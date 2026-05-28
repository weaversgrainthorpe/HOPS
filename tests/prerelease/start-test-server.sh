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

# Ensure backend binary exists
BIN="$REPO_DIR/backend/hops"
if [[ ! -x "$BIN" ]] || [[ "$REPO_DIR/backend/cmd/hops/main.go" -nt "$BIN" ]]; then
  log "Building backend"
  (cd "$REPO_DIR/backend" && CGO_ENABLED=0 go build -o hops ./cmd/hops) >&2
fi

# Ensure frontend build exists
FRONTEND_BUILD="$REPO_DIR/frontend/build"
if [[ ! -f "$FRONTEND_BUILD/index.html" ]]; then
  log "Building frontend"
  (cd "$REPO_DIR/frontend" && npm run build) >&2
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
exec "$BIN" \
  --data "$DATA_DIR" \
  --frontend "$FRONTEND_BUILD" \
  --host 127.0.0.1
