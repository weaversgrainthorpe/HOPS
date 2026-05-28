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
build_problems=()
if [[ "$version_file" != "$go_string" ]]; then ok=0; build_problems+=("version.go String() = $go_string"); fi
if [[ "$version_file" != "$go_constants" ]]; then ok=0; build_problems+=("version.go Major.Minor.Patch = $go_constants"); fi
if [[ "$version_file" != "$pkg_version" ]]; then ok=0; build_problems+=("frontend/package.json = $pkg_version"); fi

# User-facing docs that name a specific version. CHANGELOG and ROADMAP
# legitimately reference older versions in their history, so they are
# excluded. The other six must all match the current VERSION.
declare -A doc_versions
doc_versions[README.md]=$(grep -oE '\*\*Version [0-9]+\.[0-9]+\.[0-9]+\*\*' "$REPO_DIR/README.md" 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "MISSING")
doc_versions[DEPLOY.md]=$(grep -oE '\*\*Version [0-9]+\.[0-9]+\.[0-9]+\*\*' "$REPO_DIR/DEPLOY.md" 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "MISSING")
doc_versions[USER_GUIDE.md]=$(grep -oE '\(v[0-9]+\.[0-9]+\.[0-9]+\)' "$REPO_DIR/USER_GUIDE.md" 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "MISSING")
doc_versions[ICON_MANAGEMENT.md]=$(grep -oE '\(v[0-9]+\.[0-9]+\.[0-9]+\)' "$REPO_DIR/ICON_MANAGEMENT.md" 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "MISSING")
doc_versions[docs/index.html]=$(grep -oE 'class="badge">v[0-9]+\.[0-9]+\.[0-9]+' "$REPO_DIR/docs/index.html" 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "MISSING")
# QUICKSTART has two inline references — log-output example and docker image pin.
# Both should match the current version; pick whichever's first.
doc_versions["QUICKSTART.md log example"]=$(grep -oE 'version="HOPS v[0-9]+\.[0-9]+\.[0-9]+"' "$REPO_DIR/QUICKSTART.md" 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "MISSING")
doc_versions["QUICKSTART.md docker pin"]=$(grep -oE 'hops:v[0-9]+\.[0-9]+\.[0-9]+' "$REPO_DIR/QUICKSTART.md" 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "MISSING")

doc_problems=()
for f in "${!doc_versions[@]}"; do
  v="${doc_versions[$f]}"
  if [[ "$v" != "$version_file" ]]; then
    ok=0
    doc_problems+=("$f = $v")
  fi
done

if [[ $ok -eq 1 ]]; then
  echo "✓ Versions aligned at $version_file (build sources + ${#doc_versions[@]} docs)"
  exit 0
fi

{
  echo "✗ Version sources disagree — VERSION says $version_file but:"
  for p in "${build_problems[@]}"; do echo "    [build] $p"; done
  for p in "${doc_problems[@]}"; do echo "    [docs]  $p"; done
  echo ""
  echo "Update whichever is wrong and re-run. (CHANGELOG and ROADMAP are excluded — they reference historical versions intentionally.)"
} >&2
exit 1
