#!/usr/bin/env bash
# Deploy the locally-built HOPS without going through GitHub Releases.
#
# Two separate modes — a run does exactly one:
#   1. (default, main branch only) PROD_HOST (172.16.0.9) — build backend +
#      frontend, SCP artifacts, swap binary, restart hops, health-check.
#   2. --dev-only — build the latest COMMIT in a clean checkout, install it
#      into DEV_DIR on MIRROR_HOST (172.16.0.50) and restart the persistent
#      hops-dev service (scripts/hops-dev.service), against dev's OWN data dir
#      (never prod's). A prod deploy never touches dev.
#
# Use this during rapid iteration when the release workflow is disabled.
# Re-enable the workflow and use ~/deploy-hops.sh <tag> on prod for proper releases.
set -euo pipefail

# Hardcoded targets — no env-var overrides (family convention: picking the wrong
# host should be an explicit edit here, not a shell knob).
PROD_HOST="user@172.16.0.9"
PROD_DIR="/home/user/HOPS"
MIRROR_HOST="user@172.16.0.50"      # dev box; set "" to disable the dev update
# hops-dev runs from its OWN install dir, never from the working tree: the
# working tree is where builds and tests happen, so serving dev from it let
# unreviewed builds go live (2026-10-21/23). Only this script writes DEV_DIR.
DEV_DIR="/home/user/hops-dev"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$REPO_DIR"

# --- Arguments --------------------------------------------------------------
# --dev-only: build HEAD, then update ONLY the dev box (DEV_DIR + hops-dev).
# Never touches PROD_HOST. This is the only mode allowed off the main branch.
DEV_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --dev-only) DEV_ONLY=1 ;;
    *) echo "Usage: $0 [--dev-only]" >&2; exit 2 ;;
  esac
done

if [[ "$DEV_ONLY" == 1 && -z "$MIRROR_HOST" ]]; then
  echo "✗ --dev-only needs MIRROR_HOST set"
  exit 1
fi

# Prod guard: only main may be deployed to prod. v3 work never goes to prod.
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$DEV_ONLY" == 0 && "$BRANCH" != "main" ]]; then
  echo "✗ Refusing to deploy branch '$BRANCH' to prod. Use --dev-only (v3 work never goes to prod)."
  exit 1
fi


# --dev-only builds from a clean checkout of HEAD, so only COMMITTED code ever
# reaches dev — never half-finished work sitting in the working tree.
BUILD_ROOT="$REPO_DIR"
if [[ "$DEV_ONLY" == 1 ]]; then
  BUILD_TMP=$(mktemp -d)
  trap 'git -C "$REPO_DIR" worktree remove --force "$BUILD_TMP/src" >/dev/null 2>&1 || true; rm -rf "$BUILD_TMP"' EXIT
  git -C "$REPO_DIR" worktree add --detach --quiet "$BUILD_TMP/src" HEAD
  ln -s "$REPO_DIR/frontend/node_modules" "$BUILD_TMP/src/frontend/node_modules"
  BUILD_ROOT="$BUILD_TMP/src"
  if [[ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ]]; then
    echo "  (uncommitted changes in the working tree are NOT included)"
  fi
  echo "▸ Building commit $(git -C "$REPO_DIR" rev-parse --short HEAD) in a clean checkout"
fi

"$BUILD_ROOT/scripts/check-versions.sh"

# Frontend first: it gets embedded into the binary, so it must be built and
# staged inside the backend module before `go build` runs.
echo "▸ Building frontend"
(cd "$BUILD_ROOT/frontend" && npm run build >/dev/null)
# The build regenerates the offline icon bundle. If that changed a committed file, an icon the code
# now uses is missing from the commit: the deployed UI would fetch it online (or show nothing
# offline). Refuse, so it gets committed, rather than deploy a quietly incomplete bundle.
if [[ "$BUILD_ROOT" != "$REPO_DIR" ]] && ! git -C "$BUILD_ROOT" diff --quiet -- frontend/src/lib/icons/offline-bundle.ts; then
  echo "✗ The committed offline icon bundle is out of date (the build added icons):" >&2
  git -C "$BUILD_ROOT" diff --stat -- frontend/src/lib/icons/offline-bundle.ts >&2
  echo "  Run 'npm run icons:bundle' in frontend/, commit frontend/src/lib/icons/offline-bundle.ts, and deploy again." >&2
  exit 1
