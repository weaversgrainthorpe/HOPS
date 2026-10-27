#!/usr/bin/env bash
# HOPS on Proxmox VE — creates an unprivileged Debian 12 LXC container and
# installs HOPS in it with the shared installer (install.sh).
#
# Run as root in the Proxmox host shell:
#
#   bash hops-proxmox.sh                       # menus (whiptail)
#   bash hops-proxmox.sh --url http://172.16.0.50:8099 --yes
#
# Options (install options only; HOPS settings live in its own GUI):
#   --id <n>            Container ID. Default: the next free ID.
#   --hostname <name>   Default: hops.
#   --cores <n>         Default: 1.
#   --memory <MB>       Default: 256.
#   --disk <GB>         Default: 2.
#   --storage <name>    Storage for the container disk (must be active and
#                       allow container content). Default: local-lvm if
#                       present, else the first storage that can hold it.
#   --bridge <name>     Network bridge (DHCP). Default: vmbr0.
#   --url <base>        Where install.sh, SHA256SUMS and the HOPS binaries
#                       are downloaded from. Default: the latest GitHub
#                       release (or the --version release).
#   --version <x.y.z>   Install this HOPS version; it must report it on
#                       /api/health or the install counts as failed.
#   --ssh-key <file>    Public key file to authorise for root SSH. No root
#                       password is set; `pct enter <id>` on this host
#                       always gives a root shell.
#   --template-storage <name>  Where the Debian 12 template is kept.
#                       Default: local.
#   --yes               Do not ask; use the flags and defaults as given.
#                       Needed when there is no terminal.
#   --dry-run           Print every pct/pveam/pvesm/pvesh command that
#                       would run, change nothing, and exit 0.
#   -h, --help          Show this help.
#
# HOPS listens on port 8080 on a fresh install (change it later in HOPS,
# under Settings). The script finishes only when http://<ct-ip>:8080/api/health
# answers from this host; anything less is reported as a failure.
#
# The whole script is one main() called on the last line, so a truncated
# download piped to bash runs nothing.
set -Eeuo pipefail

DEFAULT_URL="https://github.com/weaversgrainthorpe/HOPS/releases/latest/download"
RELEASE_URL_PREFIX="https://github.com/weaversgrainthorpe/HOPS/releases/download"
HOPS_PORT=8080
CT_NET_TIMEOUT=90
CT_HEALTH_TIMEOUT=60

# ---- output / failure ------------------------------------------------------

step="start-up"
created=0           # 1 once the container exists
tmp=""
id=""

log()  { echo "hops-proxmox: $*"; }
warn() { echo "hops-proxmox: WARNING: $*" >&2; }

# fail <what went wrong> [what to do]
fail() {
  trap - ERR
  echo >&2
  echo "hops-proxmox: ERROR during step '$step': $1" >&2
  [[ -n ${2:-} ]] && echo "hops-proxmox: what to do: $2" >&2
  if (( created )); then
    echo "hops-proxmox: container $id WAS CREATED and is left as it is for inspection (root shell: pct enter $id)." >&2
    echo "hops-proxmox: to remove it:  pct destroy $id --purge --force" >&2
  fi
  echo "hops-proxmox: HOPS was NOT installed successfully." >&2
  exit 1
}

# shellcheck disable=SC2317  # called from the ERR trap
on_err() {
  fail "unexpected failure (exit $1) at line $2 running: $3" "re-run with the same options; if it fails again, report this message"
}
trap 'on_err $? $LINENO "$BASH_COMMAND"' ERR
trap 'if [[ -n $tmp ]]; then rm -rf "$tmp"; fi' EXIT

