#!/usr/bin/env bash
# HOPS on Proxmox VE — creates an LXC container (default) or a VM and installs
# HOPS in it with the shared installer (install.sh).
#
# Run as root in the Proxmox host shell:
#
#   bash hops-proxmox.sh                       # menus (whiptail)
#   bash hops-proxmox.sh --url http://172.16.0.50:8099 --yes
#
# Options (install options only; HOPS settings live in its own GUI):
#   --type ct|vm        Container (default) or virtual machine.
#   --id <n>            CT/VM ID. Default: the next free ID.
#   --hostname <name>   Default: hops.
#   --cores <n>         Default: 1.
#   --memory <MB>       Default: 256 (CT) or 512 (VM).
#   --disk <GB>         Default: 2 (CT) or 4 (VM).
#   --storage <name>    Storage for the CT/VM disk. Default: local-lvm if
#                       present, else the first storage that can hold it.
#   --bridge <name>     Network bridge (DHCP). Default: vmbr0.
#   --url <base>        Where install.sh, SHA256SUMS and the HOPS binaries
#                       are downloaded from. Default: the latest GitHub
#                       release (or the --version release).
#   --version <x.y.z>   Install this HOPS version; it must report it on
#                       /api/health or the install counts as failed.
#   --ssh-key <file>    Public key file to authorise for root (CT) or the
#                       default 'debian' user (VM). Without it there is no
#                       SSH login and no password: use the Proxmox console.
#   --template-storage <name>  CT only: where the Debian 12 template is kept.
#                       Default: local.
#   --snippet-storage <name>   VM only: storage with 'snippets' content for
#                       the cloud-init user-data. Default: local.
#   --yes               Do not ask; use the flags and defaults as given.
#                       Needed when there is no terminal.
#   --dry-run           Print every pct/qm/pveam/pvesm/pvesh command that
#                       would run, change nothing, and exit 0.
#   -h, --help          Show this help.
#
# HOPS listens on port 8080 on a fresh install (change it later in HOPS,
# under Settings). The script finishes only when http://<guest-ip>:8080/api/health
# answers from this host; anything less is reported as a failure.
set -Eeuo pipefail

DEFAULT_URL="https://github.com/weaversgrainthorpe/HOPS/releases/latest/download"
RELEASE_URL_PREFIX="https://github.com/weaversgrainthorpe/HOPS/releases/download"
DEBIAN_IMG_BASE="https://cloud.debian.org/images/cloud/bookworm/latest"
DEBIAN_IMG="debian-12-genericcloud-amd64.qcow2"
HOPS_PORT=8080
CT_NET_TIMEOUT=90
CT_HEALTH_TIMEOUT=60
VM_IP_TIMEOUT=600
VM_HEALTH_TIMEOUT=900

# ---- output / failure ------------------------------------------------------

step="start-up"
created=""          # "ct" or "vm" once the guest exists
snippet_file=""     # VM user-data snippet written by this run
tmp=""

log()  { echo "hops-proxmox: $*"; }
warn() { echo "hops-proxmox: WARNING: $*" >&2; }

