import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import dayjs from "dayjs";
import { google } from "googleapis";

// Ensure we load the same .env as oneway.ts
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || "http://localhost:3333/oauth/callback";

// Use the TARGET tokens here, since we're deleting from the target
function oauth(tokens: any) {
  const o = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  o.setCredentials(tokens);
  return o;
}

function cal(tokens: any) {
  return google.calendar({ version: "v3", auth: oauth(tokens) });
}

// ENV you provide:
const TARGET_CAL_ID = process.env.TARGET_CALENDAR_ID!; // calendar we are cleaning
const SOURCE_IDS = (process.env.SOURCE_CALENDAR_IDS||"").split(",").map(s=>s.trim()).filter(Boolean);
const TARGET_TOKENS = JSON.parse(process.env.TARGET_TOKENS_JSON || "{}");

// Set DRY_RUN=1 to only log actions, not delete
const DRY_RUN = process.env.DRY_RUN === "1";

if (!TARGET_CAL_ID || !SOURCE_IDS.length) {
  console.error("Set TARGET_CALENDAR_ID and SOURCE_CALENDAR_IDS in env.");
  process.exit(1);
}

const ORIGIN_KEY = "origin";

function formatEventDate(event: any): string {
  const start = event.start;
  if (!start) return "(no date)";

  const dateTime = start.dateTime || start.date;
  if (!dateTime) return "(no date)";

  try {
    const date = new Date(dateTime);
    return date.toLocaleDateString();
  } catch {
    return "(invalid date)";
  }
}

async function resolveCanonicalId(sourceApi: any, id: string): Promise<string> {
  if (id !== "primary") return id;
  const { data } = await sourceApi.calendarList.get({ calendarId: "primary" });
  return data.id || id;
}

async function run() {
  const target = cal(TARGET_TOKENS);
  const source = cal(JSON.parse(process.env.SOURCE_TOKENS_JSON || "{}"));

  // Resolve canonical source IDs for comparison
  const canonicalSourceIds = new Set<string>();
  for (const rawSrcId of SOURCE_IDS) {
    const canonicalId = await resolveCanonicalId(source, rawSrcId);
    canonicalSourceIds.add(canonicalId);
  }

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Clearing synced events from next two weeks in target: ${TARGET_CAL_ID}`);
  console.log("Time range:", dayjs().format(), "to", dayjs().add(2, "week").format());
  console.log("Looking for events from source calendars:", Array.from(canonicalSourceIds).join(", "));

  const timeMin = dayjs().toISOString();
  const timeMax = dayjs().add(2, "week").toISOString();

  let pageToken: string|undefined;
  let deleted = 0, seen = 0;

  do {
    const { data } = await target.events.list({
      calendarId: TARGET_CAL_ID,
      maxResults: 2500,
      pageToken,
      timeMin,
      timeMax,
      showDeleted: false,
      singleEvents: false
    });

    for (const ev of data.items ?? []) {
      seen++;
      const origin = ev.extendedProperties?.private?.[ORIGIN_KEY] as string|undefined;
      if (!origin) continue;

      // Check if origin starts with one of our canonical source IDs
      const isFromOurSources = Array.from(canonicalSourceIds).some(src => origin.startsWith(`${src}:`));

      if (isFromOurSources) {
        if (DRY_RUN) {
          console.log(`[DRY RUN] Would delete "${ev.summary || '(no title)'}" (${formatEventDate(ev)}) (${ev.id}) - origin: ${origin}`);
          deleted++;
        } else {
          try {
            await target.events.delete({
              calendarId: TARGET_CAL_ID,
              eventId: ev.id!,
              sendUpdates: "none" as any
            });
            console.log(`Deleted "${ev.summary || '(no title)'}" (${formatEventDate(ev)}) (${ev.id}) - origin: ${origin}`);
            deleted++;
            if (deleted % 25 === 0) {
              console.log(`Deleted ${deleted} events so far...`);
              // Add small delay to respect rate limits
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          } catch (e:any) {
            console.warn(`Failed to delete "${ev.summary || '(no title)'}" (${ev.id}):`, e.message);
          }
        }
      }
    }
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);

  if (DRY_RUN) {
    console.log(`[DRY RUN] Scanned ${seen} events in next two weeks, would delete ${deleted} synced events.`);
  } else {
    console.log(`Scanned ${seen} events in next two weeks, deleted ${deleted} synced events.`);
  }
}

run().catch(e => { console.error(e); process.exit(1); });