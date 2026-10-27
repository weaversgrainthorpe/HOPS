#!/usr/bin/env bash
# Tests for packaging/proxmox/hops-proxmox.sh without a Proxmox host.
#
#   packaging/proxmox/test/run-tests.sh
#
# Puts stub pct/pveam/pvesm/pvesh/pveversion/curl/id/ip/sleep commands
# first on PATH. Each stub logs its argv to a log file; the tests then check
# what the script ran (or did not run) and its exit code and messages.
# STUB_* variables below are test-harness plumbing only.
# shellcheck disable=SC2016  # stub bodies are single-quoted on purpose
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../hops-proxmox.sh"
INSTALL_SH="$HERE/../../install.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
stubs="$work/stubs"
mkdir -p "$stubs" "$work/served" "$work/empty-path"

# What the fake download server holds.
cp "$INSTALL_SH" "$work/served/install.sh"
(cd "$work/served" && sha256sum install.sh > SHA256SUMS)

stub() { # stub <name> <body>
  { echo '#!/usr/bin/env bash'
    echo 'echo "$(basename "$0") $*" >> "$STUB_LOG"'
    echo 'if [[ -n ${STUB_FAIL:-} && " $(basename "$0") $* " == *" $STUB_FAIL "* ]]; then echo "stub: simulated failure" >&2; exit 1; fi'
    echo "$2"
  } > "$stubs/$1"
  chmod +x "$stubs/$1"
}

stub pveversion 'echo "pve-manager/8.2.4/faa83925c9641325 (running kernel: 6.8.8-2-pve)"'
stub pvesh '
if [[ $* == "get /cluster/nextid" ]]; then echo 105; exit 0; fi
if [[ $* == "get /cluster/nextid --vmid 200" ]]; then echo "400 Parameter verification failed. vmid: VM 200 already exists" >&2; exit 2; fi
if [[ $* == "get /cluster/nextid --vmid "* ]]; then echo "${4}"; exit 0; fi
exit 0'
stub pvesm '
case "$*" in
  "status -content rootdir")
    printf "Name Type Status Total Used Available %%\nlocal-lvm lvmthin active 1 1 1 1%%\nslow dir disabled 0 0 0 0%%\n" ;;
esac'
stub pveam '
case "$1" in
  list) echo "NAME SIZE" ;;
  available) [[ ${STUB_EMPTY_INDEX:-} == 1 ]] && exit 0; printf "system          alpine-3.20-default_20240908_amd64.tar.xz\nsystem          debian-12-standard_12.7-1_amd64.tar.zst\nsystem          debian-11-standard_11.7-1_amd64.tar.zst\n" ;;
esac'
stub pct '
case "$1" in
  exec)
    if [[ $* == *"hostname -I"* ]]; then echo "10.0.0.42 "; exit 0; fi
    if [[ $* == *hops-install.sh* ]]; then echo "hops-install: HOPS installed and healthy."; exit "${STUB_INSTALL_RC:-0}"; fi ;;
esac'
stub curl '
out=""; url=""
while [[ $# -gt 0 ]]; do
  case $1 in -o) out=$2; shift 2 ;; --retry|--connect-timeout|--max-time) shift 2 ;; -*) shift ;; *) url=$1; shift ;; esac
done
case $url in
  */api/health) echo "{\"status\":\"ok\",\"version\":\"${STUB_HOPS_VERSION:-3.0.0-rc1}\"}"; exit 0 ;;
  */install.sh) src=install.sh ;;
  */SHA256SUMS) src=SHA256SUMS ;;
  *) echo "curl stub: unknown url $url" >&2; exit 22 ;;
esac
cp "$STUB_DIR/served/$src" "$out"
if [[ $src == install.sh && ${STUB_TAMPER:-} == 1 ]]; then echo "# tampered" >> "$out"; fi'
stub id 'if [[ ${1:-} == -u ]]; then echo 0; else /usr/bin/id "$@"; fi'
stub ip 'exit 0'
stub sleep '/bin/sleep 0.2'

pass=0 failn=0
ok()   { echo "PASS: $1"; pass=$((pass + 1)); }
bad()  { echo "FAIL: $1"; failn=$((failn + 1)); }

# runit <name> <expected-rc> <args...> — runs the script with stubs; output in $work/<name>.out
runit() {
  local name=$1 want=$2; shift 2
  : > "$work/$name.log"
  local rc=0
  env PATH="$stubs:$PATH" STUB_LOG="$work/$name.log" STUB_DIR="$work" \
    STUB_FAIL="${STUB_FAIL:-}" STUB_INSTALL_RC="${STUB_INSTALL_RC:-0}" STUB_TAMPER="${STUB_TAMPER:-}" \
    STUB_EMPTY_INDEX="${STUB_EMPTY_INDEX:-}" \
    bash "$SCRIPT" "$@" < /dev/null > "$work/$name.out" 2>&1 || rc=$?
  if [[ $rc != "$want" ]]; then
    bad "$name: exit $rc, wanted $want"; sed 's/^/    /' "$work/$name.out"; return 1
  fi
  return 0
}
has()    { grep -qE -- "$3" "$work/$1.$2" || { bad "$1: $2 lacks /$3/"; return 1; }; }
hasnt()  { ! grep -qE -- "$3" "$work/$1.$2" || { bad "$1: $2 unexpectedly has /$3/"; return 1; }; }

MUTATING='^(pct (create|start|exec|push|destroy)|pveam (update|download)|curl )'

echo "== syntax + shellcheck"
if bash -n "$SCRIPT"; then ok "bash -n"; else bad "bash -n"; fi
if command -v shellcheck >/dev/null; then
  if shellcheck "$SCRIPT" "$0"; then ok "shellcheck"; else bad "shellcheck"; fi
