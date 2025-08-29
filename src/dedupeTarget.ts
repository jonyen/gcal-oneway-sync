import "dotenv/config";
import { google } from "googleapis";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || "http://localhost:3333/oauth/callback";

const TARGET_CALENDAR_ID = process.env.TARGET_CALENDAR_ID!;
const TARGET_TOKENS = JSON.parse(process.env.TARGET_TOKENS_JSON || "{}");

// Set DRY_RUN=1 to only log actions, not delete
const DRY_RUN = process.env.DRY_RUN === "1";

function oauth(tokens: any) {
  const o = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  o.setCredentials(tokens);
  return o;
}

function cal(tokens: any) {
  return google.calendar({ version: "v3", auth: oauth(tokens) });
}

async function dedupe() {
  const calendar = cal(TARGET_TOKENS);

  let pageToken: string | undefined;
  const groups: Record<string, any[]> = {};

  console.log(`Scanning target calendar ${TARGET_CALENDAR_ID} for duplicates…`);

  do {
    const { data } = await calendar.events.list({
      calendarId: TARGET_CALENDAR_ID,
      maxResults: 2500,
      singleEvents: false,
      showDeleted: false,
      pageToken
    });

    for (const ev of data.items ?? []) {
      const origin = ev.extendedProperties?.private?.origin;
      if (!origin) continue;
      groups[origin] = groups[origin] || [];
      groups[origin].push(ev);
    }

    pageToken = data.nextPageToken || undefined;
  } while (pageToken);

  let deleted = 0, kept = 0;

  for (const [origin, events] of Object.entries(groups)) {
    if (events.length <= 1) continue;

    // Sort by creation time
    const sorted = events.sort((a, b) =>
      new Date(a.created!).getTime() - new Date(b.created!).getTime()
    );

    const keep = sorted[0];
    kept++;
    const dupes = sorted.slice(1);

    for (const d of dupes) {
      if (DRY_RUN) {
        console.log(`[DRY RUN] Would delete duplicate ${d.id} for origin ${origin}`);
      } else {
        try {
          await calendar.events.delete({
            calendarId: TARGET_CALENDAR_ID,
            eventId: d.id!,
            sendUpdates: "none" as any
          });
          deleted++;
          console.log(`Deleted duplicate ${d.id} for origin ${origin}`);
        } catch (e: any) {
          console.warn(`Failed to delete ${d.id}: ${e.message}`);
        }
      }
    }
  }

  if (DRY_RUN) {
    console.log(`Dry run complete. Found ${kept} groups with duplicates.`);
  } else {
    console.log(`Deduplication complete. Kept ${kept}, deleted ${deleted}.`);
  }
}

dedupe().catch(err => {
  console.error("Deduper failed:", err);
  process.exit(1);
});
