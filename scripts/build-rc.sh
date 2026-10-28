#!/usr/bin/env bash
# Build a HOPS release candidate for every release target.
#
#   scripts/build-rc.sh <label>        e.g. scripts/build-rc.sh rc1
#
# Builds the frontend once, embeds it, then cross-builds the release binary
# (no `dev` build tag) for each target with the version stamped
# <VERSION>-<label>. Output: dist/<label>/hops-<os>-<arch>[.exe], install.sh,
# hops-proxmox.sh and SHA256SUMS.
# Any failure stops the script with a non-zero exit; a partial dist/<label>
# is removed before the build starts so stale binaries can never pass as new.
set -euo pipefail

die() { echo "build-rc: ERROR: $*" >&2; exit 1; }

[[ $# -eq 1 ]] || die "usage: $0 <label>   (e.g. rc1)"
label=$1
[[ $label =~ ^[A-Za-z0-9][A-Za-z0-9.]*$ ]] || die "label '$label' must be letters, digits and dots (e.g. rc1)"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

"$REPO_DIR/scripts/check-versions.sh" || die "version sources disagree (see above)"
version=$(tr -d '[:space:]' < VERSION)
out="$REPO_DIR/dist/$label"

# Stale-data rule: remove the old output BEFORE building.
rm -rf "$out"
mkdir -p "$out"

echo "==> Building frontend"
[[ -d frontend/node_modules ]] || die "frontend/node_modules missing — run 'npm ci' in frontend/ first"
(cd frontend && npm run build) || die "frontend build failed"
[[ -f frontend/build/index.html ]] || die "frontend build produced no index.html"

echo "==> Embedding frontend"
rm -rf backend/internal/web/build
mkdir -p backend/internal/web/build
cp -r frontend/build/. backend/internal/web/build/
# Put the tracked placeholder back (rm -rf above removed it).
git checkout -- backend/internal/web/build/.gitkeep || die "could not restore backend/internal/web/build/.gitkeep"

ldflags="-s -w -X github.com/weaversgrainthorpe/HOPS/internal/version.Prerelease=$label"

# name  GOOS  GOARCH  GOARM
targets=(
  "linux-amd64   linux   amd64 -"
  "linux-arm64   linux   arm64 -"
  "darwin-amd64  darwin  amd64 -"
  "darwin-arm64  darwin  arm64 -"
  "windows-amd64 windows amd64 -"
)

for t in "${targets[@]}"; do
  read -r name goos goarch goarm <<<"$t"
  ext=""
  [[ $goos == windows ]] && ext=".exe"
  bin="$out/hops-$name$ext"
  echo "==> Building $name"
  if [[ $goarm == - ]]; then
    (cd backend && GOOS=$goos GOARCH=$goarch CGO_ENABLED=0 \
      go build -trimpath -ldflags "$ldflags" -o "$bin" ./cmd/hops) || die "go build failed for $name"
  else
    (cd backend && GOOS=$goos GOARCH=$goarch GOARM=$goarm CGO_ENABLED=0 \
      go build -trimpath -ldflags "$ldflags" -o "$bin" ./cmd/hops) || die "go build failed for $name"
  fi
  [[ -s $bin ]] || die "build for $name produced no binary"
done

echo "==> Adding install.sh and hops-proxmox.sh"
cp packaging/install.sh "$out/install.sh" || die "could not copy packaging/install.sh"
cp packaging/proxmox/hops-proxmox.sh "$out/hops-proxmox.sh" || die "could not copy packaging/proxmox/hops-proxmox.sh"

echo "==> Writing BUILD-INFO"
commit=$(git rev-parse HEAD) || die "could not read the git commit"
dirty=no
if [[ -n $(git status --porcelain --untracked-files=no) ]]; then dirty=yes; fi
{
  echo "version: $version-$label"
  echo "commit: $commit"
  echo "dirty: $dirty"
  echo "built: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$out/BUILD-INFO"

echo "==> Writing SHA256SUMS"
(cd "$out" && sha256sum hops-* install.sh BUILD-INFO > SHA256SUMS) || die "sha256sum failed"
(cd "$out" && sha256sum -c --quiet SHA256SUMS) || die "SHA256SUMS does not verify"

echo
if [[ $dirty == yes ]]; then
  echo "WARNING: built from a working tree with UNCOMMITTED changes (recorded as dirty: yes in BUILD-INFO)." >&2
fi
echo "Built HOPS v$version-$label into dist/$label:"
ls -l "$out"
