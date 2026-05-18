#!/usr/bin/env bash
# Deploy the locally-built HOPS to prod without going through GitHub Releases.
# Use this during rapid iteration when the release workflow is disabled.
# Re-enable the workflow and use ~/deploy-hops.sh <tag> on prod for proper releases.
set -euo pipefail

PROD_HOST="${PROD_HOST:-jonathan@10.10.0.9}"
PROD_DIR="${PROD_DIR:-/home/jonathan/HOPS}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$REPO_DIR"

echo "▸ Building backend (linux/amd64)"
(cd backend && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /tmp/hops-linux-amd64 ./cmd/hops)

echo "▸ Building frontend"
(cd frontend && npm run build >/dev/null)

VERSION=$(cat VERSION)
echo "▸ Local build version: $VERSION"

echo "▸ Currently running on $PROD_HOST:"
CURRENT=$(ssh "$PROD_HOST" "curl -s http://localhost:8080/api/health" | python3 -c "import json,sys; print(json.load(sys.stdin)['version'])")
echo "  $CURRENT"

echo "▸ Copying artifacts to prod"
scp -q /tmp/hops-linux-amd64 "$PROD_HOST:/tmp/hops-new"
rsync -aq --delete frontend/build/ "$PROD_HOST:/tmp/hops-frontend-new/"

echo "▸ Stopping hops, swapping binary + frontend, starting hops"
ssh "$PROD_HOST" "sudo systemctl stop hops && \
  cp /tmp/hops-new $PROD_DIR/backend/hops && \
  chmod +x $PROD_DIR/backend/hops && \
  rsync -a --delete /tmp/hops-frontend-new/ $PROD_DIR/frontend/build/ && \
  sudo systemctl start hops"

echo "▸ Health check"
sleep 1
DEPLOYED=$(ssh "$PROD_HOST" "curl -s http://localhost:8080/api/health" | python3 -c "import json,sys; d=json.load(sys.stdin); print(f\"{d['version']} ({d['status']})\")")
echo "  $DEPLOYED"

if [[ "$DEPLOYED" == "$VERSION"* ]]; then
  echo "✓ Deployed and healthy. $CURRENT → $VERSION"
else
  echo "✗ Version mismatch after deploy. Expected $VERSION, got $DEPLOYED"
  exit 1
fi
