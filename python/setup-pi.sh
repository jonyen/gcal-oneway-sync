#!/bin/bash
# Setup script for Raspberry Pi (Python version)

set -e

echo "=== Google Calendar Sync - Raspberry Pi Setup (Python) ==="
echo ""

# Check Python version
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 not found. Installing..."
    sudo apt update
    sudo apt install -y python3 python3-pip python3-venv
fi

PYTHON_VERSION=$(python3 --version | cut -d' ' -f2 | cut -d'.' -f1,2)
echo "Python version: $PYTHON_VERSION"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$SCRIPT_DIR"

# Create virtual environment
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies
echo "Installing Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Activate the virtual environment:"
echo "   cd $SCRIPT_DIR"
echo "   source venv/bin/activate"
echo ""
echo "2. Set up environment variables:"
echo "   cp $PROJECT_ROOT/.env.example $PROJECT_ROOT/.env"
echo "   nano $PROJECT_ROOT/.env"
echo ""
echo "3. Run authentication (requires browser access):"
echo "   python3 auth.py source"
echo "   python3 auth.py target"
echo ""
echo "4. Copy the token JSON outputs to your .env file"
echo ""
echo "5. Test the sync:"
echo "   python3 oneway_sync.py"
echo ""
echo "6. Set up automatic sync (cron):"
echo "   ./setup-cron-py.sh"
echo ""
