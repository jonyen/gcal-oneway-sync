import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { google } from "googleapis";

// Ensure we load the same .env as oneway.ts
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || "http://localhost:3333/oauth/callback";

// Use the TARGET (Gmail) tokens here, since we’re deleting from the target
function oauth(tokens: any) {
  const o = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  o.setCredentials(tokens);
  return o;
}

function cal(tokens: any) {
  return google.calendar({ version: "v3", auth: oauth(tokens) });
}

// ENV you provide:
const OLD_TARGET_CAL_ID = process.env.OLD_TARGET_CAL_ID!; // calendar we are cleaning
const SOURCE_IDS = (process.env.SOURCE_CALENDAR_IDS||"").split(",").map(s=>s.trim()).filter(Boolean);
const TARGET_TOKENS = JSON.parse(process.env.TARGET_TOKENS_JSON || "{}"); // see your Railway/env setup

if (!OLD_TARGET_CAL_ID || !SOURCE_IDS.length) {
  console.error("Set OLD_TARGET_CAL_ID and SOURCE_CALENDAR_IDS in env.");
  process.exit(1);
}

const ORIGIN_KEY = "origin";

async function run() {
  const target = cal(TARGET_TOKENS);
  console.log(`Cleaning old target: ${OLD_TARGET_CAL_ID}`);

  let pageToken: string|undefined;
  let deleted = 0, seen = 0;

  do {
    const { data } = await target.events.list({
      calendarId: OLD_TARGET_CAL_ID,
      maxResults: 2500,
      pageToken,
      showDeleted: false,
      singleEvents: false
    });
    for (const ev of data.items ?? []) {
      seen++;
      const origin = ev.extendedProperties?.private?.[ORIGIN_KEY] as string|undefined;
      if (!origin) continue;
      // If origin starts with one of our source IDs, we consider it a mirror we created.
      if (SOURCE_IDS.some(src => origin.startsWith(`${src}:`))) {
        try {
          await target.events.delete({ calendarId: OLD_TARGET_CAL_ID, eventId: ev.id!, sendUpdates: "none" as any });
          deleted++;
          if (deleted % 50 === 0) console.log(`Deleted ${deleted} so far...`);
        } catch (e:any) {
          console.warn(`Failed delete ${ev.id}:`, e.message);
        }
      }
    }
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);

  console.log(`Scanned ${seen} events, deleted ${deleted}.`);
}

run().catch(e => { console.error(e); process.exit(1); });

