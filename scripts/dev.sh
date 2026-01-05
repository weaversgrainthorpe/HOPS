#!/bin/bash

# Start development servers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOPS_DIR="$(dirname "$SCRIPT_DIR")"

echo "Starting HOPS development servers..."
echo "Directory: $HOPS_DIR"

# Ensure data directory exists
mkdir -p "$HOPS_DIR/data"

# Cleanup function
cleanup() {
    echo ""
    echo "Shutting down..."
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null
    fi
    # Also kill any orphaned processes
    pkill -f "hops.*--port 8080" 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Build and start backend
echo "Building and starting backend on :8080..."
cd "$HOPS_DIR/backend"
go build -o hops ./cmd/hops
./hops --port 8080 --data "$HOPS_DIR/data" --frontend "$HOPS_DIR/frontend/build" &
BACKEND_PID=$!

# Wait for backend to start
sleep 2

# Check if backend started successfully
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "ERROR: Backend failed to start!"
    exit 1
fi

# Start frontend dev server
echo "Starting frontend on :5173..."
cd "$HOPS_DIR/frontend"
pnpm dev --host --port 5173 &
FRONTEND_PID=$!

echo ""
echo "=========================================="
echo "  HOPS Development Servers Running"
echo "=========================================="
echo ""
echo "  Frontend (dev):  http://localhost:5173"
echo "  Backend API:     http://localhost:8080"
echo "  Admin Panel:     http://localhost:5173/"
echo "  Dashboard:       http://localhost:5173/home"
echo ""
echo "  Press Ctrl+C to stop all servers"
echo "=========================================="
echo ""

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID
