#!/usr/bin/env bash
# HOPS installer / upgrader for Linux (systemd).
#
# Run as root on the machine that will run HOPS:
#
#   curl -fsSL <base-url>/install.sh | sudo bash -s -- [options]
#   sudo bash install.sh [options]
#
# Options (install options only; HOPS settings live in its own GUI):
#   --url <base>      Where to download from. The directory must hold
#                     hops-linux-<arch> and SHA256SUMS.
#                     Default: the latest GitHub release.
#   --version <x.y.z> Install this release (GitHub tag v<x.y.z>) when --url is
#                     not given. In every case, HOPS must report this version
#                     on /api/health or the install counts as failed.
#   --port <n>        The port HOPS listens on, where health is checked.
#                     Default: the port HOPS last used (upgrade) or 8080.
#                     The port itself is a HOPS setting (Settings, in the
#                     GUI); a fresh install always starts on 8080.
#   -h, --help        Show this help.
#
# What it does: detects the CPU architecture, downloads the matching binary
# plus SHA256SUMS and verifies the checksum, creates the `hops` system user,
# installs /opt/hops/hops, keeps data in /var/lib/hops, writes a hardened
# hops.service, starts it and waits for /api/health.
#
# Re-running upgrades in place: the current binary is kept as
# /opt/hops/hops.prev (HOPS backs up its data itself on start-up). If the new
# binary does not become healthy, the previous one is put back and the
# script exits with an error.
#
# Every failure prints a clear message and exits non-zero.
set -euo pipefail

DEFAULT_URL="https://github.com/weaversgrainthorpe/HOPS/releases/latest/download"
RELEASE_URL_PREFIX="https://github.com/weaversgrainthorpe/HOPS/releases/download"
INSTALL_DIR=/opt/hops
BIN="$INSTALL_DIR/hops"
PREV="$INSTALL_DIR/hops.prev"
DATA_DIR=/var/lib/hops
UNIT_FILE=/etc/systemd/system/hops.service
SERVICE=hops
SVC_USER=hops
HEALTH_TIMEOUT=60

log() { echo "hops-install: $*"; }
die() { echo "hops-install: ERROR: $*" >&2; exit 1; }

usage() { sed -n '2,/^set -euo/{/^set -euo/d;s/^# \{0,1\}//;p}' "$0" 2>/dev/null || true; }

