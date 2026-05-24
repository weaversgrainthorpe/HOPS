#!/usr/bin/env bash
# Deploy the locally-built HOPS to prod without going through GitHub Releases,
# and mirror the source tree to the user's dev workstation.
#
# Two distinct operations in one invocation:
#   1. PROD_HOST (10.10.0.9 by default) — full deploy: build backend + frontend,
#      SCP artifacts, stop hops, swap binary/frontend, start hops, health-check.
#   2. MIRROR_HOST (10.10.0.50 by default) — rsync the source tree only.
#      No systemd, no restart — this host has no HOPS service; the user
#      occasionally develops there and wants the latest source. Disable with
#      MIRROR_HOST= (empty).
#
# Use this during rapid iteration when the release workflow is disabled.
# Re-enable the workflow and use ~/deploy-hops.sh <tag> on prod for proper releases.
set -euo pipefail

PROD_HOST="${PROD_HOST:-jonathan@10.10.0.9}"
PROD_DIR="${PROD_DIR:-/home/jonathan/HOPS}"
MIRROR_HOST="${MIRROR_HOST-jonathan@10.10.0.50}"      # empty disables the mirror
MIRROR_DIR="${MIRROR_DIR:-/home/jonathan/dev/hops}"
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

# --- Source mirror to dev workstation (10.10.0.50 by default) -------------
# This is *not* a deploy; it's a one-way source sync. The mirror host has no
# HOPS service. Generated/runtime/sensitive paths are excluded.

if [[ -n "$MIRROR_HOST" ]]; then
  echo "▸ Mirroring source tree to $MIRROR_HOST:$MIRROR_DIR"
  rsync -aq --delete \
    --exclude '/data/' \
    --exclude '/backend/hops' \
    --exclude '/backend/cmd/hops/hops' \
    --exclude '/backend/cmd/hashpw/hashpw' \
    --exclude '/frontend/node_modules/' \
    --exclude '/frontend/build/' \
    --exclude '/frontend/.svelte-kit/' \
    --exclude '/.claude/' \
    "$REPO_DIR/" "$MIRROR_HOST:$MIRROR_DIR/"
  echo "✓ Source mirrored ($(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo 'no git')) to $MIRROR_HOST"
fi
