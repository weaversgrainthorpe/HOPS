#!/bin/bash

# Start HOPS in production mode (requires build.sh to have been run first)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOPS_DIR="$(dirname "$SCRIPT_DIR")"

PORT="${1:-8080}"
DATA_DIR="${2:-$HOPS_DIR/data}"

echo "Starting HOPS..."
echo "Directory: $HOPS_DIR"
echo "Port: $PORT"
echo "Data: $DATA_DIR"

# Check if backend binary exists
if [ ! -f "$HOPS_DIR/backend/hops" ]; then
    echo "ERROR: Backend binary not found!"
    echo "Run ./scripts/build.sh first"
    exit 1
fi

# Check if frontend build exists
if [ ! -d "$HOPS_DIR/frontend/build" ]; then
    echo "ERROR: Frontend build not found!"
    echo "Run ./scripts/build.sh first"
    exit 1
fi

# Ensure data directory exists
mkdir -p "$DATA_DIR"

# Start backend (serves frontend from build directory)
cd "$HOPS_DIR/backend"
./hops --port $PORT --data "$DATA_DIR" --frontend "$HOPS_DIR/frontend/build"
