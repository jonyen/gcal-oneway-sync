// src/oneway.ts
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import dayjs from "dayjs";
import fs from "fs/promises";
import { google } from "googleapis";

// --- load .env from project root (works under launchd/containers too)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(projectRoot, ".env") });

// --- env
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || "http://localhost:3333/oauth/callback";

const SOURCE_IDS = (process.env.SOURCE_CALENDAR_IDS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

const TARGET_ID = process.env.TARGET_CALENDAR_ID || "primary";

const FULL_WINDOW_MONTHS = Number(process.env.FULL_WINDOW_MONTHS ?? 12);
const STATE_FILE = process.env.STATE_FILE || path.join(projectRoot, "state.json");
const STATE_DISABLE = process.env.STATE_DISABLE === "1";

// allow reset via CLI or env
const args = new Set(process.argv.slice(2));
const RESET_ALL = args.has("--reset") || process.env.RESET === "1";
const RESET_FOR = (process.env.RESET_FOR ?? "");

// tokens from env (paste JSON blobs in .env as SOURCE_TOKENS_JSON / TARGET_TOKENS_JSON)
type Tokens = {
  access_token?: string; refresh_token?: string; expiry_date?: number;
  token_type?: string; id_token?: string; scope?: string;
};
function loadTokensEnv(key: string): Tokens {
  const raw = process.env[key];
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}
const SOURCE_TOKENS = loadTokensEnv("SOURCE_TOKENS_JSON");
const TARGET_TOKENS = loadTokensEnv("TARGET_TOKENS_JSON");

// --- state (sync tokens per source)
type State = { syncTokens: Record<string, string | undefined> };
async function loadState(): Promise<State> {
  if (STATE_DISABLE) return { syncTokens: {} };
  try {
    const txt = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(txt);
    return { syncTokens: parsed.syncTokens ?? {} };
  } catch {
    console.log(`[state] no state at ${STATE_FILE}; will full-sync ${FULL_WINDOW_MONTHS}m`);
    return { syncTokens: {} };
  }
}
async function saveState(state: State) {
  if (STATE_DISABLE) return;
  try { await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2)); }
  catch (e: any) { console.warn("[state] write failed:", e?.message); }
}

// --- google helpers
function oauth(tokens: Tokens) {
  const o = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  o.setCredentials(tokens);
  return o;
}
function calendar(tokens: Tokens) {
  return google.calendar({ version: "v3", auth: oauth(tokens) });
}

// --- dedupe-safe keying
const ORIGIN_KEY = "origin";
const isoOrDate = (dt?: string, d?: string) => dt ?? d ?? "";

async function resolveCanonicalId(sourceApi: any, id: string): Promise<string> {
  if (id !== "primary") return id;
  const { data } = await sourceApi.calendarList.get({ calendarId: "primary" });
  return data.id || id;
}

// Use iCalUID (stable across calendars) + originalStart for recurring exceptions
function buildOriginKey(srcCanonicalId: string, ev: any): string {
  const base = `${srcCanonicalId}:${ev.iCalUID ?? ev.id}`;
  const orig = isoOrDate(ev.originalStartTime?.dateTime, ev.originalStartTime?.date);
  return orig ? `${base}:${orig}` : base;
}

async function findByOrigin(targetApi: any, targetId: string, key: string) {
  const { data } = await targetApi.events.list({
    calendarId: targetId,
    privateExtendedProperty: `${ORIGIN_KEY}=${key}`,
    maxResults: 2,
    singleEvents: false,
    showDeleted: false
  });
  return data.items?.[0] || null;
}

async function findByICalAndBackfill(targetApi: any, targetId: string, ev: any, key: string) {
  const iuid = ev.iCalUID;
  if (!iuid) return null;
  const { data } = await targetApi.events.list({
    calendarId: targetId,
    iCalUID: iuid,
    maxResults: 50,
    singleEvents: false,
    showDeleted: false
  });
  const items = data.items ?? [];
  if (!items.length) return null;

  // Prefer exact instance match when recurring exception
  const orig = isoOrDate(ev.originalStartTime?.dateTime, ev.originalStartTime?.date);
  const winner = orig
    ? items.find(c => isoOrDate(c.originalStartTime?.dateTime, c.originalStartTime?.date) === orig) || items[0]
    : items[0];

  // Backfill our origin tag so future runs hit fast path
  try {
    await targetApi.events.patch({
      calendarId: targetId,
      eventId: winner.id!,
      requestBody: { extendedProperties: { private: { [ORIGIN_KEY]: key } } },
      sendUpdates: "none" as any
    });
  } catch (e: any) {
    console.warn("backfill failed:", e?.message);
  }
  return winner;
}

