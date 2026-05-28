#!/usr/bin/env bash
# Pre-release test gate.
#
# Runs the comprehensive cross-feature test suite before tagging a
# release. This is heavier than the per-commit CI (Go unit + vitest +
# svelte-check) because it spins up a real hops process and drives it
# through Chromium via Playwright, plus migration-safety in Go.
#
# Run this whenever you're about to ship — when a tag is about to go
# out, when a notable behavioural change has landed, or after a refactor
# that touched code more than one feature depends on.
#
# Exits 1 on the first failure so the release loop notices.
#
# Stages (in order, fail-fast):
#   1.  Version drift          (scripts/check-versions.sh)
#   2.  Go tests               (backend/...)
#   3.  Frontend type-check    (svelte-check)
#   4.  Frontend unit tests    (vitest)
#   5.  Migration safety       (already part of stage 2; shown for clarity)
#   6.  Playwright suite       (tests/prerelease — E2E + API contract + boundaries)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

start=$(date +%s)
stage() { echo; echo "▸ $*" >&2; }
ok()    { echo "  ✓ $*"; }

stage "1/6  Version alignment"
"$REPO_DIR/scripts/check-versions.sh"

stage "2/6  Backend tests (Go)"
(cd backend && CGO_ENABLED=0 go test ./...)
ok "backend tests"

stage "3/6  Frontend type-check (svelte-check)"
(cd frontend && npm run check)
ok "type-check"

stage "4/6  Frontend unit tests (vitest)"
(cd frontend && npm test)
ok "unit tests"

stage "5/6  Migration safety (covered by stage 2 — internal/database)"
ok "see TestMigrationSafety_* in backend/internal/database"

stage "6/6  Pre-release E2E + API contract suite (Playwright)"
# First-run bootstrap: install npm deps + Chromium if missing.
if [[ ! -d "$REPO_DIR/tests/prerelease/node_modules" ]]; then
  echo "  (first run — installing test dependencies)"
  (cd tests/prerelease && npm install)
fi
if ! (cd tests/prerelease && npx playwright --version) &>/dev/null; then
  (cd tests/prerelease && npx playwright install chromium)
fi
(cd tests/prerelease && npx playwright test)
ok "playwright"

elapsed=$(( $(date +%s) - start ))
echo
echo "✓ All pre-release stages passed in ${elapsed}s."
echo "  You are clear to tag + push."
