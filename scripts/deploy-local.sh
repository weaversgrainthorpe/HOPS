#!/usr/bin/env bash
# Deploy the locally-built HOPS to prod without going through GitHub Releases,
# and bring the dev box (source + running hops-dev service) up to date.
#
# Two distinct operations in one invocation:
#   1. PROD_HOST (172.16.0.9) — full deploy: build backend + frontend,
#      SCP artifacts, swap binary, restart hops, health-check.
#   2. MIRROR_HOST (172.16.0.50) — rsync the source tree, then update the
#      persistent hops-dev service (scripts/hops-dev.service): the same
#      binary + UI build that went to prod, against dev's OWN data dir
#      (never prod's). Disable both by setting MIRROR_HOST="" below.
#
# Use this during rapid iteration when the release workflow is disabled.
# Re-enable the workflow and use ~/deploy-hops.sh <tag> on prod for proper releases.
set -euo pipefail

# Hardcoded targets — no env-var overrides (family convention: picking the wrong
# host should be an explicit edit here, not a shell knob).
PROD_HOST="user@172.16.0.9"
PROD_DIR="/home/user/HOPS"
MIRROR_HOST="user@172.16.0.50"      # set "" to disable the source mirror
MIRROR_DIR="/home/user/dev/hops"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$REPO_DIR"

"$REPO_DIR/scripts/check-versions.sh"

# Frontend first: it gets embedded into the binary, so it must be built and
# staged inside the backend module before `go build` runs.
echo "▸ Building frontend"
(cd frontend && npm run build >/dev/null)

echo "▸ Embedding frontend into backend module"
rm -rf backend/internal/web/build
mkdir -p backend/internal/web/build
cp -r frontend/build/. backend/internal/web/build/

echo "▸ Building backend (linux/amd64, UI embedded)"
(cd backend && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /tmp/hops-linux-amd64 ./cmd/hops)

VERSION=$(cat VERSION)
echo "▸ Local build version: $VERSION"

echo "▸ Currently running on $PROD_HOST:"
CURRENT=$(ssh "$PROD_HOST" "curl -s http://localhost:8080/api/health" | python3 -c "import json,sys; print(json.load(sys.stdin)['version'])")
echo "  $CURRENT"

echo "▸ Copying artifact to prod"
# The UI is embedded in the binary now, so the binary is the only artifact.
scp -q /tmp/hops-linux-amd64 "$PROD_HOST:/tmp/hops-new"

echo "▸ Swapping binary, restarting hops"
# Stage the new binary as a sibling file, then atomically rename it onto
# the running one. cp would hit "Text file busy" because the kernel
# refuses to open the in-use executable for writing; mv (rename(2))
# leaves the running process holding the old inode and replaces the
# directory entry only. The same-filesystem requirement is why we
# stage inside PROD_DIR rather than /tmp.
#
# Only the systemctl restart needs sudo, which fits a NOPASSWD line
# scoped to "restart hops".
ssh "$PROD_HOST" "cp /tmp/hops-new $PROD_DIR/backend/hops.new && \
  chmod +x $PROD_DIR/backend/hops.new && \
  mv $PROD_DIR/backend/hops.new $PROD_DIR/backend/hops && \
  sudo systemctl restart hops"

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

# --- Dev box (172.16.0.50 by default): source mirror + hops-dev service -----
# Source sync excludes generated/runtime/sensitive paths — notably /data/,
# so dev keeps its own database and nothing of prod's is ever copied over.

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
    --exclude '/backend/internal/web/build/' \
    --exclude '/.claude/' \
    "$REPO_DIR/" "$MIRROR_HOST:$MIRROR_DIR/"
  echo "✓ Source mirrored ($(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo 'no git')) to $MIRROR_HOST"

  # hops-dev runs backend/hops with --frontend frontend/build (dev serves
  # the UI from disk so it can be rebuilt without relinking), so both the
  # binary and the UI build must be refreshed — otherwise dev silently runs
  # stale code under fresh source.
  echo "▸ Updating hops-dev on $MIRROR_HOST"
  rsync -aq --delete frontend/build/ "$MIRROR_HOST:$MIRROR_DIR/frontend/build/"
  scp -q /tmp/hops-linux-amd64 "$MIRROR_HOST:$MIRROR_DIR/backend/hops.new"
  # Same stage-then-rename swap as prod. No sudo on the dev box: hops-dev
  # runs as this user with Restart=always, so stopping the process makes
  # systemd bring it back up on the new binary (after RestartSec=10).
  DEV_RESULT=$(ssh "$MIRROR_HOST" "set -e
    chmod +x $MIRROR_DIR/backend/hops.new
    mv $MIRROR_DIR/backend/hops.new $MIRROR_DIR/backend/hops
    old=\$(systemctl show hops-dev -p MainPID --value)
    if [ -z \"\$old\" ] || [ \"\$old\" = 0 ]; then echo 'NOT RUNNING (hops-dev service inactive — not restarted)'; exit 0; fi
    kill -TERM \$old
    for i in \$(seq 1 40); do
      sleep 1
      new=\$(systemctl show hops-dev -p MainPID --value)
      if [ \"\$new\" != 0 ] && [ \"\$new\" != \"\$old\" ] && v=\$(curl -sf http://localhost:8080/api/health); then
        echo \"\$v\"; exit 0
      fi
    done
    echo 'NO RESPONSE (hops-dev did not come back within 40s)'") || DEV_RESULT="SSH FAILED"
  DEV_VERSION=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(f\"{d['version']} ({d['status']})\")" "$DEV_RESULT" 2>/dev/null || echo "$DEV_RESULT")
  echo "  $DEV_VERSION"
  if [[ "$DEV_VERSION" == "$VERSION (ok)" ]]; then
    echo "✓ hops-dev restarted on the new build ($VERSION)"
  else
    echo "✗ hops-dev update failed: $DEV_VERSION (prod deploy above is unaffected)"
    exit 1
  fi
fi
