#!/bin/bash

# Start HOPS in production mode (requires build.sh to have been run first).
# The TCP port HOPS listens on is configured in the admin GUI under Settings
# (server.port, default 8080) — there is no --port CLI flag.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOPS_DIR="$(dirname "$SCRIPT_DIR")"

DATA_DIR="${1:-$HOPS_DIR/data}"

echo "Starting HOPS..."
echo "Directory: $HOPS_DIR"
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
./hops --data "$DATA_DIR" --frontend "$HOPS_DIR/frontend/build"
