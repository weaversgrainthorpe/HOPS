#!/bin/bash
set -e

echo "Building HOPS..."

# Build frontend
echo "Building frontend..."
cd frontend
pnpm install
pnpm build
cd ..

# Build backend
echo "Building backend..."
cd backend
CGO_ENABLED=0 go build -o hops ./cmd/hops
cd ..

echo "Build complete!"
echo "Backend binary: backend/hops"
echo "Frontend build: frontend/build"