else
  bad "shellcheck not installed"
fi

echo "== dry-run CT (stubs answer read-only queries)"
if runit dry_ct 0 --dry-run --url http://172.16.0.50:8099; then
  t=dry_ct
  has $t out '^\+ pveam download local debian-12-standard_12.7-1_amd64.tar.zst' &&
  has $t out '^\+ pct create 105 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst .*--memory 256 .*--rootfs local-lvm:2 .*bridge=vmbr0,ip=dhcp .*--unprivileged 1 --features nesting=1 --onboot 1' &&
  has $t out '^\+ pct start 105' &&
  has $t out '^\+ pct exec 105 -- bash /root/hops-install.sh --url http://172.16.0.50:8099' &&
  has $t out 'dry run complete' &&
  hasnt $t log "$MUTATING" && ok "dry-run CT prints commands, runs nothing mutating"
fi

echo "== dry-run CT off Proxmox (placeholders)"
: > "$work/noprox.log"
rc=0; bash "$SCRIPT" --dry-run --url http://172.16.0.50:8099 > "$work/noprox.out" 2>&1 < /dev/null || rc=$?
if [[ $rc == 0 ]] && has noprox out 'not a Proxmox VE host' && has noprox out '^\+ pct create <next-free-id> '; then
  ok "dry-run without Proxmox uses placeholders"
else
  bad "dry-run without Proxmox (rc $rc)"; sed 's/^/    /' "$work/noprox.out"
fi

echo "== full CT run (stubs succeed)"
if runit full_ct 0 --yes --url http://172.16.0.50:8099 --hostname hops-trial; then
  t=full_ct
  has $t log '^pveam download local debian-12-standard_12.7-1_amd64.tar.zst' &&
  has $t log '^pct create 105 .*--hostname hops-trial' &&
  has $t log '^pct start 105' &&
  has $t log '^pct push 105 .*/install.sh /root/hops-install.sh' &&
  has $t log '^pct exec 105 -- bash /root/hops-install.sh --url http://172.16.0.50:8099$' &&
  has $t log '^curl .*http://10.0.0.42:8080/api/health' &&
  has $t out 'install.sh checksum OK' &&
  has $t log '^curl .*--noproxy' &&
  has $t out 'Open HOPS:  http://10.0.0.42:8080' &&
  has $t out 'pct enter 105' && hasnt $t out 'Console' && ok "full CT run installs, checks health from host, prints URL + pct enter"
fi

echo "== CT: pct start fails after create"
if STUB_FAIL="pct start" runit fail_start 1 --yes --url http://172.16.0.50:8099; then
  t=fail_start
  has $t out "ERROR during step 'pct start'" &&
  has $t out 'container 105 WAS CREATED' &&
  has $t out 'pct destroy 105 --purge --force' &&
  has $t out 'NOT installed' &&
  hasnt $t log '^pct exec' && ok "pct start failure: clear error, destroy hint, exit 1"
fi

echo "== CT: install.sh fails inside the CT"
if STUB_INSTALL_RC=3 runit fail_install 1 --yes --url http://172.16.0.50:8099; then
  t=fail_install
  has $t out 'install.sh inside CT 105 exited with code 3' &&
  has $t out 'pct destroy 105' && hasnt $t out 'Open HOPS' && ok "install.sh failure surfaces exit code + destroy hint"
fi

echo "== tampered install.sh is refused before anything is created"
if STUB_TAMPER=1 runit tamper 1 --yes --url http://172.16.0.50:8099; then
  t=tamper
  has $t out 'install.sh checksum mismatch' && hasnt $t log '^pct create' && hasnt $t out 'WAS CREATED' &&
  ok "checksum mismatch stops before creation"
fi

echo "== version mismatch on health from host fails"
if STUB_HOPS_VERSION=2.2.1 runit badver 1 --yes --url http://172.16.0.50:8099 --version 3.0.0-rc1 2>/dev/null; then
  has badver out 'does not answer version 3.0.0-rc1' && ok "wrong version on /api/health is a failure"
fi

echo "== ID in use, no TTY without --yes, bad options"
runit idused 1 --yes --id 200 --url http://172.16.0.50:8099 && has idused out 'ID 200 is already in use' && hasnt idused log '^pct create' && ok "ID in use refused"
runit notty 1 --url http://172.16.0.50:8099 && has notty out 'no terminal' && ok "no TTY needs --yes"
runit badtype 1 --yes --type vm && has badtype out "unknown option '--type'" && ok "--type (VM path) is gone"
runit badstore 1 --yes --storage slow --url http://172.16.0.50:8099 && has badstore out "storage 'slow' does not exist, is not active" && hasnt badstore log '^pct create' && ok "inactive storage refused before creation"

echo "== dry-run with an empty template index (pveam update is skipped)"
if STUB_EMPTY_INDEX=1 runit dry_noindex 0 --dry-run --url http://172.16.0.50:8099; then
  has dry_noindex out '^\+ pct create 105 local:vztmpl/debian-12-standard_<latest>_amd64.tar.zst' && ok "dry-run uses a template placeholder"
fi

echo "== not a Proxmox host (empty PATH, so even on a PVE node nothing real runs)"
rc=0; env -i PATH="$work/empty-path" "$BASH" "$SCRIPT" --yes > "$work/nopve.out" 2>&1 < /dev/null || rc=$?
[[ $rc == 1 ]] && has nopve out 'not a Proxmox VE host' && ok "refuses off Proxmox"

echo
echo "passed: $pass, failed: $failn"
(( failn == 0 ))
