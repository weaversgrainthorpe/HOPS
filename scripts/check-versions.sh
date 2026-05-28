#!/usr/bin/env bash
# Verify that VERSION, backend/internal/version/version.go, and
# frontend/package.json all agree on the HOPS release number.
#
# Two releases (v2.0.0 and v2.0.1) shipped with the frontend chip
# stuck at an older version because the three sources drifted out
# of sync. This catches that at deploy time and in CI.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

version_file=$(<"$REPO_DIR/VERSION")
version_file=${version_file//[$'\t\r\n ']/}

go_string=$(grep -oE 'return "[0-9]+\.[0-9]+\.[0-9]+"' \
  "$REPO_DIR/backend/internal/version/version.go" | head -1 | \
  grep -oE '[0-9]+\.[0-9]+\.[0-9]+')

go_major=$(grep -oE 'Major = [0-9]+' "$REPO_DIR/backend/internal/version/version.go" | grep -oE '[0-9]+')
go_minor=$(grep -oE 'Minor = [0-9]+' "$REPO_DIR/backend/internal/version/version.go" | grep -oE '[0-9]+')
go_patch=$(grep -oE 'Patch = [0-9]+' "$REPO_DIR/backend/internal/version/version.go" | grep -oE '[0-9]+')
go_constants="${go_major}.${go_minor}.${go_patch}"

pkg_version=$(grep -oE '"version": "[0-9]+\.[0-9]+\.[0-9]+"' \
  "$REPO_DIR/frontend/package.json" | head -1 | \
  grep -oE '[0-9]+\.[0-9]+\.[0-9]+')

ok=1
if [[ "$version_file" != "$go_string" ]]; then ok=0; fi
if [[ "$version_file" != "$go_constants" ]]; then ok=0; fi
if [[ "$version_file" != "$pkg_version" ]]; then ok=0; fi

if [[ $ok -eq 1 ]]; then
  echo "✓ Versions aligned at $version_file"
  exit 0
fi

cat <<EOF >&2
✗ Version sources disagree — fix before deploying:

  VERSION                                : $version_file
  backend/.../version.go String()        : $go_string
  backend/.../version.go Major.Minor.Patch: $go_constants
  frontend/package.json                  : $pkg_version

All four must match. Update whichever is wrong and re-run.
EOF
exit 1
