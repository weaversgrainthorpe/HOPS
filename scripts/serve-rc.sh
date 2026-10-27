#!/usr/bin/env bash
# Serve a built release candidate (dist/<label>) over HTTP on the LAN so
# install.sh / the Proxmox script / the OVA build can download it.
#
#   scripts/serve-rc.sh <label> [port]      (port defaults to 8099)
#
# Runs in the foreground; Ctrl+C stops it. The server only reads files.
set -euo pipefail

die() { echo "serve-rc: ERROR: $*" >&2; exit 1; }

[[ $# -ge 1 && $# -le 2 ]] || die "usage: $0 <label> [port]   (e.g. rc1 8099)"
label=$1
port=${2:-8099}
[[ $label =~ ^[A-Za-z0-9][A-Za-z0-9.]*$ ]] || die "invalid label '$label'"
if ! [[ $port =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then die "invalid port '$port'"; fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
dir="$REPO_DIR/dist/$label"
[[ -d $dir ]] || die "$dir does not exist — run scripts/build-rc.sh $label first"
[[ -s $dir/SHA256SUMS ]] || die "$dir/SHA256SUMS is missing — the build is incomplete; re-run scripts/build-rc.sh $label"
(cd "$dir" && sha256sum -c --quiet SHA256SUMS) || die "files in $dir do not match SHA256SUMS — rebuild"
command -v python3 >/dev/null || die "python3 is required"

ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}' || true)
[[ -n $ip ]] || ip=$(hostname -I 2>/dev/null | awk '{print $1}')
[[ -n $ip ]] || ip="<this-host-ip>"

version=$(tr -d '[:space:]' < "$REPO_DIR/VERSION")
echo "Serving $dir"
if [[ -r $dir/BUILD-INFO ]]; then sed 's/^/  /' "$dir/BUILD-INFO"; fi
echo "  Base URL: http://$ip:$port"
echo "  Install:  curl -fsSL http://$ip:$port/install.sh | sudo bash -s -- --url http://$ip:$port --version $version-$label"
echo "  Note: plain http proves nothing about who served the files (LAN trials only)."
echo "Ctrl+C to stop."
exec python3 -m http.server "$port" --bind 0.0.0.0 --directory "$dir"