url=""
version=""
port=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --url) [[ $# -ge 2 ]] || die "--url needs a value"; url=$2; shift 2 ;;
    --url=*) url=${1#*=}; shift ;;
    --version) [[ $# -ge 2 ]] || die "--version needs a value"; version=$2; shift 2 ;;
    --version=*) version=${1#*=}; shift ;;
    --port) [[ $# -ge 2 ]] || die "--port needs a value"; port=$2; shift 2 ;;
    --port=*) port=${1#*=}; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option '$1' (see --help)" ;;
  esac
done

version=${version#v}
if [[ -n $version && ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]]; then
  die "--version '$version' is not a version like 3.0.0 or 3.0.0-rc1"
fi
if [[ -n $port ]] && ! { [[ $port =~ ^[0-9]+$ ]] && (( port >= 1 && port <= 65535 )); }; then
  die "--port '$port' is not a port number (1-65535)"
fi
if [[ -z $url ]]; then
  if [[ -n $version ]]; then url="$RELEASE_URL_PREFIX/v$version"; else url=$DEFAULT_URL; fi
fi
url=${url%/}

# ---- preflight -------------------------------------------------------------

[[ $(id -u) -eq 0 ]] || die "must run as root (try: sudo bash $0 ...)"
[[ $(uname -s) == Linux ]] || die "this installer is for Linux; see DEPLOY.md for other systems"
[[ -d /run/systemd/system ]] || die "systemd is not running on this machine; install.sh needs systemd (see DEPLOY.md for other options)"
for cmd in systemctl sha256sum install awk getent; do
  command -v "$cmd" >/dev/null 2>&1 || die "required command '$cmd' not found"
done

if command -v curl >/dev/null 2>&1; then
  fetcher=curl
elif command -v wget >/dev/null 2>&1; then
  fetcher=wget
else
  die "neither curl nor wget is installed; install one and re-run"
fi

case $(uname -m) in
  x86_64|amd64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  armv6l|armv7l|armv8l) arch=armv6 ;;
  *) die "unsupported CPU architecture '$(uname -m)' (supported: x86_64, aarch64, armv6l/armv7l)" ;;
esac
asset="hops-linux-$arch"

# fetch <url> <dest> — fails loudly on any HTTP or network error.
fetch() {
  local src=$1 dest=$2
  if [[ $fetcher == curl ]]; then
    curl -fsSL --retry 3 --connect-timeout 15 -o "$dest" "$src" || die "download failed: $src"
  else
    wget -q --tries=3 --timeout=15 -O "$dest" "$src" || die "download failed: $src"
  fi
  [[ -s $dest ]] || die "download was empty: $src"
}

# http_get <url> — prints the body; non-zero on failure (never dies).
http_get() {
  if [[ $fetcher == curl ]]; then
    curl -fsS --max-time 5 "$1" 2>/dev/null
  else
    wget -q --timeout=5 --tries=1 -O - "$1" 2>/dev/null
  fi
}

port_in_use() {
  local p=$1
  if command -v ss >/dev/null 2>&1; then
    ss -Hltn "sport = :$p" 2>/dev/null | grep -q .
  else
    # No ss: treat "something answers HTTP there" as in use.
    http_get "http://127.0.0.1:$p/" >/dev/null || [[ $? -eq 22 ]]
  fi
}

primary_ip() {
  local ip=""
  if command -v ip >/dev/null 2>&1; then
    ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}') || ip=""
  fi
  if [[ -z $ip ]] && command -v hostname >/dev/null 2>&1; then
    ip=$(hostname -I 2>/dev/null | awk '{print $1}') || ip=""
  fi
  echo "${ip:-<this-machine-ip>}"
}

# wait_healthy <port> — succeeds once /api/health answers status "ok" (and the
# expected version, when one was given) while the service is running.
health_body=""
wait_healthy() {
  local p=$1 deadline=$((SECONDS + HEALTH_TIMEOUT))
  health_body=""
  while (( SECONDS < deadline )); do
    if health_body=$(http_get "http://127.0.0.1:$p/api/health"); then
      if [[ $health_body == *'"status":"ok"'* ]] && systemctl is-active --quiet "$SERVICE"; then
        if [[ -z $version || $health_body == *"\"version\":\"$version\""* ]]; then
          return 0
        fi
      fi
    fi
    sleep 2
  done
  return 1
}

show_logs() {
  echo "---- last service log lines (journalctl -u $SERVICE) ----" >&2
  journalctl -u "$SERVICE" -n 25 --no-pager >&2 2>/dev/null || echo "(journalctl unavailable)" >&2
  echo "---------------------------------------------------------" >&2
}

# ---- download + verify -----------------------------------------------------

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

log "architecture: $(uname -m) -> $asset"
log "downloading from $url"
fetch "$url/$asset" "$tmp/$asset"
fetch "$url/SHA256SUMS" "$tmp/SHA256SUMS"

expected=$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1; exit }' "$tmp/SHA256SUMS")
[[ -n $expected ]] || die "SHA256SUMS from $url has no entry for $asset — refusing to install an unverified binary"
actual=$(sha256sum "$tmp/$asset" | awk '{print $1}')
if [[ $actual != "$expected" ]]; then
  die "checksum mismatch for $asset — expected $expected, got $actual. The download is corrupt or was tampered with; nothing was installed or changed."
fi
log "checksum OK ($actual)"
chmod 0755 "$tmp/$asset"

# ---- user, directories -----------------------------------------------------

upgrade=0
[[ -e $BIN ]] && upgrade=1

if ! getent passwd "$SVC_USER" >/dev/null; then
  nologin=/usr/sbin/nologin
  [[ -x $nologin ]] || nologin=/bin/false
  if command -v useradd >/dev/null 2>&1; then
    useradd --system --user-group --home-dir "$DATA_DIR" --no-create-home --shell "$nologin" "$SVC_USER" \
      || die "could not create the '$SVC_USER' system user"
  elif command -v adduser >/dev/null 2>&1; then
    # BusyBox adduser
    addgroup -S "$SVC_USER" 2>/dev/null || true
    adduser -S -D -H -h "$DATA_DIR" -s "$nologin" -G "$SVC_USER" "$SVC_USER" \
      || die "could not create the '$SVC_USER' system user"
  else
    die "neither useradd nor adduser is available to create the '$SVC_USER' user"
  fi
  log "created system user '$SVC_USER'"
fi

install -d -m 0755 "$INSTALL_DIR" || die "could not create $INSTALL_DIR"
install -d -o "$SVC_USER" -g "$SVC_USER" -m 0750 "$DATA_DIR" || die "could not create $DATA_DIR"

# The port HOPS will listen on. It is a HOPS setting; HOPS records the port
# it last used in $DATA_DIR/.last-port, and a brand-new install uses 8080.
last_port=""
if [[ -r $DATA_DIR/.last-port ]]; then
  last_port=$(tr -dc '0-9' < "$DATA_DIR/.last-port")
fi
expect_port=${last_port:-8080}
if [[ -z $port ]]; then
  port=$expect_port
elif [[ $port != "$expect_port" ]]; then
  if [[ -z $last_port ]]; then
    die "--port $port: a new HOPS install always starts on 8080. Install without --port, then change the port in HOPS under Settings."
  fi
  die "--port $port, but HOPS is configured to listen on $expect_port (from $DATA_DIR/.last-port). Change the port in HOPS under Settings, or re-run without --port."
fi

# ---- systemd unit ----------------------------------------------------------

unit_tmp="$tmp/hops.service"
cat > "$unit_tmp" <<EOF
# Written by HOPS install.sh — re-running the installer rewrites this file.
[Unit]
Description=HOPS - Home Operations Portal System
Documentation=https://github.com/weaversgrainthorpe/HOPS
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SVC_USER
Group=$SVC_USER
WorkingDirectory=$DATA_DIR
ExecStart=$BIN --data $DATA_DIR
Restart=on-failure
RestartSec=5
UMask=0027

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DATA_DIR
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictSUIDSGID=true
RestrictRealtime=true
RestrictNamespaces=true
LockPersonality=true
SystemCallArchitectures=native
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
# Lets HOPS bind a port below 1024 if one is chosen in Settings.
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

# ---- install / upgrade -----------------------------------------------------

if (( upgrade )); then
  log "existing install found — upgrading in place"
  if systemctl is-active --quiet "$SERVICE"; then
    systemctl stop "$SERVICE" || die "could not stop $SERVICE; nothing was changed"
  fi
fi

if port_in_use "$port"; then
  if (( upgrade )); then systemctl start "$SERVICE" >/dev/null 2>&1 || true; fi
  die "port $port is already in use by another program, so HOPS could not be checked there. Free the port and re-run. Nothing was changed."
fi

if (( upgrade )); then
  cp -p "$BIN" "$PREV" || die "could not keep the current binary as $PREV; nothing was changed"
  log "previous binary kept as $PREV"
fi
install -m 0755 "$tmp/$asset" "$BIN.new" || die "could not write $BIN.new"
mv -f "$BIN.new" "$BIN" || die "could not move the new binary into place at $BIN"
install -m 0644 "$unit_tmp" "$UNIT_FILE" || die "could not write $UNIT_FILE"

systemctl daemon-reload || die "systemctl daemon-reload failed"
systemctl enable "$SERVICE" >/dev/null 2>&1 || die "could not enable $SERVICE"
systemctl restart "$SERVICE" || true   # health below decides success

log "waiting up to ${HEALTH_TIMEOUT}s for http://127.0.0.1:$port/api/health ..."
if wait_healthy "$port"; then
  ip=$(primary_ip)
  echo
  if (( upgrade )); then log "HOPS upgraded and healthy."; else log "HOPS installed and healthy."; fi
  log "health: $health_body"
  echo
  echo "  Open HOPS:  http://$ip:$port"
  echo
  exit 0
fi

# ---- failure ---------------------------------------------------------------

why="HOPS did not report healthy on port $port within ${HEALTH_TIMEOUT}s"
if [[ -n $version ]]; then why="$why (expected version $version)"; fi
if [[ -n $health_body ]]; then why="$why; last health answer: $health_body"; fi
show_logs

if (( upgrade )); then
  echo "hops-install: $why — rolling back to the previous binary." >&2
  systemctl stop "$SERVICE" >/dev/null 2>&1 || true
  cp -p "$BIN" "$INSTALL_DIR/hops.failed" 2>/dev/null || true
  cp -p "$PREV" "$BIN" || die "ROLLBACK FAILED: could not restore $PREV to $BIN. HOPS is NOT running. The failed binary is at $INSTALL_DIR/hops.failed."
  systemctl restart "$SERVICE" || true
  saved_version=$version
  version=""   # the old binary reports its own version
  if wait_healthy "$port"; then
    version=$saved_version
    die "upgrade FAILED and was rolled back: $why. The previous HOPS is running again ($health_body). The failed binary is kept at $INSTALL_DIR/hops.failed."
  fi
  show_logs
  die "upgrade FAILED and the rollback did not come up healthy either. HOPS is NOT running. Previous binary: $BIN (copy at $PREV); failed binary: $INSTALL_DIR/hops.failed. Check: journalctl -u $SERVICE"
fi

die "install FAILED: $why. Check: journalctl -u $SERVICE"
