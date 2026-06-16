#!/bin/bash
set -e

echo "Building HOPS..."

# Build frontend
echo "Building frontend..."
cd frontend
npm install
npm run build
cd ..

# Stage the frontend build inside the backend module so go:embed can pick it
# up (//go:embed can't reach paths outside its own module). The binary ships
# with the UI embedded — there is no separate frontend/build to deploy.
echo "Embedding frontend..."
rm -rf backend/internal/web/build
mkdir -p backend/internal/web/build
cp -r frontend/build/. backend/internal/web/build/

# Build backend
echo "Building backend..."
cd backend
CGO_ENABLED=0 go build -o hops ./cmd/hops
cd ..

echo "Build complete!"
echo "Backend binary (UI embedded): backend/hops"
