#!/bin/bash

# Start development servers
echo "Starting HOPS development servers..."

# Ensure data directory exists
mkdir -p data

# Start backend in background
echo "Starting backend on :8080..."
cd backend
go run cmd/hops/main.go --port 8080 --data ../data --frontend ../frontend/build &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 2

# Start frontend
echo "Starting frontend on :5173..."
cd frontend
pnpm dev --host --port 5173 &
FRONTEND_PID=$!
cd ..

echo ""
echo "HOPS is running:"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8080"
echo "  Admin:    http://localhost:5173/admin"
echo ""
echo "Press Ctrl+C to stop all servers"

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID
