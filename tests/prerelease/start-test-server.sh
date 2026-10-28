#!/usr/bin/env bash
# Start a fresh HOPS process for the pre-release test suite.
# Picks a clean tempdir for --data so the user's real homelab DB is never
# touched. Builds the backend on demand if frontend/build or the binary
# don't exist yet. Cleans up the tempdir on exit.
#
# HOPS reads its port from the app_settings table (port is a runtime
# setting, not a CLI flag). We pre-seed that table before launching so
# the test process binds the port the Playwright config expects.
#
# Playwright's webServer block in playwright.config.ts launches this and
# waits for /api/health.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${HOPS_TEST_PORT:-18080}"

log() { echo "[start-test-server] $*" >&2; }

RELEASE=0
[[ "${HOPS_TEST_BUILD:-dev}" == "release" ]] && RELEASE=1

if [[ $RELEASE == 1 ]]; then
  # Release mode: the real shipped artifact (scripts/build.sh: UI embedded, no -tags dev,
  # no --frontend flag). Rebuilt unless backend/hops is newer than every backend + frontend source.
  # backend/hops is also what specs that spawn their own HOPS use (hops-bin.ts).
  BIN="$REPO_DIR/backend/hops"
  if [[ ! -x "$BIN" ]] || [[ -n "$(find "$REPO_DIR/backend/cmd" "$REPO_DIR/backend/internal" "$REPO_DIR/frontend/src" "$REPO_DIR/frontend/static" -type f -newer "$BIN" -not -path '*/internal/web/build/*' -print -quit)" ]]; then
    log "Building the release binary (scripts/build.sh)"
    (cd "$REPO_DIR" && ./scripts/build.sh) >&2
  fi
  log "Release mode: UI embedded, no --frontend"
  FRONTEND_ARGS=()
else
# Ensure backend binary exists
# A separate -tags dev binary: --frontend does not exist in release builds
# (backend/hops from build.sh), so the harness never shares that binary.
BIN="$REPO_DIR/backend/hops-testdev"
if [[ ! -x "$BIN" ]] || [[ -n "$(find "$REPO_DIR/backend/cmd" "$REPO_DIR/backend/internal" -name '*.go' -newer "$BIN" -print -quit)" ]]; then
  log "Building backend (-tags dev)"
  (cd "$REPO_DIR/backend" && CGO_ENABLED=0 go build -tags dev -o hops-testdev ./cmd/hops) >&2
fi

# Ensure frontend build exists
FRONTEND_BUILD="$REPO_DIR/frontend/build"
if [[ ! -f "$FRONTEND_BUILD/index.html" ]]; then
  log "Building frontend"
  (cd "$REPO_DIR/frontend" && npm run build) >&2
fi
FRONTEND_ARGS=(--frontend "$FRONTEND_BUILD" --no-lan-multicast)  # dev build: Discovery sends nothing onto the real LAN
fi

# Fresh tempdir per run — discarded on exit
DATA_DIR="$(mktemp -d -t hops-prerelease-XXXXXX)"
DB="$DATA_DIR/hops.db"
log "Data dir: $DATA_DIR"
trap 'log "Cleaning up $DATA_DIR"; rm -rf "$DATA_DIR"' EXIT

# Pre-seed app_settings.server.port so hops binds the port Playwright expects.
# The schema match must stay in sync with database.go.
log "Pre-seeding port=$PORT"
python3 - <<EOF
import sqlite3
conn = sqlite3.connect("$DB")
conn.execute("""CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)""")
conn.execute("INSERT OR REPLACE INTO app_settings(key, value) VALUES('server.port', '$PORT')")
conn.commit()
conn.close()
EOF

log "Starting hops on port $PORT"
# The UI is embedded in the binary, but the harness serves it from disk via
# the --frontend dev override (-tags dev build) so the frontend can be rebuilt without rebuilding
# the Go binary. This is intentional — don't drop the flag.
exec "$BIN" \
  --data "$DATA_DIR" \
  "${FRONTEND_ARGS[@]}" \
  --host 127.0.0.1
