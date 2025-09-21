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

// Removed FULL_WINDOW_MONTHS - now syncing only upcoming 2 weeks
const STATE_FILE = process.env.STATE_FILE || path.join(projectRoot, "state.json");
const STATE_DISABLE = process.env.STATE_DISABLE === "1";
const LOCK_FILE = path.join(projectRoot, "sync.lock");

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
    console.log(`[state] no state at ${STATE_FILE}; will sync upcoming 2 weeks`);
    return { syncTokens: {} };
  }
}
async function saveState(state: State) {
  if (STATE_DISABLE) return;
  try { await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2)); }
  catch (e: any) { console.warn("[state] write failed:", e?.message); }
}

// Lock management to prevent concurrent syncs
async function acquireLock(): Promise<boolean> {
  try {
    await fs.writeFile(LOCK_FILE, process.pid.toString(), { flag: 'wx' });
    return true;
  } catch (e: any) {
    if (e.code === 'EEXIST') {
      try {
        const pidStr = await fs.readFile(LOCK_FILE, 'utf8');
        const pid = parseInt(pidStr.trim());

        // Check if process is still running
        try {
          process.kill(pid, 0);
          console.warn(`[lock] sync already running (PID ${pid})`);
          return false;
        } catch {
          // Process doesn't exist, remove stale lock
          console.log(`[lock] removing stale lock for PID ${pid}`);
          await fs.unlink(LOCK_FILE);
          return await acquireLock();
        }
      } catch {
        // Can't read lock file, remove it
        await fs.unlink(LOCK_FILE).catch(() => {});
        return await acquireLock();
      }
    }
    throw e;
  }
}

async function releaseLock() {
  try {
    await fs.unlink(LOCK_FILE);
  } catch (e: any) {
    if (e.code !== 'ENOENT') {
      console.warn("[lock] release failed:", e?.message);
    }
  }
}

// --- google helpers with rate limiting
function oauth(tokens: Tokens) {
  const o = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  o.setCredentials(tokens);
  return o;
}
function calendar(tokens: Tokens) {
  return google.calendar({ version: "v3", auth: oauth(tokens) });
}

// Rate limiting helper
async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- dedupe-safe keying
const ORIGIN_KEY = "origin";
const isoOrDate = (dt?: string, d?: string) => dt ?? d ?? "";

async function resolveCanonicalId(sourceApi: any, id: string): Promise<string> {
  if (id !== "primary") return id;
  const { data } = await sourceApi.calendarList.get({ calendarId: "primary" });
  return data.id || id;
}

// Normalize iCalUID by removing @google.com suffix for consistent deduplication
function normalizeICalUID(iCalUID: string): string {
  return iCalUID ? iCalUID.replace(/@google\.com$/, '') : iCalUID;
}

// Use iCalUID (stable across calendars) + originalStart for recurring exceptions
function buildOriginKey(srcCanonicalId: string, ev: any): string {
  const normalizedUID = normalizeICalUID(ev.iCalUID ?? ev.id);
  const base = `${srcCanonicalId}:${normalizedUID}`;
  const orig = isoOrDate(ev.originalStartTime?.dateTime, ev.originalStartTime?.date);
  return orig ? `${base}:${orig}` : base;
}

async function findByOrigin(targetApi: any, targetId: string, key: string) {
  const { data } = await targetApi.events.list({
    calendarId: targetId,
    privateExtendedProperty: `${ORIGIN_KEY}=${key}`,
    maxResults: 10,
    singleEvents: false,
    showDeleted: false
  });
  const items = data.items || [];

  // If multiple items found, prefer the oldest (first created)
  if (items.length > 1) {
    console.warn(`  ! found ${items.length} events for origin ${key}, using oldest`);
    return items.sort((a: any, b: any) =>
      new Date(a.created!).getTime() - new Date(b.created!).getTime()
    )[0];
  }

  return items[0] || null;
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
    ? items.find((c: any) => isoOrDate(c.originalStartTime?.dateTime, c.originalStartTime?.date) === orig) || items[0]
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
    // Skip reminders to avoid conflicts - let target calendar use defaults
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
  if (token) {
    baseParams.syncToken = token;
  } else {
    // Sync only upcoming 2 weeks
    baseParams.timeMin = dayjs().toISOString();
    baseParams.timeMax = dayjs().add(2, "week").toISOString();
  }

  let pageToken: string | undefined;

  do {
    try {
      const { data } = await sourceApi.events.list({ ...baseParams, pageToken });
      const items = data.items ?? [];
      console.log(`[fetch] ${sourceId} -> ${targetId} items=${items.length} ${token ? "(inc)" : "(full)"}`);

      for (let i = 0; i < items.length; i++) {
        const ev = items[i];
        const key = buildOriginKey(sourceId, ev);

        // Add small delay every 10 events to avoid quota issues
        if (i > 0 && i % 10 === 0) {
          await sleep(100);
        }

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

        // Robust deduplication with multiple checks
        let mirror = await findByOrigin(targetApi, targetId, key);
        if (!mirror) mirror = await findByICalAndBackfill(targetApi, targetId, ev, key);

        const body = mirrorBodyFrom(ev, key);

        if (!mirror) {
          // Triple-check before creating to prevent duplicates
          mirror = await findByOrigin(targetApi, targetId, key);
          if (!mirror) {
            try {
              const { data: created } = await targetApi.events.insert({
                calendarId: targetId,
                requestBody: body,
                sendUpdates: "none"
              });
              console.log(`  + created ${created.id} for ${key}`);
            } catch (insertError: any) {
              // Enhanced race condition handling
              console.warn(`  ! insert failed for ${key}, checking for race condition: ${insertError?.message}`);

              // Wait a moment and check again more thoroughly
              await sleep(200);
              mirror = await findByOrigin(targetApi, targetId, key);
              if (!mirror) mirror = await findByICalAndBackfill(targetApi, targetId, ev, key);

              if (mirror) {
                try {
                  await targetApi.events.patch({
                    calendarId: targetId,
                    eventId: mirror.id!,
                    requestBody: body,
                    sendUpdates: "none"
                  });
                  console.log(`  ~ updated ${mirror.id} for ${key} (race condition resolved)`);
                } catch (patchError: any) {
                  console.warn(`  ! patch failed after race condition: ${patchError?.message}`);
                }
              } else {
                // Last resort: check if the error was due to a duplicate iCalUID
                if (insertError?.message?.includes('duplicate') || insertError?.message?.includes('already exists')) {
                  console.warn(`  ! duplicate detected, event may already exist: ${key}`);
                } else {
                  throw insertError;
                }
              }
            }
          } else {
            // Found during triple-check, update instead
            await targetApi.events.patch({
              calendarId: targetId,
              eventId: mirror.id!,
              requestBody: body,
              sendUpdates: "none"
            });
            console.log(`  ~ updated ${mirror.id} for ${key} (found during triple-check)`);
          }
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
        console.warn(`[${sourceId}] stale sync token → resetting to 2-week window`);
        delete state.syncTokens[sourceId];
        await saveState(state);
        delete baseParams.syncToken;
        baseParams.timeMin = dayjs().toISOString();
        baseParams.timeMax = dayjs().add(2, "week").toISOString();
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

  // Acquire lock to prevent concurrent syncs
  const lockAcquired = await acquireLock();
  if (!lockAcquired) {
    console.log("Sync already in progress, exiting.");
    return;
  }

  try {
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
  } finally {
    await releaseLock();
  }
}

// Allow direct CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
