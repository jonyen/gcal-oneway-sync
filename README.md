# Google Calendar One-Way Sync

Sync events from multiple source Google Calendars to a single target calendar with automatic deduplication.

## Features

- One-way sync from multiple source calendars to a target calendar
- Automatic deduplication of events
- Scheduled sync via cron
- Persistent state tracking
- Multiple deployment options (local, Raspberry Pi, or cloud)

## Quick Start (Local Setup)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up authentication:**
   ```bash
   # Authenticate source calendar(s)
   npm run auth:source

   # Authenticate target calendar
   npm run auth:target
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   nano .env
   # Fill in your calendar IDs
   ```

4. **Build and test:**
   ```bash
   npm run build
   npm run sync
   ```

5. **Set up automatic sync (every 30 minutes):**
   ```bash
   ./setup-local-cron.sh
   ```

### Managing Local Sync

- **View logs:** `tail -f sync.log`
- **Run manual sync:** `npm run sync`
- **Change schedule:** `./setup-local-cron.sh '*/15 * * * *'`
- **Remove cron job:** `crontab -l | grep -v 'onewaySync.js' | crontab -`

## Alternative Deployment Options

### Option 1: Raspberry Pi Deployment

#### Option 1A: Python Version (All Raspberry Pi Models)

**Best for: Raspberry Pi 1, Zero, or any older model (ARMv6)**

The Python version works on ALL Raspberry Pi models, including older ones that can't run modern Node.js.

See [python/README.md](python/README.md) for full instructions.

**Quick Start:**
```bash
cd ~/gcal-oneway-sync/python
./setup-pi.sh
# Follow the setup instructions
./setup-cron-py.sh
```

#### Option 1B: Node.js/Docker Version (Pi 3B+ or newer)

#### Prerequisites

- Raspberry Pi (3B+ or newer required)
- Docker and docker-compose installed
- Internet connection

#### Quick Start

1. **Clone the repository on your Raspberry Pi:**
   ```bash
   git clone <your-repo-url>
   cd gcal-oneway-sync
   ```

2. **Set up authentication:**
   ```bash
   # Install dependencies
   npm install

   # Authenticate source calendar(s)
   npm run auth:source

   # Authenticate target calendar
   npm run auth:target
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   nano .env
   # Fill in your credentials and calendar IDs
   # Copy token JSON from source-tokens.json and target-tokens.json
   # into SOURCE_TOKENS_JSON and TARGET_TOKENS_JSON
   ```

4. **Deploy the service:**
   ```bash
   ./deploy-pi.sh
   ```

5. **Set up automatic sync (every 30 minutes):**
   ```bash
   ./setup-cron.sh
   ```

#### Managing the Service

- **View logs:** `docker-compose logs -f`
- **Stop service:** `docker-compose down`
- **Restart service:** `docker-compose restart`
- **Trigger manual sync:** `curl -X POST http://localhost:8080/sync`
- **Check service status:** `curl http://localhost:8080/health`

#### Customizing Sync Schedule

The default sync runs every 30 minutes. To change:
```bash
# Every 15 minutes
./setup-cron.sh '*/15 * * * *'

# Every 2 hours
./setup-cron.sh '0 */2 * * *'

# Every hour from 9 AM to 5 PM
./setup-cron.sh '0 9-17 * * *'
```

### Option 2: Google Cloud Run Deployment (Currently Disabled)

The cloud deployment workflow is currently disabled. To re-enable:

```bash
# Re-enable the GitHub Actions workflow
mv .github/workflows/deploy.yml.disabled .github/workflows/deploy.yml
```

#### Prerequisites

- Google Cloud Platform account
- gcloud CLI installed
- GitHub repository with secrets configured

Once enabled, pushing to the `main` branch will automatically deploy to Cloud Run. See `setup-scheduler.sh` for Cloud Scheduler configuration.

## Development

### Local Development

```bash
# Install dependencies
npm install

# Run sync once
npm run dev

# Build TypeScript
npm run build

# Run built version
npm run sync
```

### Environment Variables

See `.env.example` for all available configuration options.

## Troubleshooting

### Raspberry Pi Issues

- **Docker build fails:** Ensure you have enough disk space (`df -h`)
- **Container won't start:** Check logs with `docker-compose logs`
- **Cron not working:** Verify cron job with `crontab -l` and check `/tmp/gcal-sync.log`

### Authentication Issues

- **Tokens expired:** Re-run `npm run auth:source` and `npm run auth:target`
- **Permission denied:** Ensure your OAuth app has calendar API access

## License

Private use only.
