// src/auth.ts
import "dotenv/config";
import http from "http";
import { google } from "googleapis";
const who = process.argv[2];
if (!who) {
    console.error('Usage: tsx src/auth.ts <source|target>');
    process.exit(1);
}
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || "http://localhost:3333/oauth/callback";
const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const scopes = [
    "https://www.googleapis.com/auth/calendar",
    "openid",
    "email"
];
const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes
});
const server = http.createServer(async (req, res) => {
    if (!req.url)
        return;
    const u = new URL(req.url, REDIRECT_URI);
    if (u.pathname !== "/oauth/callback") {
        res.writeHead(200);
        res.end("Auth server ready");
        return;
    }
    const code = u.searchParams.get("code");
    if (!code) {
        res.writeHead(400);
        res.end("Missing code");
        return;
    }
    try {
        const { tokens } = await oauth2.getToken(code);
        // Print the JSON blob so you can paste it into Railway
        console.log(`\n\n=== COPY THIS INTO RAILWAY AS ${who.toUpperCase()}_TOKENS_JSON ===\n`);
        console.log(JSON.stringify(tokens, null, 2));
        console.log("\n==============================================================\n");
        res.writeHead(200);
        res.end(`Authorized ${who}. Check your terminal for the JSON blob to paste into Railway.`);
    }
    catch (e) {
        console.error(e);
        res.writeHead(500);
        res.end("Token exchange failed");
    }
    finally {
        server.close();
    }
});
server.listen(new URL(REDIRECT_URI).port, () => {
    console.log(`\nAuthorize the ${who} account:\n${url}\n`);
});
//# sourceMappingURL=auth.js.map