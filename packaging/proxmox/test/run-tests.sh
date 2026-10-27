#!/usr/bin/env bash
# Tests for packaging/proxmox/hops-proxmox.sh without a Proxmox host.
#
#   packaging/proxmox/test/run-tests.sh
#
# Puts stub pct/qm/pveam/pvesm/pvesh/pveversion/curl/id/ip/sleep commands
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
mkdir -p "$stubs" "$work/snippets" "$work/served"

# What the fake download server holds.
cp "$INSTALL_SH" "$work/served/install.sh"
(cd "$work/served" && sha256sum install.sh > SHA256SUMS)
printf 'fake qcow2\n' > "$work/served/debian.qcow2"
echo "$(sha512sum "$work/served/debian.qcow2" | awk '{print $1}')  debian-12-genericcloud-amd64.qcow2" > "$work/served/SHA512SUMS"

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
  "status -content rootdir"|"status -content images")
    printf "Name Type Status Total Used Available %%\nlocal dir active 1 1 1 1%%\nlocal-lvm lvmthin active 1 1 1 1%%\n" ;;
  "status -content snippets")
    if [[ ${STUB_NO_SNIPPETS:-} == 1 ]]; then printf "Name Type Status Total Used Available %%\n"
    else printf "Name Type Status Total Used Available %%\nlocal dir active 1 1 1 1%%\n"; fi ;;
  "status -storage "*) exit 0 ;;
  "path local:snippets/"*) echo "$STUB_DIR/snippets/${2#local:snippets/}" ;;
esac'
stub pveam '
case "$1" in
  list) echo "NAME SIZE" ;;
  available) printf "system          alpine-3.20-default_20240908_amd64.tar.xz\nsystem          debian-12-standard_12.7-1_amd64.tar.zst\nsystem          debian-11-standard_11.7-1_amd64.tar.zst\n" ;;
esac'
stub pct '
case "$1" in
  exec)
    if [[ $* == *"hostname -I"* ]]; then echo "10.0.0.42 "; exit 0; fi
    if [[ $* == *hops-install.sh* ]]; then echo "hops-install: HOPS installed and healthy."; exit "${STUB_INSTALL_RC:-0}"; fi ;;
esac'
stub qm '
if [[ $1 == guest && $2 == cmd ]]; then
  printf "[{\"name\":\"lo\",\"ip-addresses\":[{\"ip-address\":\"127.0.0.1\",\"ip-address-type\":\"ipv4\"}]},{\"name\":\"eth0\",\"ip-addresses\":[{\"ip-address\" : \"10.0.0.43\",\"ip-address-type\":\"ipv4\"}]}]\n"
fi
if [[ $1 == guest && $2 == exec ]]; then
  printf "{\n   \"exitcode\" : 0,\n   \"exited\" : 1,\n   \"out-data\" : \"0\\\\n\"\n}\n"
fi'
stub curl '
out=""; url=""
while [[ $# -gt 0 ]]; do
  case $1 in -o) out=$2; shift 2 ;; --retry|--connect-timeout|--max-time) shift 2 ;; -*) shift ;; *) url=$1; shift ;; esac
done
case $url in
  */api/health) echo "{\"status\":\"ok\",\"version\":\"${STUB_HOPS_VERSION:-3.0.0-rc1}\"}"; exit 0 ;;
  */SHA512SUMS) src=SHA512SUMS ;;
  */debian-12-genericcloud-amd64.qcow2) src=debian.qcow2 ;;
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
    STUB_NO_SNIPPETS="${STUB_NO_SNIPPETS:-}" \
    bash "$SCRIPT" "$@" < /dev/null > "$work/$name.out" 2>&1 || rc=$?
  if [[ $rc != "$want" ]]; then
    bad "$name: exit $rc, wanted $want"; sed 's/^/    /' "$work/$name.out"; return 1
  fi
  return 0
}
has()    { grep -qE -- "$3" "$work/$1.$2" || { bad "$1: $2 lacks /$3/"; return 1; }; }
hasnt()  { ! grep -qE -- "$3" "$work/$1.$2" || { bad "$1: $2 unexpectedly has /$3/"; return 1; }; }

