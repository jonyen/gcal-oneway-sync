#!/usr/bin/env python3
"""OAuth2 authentication for Google Calendar API."""

import os
import sys
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from google_auth_oauthlib.flow import Flow
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

CLIENT_ID = os.getenv('GOOGLE_CLIENT_ID')
CLIENT_SECRET = os.getenv('GOOGLE_CLIENT_SECRET')
REDIRECT_URI = os.getenv('OAUTH_REDIRECT_URI', 'http://localhost:3333/oauth/callback')

SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/userinfo.email',
    'openid'
]

class OAuthHandler(BaseHTTPRequestHandler):
    """Handle OAuth callback."""

    def do_GET(self):
        """Handle GET request."""
        parsed = urlparse(self.path)

        if parsed.path != '/oauth/callback':
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'Auth server ready')
            return

        params = parse_qs(parsed.query)
        code = params.get('code', [None])[0]

        if not code:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'Missing code')
            return

        try:
            # Exchange code for tokens
            flow = Flow.from_client_config(
                {
                    "web": {
                        "client_id": CLIENT_ID,
                        "client_secret": CLIENT_SECRET,
                        "redirect_uris": [REDIRECT_URI],
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                        "token_uri": "https://oauth2.googleapis.com/token"
                    }
                },
                scopes=SCOPES,
                redirect_uri=REDIRECT_URI
            )

            flow.fetch_token(code=code)
            credentials = flow.credentials

            # Convert to dict format compatible with TypeScript version
            tokens = {
                'access_token': credentials.token,
                'refresh_token': credentials.refresh_token,
                'token_type': 'Bearer',
                'expiry_date': int(credentials.expiry.timestamp() * 1000) if credentials.expiry else None,
                'scope': ' '.join(credentials.scopes) if credentials.scopes else None
            }

            # Print tokens
            print(f'\n\n=== COPY THIS INTO .env AS {self.server.who.upper()}_TOKENS_JSON ===\n')
            print(json.dumps(tokens, indent=2))
            print('\n==============================================================\n')

            # Save to file
            token_file = f'{self.server.who}-tokens.json'
            with open(token_file, 'w') as f:
                json.dump(tokens, f, indent=2)
            print(f'Tokens saved to {token_file}')

            self.send_response(200)
            self.end_headers()
            self.wfile.write(f'Authorized {self.server.who}. Check your terminal for the JSON blob.'.encode())

        except Exception as e:
            print(f'Error: {e}')
            self.send_response(500)
            self.end_headers()
            self.wfile.write(b'Token exchange failed')
        finally:
            # Shutdown server after handling request
            import threading
            threading.Thread(target=self.server.shutdown).start()

    def log_message(self, format, *args):
        """Suppress log messages."""
        pass


def main():
    """Run OAuth flow."""
    if len(sys.argv) < 2 or sys.argv[1] not in ['source', 'target']:
        print('Usage: python3 auth.py <source|target>')
        sys.exit(1)

    who = sys.argv[1]

    # Create flow
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "redirect_uris": [REDIRECT_URI],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token"
            }
        },
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI
    )

    auth_url, _ = flow.authorization_url(
        access_type='offline',
        prompt='consent'
    )

    print(f'\nAuthorize the {who} account:\n{auth_url}\n')

    # Start server
    port = int(urlparse(REDIRECT_URI).port or 3333)
    server = HTTPServer(('', port), OAuthHandler)
    server.who = who

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nInterrupted')
        server.shutdown()


if __name__ == '__main__':
    main()
