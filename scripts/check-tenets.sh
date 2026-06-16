#!/usr/bin/env bash
# Mechanical guards for the HOPS tenets (see TENETS.md). Each check maps to a
# tenet and fails if a change would silently break it — the kind of drift that
# let the "single binary" promise rot for the web UI across every public
# release until v2.2.0.
#
# These are STATIC checks (greps) and run fast with no toolchain. The
# single-file *runtime* smoke (binary serves the embedded UI with no
# --frontend) lives in the CI `tenets` job, which has Go + Node available.
#
# Run locally any time:  ./scripts/check-tenets.sh
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

fail=0
note() { printf '    %s\n' "$1"; }

echo "▸ Tenet 1 (GUI-first, zero config files): no env-var / config-file runtime config"
# HOPS reads only CLI bootstrap flags; everything user-tunable lives in the
# SQLite-backed Settings GUI. An os.Getenv / os.LookupEnv creeping into the
# backend is the tell that config is leaking out of the GUI.
if grep -rnE 'os\.(Getenv|LookupEnv)' backend --include='*.go' | grep -v '_test.go'; then
  fail=1; note "✗ env-var config found in backend — runtime config must go through the GUI/SQLite (TENET 1)."
else
  note "✓ no env-var config in backend"
fi

echo "▸ Tenet 4 (Runs anywhere): pure Go, no CGO"
# CGO would break the static cross-compile that gives us the full
# linux/darwin/windows × amd64/arm64 matrix from one toolchain.
if grep -rnE '^[[:space:]]*import "C"|//[[:space:]]*#cgo' backend --include='*.go' | grep -v '_test.go'; then
  fail=1; note "✗ cgo usage found — backend must stay pure Go / CGO_ENABLED=0 (TENET 4)."
else
  note "✓ no cgo in backend"
fi

echo "▸ Tenet 10 (No telemetry): no analytics / telemetry / update-check hosts in source"
if grep -rniE 'sentry\.io|posthog|google-analytics|googletagmanager|mixpanel|amplitude|api\.github\.com/repos' \
     backend frontend/src --include='*.go' --include='*.ts' --include='*.svelte' 2>/dev/null | grep -v '_test.go'; then
  fail=1; note "✗ telemetry/analytics/update-check reference found — HOPS must never phone home (TENET 10)."
else
  note "✓ no telemetry/analytics/update-check references"
fi

echo "▸ Tenet 3/10 (Everything embedded, offline-capable): built UI shell loads no external origin"
# Note on Iconify: api.iconify.design legitimately stays in the JS bundle as the
# fallback for arbitrary icon names typed by hand, so grepping the bundle for it
# would false-positive. The real guarantee — the app's OWN icons render offline —
# is enforced elsewhere: `npm run icons:check` (every referenced icon is in the
# committed offline bundle) and tests/prerelease/e2e/offline-icons.spec.ts
# (blocks the Iconify API, asserts the UI still renders). This check covers the
# rest of the shell.
#
# Only meaningful after a frontend build. The app shell must not pull
# scripts/styles/fonts from a CDN — everything ships embedded.
if [[ -f frontend/build/index.html ]]; then
  ext=$(grep -oEh 'https?://[^"'"'"' )]+' frontend/build/*.html 2>/dev/null | sort -u || true)
  if [[ -n "$ext" ]]; then
    fail=1
    note "✗ external origin(s) referenced in built UI shell (TENET 3/10):"
    printf '        %s\n' $ext
  else
    note "✓ built UI shell references no external origins"
  fi
else
  note "• frontend/build not present — skipping built-UI check (run 'npm run build' first)"
fi

echo
if [[ $fail -ne 0 ]]; then
  echo "✗ tenet guard FAILED — a change conflicts with TENETS.md. Fix it, or if the"
  echo "  tenet itself is being redefined, update TENETS.md in the same change."
  exit 1
fi
echo "✓ tenet guards passed"
