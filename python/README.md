# Google Calendar Sync - Python Version

Python implementation of the one-way calendar sync, compatible with older Raspberry Pi models (including Pi 1 Model B+ with ARMv6).

## Features

- Compatible with Raspberry Pi 1 Model B+ and newer
- One-way sync from multiple source calendars to target calendar
- Automatic deduplication
- Incremental sync using sync tokens
- State persistence
- Lock file to prevent concurrent syncs

## Requirements

- Python 3.6 or newer
- Raspberry Pi (any model) or any Linux/macOS system
- Internet connection

## Quick Start (Raspberry Pi)

### 1. Clone and Setup

```bash
cd ~
git clone git@github.com:jonyen/gcal-oneway-sync.git
cd gcal-oneway-sync/python
./setup-pi.sh
```

### 2. Configure Environment

```bash
# Copy example env file
cp ../.env.example ../.env

# Edit configuration
nano ../.env
```

Fill in your Google OAuth credentials:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SOURCE_CALENDAR_IDS` (comma-separated)
- `TARGET_CALENDAR_ID`

### 3. Authenticate

The authentication requires a browser, so you need to do this from a machine with a web browser (can be your computer, not the Pi).

**Option A: Run auth on your computer, copy tokens to Pi**

On your computer:
```bash
cd gcal-oneway-sync/python
source venv/bin/activate  # or create venv first
python3 auth.py source
python3 auth.py target
```

Copy the JSON output and paste into your `.env` file as `SOURCE_TOKENS_JSON` and `TARGET_TOKENS_JSON`.

**Option B: Port forward from Pi (if you can SSH with browser access)**

On your Pi:
```bash
cd ~/gcal-oneway-sync/python
source venv/bin/activate
python3 auth.py source
```

On your computer (new terminal):
```bash
ssh -L 3333:localhost:3333 pi@raspberrypi.local
```

Then open the auth URL in your browser. Repeat for target.

### 4. Transfer .env to Pi

If you configured on your computer, copy the `.env` file to your Pi:

```bash
# On your computer
scp ../.env pi@raspberrypi.local:~/gcal-oneway-sync/
```

### 5. Test Sync

On your Pi:
```bash
cd ~/gcal-oneway-sync/python
source venv/bin/activate
python3 oneway_sync.py
```

### 6. Setup Automatic Sync

```bash
./setup-cron-py.sh
```

This sets up a cron job to run every 30 minutes. View logs:

```bash
tail -f ~/gcal-oneway-sync/sync.log
```

## Configuration

### Environment Variables

All configuration is in the `.env` file at the project root:

- `GOOGLE_CLIENT_ID` - OAuth client ID
- `GOOGLE_CLIENT_SECRET` - OAuth client secret
- `OAUTH_REDIRECT_URI` - Redirect URI (default: http://localhost:3333/oauth/callback)
- `SOURCE_CALENDAR_IDS` - Comma-separated source calendar IDs
- `TARGET_CALENDAR_ID` - Target calendar ID (default: primary)
- `SOURCE_TOKENS_JSON` - JSON string of source OAuth tokens
- `TARGET_TOKENS_JSON` - JSON string of target OAuth tokens
- `STATE_FILE` - Path to state file (default: state.json)
- `STATE_DISABLE` - Set to "1" to disable state persistence

### Sync Schedule

Change the cron schedule:

```bash
# Every 15 minutes
./setup-cron-py.sh '*/15 * * * *'

# Every hour
./setup-cron-py.sh '0 * * * *'

# Every 2 hours
./setup-cron-py.sh '0 */2 * * *'
```

## Manual Operations

### Reset Sync State

Force full sync (next 2 weeks):
```bash
python3 oneway_sync.py --reset
```

Reset specific calendar:
```bash
RESET_FOR=calendar@group.calendar.google.com python3 oneway_sync.py
```

### View Cron Jobs

```bash
crontab -l
```

### Remove Cron Job

```bash
crontab -l | grep -v 'oneway_sync.py' | crontab -
```

## Troubleshooting

### Python version issues

Check Python version:
```bash
python3 --version
```

If too old (< 3.6), update:
```bash
sudo apt update
sudo apt install python3 python3-pip
```

### Authentication issues

- Make sure OAuth credentials are correct in `.env`
- Verify tokens are valid JSON in `SOURCE_TOKENS_JSON` and `TARGET_TOKENS_JSON`
- Re-run authentication if tokens expired

### Sync not running

Check cron is running:
```bash
sudo service cron status
```

Check logs:
```bash
tail -f ~/gcal-oneway-sync/sync.log
```

Verify cron job exists:
```bash
crontab -l | grep oneway_sync
```

### Permission issues

Ensure scripts are executable:
```bash
chmod +x ~/gcal-oneway-sync/python/*.py
chmod +x ~/gcal-oneway-sync/python/*.sh
```

## How It Works

1. **Authentication**: OAuth2 flow with Google Calendar API
2. **Incremental Sync**: Uses Google's sync tokens to fetch only changed events
3. **Deduplication**: Multiple strategies to prevent duplicates:
   - Origin key (calendar ID + iCalUID + original start time)
   - Title + time matching
   - Event freshness comparison
4. **State Management**: Stores sync tokens to enable incremental updates
5. **Lock File**: Prevents concurrent sync runs

## Comparison with TypeScript Version

The Python version has feature parity with the TypeScript version:

- ✅ Same sync logic and deduplication
- ✅ Same configuration via .env
- ✅ Compatible with older hardware (ARMv6)
- ✅ Lower memory footprint
- ✅ No Node.js required

Choose Python if:
- You have an older Raspberry Pi (Model 1, Zero)
- You prefer Python over Node.js
- You want lower resource usage

Choose TypeScript/Node.js if:
- You have Pi 3B+ or newer
- You want Docker deployment
- You prefer the original implementation
