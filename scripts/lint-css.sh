#!/usr/bin/env bash
# CSS lint guardrail (stylelint) — see .stylelintrc.json. Error-severity findings
# exit non-zero (also enforced in scripts/hooks/pre-push); warnings are
# informational. One-time setup: `npm install`.
#   Usage: bash scripts/lint-css.sh [--fix]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ ! -x node_modules/.bin/stylelint ]; then
    echo "stylelint not installed — run: npm install" >&2
    exit 1
fi
exec node_modules/.bin/stylelint "frontend/src/**/*.css" "$@"
