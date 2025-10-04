#!/bin/bash
# Setup cron job for Python version of calendar sync

# Get script directory (absolute path)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Default: every 30 minutes
SCHEDULE="${1:-*/30 * * * *}"

# Paths
VENV_PYTHON="$SCRIPT_DIR/venv/bin/python3"
SYNC_SCRIPT="$SCRIPT_DIR/oneway_sync.py"
LOG_FILE="$PROJECT_ROOT/sync.log"

# Verify files exist
if [ ! -f "$VENV_PYTHON" ]; then
    echo "Error: Virtual environment not found at $VENV_PYTHON"
    echo "Run setup-pi.sh first"
    exit 1
fi

if [ ! -f "$SYNC_SCRIPT" ]; then
    echo "Error: Sync script not found at $SYNC_SCRIPT"
    exit 1
fi

# Create cron command
CRON_CMD="$SCHEDULE cd $PROJECT_ROOT && $VENV_PYTHON $SYNC_SCRIPT >> $LOG_FILE 2>&1"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -F "$SYNC_SCRIPT" > /dev/null; then
    echo "Removing existing cron job..."
    crontab -l | grep -v "$SYNC_SCRIPT" | crontab -
fi

# Add new cron job
echo "Adding cron job: $SCHEDULE"
(crontab -l 2>/dev/null; echo "$CRON_CMD") | crontab -

echo ""
echo "Cron job installed successfully!"
echo "Schedule: $SCHEDULE"
echo "Script: $SYNC_SCRIPT"
echo "Log file: $LOG_FILE"
echo ""
echo "View logs: tail -f $LOG_FILE"
echo "List cron jobs: crontab -l"
echo "Remove cron job: crontab -l | grep -v 'oneway_sync.py' | crontab -"
echo ""
echo "Common schedules:"
echo "  Every 15 minutes: */15 * * * *"
echo "  Every 30 minutes: */30 * * * *"
echo "  Every hour: 0 * * * *"
echo "  Every 2 hours: 0 */2 * * *"
echo ""
