#!/bin/bash

# Deployment script for Raspberry Pi
# This script helps deploy and update the gcal-oneway-sync service on a Raspberry Pi

set -e

echo "=== Google Calendar One-Way Sync - Raspberry Pi Deployment ==="
echo ""

# Check if docker is installed
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed. Please install Docker first:"
    echo "  curl -sSL https://get.docker.com | sh"
    echo "  sudo usermod -aG docker $USER"
    exit 1
fi

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "Error: docker-compose is not installed. Please install it first:"
    echo "  sudo apt-get update && sudo apt-get install -y docker-compose"
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "Error: .env file not found!"
    echo "Please copy .env.example to .env and configure it:"
    echo "  cp .env.example .env"
    echo "  nano .env"
    exit 1
fi

# Create data directory if it doesn't exist
mkdir -p ./data
echo "✓ Data directory ready"

# Stop existing container if running
if [ "$(docker ps -q -f name=gcal-oneway-sync)" ]; then
    echo "Stopping existing container..."
    docker-compose down
fi

# Build and start the service
echo "Building Docker image for ARM64..."
docker-compose build --no-cache

echo "Starting service..."
docker-compose up -d

echo ""
echo "✓ Deployment complete!"
echo ""
echo "Service is now running. Check status with:"
echo "  docker-compose ps"
echo "  docker-compose logs -f"
echo ""
echo "Test the service:"
echo "  curl http://localhost:8080"
echo ""
echo "Trigger a sync manually:"
echo "  curl -X POST http://localhost:8080/sync"
echo ""
echo "To set up automated sync, run:"
echo "  ./setup-cron.sh"