MUTATING='^(pct (create|start|exec|push|destroy)|qm (create|set|resize|start|destroy|importdisk)|pveam (update|download)|curl )'

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

echo "== dry-run VM"
if runit dry_vm 0 --dry-run --type vm --id 120 --url http://172.16.0.50:8099 --version 3.0.0-rc1; then
  t=dry_vm
  has $t out '^\+ qm create 120 .*--cores 1 --memory 512 .*virtio,bridge=vmbr0 .*--serial0 socket .*--agent enabled=1' &&
  has $t out '^\+ qm set 120 --scsi0 local-lvm:0,import-from=.*debian-12-genericcloud-amd64.qcow2' &&
  has $t out '^\+ qm set 120 --ide2 local-lvm:cloudinit .*--cicustom user=local:snippets/hops-120-user.yaml' &&
  has $t out '^\+ qm start 120' &&
  has $t out 'qemu-guest-agent' &&
  has $t out 'version=3.0.0-rc1' &&
  hasnt $t log "$MUTATING" &&
  [[ -z $(ls -A "$work/snippets") ]] && ok "dry-run VM prints commands + user-data, writes nothing"
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
  has $t out 'Open HOPS:  http://10.0.0.42:8080' && ok "full CT run installs, checks health from host, prints URL"
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
runit badtype 1 --yes --type lxc && has badtype out 'must be ct or vm' && ok "bad --type refused"

echo "== not a Proxmox host (real PATH)"
rc=0; bash "$SCRIPT" --yes > "$work/nopve.out" 2>&1 < /dev/null || rc=$?
[[ $rc == 1 ]] && has nopve out 'not a Proxmox VE host' && ok "refuses off Proxmox"

echo "== full VM run (stubs succeed)"
if runit full_vm 0 --yes --type vm --url http://172.16.0.50:8099; then
  t=full_vm
  has $t log '^qm create 105 ' && has $t log '^qm set 105 --scsi0 ' && has $t log '^qm start 105' &&
  has $t log '^qm guest cmd 105 network-get-interfaces' &&
  has $t out 'debian-12-genericcloud-amd64.qcow2 checksum OK' &&
  has $t out 'Open HOPS:  http://10.0.0.43:8080' &&
  grep -q '^#cloud-config' "$work/snippets/hops-105-user.yaml" &&
  grep -q 'want=' "$work/snippets/hops-105-user.yaml" && ok "full VM run writes snippet, gets IP via agent, checks health"
fi
if [[ -f $work/snippets/hops-105-user.yaml ]] && command -v python3 >/dev/null && python3 -c 'import yaml' 2>/dev/null; then
  if python3 -I -c 'import sys,yaml; d=yaml.safe_load(open(sys.argv[1])); assert d["packages"] and d["runcmd"] and d["write_files"][0]["content"].startswith("#!/bin/bash")' \
    "$work/snippets/hops-105-user.yaml"; then ok "user-data is valid YAML"; else bad "user-data YAML"; fi
  python3 -I -c 'import sys,yaml; print(yaml.safe_load(open(sys.argv[1]))["write_files"][0]["content"])' "$work/snippets/hops-105-user.yaml" > "$work/firstboot.sh"
  if bash -n "$work/firstboot.sh" && grep -q 'sha256sum' "$work/firstboot.sh"; then ok "first-boot script parses"; else bad "first-boot script syntax"; fi
fi

echo "== VM: no snippets storage"
if STUB_NO_SNIPPETS=1 runit nosnip 1 --yes --type vm --url http://172.16.0.50:8099; then
  has nosnip out "does not allow 'snippets'" && hasnt nosnip log '^qm create' && ok "missing snippets storage stops before creation"
fi

echo
echo "passed: $pass, failed: $failn"
(( failn == 0 ))