usage() {
  cat <<'EOF'
HOPS on Proxmox VE: creates an unprivileged Debian 12 LXC container and
installs HOPS in it with install.sh. Run as root in the Proxmox host shell.

  bash hops-proxmox.sh                                   # menus (whiptail)
  bash hops-proxmox.sh --url http://172.16.0.50:8099 --yes

Options:
  --id <n>                  Container ID (default: next free)
  --hostname <name>         Default: hops
  --cores <n>               Default: 1
  --memory <MB>             Default: 256
  --disk <GB>               Default: 2
  --storage <name>          Container disk storage (default: local-lvm, else
                            the first active storage for containers)
  --bridge <name>           Network bridge, DHCP (default: vmbr0)
  --url <base>              Where install.sh, SHA256SUMS and the binaries are
                            (default: the latest GitHub release)
  --version <x.y.z>         Require this HOPS version on /api/health
  --ssh-key <file>          Public key for root SSH (no password is set;
                            `pct enter <id>` always gives a shell)
  --template-storage <name> Where the Debian 12 template is kept (default: local)
  --yes                     No questions; use flags and defaults
  --dry-run                 Print the commands that would run; change nothing
  -h, --help                This help
EOF
}

# ct_storages — active storages that can hold container disks.
ct_storages() { pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $3=="active" {print $1}'; }

need() { [[ $# -ge 2 ]] || fail "$1 needs a value" "see --help"; }

main() {
# ---- options ---------------------------------------------------------------

hostname="hops" cores="1" memory="256" disk="2" storage="" bridge="vmbr0"
url="" version="" ssh_key="" tstore="local" yes=0 dry=0

while [[ $# -gt 0 ]]; do
  case $1 in
    --id) need "$@"; id=$2; shift 2 ;;
    --hostname) need "$@"; hostname=$2; shift 2 ;;
    --cores) need "$@"; cores=$2; shift 2 ;;
    --memory) need "$@"; memory=$2; shift 2 ;;
    --disk) need "$@"; disk=$2; shift 2 ;;
    --storage) need "$@"; storage=$2; shift 2 ;;
    --bridge) need "$@"; bridge=$2; shift 2 ;;
    --url) need "$@"; url=$2; shift 2 ;;
    --version) need "$@"; version=$2; shift 2 ;;
    --ssh-key) need "$@"; ssh_key=$2; shift 2 ;;
    --template-storage) need "$@"; tstore=$2; shift 2 ;;
    --yes|-y) yes=1; shift ;;
    --dry-run) dry=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown option '$1'" "see --help" ;;
  esac
done

# run <cmd...> — a command that changes something. Printed always; skipped in
# --dry-run.
show() {
  local a out="+"
  for a in "$@"; do
    if [[ $a =~ ^[][A-Za-z0-9_./:=,@\<\>+-]+$ ]]; then out+=" $a"; else out+=" $(printf '%q' "$a")"; fi
  done
  echo "$out"
}
run() {
  show "$@"
  (( dry )) && return 0
  "$@"
}

# query <placeholder> <cmd...> — a read-only command. In --dry-run without
# Proxmox tools it prints the placeholder instead.
query() {
  local ph=$1; shift
  if (( dry )) && ! command -v "$1" >/dev/null 2>&1; then
    echo "$ph"
    return 0
  fi
  "$@"
}

# ---- preflight -------------------------------------------------------------

step="preflight"
is_pve=1
for c in pveversion pct pveam pvesm pvesh; do
  command -v "$c" >/dev/null 2>&1 || is_pve=0
done
if (( is_pve )); then
  pve_ver=$(pveversion 2>/dev/null) || is_pve=0
fi
if (( ! is_pve )); then
  if (( dry )); then
    warn "this is not a Proxmox VE host; --dry-run uses placeholders for Proxmox queries"
  else
    fail "this is not a Proxmox VE host (pveversion/pct/pveam/pvesm/pvesh not all found)" \
      "run this script in the shell of a Proxmox VE node (Datacenter > node > Shell)"
  fi
else
  log "Proxmox: $pve_ver"
fi
if [[ $(id -u) -ne 0 ]]; then
  if (( dry )); then
    warn "not root; a real run needs root"
  else
    fail "must run as root" "run it as root in the Proxmox host shell"
  fi
fi
[[ $(uname -m) == x86_64 ]] || fail "this host is $(uname -m); the script supports x86_64 Proxmox VE only"
(( dry )) || command -v curl >/dev/null 2>&1 || fail "curl is not installed on this host" "apt install curl"

interactive=0
if (( ! yes && ! dry )) && [[ -t 0 && -t 1 ]] && command -v whiptail >/dev/null 2>&1; then
  interactive=1
