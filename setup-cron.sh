#!/bin/bash

# Cron setup script for Raspberry Pi
# Replaces Google Cloud Scheduler with local cron jobs

set -e

echo "=== Setting up Cron for Calendar Sync ==="
echo ""

# Default: sync every 30 minutes
CRON_SCHEDULE="${1:-*/30 * * * *}"
SYNC_URL="http://localhost:8080/sync"

echo "This script will set up a cron job to trigger sync at:"
echo "  Schedule: $CRON_SCHEDULE"
echo "  Target: $SYNC_URL"
echo ""

# Check if service is running
if ! curl -s "$SYNC_URL/../health" &> /dev/null; then
    echo "Warning: Service is not responding at http://localhost:8080"
    echo "Make sure the service is running with: ./deploy-pi.sh"
    echo ""
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Create a cron job entry
CRON_CMD="curl -X POST -s $SYNC_URL >> /tmp/gcal-sync.log 2>&1"
CRON_ENTRY="$CRON_SCHEDULE $CRON_CMD"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "$SYNC_URL"; then
    echo "Cron job already exists. Removing old entry..."
    crontab -l 2>/dev/null | grep -v "$SYNC_URL" | crontab -
fi

# Add new cron job
(crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -

echo "✓ Cron job added successfully!"
echo ""
echo "Current cron jobs:"
crontab -l | grep -v '^#' | grep -v '^$' || echo "  (none)"
echo ""
echo "To view sync logs:"
echo "  tail -f /tmp/gcal-sync.log"
echo ""
echo "To modify the schedule, run:"
echo "  ./setup-cron.sh 'YOUR_CRON_SCHEDULE'"
echo ""
echo "Examples:"
echo "  ./setup-cron.sh '*/15 * * * *'  # Every 15 minutes"
echo "  ./setup-cron.sh '0 */2 * * *'   # Every 2 hours"
echo "  ./setup-cron.sh '0 9-17 * * *'  # Every hour from 9 AM to 5 PM"
echo ""
echo "To remove the cron job:"
echo "  crontab -l | grep -v '$SYNC_URL' | crontab -"
