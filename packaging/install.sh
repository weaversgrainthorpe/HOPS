#!/usr/bin/env bash
# HOPS installer / upgrader for Linux (systemd). Run as root; --help for usage.
#
# The whole script is one main() called on the last line, so a truncated
# `curl | bash` download runs nothing. Every failure prints a clear message
# and exits non-zero.
set -euo pipefail

DEFAULT_URL="https://github.com/weaversgrainthorpe/HOPS/releases/latest/download"
RELEASE_URL_PREFIX="https://github.com/weaversgrainthorpe/HOPS/releases/download"
INSTALL_DIR=/opt/hops
BIN="$INSTALL_DIR/hops"
PREV="$INSTALL_DIR/hops.prev"
FAILED="$INSTALL_DIR/hops.failed"
DATA_DIR=/var/lib/hops
UNIT_FILE=/etc/systemd/system/hops.service
UNIT_PREV="$UNIT_FILE.prev"
SERVICE=hops
SVC_USER=hops
HEALTH_TIMEOUT=60
# Units this script writes carry this marker; a hops.service without it was
# set up some other way (e.g. a v2 install) and is never touched.
UNIT_MARKER="# Written by HOPS install.sh"
UNIT_TEMPLATE=2

print_help() {
  cat <<'EOF'
HOPS installer / upgrader for Linux (systemd).

Usage (as root):
  curl -fsSL <base-url>/install.sh | sudo bash -s -- [options]
  sudo bash install.sh [options]

Options (install options only; HOPS settings are set in its GUI):
  --url <base>       Download from here. The directory must hold
                     hops-linux-<arch> and SHA256SUMS.
                     Default: the latest GitHub release.
  --version <x.y.z>  Install this release (GitHub tag v<x.y.z>) when --url is
                     not given. In every case HOPS must then report this
                     version on /api/health, or the install counts as failed.
  --port <n>         The port HOPS listens on, where health is checked.
                     Default: the port HOPS last used, else 8080. The port is
                     a HOPS setting: a new install starts on 8080; change it
                     in HOPS under Settings.
  -h, --help         Show this help.

Installs /opt/hops/hops, data in /var/lib/hops, and a hardened hops.service
run as the `hops` system user. Re-running upgrades in place: the previous
binary and unit are kept (hops.prev, hops.service.prev) and put back if the
new version does not become healthy. Local service changes belong in a
drop-in (systemctl edit hops); the installer rewrites hops.service itself.
EOF
}

log() { echo "hops-install: $*"; }
warn() { echo "hops-install: WARNING: $*" >&2; }
die() { echo "hops-install: ERROR: $*" >&2; exit 1; }

# ---- helpers ----------------------------------------------------------------

