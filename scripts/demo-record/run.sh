#!/usr/bin/env bash
# Record the demo video and/or capture the screenshots for the README and the
# GitHub Pages site, from a THROWAWAY HOPS: the release binary (scripts/build.sh)
# on a fresh temp data dir, bound to 127.0.0.1, showing only the shipped Sample.
# Nothing real is ever on screen, and no real instance is touched.
#
#   scripts/demo-record/run.sh record        # -> docs/screenshots/demo.mp4 + demo.gif
#   scripts/demo-record/run.sh screenshots   # -> docs/screenshots/*.png
#   scripts/demo-record/run.sh all
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
WHAT="${1:-all}"
case "$WHAT" in record|screenshots|all) ;; *) echo "Usage: $0 record|screenshots|all" >&2; exit 2 ;; esac

log() { echo "[demo] $*" >&2; }

BIN="$REPO/backend/hops"
if [[ ! -x "$BIN" ]] || [[ -n "$(find "$REPO/backend/cmd" "$REPO/backend/internal" "$REPO/frontend/src" "$REPO/frontend/static" -type f -newer "$BIN" -not -path '*/internal/web/build/*' -print -quit)" ]]; then
  log "Building the release binary"
  (cd "$REPO" && ./scripts/build.sh) >&2
fi
[[ -d "$HERE/node_modules" ]] || (cd "$HERE" && npm install --no-audit --no-fund) >&2

DATA="$(mktemp -d -t hops-demo-XXXXXX)"
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
PID=""
cleanup() { [[ -n "$PID" ]] && kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null || true; rm -rf "$DATA"; }
trap cleanup EXIT

# The port is a setting (app_settings), not a flag: seed it, as the test harness does.
python3 - "$DATA/hops.db" "$PORT" <<'EOF'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)")
c.execute("INSERT OR REPLACE INTO app_settings(key, value) VALUES('server.port', ?)", (sys.argv[2],))
c.commit()
EOF

"$BIN" --data "$DATA" --host 127.0.0.1 > "$DATA/hops.log" 2>&1 &
PID=$!
BASE="http://127.0.0.1:$PORT"
for _ in $(seq 1 60); do curl -fs "$BASE/api/health" >/dev/null && break; sleep 0.5; done
curl -fs "$BASE/api/health" >/dev/null || { log "HOPS did not start:"; tail -20 "$DATA/hops.log" >&2; exit 1; }
log "Throwaway HOPS at $BASE (data $DATA)"

OUT="$REPO/docs/screenshots"
if [[ "$WHAT" == screenshots || "$WHAT" == all ]]; then
  node "$HERE/screenshots.mjs" "$BASE" "$OUT"
fi
if [[ "$WHAT" == record || "$WHAT" == all ]]; then
  node "$HERE/record.mjs" "$BASE" "$HERE/output"
  node "$HERE/convert.mjs" "$HERE/output" "$OUT"
fi
log "Done"