fi

echo "▸ Embedding frontend into backend module"
rm -rf "$BUILD_ROOT/backend/internal/web/build"
mkdir -p "$BUILD_ROOT/backend/internal/web/build"
cp -r "$BUILD_ROOT/frontend/build/." "$BUILD_ROOT/backend/internal/web/build/"

echo "▸ Building backend (linux/amd64, UI embedded)"
(cd "$BUILD_ROOT/backend" && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /tmp/hops-linux-amd64 ./cmd/hops)
# The embed step deletes the tracked placeholder; put it back in the working tree.
[[ "$DEV_ONLY" == 1 ]] || git -C "$REPO_DIR" checkout -- backend/internal/web/build/.gitkeep 2>/dev/null || true

VERSION=$(cat "$BUILD_ROOT/VERSION")
echo "▸ Local build version: $VERSION"

if [[ "$DEV_ONLY" == 0 ]]; then
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
fi  # end prod-only section (skipped by --dev-only)

# --- Dev box (172.16.0.50): install into DEV_DIR + restart hops-dev ----------
# hops-dev runs $DEV_DIR/hops (UI embedded) against $DEV_DIR/data — dev's OWN
# data, never prod's. Nothing else writes DEV_DIR, so tests and builds in the
# working tree can never change what dev serves.

# Only --dev-only touches dev. A prod deploy builds main, and main's build must
# never land on dev (dev runs v3 against v3 data — dev/prod isolation).
if [[ "$DEV_ONLY" == 1 && -n "$MIRROR_HOST" ]]; then
  echo "▸ Installing into $MIRROR_HOST:$DEV_DIR and restarting hops-dev"
  scp -q /tmp/hops-linux-amd64 "$MIRROR_HOST:$DEV_DIR/hops.new"
  DEV_RESULT=$(ssh "$MIRROR_HOST" "set -e
    chmod +x $DEV_DIR/hops.new
    mv $DEV_DIR/hops.new $DEV_DIR/hops
    old=\$(systemctl show hops-dev -p MainPID --value)
    sudo systemctl restart hops-dev
    # Every v3 build reports the same VERSION, so a health answer alone proves
    # nothing (dev.sh can also listen on :8080). Require a NEW hops-dev process
    # that is active AND is the one listening on :8080.
    for i in \$(seq 1 40); do
      sleep 1
      pid=\$(systemctl show hops-dev -p MainPID --value)
      state=\$(systemctl show hops-dev -p ActiveState --value)
      [ \"\$pid\" != 0 ] && [ \"\$pid\" != \"\$old\" ] && [ \"\$state\" = active ] || continue
      ss -ltnpH 'sport = :8080' 2>/dev/null | grep -q \"pid=\$pid,\" || continue
      if v=\$(curl -sf http://localhost:8080/api/health); then echo \"\$v\"; exit 0; fi
    done
    echo \"NOT CONFIRMED (no new active hops-dev process serving :8080 within 40s; MainPID was \$old)\"") || DEV_RESULT="SSH FAILED"
  DEV_VERSION=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(f\"{d['version']} ({d['status']})\")" "$DEV_RESULT" 2>/dev/null || echo "$DEV_RESULT")
  echo "  $DEV_VERSION"
  if [[ "$DEV_VERSION" == "$VERSION (ok)" ]]; then
    echo "✓ hops-dev restarted on commit $(git -C "$REPO_DIR" rev-parse --short HEAD) ($VERSION)"
  else
    echo "✗ hops-dev update failed: $DEV_VERSION (prod deploy above is unaffected)"
    exit 1
  fi
fi