function mirrorBodyFrom(ev: any, key: string) {
  return {
    summary: ev.summary ?? "(busy)",
    description: ev.description,
    location: ev.location,
    start: ev.start,
    end: ev.end,
    reminders: ev.reminders,
    visibility: ev.visibility,
    recurrence: ev.recurrence, // keep series when present
    attendees: undefined,      // avoid invites from target
    extendedProperties: { private: { [ORIGIN_KEY]: key } }
  };
}

async function syncOneSource(
  sourceApi: any,
  targetApi: any,
  rawSourceId: string,
  targetId: string,
  state: State
) {
  const sourceId = await resolveCanonicalId(sourceApi, rawSourceId);

  const baseParams: any = {
    calendarId: sourceId,
    showDeleted: true,
    maxResults: 2500
  };
  const token = state.syncTokens[sourceId];
  if (token) baseParams.syncToken = token;
  else baseParams.timeMin = dayjs().subtract(FULL_WINDOW_MONTHS, "month").toISOString();

  let pageToken: string | undefined;

  do {
    try {
      const { data } = await sourceApi.events.list({ ...baseParams, pageToken });
      const items = data.items ?? [];
      console.log(`[fetch] ${sourceId} -> ${targetId} items=${items.length} ${token ? "(inc)" : "(full)"}`);

      for (const ev of items) {
        const key = buildOriginKey(sourceId, ev);

        if (ev.status === "cancelled") {
          // delete mirrored event if it exists
          const mirror = await (findByOrigin(targetApi, targetId, key) || findByICalAndBackfill(targetApi, targetId, ev, key));
          if (mirror) {
            try {
              await targetApi.events.delete({
                calendarId: targetId,
                eventId: mirror.id!,
                sendUpdates: "none" as any
              });
              console.log(`  - deleted mirror for ${key}`);
            } catch (e: any) {
              console.warn(`  ! delete failed for ${key}: ${e?.message}`);
            }
          }
          continue;
        }

        // Upsert in target
        let mirror = await findByOrigin(targetApi, targetId, key);
        if (!mirror) mirror = await findByICalAndBackfill(targetApi, targetId, ev, key);

        const body = mirrorBodyFrom(ev, key);

        if (!mirror) {
          const { data: created } = await targetApi.events.insert({
            calendarId: targetId,
            requestBody: body,
            sendUpdates: "none"
          });
          console.log(`  + created ${created.id} for ${key}`);
        } else {
          await targetApi.events.patch({
            calendarId: targetId,
            eventId: mirror.id!,
            requestBody: body,
            sendUpdates: "none"
          });
          console.log(`  ~ updated ${mirror.id} for ${key}`);
        }
      }

      pageToken = data.nextPageToken || undefined;
      if (data.nextSyncToken) {
        state.syncTokens[sourceId] = data.nextSyncToken;
        await saveState(state);
      }
    } catch (e: any) {
      const code = e?.code || e?.response?.status;
      if (code === 410) {
        console.warn(`[${sourceId}] stale sync token → resetting to full window`);
        delete state.syncTokens[sourceId];
        await saveState(state);
        delete baseParams.syncToken;
        baseParams.timeMin = dayjs().subtract(FULL_WINDOW_MONTHS, "month").toISOString();
        pageToken = undefined;
        continue;
      }
      throw e;
    }
  } while (pageToken);
}

// Exported entry so we can run via HTTP (Cloud Run) or CLI
export async function main() {
  if (!SOURCE_IDS.length) {
    console.error("Set SOURCE_CALENDAR_IDS (comma-separated).");
    process.exit(1);
  }

  const src = calendar(SOURCE_TOKENS);
  const tgt = calendar(TARGET_TOKENS);

  const state = await loadState();
  if (RESET_ALL) {
    state.syncTokens = {};
  } else if (RESET_FOR) {
    for (const id of RESET_FOR.split(",").map(s => s.trim()).filter(Boolean)) {
      delete state.syncTokens[id];
    }
  }

  console.log("---- Sync run", new Date().toISOString(), "----");
  console.log("Sources:", SOURCE_IDS.join(", "));
  console.log("Target :", TARGET_ID);

  for (const srcId of SOURCE_IDS) {
    await syncOneSource(src, tgt, srcId, TARGET_ID, state);
  }

  console.log("Done.");
}

// Allow direct CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
