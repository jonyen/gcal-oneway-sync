// src/oneway.ts
import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import dayjs from "dayjs";
import { google } from "googleapis";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// project root = dist/.. when compiled
const projectRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(projectRoot, ".env") });

type Tokens = {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  id_token?: string;
  scope?: string;
};

type State = {
  syncTokens: Record<string, string | undefined>; // per source calendar
};

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || "http://localhost:3333/oauth/callback";

const SOURCE_IDS = (process.env.SOURCE_CALENDAR_IDS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const TARGET_ID = process.env.TARGET_CALENDAR_ID || "primary";

// files
const TOKENS_SOURCE = path.join(process.cwd(), "tokens-source.json");
const TOKENS_TARGET = path.join(process.cwd(), "tokens-target.json");
const STATE_FILE = path.join(process.cwd(), "state.json");

// origin tag
const ORIGIN_KEY = "origin"; // extendedProperties.private.origin

// --- helpers
async function loadJSON<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}
async function saveJSON<T>(file: string, data: T): Promise<void> {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

function oauthClient(tokens: Tokens) {
  const o = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  o.setCredentials(tokens);
  return o;
}

function calendarClient(tokens: Tokens) {
  return google.calendar({ version: "v3", auth: oauthClient(tokens) });
}

// Build a stable origin key for an event (handles recurring exceptions)
function originKey(sourceCalId: string, ev: any): string {
  const base = `${sourceCalId}:${ev.id}`;
  const orig = ev.originalStartTime?.dateTime || ev.originalStartTime?.date;
  return orig ? `${base}:${orig}` : base;
}

// Find mirrored event in target by origin extended property
async function findMirror(targetCal: any, targetCalId: string, key: string) {
  const { data } = await targetCal.events.list({
    calendarId: targetCalId,
    privateExtendedProperty: `${ORIGIN_KEY}=${key}`,
    maxResults: 2,
    showDeleted: false,
    singleEvents: false
  });
  return (data.items && data.items[0]) || null;
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
    recurrence: ev.recurrence,                 // keep series if present
    attendees: undefined,                      // optional: omit to avoid invites
    extendedProperties: { private: { [ORIGIN_KEY]: key } }
  };
}

async function syncOneSource(sourceCalId: string, source: any, target: any, targetId: string, state: State) {
  const params: any = {
    calendarId: sourceCalId,
    showDeleted: true,
    maxResults: 2500,
    // singleEvents: false to get masters + instances as API decides (we handle either)
  };

  const stored = state.syncTokens[sourceCalId];
  if (stored) {
    params.syncToken = stored;
  } else {
    // first-time: pull ~12 months back
    params.timeMin = dayjs().subtract(12, "month").toISOString();
  }

  let pageToken: string | undefined;

  do {
    try {
      const { data } = await source.events.list({ ...params, pageToken });
      const items = data.items ?? [];
      console.log(`[fetch] ${sourceCalId} items=${items.length} ${params.syncToken ? "(incremental)" : "(first sync)"}`);

      for (const ev of items) {
        const key = originKey(sourceCalId, ev);

        if (ev.status === "cancelled") {
          // delete mirror if exists
          const mirror = await findMirror(target, targetId, key);
          if (mirror) {
            try {
              await target.events.delete({ calendarId: targetId, eventId: mirror.id, sendUpdates: "none" as any });
              console.log(`  - deleted mirror for ${key}`);
            } catch (e) {
              console.warn(`  ! delete failed for ${key}`, (e as any)?.message);
            }
          }
          continue;
        }

        // Create or update in target
        const mirror = await findMirror(target, targetId, key);
        const body = mirrorBodyFrom(ev, key);

        if (!mirror) {
          const { data: created } = await target.events.insert({
            calendarId: targetId,
            requestBody: body,
            sendUpdates: "none"
          });
          console.log(`  + created mirror for ${key} -> ${created.id}`);
        } else {
          await target.events.patch({
            calendarId: targetId,
            eventId: mirror.id,
            requestBody: body,
            sendUpdates: "none"
          });
          console.log(`  ~ updated mirror for ${key} -> ${mirror.id}`);
        }
      }

      pageToken = data.nextPageToken || undefined;
      if (data.nextSyncToken) {
        state.syncTokens[sourceCalId] = data.nextSyncToken;
        await saveJSON(STATE_FILE, state);
      }
    } catch (e: any) {
      // If syncToken is invalid/stale, clear and restart with full window
      const code = e?.code || e?.response?.status;
      if (code === 410) {
        console.warn(`[${sourceCalId}] sync token stale, resetting…`);
        delete state.syncTokens[sourceCalId];
        await saveJSON(STATE_FILE, state);
        // reset params to full window
        delete params.syncToken;
        params.timeMin = dayjs().subtract(12, "month").toISOString();
        pageToken = undefined;
        continue;
      }
      throw e;
    }
  } while (pageToken);
}

async function main() {
  if (!SOURCE_IDS.length) {
    console.error("Set SOURCE_CALENDAR_IDS in .env (comma-separated).");
    process.exit(1);
  }

  const sourceTokens = await loadJSON<Tokens>(TOKENS_SOURCE, {} as Tokens);
  const targetTokens = await loadJSON<Tokens>(TOKENS_TARGET, {} as Tokens);
  if (!sourceTokens.refresh_token || !targetTokens.refresh_token) {
    console.error("Run auth first: npm run auth:source && npm run auth:target");
    process.exit(1);
  }

  const state = await loadJSON<State>(STATE_FILE, { syncTokens: {} });

  const sourceCal = calendarClient(sourceTokens);
  const targetCal = calendarClient(targetTokens);

  console.log(`One-way sync: [${SOURCE_IDS.join(", ")}]  →  ${TARGET_ID}`);

  for (const srcId of SOURCE_IDS) {
    await syncOneSource(srcId, sourceCal, targetCal, TARGET_ID, state);
  }

  console.log("Done.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