fi
if (( ! yes && ! dry && ! interactive )); then
  fail "no terminal for menus (or whiptail missing), and --yes not given" \
    "re-run with --yes plus any options you want (see --help)"
fi

# ---- choices ---------------------------------------------------------------

step="choices"
wt() { whiptail --backtitle "HOPS on Proxmox VE" "$@" 3>&1 1>&2 2>&3; }
cancelled() { echo "hops-proxmox: cancelled; nothing was changed." >&2; exit 1; }

if [[ -z $id ]]; then
  id=$(query "<next-free-id>" pvesh get /cluster/nextid) || fail "could not get the next free ID (pvesh get /cluster/nextid)" "pass one with --id"
fi

if [[ -z $storage ]]; then
  if (( is_pve )); then
    local list
    list=$(ct_storages) || list=""
    if grep -qx local-lvm <<<"$list"; then storage=local-lvm; else storage=$(head -n1 <<<"$list"); fi
    [[ -n $storage ]] || fail "no active storage can hold a container disk" "pass one with --storage (see: pvesm status -content rootdir)"
  else
    storage="<storage>"
  fi
fi
url=${url%/}

if (( interactive )); then
  summary() {
    printf 'Container ID: %s\nHostname: %s\nCores: %s\nMemory: %s MB\nDisk: %s GB on %s\nNetwork: DHCP on %s\nDownload from: %s\n' \
      "$id" "$hostname" "$cores" "$memory" "$disk" "$storage" "$bridge" "${url:-GitHub release}"
  }
  if ! wt --title "Settings" --yes-button "Install" --no-button "Change" --yesno "$(summary)" 18 70; then
    id=$(wt --inputbox "Container ID" 8 60 "$id") || cancelled
    hostname=$(wt --inputbox "Hostname" 8 60 "$hostname") || cancelled
    cores=$(wt --inputbox "CPU cores" 8 60 "$cores") || cancelled
    memory=$(wt --inputbox "Memory (MB)" 8 60 "$memory") || cancelled
    disk=$(wt --inputbox "Disk (GB)" 8 60 "$disk") || cancelled
    storage=$(wt --inputbox "Disk storage" 8 60 "$storage") || cancelled
    bridge=$(wt --inputbox "Network bridge (DHCP)" 8 60 "$bridge") || cancelled
    url=$(wt --inputbox "Download address (empty = GitHub release)" 8 70 "$url") || cancelled
    url=${url%/}
    wt --title "Settings" --yesno "$(summary)" 18 70 || cancelled
  fi
fi

# ---- validation ------------------------------------------------------------