# fetch <url> <dest> — fails loudly on any HTTP or network error. Over https
# it refuses redirects to anything but https.
fetch() {
  local src=$1 dest=$2
  if [[ $fetcher == curl ]]; then
    local proto=()
    if [[ $src == https://* ]]; then proto=(--proto "=https" --proto-redir "=https"); fi
    curl -fsSL "${proto[@]}" --retry 3 --connect-timeout 15 -o "$dest" "$src" || die "download failed: $src"
  else
    local proto=()
    if [[ $src == https://* ]]; then proto=(--https-only); fi
    wget -q "${proto[@]}" --tries=3 --timeout=15 -O "$dest" "$src" || die "download failed: $src"
  fi
  [[ -s $dest ]] || die "download was empty: $src"
}

# http_get <url> — prints the body; non-zero on failure. Never via a proxy.
http_get() {
  if [[ $fetcher == curl ]]; then
    curl -fsS --noproxy '*' --max-time 5 "$1" 2>/dev/null
  else
    wget -q --no-proxy --timeout=5 --tries=1 -O - "$1" 2>/dev/null
  fi
}

port_in_use() {
  local p=$1
  if command -v ss >/dev/null 2>&1; then
    ss -Hltn "sport = :$p" 2>/dev/null | grep -q .
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null
  fi
}

port_holder() {
  local p=$1 who=""
  if command -v ss >/dev/null 2>&1; then
    who=$(ss -Hltnp "sport = :$p" 2>/dev/null | grep -o 'users:(([^)]*' | head -1 | sed 's/users:((//') || who=""
  fi
  echo "${who:-unknown process}"
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

# The address HOPS binds, from the effective ExecStart (a drop-in may add
# --host). Empty / wildcard means "all interfaces" → probe 127.0.0.1.
health_host() {
  local exec h=""
  exec=$(systemctl show -p ExecStart "$SERVICE" 2>/dev/null) || exec=""
  if [[ $exec =~ --host[=[:space:]]+([^[:space:];]+) ]]; then h=${BASH_REMATCH[1]}; fi
  case $h in
    ""|0.0.0.0|::|"[::]") echo 127.0.0.1 ;;
    *:*) echo "[${h#[}" | sed 's/\]*$/]/' ;;
    *) echo "$h" ;;
  esac
}

read_last_port() {
  local p=""
  if [[ -r $DATA_DIR/.last-port ]]; then p=$(tr -dc '0-9' < "$DATA_DIR/.last-port"); fi
  echo "$p"
}

# wait_healthy — succeeds once /api/health answers status "ok" (and the
# expected version, when one is required) while the service is running.
# It follows .last-port, which a starting HOPS rewrites, so a port change
# saved in Settings but not yet applied is found rather than misreported.
health_body=""
health_port=""
wait_healthy() {
  local want_version=$1 deadline=$((SECONDS + HEALTH_TIMEOUT)) host p=""
  health_body=""
  host=$(health_host)
  while (( SECONDS < deadline )); do
    p=$(read_last_port); p=${p:-$port}
    if health_body=$(http_get "http://$host:$p/api/health"); then
      if [[ $health_body == *'"status":"ok"'* ]] && systemctl is-active --quiet "$SERVICE"; then
        if [[ -z $want_version || $health_body == *"\"version\":\"$want_version\""* ]]; then
          health_port=$p
          return 0
        fi
      fi
    fi
    sleep 2
  done
  health_port=$p
  return 1
}

show_logs() {
  {
    echo "---- systemctl status / last 30 log lines (journalctl -u $SERVICE -n 30) ----"
    systemctl status "$SERVICE" --no-pager -l 2>/dev/null | head -12 || true
    journalctl -u "$SERVICE" -n 30 --no-pager 2>/dev/null || echo "(journalctl unavailable)"
    echo "-----------------------------------------------------------------------------"
  } >&2
}

# ---- the critical section guard --------------------------------------------
# Between stopping the service and a verified result, any exit (die, signal,
# set -e) must leave the machine as it was: old binary + unit back, service
# restarted if it was running. Fresh installs are cleanly un-installed.
critical=0
swapped_bin=0
swapped_unit=0
was_active=0
upgrade=0

restore_previous() {
  if (( swapped_bin )); then
    cp -p "$BIN" "$FAILED" 2>/dev/null || true
    cp -p "$PREV" "$BIN" || return 1
    swapped_bin=0
  fi
  if (( swapped_unit )); then
    if [[ -e $UNIT_PREV ]]; then cp -p "$UNIT_PREV" "$UNIT_FILE" || return 1; fi
    swapped_unit=0
  fi
  systemctl daemon-reload || return 1
}

uninstall_failed_fresh() {
  systemctl disable --now "$SERVICE" >/dev/null 2>&1 || true
  if [[ -e $BIN ]]; then mv -f "$BIN" "$FAILED" 2>/dev/null || rm -f "$BIN"; fi
  rm -f "$UNIT_FILE"
  systemctl daemon-reload >/dev/null 2>&1 || true
}

# shellcheck disable=SC2317  # invoked via trap
on_exit() {
  local rc=$?
  rm -rf "${tmp:-/nonexistent}" "$BIN.new" "$UNIT_FILE.new" 2>/dev/null || true
  if (( critical )); then
    critical=0
    if (( upgrade )); then
      echo "hops-install: the upgrade stopped part-way — putting the previous HOPS back." >&2
      if restore_previous; then
        if (( was_active )); then
          if systemctl restart "$SERVICE"; then
            echo "hops-install: previous binary and unit restored; $SERVICE restarted. Nothing else changed." >&2
          else
            echo "hops-install: previous binary and unit restored, but $SERVICE did NOT restart. Check: journalctl -u $SERVICE -n 30" >&2
          fi
        else
          echo "hops-install: previous binary and unit restored ($SERVICE was not running before, so it was left stopped)." >&2
        fi
      else
        echo "hops-install: RESTORE FAILED — HOPS may be broken. Previous binary: $PREV, previous unit: $UNIT_PREV." >&2
      fi
    else
      uninstall_failed_fresh
      echo "hops-install: the install stopped part-way; it was undone (service disabled and removed; binary moved to $FAILED)." >&2
    fi
    (( rc != 0 )) || rc=1
  fi
  exit "$rc"
}

# ---- unit file ---------------------------------------------------------------

write_unit() {
  local out=$1 container=$2 native=$3
  {
    echo "$UNIT_MARKER (unit template $UNIT_TEMPLATE)."
    cat <<EOF
# Re-running the installer rewrites this file. Do not edit it: put local
# changes (e.g. --host 127.0.0.1) in a drop-in with \`systemctl edit hops\`,
# which the installer never touches.
[Unit]
Description=HOPS - Home Operations Portal System
Documentation=https://github.com/weaversgrainthorpe/HOPS
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SVC_USER
Group=$svc_group
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
RestrictSUIDSGID=true
RestrictRealtime=true
RestrictNamespaces=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
# Lets HOPS bind a port below 1024 if one is chosen in Settings.
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE
EOF
    if [[ $container == none ]]; then
      cat <<'EOF'
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
EOF
    else
      echo "# Running in a container ($container): device/kernel/clock/hostname"
      echo "# protections are left out; unprivileged containers often refuse them."
    fi
    if [[ $native == yes ]]; then
      echo "SystemCallArchitectures=native"
    fi
    cat <<'EOF'

[Install]
WantedBy=multi-user.target
EOF
  } > "$out"
}

# Lines that matter when comparing units (comments and blanks dropped).
unit_body() { grep -vE '^[[:space:]]*(#|$)' "$1" || true; }

# ---- main ---------------------------------------------------------------------

main() {
  local url="" version="" port_arg=""
  while [[ $# -gt 0 ]]; do
    case $1 in
      --url) [[ $# -ge 2 ]] || die "--url needs a value"; url=$2; shift 2 ;;
      --url=*) url=${1#*=}; shift ;;
      --version) [[ $# -ge 2 ]] || die "--version needs a value"; version=$2; shift 2 ;;
      --version=*) version=${1#*=}; shift ;;
      --port) [[ $# -ge 2 ]] || die "--port needs a value"; port_arg=$2; shift 2 ;;
      --port=*) port_arg=${1#*=}; shift ;;
      -h|--help) print_help; exit 0 ;;
      *) die "unknown option '$1' (see --help)" ;;
    esac
  done

  version=${version#v}
  if [[ -n $version && ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]]; then
    die "--version '$version' is not a version like 3.0.0 or 3.0.0-rc1"
  fi
  if [[ -n $port_arg ]] && ! { [[ $port_arg =~ ^[0-9]+$ ]] && (( port_arg >= 1 && port_arg <= 65535 )); }; then
    die "--port '$port_arg' is not a port number (1-65535)"
  fi
  if [[ -z $url ]]; then
    if [[ -n $version ]]; then url="$RELEASE_URL_PREFIX/v$version"; else url=$DEFAULT_URL; fi
  fi
  url=${url%/}
  case $url in
    https://*) ;;
    http://*) warn "--url is plain http: the checksum proves the files are intact, not who served them (fine for a trusted LAN only)." ;;
    *) die "--url '$url' must start with https:// or http://" ;;
  esac

  # ---- preflight (nothing is changed until the downloads verify) -----------

  if [[ $(id -u) -ne 0 ]]; then
    die "must run as root: curl -fsSL <base-url>/install.sh | sudo bash -s -- [options]   (or: sudo bash install.sh [options])"
  fi
  [[ $(uname -s) == Linux ]] || die "this installer is for Linux; see DEPLOY.md for other systems"
  [[ -d /run/systemd/system ]] || die "systemd is not running on this machine; install.sh needs systemd (see DEPLOY.md for other options)"
  local cmd
  for cmd in systemctl sha256sum install awk getent id grep sed; do
    command -v "$cmd" >/dev/null 2>&1 || die "required command '$cmd' not found"
  done

  if command -v curl >/dev/null 2>&1; then
    fetcher=curl
  elif command -v wget >/dev/null 2>&1; then
    fetcher=wget
  else
    die "neither curl nor wget is installed; install one and re-run"
  fi

  # Architecture of the userland (what systemd and the OS are built for),
  # not the kernel: 32-bit Raspberry Pi OS on a 64-bit kernel needs armv6.
  local arch="" native=yes how dpkg_arch bits
  if command -v dpkg >/dev/null 2>&1 && dpkg_arch=$(dpkg --print-architecture 2>/dev/null); then
    how="dpkg: $dpkg_arch"
    case $dpkg_arch in
      amd64) arch=amd64 ;;
      arm64) arch=arm64 ;;
      armhf|armel) arch=armv6 ;;
      *) die "unsupported architecture '$dpkg_arch' (supported: amd64, arm64, armhf/armel)" ;;
    esac
  else
    bits=$(getconf LONG_BIT 2>/dev/null) || bits=""
    how="uname -m: $(uname -m), userland bits: ${bits:-unknown}"
    case $(uname -m) in
      x86_64|amd64) [[ $bits == 32 ]] && die "32-bit x86 userland on a 64-bit kernel is not supported"; arch=amd64 ;;
      aarch64|arm64) if [[ $bits == 32 ]]; then arch=armv6; else arch=arm64; fi ;;
      armv6l|armv7l|armv8l) arch=armv6 ;;
      *) die "unsupported CPU architecture '$(uname -m)' (supported: x86_64, aarch64, armv6l/armv7l)" ;;
    esac
    # Unsure whether the userland matches the binary → no syscall-arch filter.
    [[ -n $bits ]] || native=no
  fi
  local asset="hops-linux-$arch"

  local container=none
  if command -v systemd-detect-virt >/dev/null 2>&1; then
    container=$(systemd-detect-virt --container 2>/dev/null) || container=none
  fi

  # Refuse a hops.service this script did not write (v2 or a manual setup).
  local frag
  frag=$(systemctl show -p FragmentPath --value "$SERVICE" 2>/dev/null) || frag=""
  if [[ -n $frag && $frag != "$UNIT_FILE" ]]; then
    die "an existing $SERVICE service from another install method was found at $frag (ExecStart: $(systemctl show -p ExecStart --value "$SERVICE" 2>/dev/null | grep -o 'path=[^;]*' | head -1)). install.sh will not replace it. See DEPLOY.md, \"Upgrading from v2 with install.sh\"."
  fi
  if [[ -e $UNIT_FILE ]] && ! grep -qF "$UNIT_MARKER" "$UNIT_FILE"; then
    die "an existing $UNIT_FILE was not written by install.sh (ExecStart: $(grep -m1 '^ExecStart=' "$UNIT_FILE" | cut -d= -f2-)). It is probably a v2 or manual install; install.sh will not replace it or its data. See DEPLOY.md, \"Upgrading from v2 with install.sh\". Nothing was changed."
  fi
  if [[ -e $UNIT_FILE ]]; then
    local old_exec
    old_exec=$(grep -m1 '^ExecStart=' "$UNIT_FILE" | cut -d= -f2-)
    if [[ $old_exec != "$BIN --data $DATA_DIR" ]]; then
      die "$UNIT_FILE was edited: its ExecStart is '$old_exec' (install.sh writes '$BIN --data $DATA_DIR'). Re-running would drop that change. Move it to a drop-in (sudo systemctl edit $SERVICE: an empty 'ExecStart=' line, then your ExecStart line), restore the ExecStart line in $UNIT_FILE, and re-run. Nothing was changed."
    fi
  fi

  [[ -e $BIN ]] && upgrade=1

  # Existing service user: must be usable as a system account.
  svc_group=$SVC_USER
  if getent passwd "$SVC_USER" >/dev/null; then
    local uid shell uid_min
    uid=$(id -u "$SVC_USER")
    svc_group=$(id -gn "$SVC_USER")
    shell=$(getent passwd "$SVC_USER" | cut -d: -f7)
    uid_min=$(awk '$1=="UID_MIN"{print $2}' /etc/login.defs 2>/dev/null) || uid_min=""
    uid_min=${uid_min:-1000}
    if (( uid >= uid_min )) || [[ $shell != */nologin && $shell != */false ]]; then
      warn "the existing '$SVC_USER' account (uid $uid, shell $shell) looks like a login user, not a system account. HOPS will run as it."
    fi
  fi
  if [[ -e $DATA_DIR/hops.db ]] && getent passwd "$SVC_USER" >/dev/null; then
    local owner
    owner=$(stat -c %U "$DATA_DIR/hops.db")
    if [[ $owner != "$SVC_USER" ]]; then
      die "$DATA_DIR/hops.db is owned by '$owner', not '$SVC_USER', so HOPS could not open it. Fix with: chown -R $SVC_USER:$svc_group $DATA_DIR   then re-run. Nothing was changed."
    fi
  fi

  # The port HOPS will listen on is a HOPS setting. HOPS records the port it
  # last used in .last-port; a brand-new install uses 8080.
  local last_port expect_port
  last_port=$(read_last_port)
  expect_port=${last_port:-8080}
  if [[ -z $port_arg ]]; then
    port=$expect_port
  elif [[ $port_arg != "$expect_port" ]]; then
    if [[ -z $last_port ]]; then
      die "--port $port_arg: a new HOPS install always starts on 8080. Install without --port, then change the port in HOPS under Settings."
    fi
    die "--port $port_arg, but HOPS is configured to listen on $expect_port (from $DATA_DIR/.last-port). Change the port in HOPS under Settings, or re-run without --port."
  else
    port=$port_arg
  fi

  # ---- download + verify -----------------------------------------------------

  tmp=$(mktemp -d)
  trap on_exit EXIT
  trap 'exit 130' INT TERM HUP

  log "architecture: $asset ($how)"
  log "downloading from $url"
  fetch "$url/$asset" "$tmp/$asset"
  fetch "$url/SHA256SUMS" "$tmp/SHA256SUMS"

  local expected actual
  expected=$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1; exit }' "$tmp/SHA256SUMS")
  [[ -n $expected ]] || die "SHA256SUMS from $url has no entry for $asset — refusing to install an unverified binary. Nothing was changed."
  actual=$(sha256sum "$tmp/$asset" | awk '{print $1}')
  if [[ $actual != "$expected" ]]; then
    die "checksum mismatch for $asset — expected $expected, got $actual. The download is corrupt or was tampered with; nothing was installed or changed."
  fi
  log "checksum OK ($actual)"

  # ---- prepare everything that can fail, before touching the service --------

  if ! getent passwd "$SVC_USER" >/dev/null; then
    local nologin=/usr/sbin/nologin
    [[ -x $nologin ]] || nologin=/bin/false
    if command -v useradd >/dev/null 2>&1; then
      useradd --system --user-group --home-dir "$DATA_DIR" --no-create-home --shell "$nologin" "$SVC_USER" \
        || die "could not create the '$SVC_USER' system user"
    elif command -v adduser >/dev/null 2>&1; then
      addgroup -S "$SVC_USER" 2>/dev/null || true
      adduser -S -D -H -h "$DATA_DIR" -s "$nologin" -G "$SVC_USER" "$SVC_USER" \
        || die "could not create the '$SVC_USER' system user"
    else
      die "neither useradd nor adduser is available to create the '$SVC_USER' user"
    fi
    svc_group=$(id -gn "$SVC_USER")
    log "created system user '$SVC_USER'"
  fi

  install -d -m 0755 "$INSTALL_DIR" || die "could not create $INSTALL_DIR"
  install -d -o "$SVC_USER" -g "$svc_group" -m 0750 "$DATA_DIR" || die "could not create $DATA_DIR"

  # New binary and unit staged next to their targets (a full disk fails here).
  install -m 0755 "$tmp/$asset" "$BIN.new" || die "could not write $BIN.new (disk full?). Nothing was changed."
  write_unit "$tmp/hops.service" "$container" "$native"
  install -m 0644 "$tmp/hops.service" "$UNIT_FILE.new" || die "could not write $UNIT_FILE.new. Nothing was changed."
  if [[ $container != none ]]; then
    log "running in a container ($container): unit leaves out device/kernel/clock/hostname protections"
  fi

  if (( upgrade )); then
    log "existing install found — upgrading in place"
    if ! { cp -p "$BIN" "$PREV.tmp" && mv -f "$PREV.tmp" "$PREV"; }; then
      rm -f "$PREV.tmp"
      die "could not keep the current binary as $PREV (disk full?). Nothing was changed."
    fi
    if [[ -e $UNIT_FILE ]]; then
      cp -p "$UNIT_FILE" "$UNIT_PREV" || die "could not keep the current unit as $UNIT_PREV. Nothing was changed."
      if [[ "$(unit_body "$UNIT_FILE")" != "$(unit_body "$UNIT_FILE.new")" ]]; then
        log "hops.service changes (previous kept as $UNIT_PREV; local changes belong in 'systemctl edit hops'):"
        if command -v diff >/dev/null 2>&1; then
          diff -u <(unit_body "$UNIT_FILE") <(unit_body "$UNIT_FILE.new") | sed -n '3,$p' | sed 's/^/    /' || true
        else
          echo "    (diff not installed; compare $UNIT_PREV with $UNIT_FILE)"
        fi
      fi
    else
      rm -f "$UNIT_PREV"
    fi
    log "previous binary kept as $PREV"
  fi

  # ---- critical section: stop → swap → start --------------------------------

  if systemctl is-active --quiet "$SERVICE"; then was_active=1; fi
  critical=1
  if (( was_active )); then
    systemctl stop "$SERVICE" || die "could not stop $SERVICE"
  fi
  if port_in_use "$port"; then
    die "port $port is already in use by $(port_holder "$port"), so the new HOPS could not be checked there. Free the port and re-run."
  fi

  mv -f "$BIN.new" "$BIN" || die "could not move the new binary into place at $BIN"
  swapped_bin=1
  mv -f "$UNIT_FILE.new" "$UNIT_FILE" || die "could not move the new unit into place at $UNIT_FILE"
  swapped_unit=1
  systemctl daemon-reload || die "systemctl daemon-reload failed"
  systemctl enable "$SERVICE" >/dev/null 2>&1 || die "could not enable $SERVICE"
  systemctl restart "$SERVICE" || true   # health below decides success

  log "waiting up to ${HEALTH_TIMEOUT}s for /api/health (port $port) ..."
  if wait_healthy "$version"; then
    critical=0
    local ip
    ip=$(primary_ip)
    echo
    if (( upgrade )); then log "HOPS upgraded and healthy."; else log "HOPS installed and healthy."; fi
    log "health: $health_body"
    if [[ $health_port != "$port" ]]; then
      log "note: HOPS came up on port $health_port, not $port (a port change saved in Settings took effect on restart)."
    fi
    rm -f "$INSTALL_DIR/hops.failed"
    echo
    echo "  Open HOPS:  http://$ip:$health_port"
    echo
    exit 0
  fi

  # ---- health failed ---------------------------------------------------------

  local why="HOPS did not report healthy on port $health_port within ${HEALTH_TIMEOUT}s"
  [[ -n $version ]] && why="$why (expected version $version)"
  [[ -n $health_body ]] && why="$why; last health answer: $health_body"
  show_logs
  critical=0

  if (( upgrade )); then
    echo "hops-install: $why — rolling back to the previous binary and unit." >&2
    systemctl stop "$SERVICE" >/dev/null 2>&1 || true
    restore_previous || die "ROLLBACK FAILED: could not restore $PREV / $UNIT_PREV. HOPS is NOT running. The failed binary is at $FAILED."
    if (( ! was_active )); then
      die "upgrade FAILED: $why. Previous binary and unit restored; $SERVICE was not running before, so it was left stopped. Failed binary: $FAILED."
    fi
    systemctl restart "$SERVICE" || true
    if wait_healthy ""; then
      die "upgrade FAILED and was rolled back: $why. The previous HOPS is running again on port $health_port ($health_body). The failed binary is kept at $FAILED."
    fi
    show_logs
    die "upgrade FAILED and the rollback did not come up healthy either. HOPS is NOT running. Restored binary: $BIN (copy at $PREV); failed binary: $FAILED. Check: journalctl -u $SERVICE -n 30"
  fi

  uninstall_failed_fresh
  die "install FAILED: $why. The service was disabled and removed and the binary moved to $FAILED, so a re-run starts clean. See the log lines above."
}

main "$@"