# fail <what went wrong> [what to do]
fail() {
  trap - ERR
  echo >&2
  echo "hops-proxmox: ERROR during step '$step': $1" >&2
  [[ -n ${2:-} ]] && echo "hops-proxmox: what to do: $2" >&2
  if [[ $created == ct ]]; then
    echo "hops-proxmox: container $id WAS CREATED and is left as it is for inspection (pct enter $id)." >&2
    echo "hops-proxmox: to remove it:  pct destroy $id --purge --force" >&2
  elif [[ $created == vm ]]; then
    echo "hops-proxmox: VM $id WAS CREATED and is left as it is for inspection (Proxmox console)." >&2
    echo "hops-proxmox: to remove it:  qm destroy $id --purge" >&2
  fi
  if [[ -n $snippet_file ]]; then
    echo "hops-proxmox: and its cloud-init snippet:  rm -f $snippet_file" >&2
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

usage() { sed -n '2,/^set -Eeuo/{/^set -Eeuo/d;s/^# \{0,1\}//;p}' "$0" 2>/dev/null || true; }

# ---- options ---------------------------------------------------------------

type="" id="" hostname="hops" cores="1" memory="" disk="" storage="" bridge="vmbr0"
url="" version="" ssh_key="" tstore="local" sstore="local" yes=0 dry=0

need() { [[ $# -ge 2 ]] || fail "$1 needs a value" "see --help"; }
while [[ $# -gt 0 ]]; do
  case $1 in
    --type) need "$@"; type=$2; shift 2 ;;
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
    --snippet-storage) need "$@"; sstore=$2; shift 2 ;;
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
for c in pveversion pct qm pveam pvesm pvesh; do
  command -v "$c" >/dev/null 2>&1 || is_pve=0
done
if (( is_pve )); then
  pve_ver=$(pveversion 2>/dev/null) || is_pve=0
fi
if (( ! is_pve )); then
  if (( dry )); then
    warn "this is not a Proxmox VE host; --dry-run uses placeholders for Proxmox queries"
  else
    fail "this is not a Proxmox VE host (pveversion/pct/qm/pveam/pvesm/pvesh not all found)" \
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

if [[ -z $type ]] && (( interactive )); then
  type=$(wt --title "Install HOPS" --menu "Install HOPS in:" 12 64 2 \
    ct "LXC container (recommended, 256 MB)" \
    vm "Virtual machine (Debian 12 cloud image, 512 MB)") || cancelled
fi
type=${type:-ct}
[[ $type == ct || $type == vm ]] || fail "--type must be ct or vm (got '$type')"

if [[ $type == ct ]]; then memory=${memory:-256}; disk=${disk:-2}; else memory=${memory:-512}; disk=${disk:-4}; fi

if [[ -z $id ]]; then
  id=$(query "<next-free-id>" pvesh get /cluster/nextid) || fail "could not get the next free ID (pvesh get /cluster/nextid)" "pass one with --id"
fi

# first_storage <content> — prints the preferred active storage for a content type.
first_storage() {
  local want=$1 prefer=$2 list
  list=$(pvesm status -content "$want" 2>/dev/null | awk 'NR>1 && $3=="active" {print $1}') || list=""
  if grep -qx "$prefer" <<<"$list"; then echo "$prefer"; else head -n1 <<<"$list"; fi
}
if [[ -z $storage ]]; then
  if (( is_pve )); then
    if [[ $type == ct ]]; then storage=$(first_storage rootdir local-lvm); else storage=$(first_storage images local-lvm); fi
    [[ -n $storage ]] || fail "no active storage can hold a $type disk" "pass one with --storage (see: pvesm status)"
  else
    storage="<storage>"
  fi
fi
url=${url%/}

if (( interactive )); then
  summary() {
    printf 'Type: %s\nID: %s\nHostname: %s\nCores: %s\nMemory: %s MB\nDisk: %s GB on %s\nNetwork: DHCP on %s\nDownload from: %s\n' \
      "$type" "$id" "$hostname" "$cores" "$memory" "$disk" "$storage" "$bridge" "${url:-GitHub release}"
  }
  if ! wt --title "Settings" --yes-button "Install" --no-button "Change" --yesno "$(summary)" 18 70; then
    id=$(wt --inputbox "ID" 8 60 "$id") || cancelled
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
  pvesm status -storage "$storage" >/dev/null 2>&1 || fail "storage '$storage' does not exist or is not active" "see: pvesm status"
  ip link show "$bridge" >/dev/null 2>&1 || fail "network bridge '$bridge' does not exist on this host" "see: ip link (or Datacenter > node > Network); pass --bridge"
fi

log "plan: $type $id '$hostname', $cores core(s), ${memory} MB, ${disk} GB on $storage, DHCP on $bridge"
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
    if health_body=$(curl -fsS --max-time 5 "http://$ip:$HOPS_PORT/api/health" 2>/dev/null) \
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
  log "HOPS is installed and healthy in $1 $id ($hostname)."
  log "health: $health_body"
  echo
  echo "  Open HOPS:  http://$2:$HOPS_PORT"
  echo
  echo "  No password is set. Console: Proxmox > $id > Console${ssh_pub:+ (or SSH with your key)}."
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
  (( dry )) || created=ct

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
  done_banner CT "$ip"
}

# ---- VM --------------------------------------------------------------------

# user_data — prints the cloud-init user-data for the VM.
user_data() {
  local q_url q_sha q_ver
  q_url=$(printf '%q' "$url"); q_sha=$(printf '%q' "$install_sha"); q_ver=$(printf '%q' "$version")
  cat <<EOF
#cloud-config
# Written by hops-proxmox.sh for VM $id. No password is set for any user.
hostname: $hostname
manage_etc_hosts: true
package_update: true
packages:
  - curl
  - ca-certificates
  - qemu-guest-agent
EOF
  if [[ -n $ssh_pub ]]; then
    printf "ssh_authorized_keys:\n  - '%s'\n" "$ssh_pub"
  fi
  cat <<EOF
write_files:
  - path: /usr/local/sbin/hops-firstboot.sh
    permissions: '0755'
    content: |
      #!/bin/bash
      set -euo pipefail
      url=$q_url
      want=$q_sha
      version=$q_ver
EOF
  sed 's/^/      /' <<'EOF'
d=$(mktemp -d)
curl -fsSL --retry 5 --connect-timeout 15 -o "$d/install.sh" "$url/install.sh"
curl -fsSL --retry 5 --connect-timeout 15 -o "$d/SHA256SUMS" "$url/SHA256SUMS"
listed=$(awk '$2=="install.sh" || $2=="*install.sh" {print $1; exit}' "$d/SHA256SUMS")
got=$(sha256sum "$d/install.sh" | awk '{print $1}')
if [ -z "$listed" ] || [ "$got" != "$listed" ] || [ "$got" != "$want" ]; then
  echo "hops-firstboot: install.sh checksum mismatch (got $got, SHA256SUMS $listed, host verified $want)" >&2
  exit 1
fi
args=(--url "$url")
[ -n "$version" ] && args+=(--version "$version")
bash "$d/install.sh" "${args[@]}"
EOF
  cat <<'EOF'
runcmd:
  - [systemctl, enable, --now, qemu-guest-agent]
  - [bash, -c, '/usr/local/sbin/hops-firstboot.sh > /var/log/hops-firstboot.log 2>&1; echo $? > /var/log/hops-firstboot.status']
EOF
}

# guest_out <cmd...> — runs a command in the VM via the guest agent and prints
# its stdout ("" if the agent cannot run it).
guest_out() {
  local json
  json=$(qm guest exec "$id" -- "$@" 2>/dev/null) || return 1
  [[ $json == *'"exitcode" : 0'* || $json == *'"exitcode":0'* ]] || return 1
  printf '%b' "$(sed -n 's/.*"out-data" *: *"\(.*\)".*/\1/p' <<<"$json" | head -n1)"
}

install_vm() {
  step="snippet storage"
  local sdir="" sname="hops-$id-user.yaml"
  if (( is_pve )); then
    pvesm status -content snippets 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$sstore" \
      || fail "storage '$sstore' does not allow 'snippets' content, which the VM's cloud-init user-data needs" \
        "enable it in Datacenter > Storage > $sstore > Content > Snippets (or: pvesm set $sstore --content <existing>,snippets), or pass --snippet-storage <storage-with-snippets>. Nothing was created."
    snippet_path=$(pvesm path "$sstore:snippets/$sname") || fail "could not resolve the snippet path for $sstore:snippets/$sname"
    sdir=$(dirname "$snippet_path")
  else
    snippet_path="<$sstore-snippets-dir>/$sname"
  fi

  step="Debian image"
  echo "+ curl -fsSL $DEBIAN_IMG_BASE/$DEBIAN_IMG  (verified against $DEBIAN_IMG_BASE/SHA512SUMS)"
  if (( ! dry )); then
    curl -fsSL --retry 3 --connect-timeout 15 -o "$tmp/SHA512SUMS" "$DEBIAN_IMG_BASE/SHA512SUMS" \
      || fail "could not download Debian's SHA512SUMS from $DEBIAN_IMG_BASE" "check this host's internet access"
    local want got
    want=$(awk -v f="$DEBIAN_IMG" '$2==f || $2=="*" f {print $1; exit}' "$tmp/SHA512SUMS")
    [[ -n $want ]] || fail "Debian's SHA512SUMS has no entry for $DEBIAN_IMG"
    log "downloading $DEBIAN_IMG (about 350 MB) ..."
    curl -fSL --retry 3 --connect-timeout 15 -o "$tmp/$DEBIAN_IMG" "$DEBIAN_IMG_BASE/$DEBIAN_IMG" \
      || fail "could not download $DEBIAN_IMG_BASE/$DEBIAN_IMG" "check this host's internet access and free space in $tmp"
    got=$(sha512sum "$tmp/$DEBIAN_IMG" | awk '{print $1}')
    [[ $got == "$want" ]] || fail "$DEBIAN_IMG checksum mismatch (expected $want, got $got)" "re-run; if it repeats, the mirror or download is bad"
    log "$DEBIAN_IMG checksum OK"
  fi

  step="cloud-init snippet"
  echo "+ write $snippet_path:"
  user_data | sed 's/^/    | /'
  if (( ! dry )); then
    [[ -d $sdir ]] || fail "snippet directory $sdir does not exist"
    [[ ! -e $snippet_path ]] || fail "$snippet_path already exists (left by an earlier VM $id?)" "remove it if VM $id is gone, then re-run"
    user_data > "$snippet_path" || fail "could not write $snippet_path"
    snippet_file=$snippet_path
  fi

  step="qm create"
  run qm create "$id" --name "$hostname" --cores "$cores" --memory "$memory" \
    --net0 "virtio,bridge=$bridge" --scsihw virtio-scsi-pci --ostype l26 \
    --serial0 socket --vga serial0 --agent enabled=1 --onboot 1 \
    --description "HOPS (installed by hops-proxmox.sh)" \
    || fail "qm create failed (see the message above)" "fix the cause and re-run"
  (( dry )) || created=vm

  step="import disk"
  run qm set "$id" --scsi0 "$storage:0,import-from=$tmp/$DEBIAN_IMG,discard=on" \
    || fail "importing the Debian image into $storage failed" "check free space on '$storage' (pvesm status)"
  run qm resize "$id" scsi0 "${disk}G" \
    || fail "resizing the disk to ${disk} GB failed" "the image may already be larger; use a bigger --disk"

  step="cloud-init drive"
  run qm set "$id" --ide2 "$storage:cloudinit" --boot order=scsi0 --ipconfig0 ip=dhcp \
    --cicustom "user=$sstore:snippets/$sname" \
    || fail "adding the cloud-init drive failed"

  step="qm start"
  run qm start "$id" || fail "qm start $id failed" "see the VM's task log in the Proxmox GUI"

  step="VM address"
  echo "+ wait up to ${VM_IP_TIMEOUT}s for the guest agent to report an IPv4 address (qm guest cmd $id network-get-interfaces)"
  local ip="<vm-ip>"
  if (( ! dry )); then
    ip=""
    local deadline=$((SECONDS + VM_IP_TIMEOUT)) json
    while (( SECONDS < deadline )); do
      if json=$(qm guest cmd "$id" network-get-interfaces 2>/dev/null); then
        ip=$(grep -oE '"ip-address" *: *"[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"' <<<"$json" | grep -oE '[0-9]+(\.[0-9]+){3}' | grep -v '^127\.' | head -n1) || ip=""
        [[ -n $ip ]] && break
      fi
      sleep 5
    done
    [[ -n $ip ]] || fail "VM $id did not report an IPv4 address within ${VM_IP_TIMEOUT}s (guest agent)" \
      "open the VM console (Proxmox > $id > Console) and check that it booted, got DHCP on '$bridge' and installed qemu-guest-agent (cloud-init: /var/log/cloud-init-output.log)"
    log "VM $id address: $ip"
  fi

  step="HOPS first-boot install"
  echo "+ poll http://$ip:$HOPS_PORT/api/health from this host (up to ${VM_HEALTH_TIMEOUT}s), checking /var/log/hops-firstboot.status in the guest"
  if (( dry )); then return 0; fi
  local deadline=$((SECONDS + VM_HEALTH_TIMEOUT)) status
  while (( SECONDS < deadline )); do
    if health_from_host "$ip" 15; then
      done_banner VM "$ip"
      return 0
    fi
    status=$(guest_out cat /var/log/hops-firstboot.status 2>/dev/null | tr -dc '0-9') || status=""
    if [[ -n $status && $status != 0 ]]; then
      echo "---- /var/log/hops-firstboot.log (last lines, from the guest) ----" >&2
      guest_out tail -n 40 /var/log/hops-firstboot.log >&2 || echo "(could not read it via the guest agent)" >&2
      echo "------------------------------------------------------------------" >&2
      fail "install.sh in VM $id failed on first boot (exit code $status)" \
        "see the log above; in the VM console: cat /var/log/hops-firstboot.log /var/log/cloud-init-output.log"
    fi
  done
  fail "HOPS in VM $id did not answer http://$ip:$HOPS_PORT/api/health${version:+ with version $version} within ${VM_HEALTH_TIMEOUT}s${health_body:+ (last answer: $health_body)}" \
    "in the VM console: cat /var/log/hops-firstboot.log /var/log/cloud-init-output.log; check firewalls"
}

if [[ $type == ct ]]; then install_ct; else install_vm; fi
(( dry )) && log "dry run complete; nothing was changed."
exit 0
