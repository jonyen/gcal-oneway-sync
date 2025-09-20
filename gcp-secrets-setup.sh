#!/bin/bash

# GCP Secret Manager setup script
# This script creates secrets in Google Secret Manager for your environment variables

PROJECT_ID="gcal-sync-472716"

echo "Creating secrets in Google Secret Manager..."

# Enable Secret Manager API
gcloud services enable secretmanager.googleapis.com --project=$PROJECT_ID

# Create secrets (you'll need to add the actual values)
echo "Creating GOOGLE_CLIENT_ID secret..."
echo -n "your-client-id.apps.googleusercontent.com" | gcloud secrets create google-client-id --data-file=- --project=$PROJECT_ID

echo "Creating GOOGLE_CLIENT_SECRET secret..."
echo -n "your-client-secret" | gcloud secrets create google-client-secret --data-file=- --project=$PROJECT_ID

echo "Creating SOURCE_TOKENS_JSON secret..."
echo -n '{"access_token":"...","refresh_token":"..."}' | gcloud secrets create source-tokens-json --data-file=- --project=$PROJECT_ID

echo "Creating TARGET_TOKENS_JSON secret..."
echo -n '{"access_token":"...","refresh_token":"..."}' | gcloud secrets create target-tokens-json --data-file=- --project=$PROJECT_ID

echo "Creating SOURCE_CALENDAR_IDS secret..."
echo -n "team@group.calendar.google.com,calendar2@group.calendar.google.com" | gcloud secrets create source-calendar-ids --data-file=- --project=$PROJECT_ID

echo "Secrets created! Update cloud-run-deploy.sh to use these secrets."