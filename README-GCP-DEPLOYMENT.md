# GCP Deployment Guide

This guide explains how to deploy your Google Calendar sync application to Google Cloud Platform.

## Prerequisites

1. **Google Cloud CLI**: Install and authenticate with `gcloud auth login`
2. **GCP Project**: Create a project and enable billing
3. **APIs**: Enable Container Registry and Cloud Run APIs

## Deployment Options

### Option 1: Cloud Run (Recommended)

Cloud Run is serverless and scales to zero when not in use.

1. **Set up secrets**:
   ```bash
   # Edit the script with your project ID and values
   ./gcp-secrets-setup.sh
   ```

2. **Deploy**:
   ```bash
   # Edit cloud-run-deploy.sh with your project ID
   ./cloud-run-deploy.sh
   ```

### Option 2: App Engine

For a fully managed platform experience:

1. **Deploy**:
   ```bash
   # Copy env-vars.yaml to a new file with real values
   cp env-vars.yaml env-vars-prod.yaml
   # Edit env-vars-prod.yaml with your actual values

   gcloud app deploy --env-vars-file env-vars-prod.yaml
   ```

### Option 3: Cloud Build (CI/CD)

For automated deployments from Git:

1. **Connect repository** to Cloud Build
2. **Use** the `cloudbuild.yaml` configuration
3. **Set up triggers** for automatic deployment

## Environment Variables

The application needs these environment variables:

- `GOOGLE_CLIENT_ID`: OAuth client ID
- `GOOGLE_CLIENT_SECRET`: OAuth client secret
- `SOURCE_CALENDAR_IDS`: Comma-separated calendar IDs to sync from
- `TARGET_CALENDAR_ID`: Target calendar ID (usually "primary")
- `SOURCE_TOKENS_JSON`: OAuth tokens for source calendars
- `TARGET_TOKENS_JSON`: OAuth tokens for target calendar

## Security Best Practices

1. **Use Secret Manager** for sensitive data (tokens, secrets)
2. **Never commit** real credentials to version control
3. **Use IAM roles** to restrict access
4. **Enable audit logging** for compliance

## Monitoring

- **Cloud Logging**: View application logs
- **Cloud Monitoring**: Set up alerts
- **Error Reporting**: Track application errors

## Cost Optimization

- **Cloud Run**: Pay only when running
- **Set memory/CPU limits** appropriately
- **Use min instances = 0** for development