step="validation"
num() {
  if ! [[ $2 =~ ^[0-9]+$ ]] || (( 10#$2 < $3 )); then fail "--$1 must be a whole number of at least $3 (got '$2')"; fi
}
[[ $id == "<next-free-id>" ]] || num id "$id" 100
num cores "$cores" 1
num memory "$memory" 128
num disk "$disk" 1
[[ $hostname =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] || fail "--hostname '$hostname' is not a valid host name"
[[ $bridge =~ ^[A-Za-z0-9._-]+$ ]] || fail "--bridge '$bridge' is not a valid bridge name"
version=${version#v}
if [[ -n $version && ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]]; then
  fail "--version '$version' is not a version like 3.0.0 or 3.0.0-rc1"
fi
if [[ -z $url ]]; then
  if [[ -n $version ]]; then url="$RELEASE_URL_PREFIX/v$version"; else url=$DEFAULT_URL; fi
fi
[[ $url =~ ^https?://[^[:space:]\'\"\\]+$ ]] || fail "--url '$url' must be an http:// or https:// address"
ssh_pub=""
if [[ -n $ssh_key ]]; then
  [[ -r $ssh_key ]] || fail "--ssh-key file '$ssh_key' cannot be read"
  ssh_pub=$(grep -E '^(ssh-|ecdsa-|sk-)' "$ssh_key" | head -n1) || true
  [[ -n $ssh_pub ]] || fail "--ssh-key file '$ssh_key' holds no public key line (ssh-ed25519 ..., ssh-rsa ...)"
  [[ $ssh_pub != *"'"* ]] || fail "--ssh-key: the key line contains a quote character; remove it from the key's comment"
fi

if (( is_pve )); then
  if [[ $id != "<next-free-id>" ]]; then
    pvesh get /cluster/nextid --vmid "$id" >/dev/null 2>&1 || fail "ID $id is already in use" "choose another --id, or leave it out for the next free one"
  fi
  ct_storages | grep -qx -- "$storage" \
    || fail "storage '$storage' does not exist, is not active, or does not allow container disks" "see: pvesm status -content rootdir; pass --storage"
  ip link show "$bridge" >/dev/null 2>&1 || fail "network bridge '$bridge' does not exist on this host" "see: ip link (or Datacenter > node > Network); pass --bridge"
fi

log "plan: CT $id '$hostname', $cores core(s), ${memory} MB, ${disk} GB on $storage, DHCP on $bridge"
log "HOPS download: $url${version:+ (version $version)}"
(( dry )) && log "DRY RUN — the commands below are printed, not run."

# ---- install.sh: download + verify on this host ----------------------------

step="download install.sh"
tmp=$(mktemp -d /var/tmp/hops-proxmox.XXXXXX 2>/dev/null || mktemp -d)
install_sha="<sha256-of-install.sh>"
if (( dry )); then
  echo "+ curl -fsSL $url/install.sh  (verified against $url/SHA256SUMS)"
else
  curl -fsSL --retry 3 --connect-timeout 15 -o "$tmp/install.sh" "$url/install.sh" \
    || fail "could not download $url/install.sh" "check --url and that this host can reach it (curl -I $url/install.sh)"
  curl -fsSL --retry 3 --connect-timeout 15 -o "$tmp/SHA256SUMS" "$url/SHA256SUMS" \
    || fail "could not download $url/SHA256SUMS" "check --url; the directory must hold SHA256SUMS"
  [[ -s $tmp/install.sh ]] || fail "$url/install.sh was empty"
  listed=$(awk '$2=="install.sh" || $2=="*install.sh" {print $1; exit}' "$tmp/SHA256SUMS")
  [[ -n $listed ]] || fail "SHA256SUMS at $url has no entry for install.sh — refusing to run an unverified installer"
  install_sha=$(sha256sum "$tmp/install.sh" | awk '{print $1}')
  [[ $install_sha == "$listed" ]] || fail "install.sh checksum mismatch: expected $listed, got $install_sha" \
    "the download is corrupt or was tampered with; nothing was created"
  log "install.sh checksum OK ($install_sha)"
fi

inst_args=(--url "$url")
[[ -n $version ]] && inst_args+=(--version "$version")

# health_from_host <ip> <timeout> — succeeds once HOPS answers healthy.
health_body=""
health_from_host() {
  local ip=$1 deadline=$((SECONDS + $2))
  while (( SECONDS < deadline )); do
    if health_body=$(curl -fsS --noproxy '*' --max-time 5 "http://$ip:$HOPS_PORT/api/health" 2>/dev/null) \
       && [[ $health_body == *'"status":"ok"'* ]] \
       && [[ -z $version || $health_body == *"\"version\":\"$version\""* ]]; then
      return 0
    fi
    sleep 3
  done
  return 1
}

done_banner() {
  echo
  log "HOPS is installed and healthy in CT $id ($hostname)."
  log "health: $health_body"
  echo
  echo "  Open HOPS:  http://$1:$HOPS_PORT"
  echo
  echo "  Shell in the container: pct enter $id  (on this host; no root password is set${ssh_pub:+, or SSH as root with your key})"
  echo
}

# ---- CT --------------------------------------------------------------------

install_ct() {
  step="CT template"
  local tmpl=""
  if (( is_pve )); then
    tmpl=$(pveam list "$tstore" 2>/dev/null | awk '{print $1}' | sed -n 's#^.*vztmpl/\(debian-12-standard_[^ ]*\)$#\1#p' | sort -V | tail -n1) || tmpl=""
  fi
  if [[ -z $tmpl ]]; then
    run pveam update || fail "pveam update failed" "check this host's internet access, then re-run"
    if (( is_pve )); then
      tmpl=$(pveam available --section system | awk '{print $2}' | grep '^debian-12-standard_' | sort -V | tail -n1) || tmpl=""
      # --dry-run skips 'pveam update', so the index may be empty here.
      if [[ -z $tmpl ]] && (( dry )); then tmpl="debian-12-standard_<latest>_amd64.tar.zst"; fi
      [[ -n $tmpl ]] || fail "no Debian 12 template is listed by 'pveam available --section system'" "run 'pveam update' and check its output"
    else
      tmpl="debian-12-standard_<ver>_amd64.tar.zst"
    fi
    run pveam download "$tstore" "$tmpl" || fail "downloading the template $tmpl to '$tstore' failed" \
      "check that storage '$tstore' allows 'Container templates' (pvesm status -content vztmpl); pass --template-storage"
  else
    log "using template $tstore:vztmpl/$tmpl"
  fi

  step="pct create"
  local create=(pct create "$id" "$tstore:vztmpl/$tmpl"
    --hostname "$hostname" --cores "$cores" --memory "$memory" --swap 256
    --rootfs "$storage:$disk" --net0 "name=eth0,bridge=$bridge,ip=dhcp"
    --unprivileged 1 --features nesting=1 --onboot 1 --ostype debian
    --description "HOPS (installed by hops-proxmox.sh)")
  [[ -n $ssh_key ]] && create+=(--ssh-public-keys "$ssh_key")
  run "${create[@]}" || fail "pct create failed (see the message above)" "fix the cause (storage, ID, template) and re-run"
  (( dry )) || created=1

  step="pct start"
  run pct start "$id" || fail "pct start $id failed" "see: pct start $id --debug"

  step="CT network"
  echo "+ wait up to ${CT_NET_TIMEOUT}s for an IPv4 address and DNS inside CT $id (pct exec)"
  if (( ! dry )); then
    local deadline=$((SECONDS + CT_NET_TIMEOUT)) ok=0
    while (( SECONDS < deadline )); do
      if pct exec "$id" -- sh -c 'ip -4 -o addr show scope global | grep -q inet && getent hosts deb.debian.org >/dev/null' >/dev/null 2>&1; then
        ok=1; break
      fi
      sleep 2
    done
    (( ok )) || fail "CT $id got no IPv4 address / DNS within ${CT_NET_TIMEOUT}s" \
      "check DHCP on bridge '$bridge' and DNS (pct enter $id; ip a; cat /etc/resolv.conf)"
  fi

  step="curl in CT"
  run pct exec "$id" -- bash -c 'dpkg -s curl ca-certificates >/dev/null 2>&1 || { export DEBIAN_FRONTEND=noninteractive; apt-get update -q && apt-get install -y -q curl ca-certificates; }' \
    || fail "installing curl + ca-certificates in CT $id failed" "pct enter $id; apt-get update; apt-get install curl ca-certificates"

  step="install.sh in CT"
  run pct push "$id" "$tmp/install.sh" /root/hops-install.sh --perms 0755 || fail "pct push of install.sh failed"
  log "running install.sh inside CT $id (its output follows)"
  local rc=0
  run pct exec "$id" -- bash /root/hops-install.sh "${inst_args[@]}" || rc=$?
  (( rc == 0 )) || fail "install.sh inside CT $id exited with code $rc (its error is above)" \
    "fix the cause, then re-run it in place: pct exec $id -- bash /root/hops-install.sh ${inst_args[*]}"

  step="health from host"
  local ip="<ct-ip>"
  if (( ! dry )); then
    ip=$(pct exec "$id" -- hostname -I 2>/dev/null | awk '{print $1}') || ip=""
    [[ -n $ip ]] || fail "could not read CT $id's IP address (pct exec $id -- hostname -I)"
  fi
  echo "+ poll http://$ip:$HOPS_PORT/api/health from this host (up to ${CT_HEALTH_TIMEOUT}s)"
  if (( dry )); then return 0; fi
  health_from_host "$ip" "$CT_HEALTH_TIMEOUT" \
    || fail "HOPS is healthy inside CT $id but http://$ip:$HOPS_PORT/api/health does not answer${version:+ version $version} from this host${health_body:+ (last answer: $health_body)}" \
      "check firewalls between this host and the CT (Proxmox firewall on net0)"
  done_banner "$ip"
}

install_ct
(( dry )) && log "dry run complete; nothing was changed."
exit 0
}

main "$@"
