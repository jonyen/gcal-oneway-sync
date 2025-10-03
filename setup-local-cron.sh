#!/bin/bash

# Local cron setup script
# Runs calendar sync directly using Node.js (no Docker required)

set -e

echo "=== Setting up Local Cron for Calendar Sync ==="
echo ""

# Get the absolute path to the project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$PROJECT_DIR/sync.log"

# Default: sync every 30 minutes
CRON_SCHEDULE="${1:-*/30 * * * *}"

echo "Project directory: $PROJECT_DIR"
echo "Log file: $LOG_FILE"
echo "Cron schedule: $CRON_SCHEDULE"
echo ""

# Check if .env file exists
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo "Error: .env file not found!"
    echo "Please copy .env.example to .env and configure it:"
    echo "  cp .env.example .env"
    echo "  nano .env"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
    echo "Error: node_modules not found!"
    echo "Please run: npm install"
    exit 1
fi

# Check if build exists
if [ ! -d "$PROJECT_DIR/dist" ]; then
    echo "Building the project..."
    cd "$PROJECT_DIR"
    npm run build
fi

# Create the sync command
SYNC_CMD="cd $PROJECT_DIR && /usr/bin/env node dist/onewaySync.js >> $LOG_FILE 2>&1 && /usr/bin/env node dist/dedupeTarget.js >> $LOG_FILE 2>&1"

# Create cron entry with full command
CRON_ENTRY="$CRON_SCHEDULE $SYNC_CMD"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "onewaySync.js"; then
    echo "Cron job already exists. Removing old entry..."
    crontab -l 2>/dev/null | grep -v "onewaySync.js" | crontab -
fi

# Add new cron job
(crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -

echo "✓ Cron job added successfully!"
echo ""
echo "Current cron jobs:"
crontab -l
echo ""
echo "To view sync logs:"
echo "  tail -f $LOG_FILE"
echo ""
echo "To test the sync manually:"
echo "  npm run sync"
echo ""
echo "To modify the schedule, run:"
echo "  ./setup-local-cron.sh 'YOUR_CRON_SCHEDULE'"
echo ""
echo "Examples:"
echo "  ./setup-local-cron.sh '*/15 * * * *'  # Every 15 minutes"
echo "  ./setup-local-cron.sh '0 */2 * * *'   # Every 2 hours"
echo "  ./setup-local-cron.sh '0 9-17 * * *'  # Every hour from 9 AM to 5 PM"
echo ""
echo "To remove the cron job:"
echo "  crontab -l | grep -v 'onewaySync.js' | crontab -"
