import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { google } from "googleapis";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env") });
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || "http://localhost:3333/oauth/callback";
const TARGET_CALENDAR_ID = process.env.TARGET_CALENDAR_ID;
const TARGET_TOKENS = JSON.parse(process.env.TARGET_TOKENS_JSON || "{}");
// Set DRY_RUN=1 to only log actions, not delete
const DRY_RUN = process.env.DRY_RUN === "1";
function oauth(tokens) {
    const o = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    o.setCredentials(tokens);
    return o;
}
function cal(tokens) {
    return google.calendar({ version: "v3", auth: oauth(tokens) });
}
function isAllDayEvent(event) {
    // All-day events have start.date instead of start.dateTime
    return !!(event.start?.date && !event.start?.dateTime);
}
async function clearAllDayEvents() {
    const calendar = cal(TARGET_TOKENS);
    console.log(`Scanning target calendar ${TARGET_CALENDAR_ID} for all-day events...`);
    let pageToken;
    let found = 0, deleted = 0;
    do {
        const { data } = await calendar.events.list({
            calendarId: TARGET_CALENDAR_ID,
            maxResults: 2500,
            singleEvents: false,
            showDeleted: false,
            pageToken
        });
        for (const event of data.items ?? []) {
            if (isAllDayEvent(event)) {
                found++;
                console.log(`Found all-day event: "${event.summary}" on ${event.start?.date} (${event.id})`);
                if (DRY_RUN) {
                    console.log(`[DRY RUN] Would delete all-day event: ${event.id}`);
                }
                else {
                    try {
                        await calendar.events.delete({
                            calendarId: TARGET_CALENDAR_ID,
                            eventId: event.id,
                            sendUpdates: "none"
                        });
                        deleted++;
                        console.log(`Deleted all-day event: ${event.id}`);
                        // Add small delay to respect rate limits
                        if (deleted % 10 === 0) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                    }
                    catch (e) {
                        console.warn(`Failed to delete all-day event ${event.id}: ${e.message}`);
                    }
                }
            }
        }
        pageToken = data.nextPageToken || undefined;
    } while (pageToken);
    if (DRY_RUN) {
        console.log(`Found ${found} all-day events (dry run mode)`);
    }
    else {
        console.log(`Cleanup complete. Found ${found}, deleted ${deleted} all-day events`);
    }
}
clearAllDayEvents().catch(err => {
    console.error("All-day event cleanup failed:", err);
    process.exit(1);
});
//# sourceMappingURL=clearAllDay.js.map