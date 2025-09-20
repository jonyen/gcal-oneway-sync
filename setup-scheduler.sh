#!/bin/bash

# Cloud Scheduler setup script
# This creates a scheduled job to trigger calendar sync every 30 minutes

PROJECT_ID="gcal-sync-472716"
SERVICE_URL="https://gcal-oneway-sync-585561027910.us-central1.run.app"
JOB_NAME="gcal-sync-scheduler"
REGION="us-central1"

echo "Setting up Cloud Scheduler for calendar sync..."

# Enable Cloud Scheduler API
gcloud services enable cloudscheduler.googleapis.com --project=$PROJECT_ID

# Create the scheduled job
gcloud scheduler jobs create http $JOB_NAME \
  --location=$REGION \
  --schedule="*/30 * * * *" \
  --uri="$SERVICE_URL/sync" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body='{"trigger":"scheduler"}' \
  --time-zone="America/Los_Angeles" \
  --project=$PROJECT_ID

echo "Scheduler job created successfully!"
echo "Job name: $JOB_NAME"
echo "Schedule: Every 30 minutes"
echo "Target URL: $SERVICE_URL/sync"
echo ""
echo "To view the job:"
echo "gcloud scheduler jobs describe $JOB_NAME --location=$REGION --project=$PROJECT_ID"
echo ""
echo "To trigger manually:"
echo "gcloud scheduler jobs run $JOB_NAME --location=$REGION --project=$PROJECT_ID"