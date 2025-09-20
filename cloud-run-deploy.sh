#!/bin/bash

# Cloud Run deployment script
# Make sure you have gcloud CLI installed and authenticated

# Set your GCP project ID
PROJECT_ID="gcal-sync-472716"
SERVICE_NAME="gcal-oneway-sync"
REGION="us-central1"

# Enable required APIs
echo "Enabling required APIs..."
gcloud services enable cloudbuild.googleapis.com --project=$PROJECT_ID
gcloud services enable run.googleapis.com --project=$PROJECT_ID
gcloud services enable artifactregistry.googleapis.com --project=$PROJECT_ID

# Create Artifact Registry repository
echo "Creating Artifact Registry repository..."
gcloud artifacts repositories create $SERVICE_NAME \
  --repository-format=docker \
  --location=$REGION \
  --project=$PROJECT_ID || true

# Configure Docker authentication
gcloud auth configure-docker $REGION-docker.pkg.dev

# Grant Secret Manager access to Compute Engine default service account
echo "Granting Secret Manager permissions..."
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Build and push to Artifact Registry
echo "Building and pushing container..."
gcloud builds submit --tag $REGION-docker.pkg.dev/$PROJECT_ID/$SERVICE_NAME/$SERVICE_NAME:latest

# Deploy to Cloud Run with secrets
echo "Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image $REGION-docker.pkg.dev/$PROJECT_ID/$SERVICE_NAME/$SERVICE_NAME:latest \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production \
  --set-secrets GOOGLE_CLIENT_ID=google-client-id:latest,GOOGLE_CLIENT_SECRET=google-client-secret:latest,SOURCE_TOKENS_JSON=source-tokens-json:latest,TARGET_TOKENS_JSON=target-tokens-json:latest,SOURCE_CALENDAR_IDS=source-calendar-ids:latest \
  --set-env-vars TARGET_CALENDAR_ID=45885219398c1d3970c6fb97a81b763c5e8efd8d2592c1489ef484d79b6ab2b5@group.calendar.google.com,FULL_WINDOW_MONTHS=12,STATE_FILE=/app/state.json \
  --max-instances 1 \
  --memory 512Mi \
  --cpu 1

echo "Deployment complete!"
echo "Service URL: $(gcloud run services describe $SERVICE_NAME --region $REGION --format 'value(status.url)')"