#!/usr/bin/env bash
# HOPS security check: vulnerability, static, dependency and secrets scans.
# Local and offline-capable where possible (govulncheck and npm audit need the
# network for their advisory databases; they FAIL, not skip, if unreachable).
# Usage: scripts/security-check.sh [--quick]   (--quick skips the history secret scan)
# A missing tool is a FAILED check with install instructions, never a silent skip.
# NEVER scans or prints tests/prerelease/hopsexport/ (real user data),
# node_modules, data dirs or design/feedback/.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2
export PATH="$PATH:$HOME/go/bin:$(go env GOPATH 2>/dev/null)/bin"
QUICK=0; [ "${1:-}" = "--quick" ] && QUICK=1
# Scan output goes to a fresh temp dir OUTSIDE the repo (override: SECURITY_CHECK_OUT=dir; wiped first).
if [ -n "${SECURITY_CHECK_OUT:-}" ]; then OUT="$SECURITY_CHECK_OUT"; rm -rf "$OUT"; mkdir -p "$OUT"
else OUT="$(mktemp -d "${TMPDIR:-/var/tmp}/hops-security-check.XXXXXX")" || { echo "cannot create output dir" >&2; exit 2; }; fi
NAMES=(); RESULTS=(); COUNTS=(); NOTES=()
record() { NAMES+=("$1"); RESULTS+=("$2"); COUNTS+=("$3"); NOTES+=("${4:-}"); }
need() { # tool, install hint, check name
  command -v "$1" >/dev/null 2>&1 && return 0
  echo "!! $1 is NOT INSTALLED -> check '$3' FAILED (not skipped). Install: $2" >&2
  record "$3" FAIL "n/a" "$1 not installed"; return 1
}

# Paths that must never be scanned (grep -E on paths, and git pathspec excludes).
EXCL_RE='(^|/)(node_modules|\.git|hopsexport|feedback|data|dist|build|\.svelte-kit)/'
PATHSPEC=(':(exclude)tests/prerelease/hopsexport' ':(exclude)design/feedback' ':(exclude)**/node_modules' ':(exclude)*package-lock.json')

echo "== go vet"
if (cd backend && go vet ./... ) >"$OUT/vet.txt" 2>&1; then record "go vet" PASS 0
else n=$(grep -c . "$OUT/vet.txt"); cat "$OUT/vet.txt"; record "go vet" FAIL "$n"; fi

echo "== govulncheck"
if need govulncheck "go install golang.org/x/vuln/cmd/govulncheck@latest" govulncheck; then
  (cd backend && govulncheck ./...) >"$OUT/govulncheck.txt" 2>&1; rc=$?
  cat "$OUT/govulncheck.txt"
  n=$(grep -c '^Vulnerability #' "$OUT/govulncheck.txt")
  if [ $rc -eq 0 ]; then record govulncheck PASS 0
  elif [ "$n" -gt 0 ]; then record govulncheck FAIL "$n" "reachable vulns"
  else record govulncheck FAIL "?" "tool error (network?) rc=$rc"; fi
fi

echo "== gosec"
if need gosec "go install github.com/securego/gosec/v2/cmd/gosec@latest" gosec; then
  # Reviewed suppressions go here as -exclude=Gxxx with a reason; none yet.
  (cd backend && gosec -quiet -fmt=text -out="$OUT/gosec.txt" ./... ) >"$OUT/gosec.log" 2>&1; rc=$?
  cat "$OUT/gosec.txt" 2>/dev/null; cat "$OUT/gosec.log"
  n=$(grep -c '^\[.*\] - G[0-9]' "$OUT/gosec.txt" 2>/dev/null || true)
  if [ $rc -eq 0 ]; then record gosec PASS 0
  elif [ "${n:-0}" -gt 0 ]; then record gosec FAIL "$n"
  else record gosec FAIL "?" "tool error rc=$rc"; fi
fi

echo "== npm audit"
if need npm "install Node.js/npm from your package manager" npm-audit; then
  for d in frontend tests/prerelease; do
    if [ ! -f "$d/package-lock.json" ]; then record "npm audit prod ($d)" FAIL "?" "no package-lock.json"; continue; fi
    (cd "$d" && npm audit --omit=dev --audit-level=high) >"$OUT/npm-prod-$(basename "$d").txt" 2>&1; rc=$?
    cat "$OUT/npm-prod-$(basename "$d").txt"
    (cd "$d" && npm audit) >"$OUT/npm-full-$(basename "$d").txt" 2>&1; rcf=$?
    cat "$OUT/npm-full-$(basename "$d").txt"
    nf=$(grep -Eo '[0-9]+ (low|moderate|high|critical)' "$OUT/npm-full-$(basename "$d").txt" | awk '{s+=$1} END{print s+0}')
    np=$(grep -Eo '[0-9]+ (high|critical)' "$OUT/npm-prod-$(basename "$d").txt" | awk '{s+=$1} END{print s+0}')
    if [ $rc -eq 0 ]; then record "npm audit prod>=high ($d)" PASS 0
    elif grep -qiE 'ENOTFOUND|EAI_AGAIN|ECONNREFUSED|network' "$OUT/npm-prod-$(basename "$d").txt"; then record "npm audit prod>=high ($d)" FAIL "?" "registry unreachable"
    else record "npm audit prod>=high ($d)" FAIL "$np"; fi
    # The full report is informational (dev deps): fails only if it could not run.
    if [ $rcf -eq 0 ]; then record "npm audit full ($d)" PASS 0
    elif [ "$nf" -gt 0 ]; then record "npm audit full ($d)" INFO "$nf" "report only"
    else record "npm audit full ($d)" FAIL "?" "could not run"; fi
  done
fi

# Secrets. gitleaks if present; else a grep fallback. Findings print the RULE,
# file and commit only, never the matched text (so a hit never re-leaks).
RULES='AKIA[0-9A-Z]{16}|-----BEGIN ([A-Z]+ )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{32,}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{15,}[.]eyJ[A-Za-z0-9_-]{15,}[.][A-Za-z0-9_-]{10,}|(api[_-]?key|secret|token|passw(or)?d|bearer)["'"'"' ]*[:=]["'"'"' ]*[A-Za-z0-9/+_=.-]{20,}["'"'"']'
echo "== secrets"
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks dir . --no-banner --redact -v >"$OUT/gl-tree.txt" 2>&1; rc1=$?
  [ $QUICK -eq 0 ] && { gitleaks git . --no-banner --redact -v --log-opts="--all -- . :(exclude)tests/prerelease/hopsexport :(exclude)design/feedback" >"$OUT/gl-hist.txt" 2>&1; rc2=$?; } || rc2=0
  n1=$(grep -c '^Finding:' "$OUT/gl-tree.txt"); n2=$(grep -c '^Finding:' "$OUT/gl-hist.txt" 2>/dev/null || echo 0)
  [ $rc1 -eq 0 ] && record "secrets: tree (gitleaks)" PASS 0 || record "secrets: tree (gitleaks)" FAIL "$n1"
  if [ $QUICK -eq 1 ]; then record "secrets: history (gitleaks)" SKIP "-" "--quick requested"
  elif [ $rc2 -eq 0 ]; then record "secrets: history (gitleaks)" PASS 0; else record "secrets: history (gitleaks)" FAIL "$n2"; fi
else
  echo "(gitleaks not installed; using grep fallback. Better: go install github.com/zricethezav/gitleaks/v8@latest, or your package manager)" >&2
  : >"$OUT/secrets-tree.txt"
  while IFS= read -r f; do
    echo "$f" | grep -Eq "$EXCL_RE" && continue
    grep -Iq . "$f" 2>/dev/null || continue
    grep -EIn -- "$RULES" "$f" >/dev/null 2>&1 && grep -EIc -- "$RULES" "$f" | sed "s|^|$f: matching lines: |" >>"$OUT/secrets-tree.txt"
  done < <(git ls-files -co --exclude-standard -- "${PATHSPEC[@]}")
  cat "$OUT/secrets-tree.txt"
  n=$(grep -c . "$OUT/secrets-tree.txt")
  [ "$n" -eq 0 ] && record "secrets: tree (grep)" PASS 0 || record "secrets: tree (grep)" FAIL "$n" "files with hits"
  if [ $QUICK -eq 1 ]; then record "secrets: history (grep)" SKIP "-" "--quick requested"
  else
    # Added lines across all history; print commit + file + count only.
    git log --all -p --no-color --format='@@C %h' -- . "${PATHSPEC[@]}" 2>"$OUT/hist.err" | awk -v re="$RULES" '
      /^@@C /{c=$2; next}
      /^\+\+\+ /{f=substr($0,7); next}
      /^\+[^+]/{ if ($0 ~ re) k[c" "f]++ }
      END{for (x in k) print x": "k[x]" matching added lines"}' >"$OUT/secrets-hist.txt"
    if [ -s "$OUT/hist.err" ]; then cat "$OUT/hist.err"; record "secrets: history (grep)" FAIL "?" "git log failed"
    else cat "$OUT/secrets-hist.txt"; n=$(grep -c . "$OUT/secrets-hist.txt")
      [ "$n" -eq 0 ] && record "secrets: history (grep)" PASS 0 || record "secrets: history (grep)" FAIL "$n" "commit/file pairs"; fi
  fi
fi

echo; echo "== SUMMARY (details: $OUT)"
printf '%-38s %-5s %-6s %s\n' CHECK RESULT COUNT NOTE
bad=0
for i in "${!NAMES[@]}"; do
  printf '%-38s %-5s %-6s %s\n' "${NAMES[$i]}" "${RESULTS[$i]}" "${COUNTS[$i]}" "${NOTES[$i]}"
  [ "${RESULTS[$i]}" = FAIL ] && bad=1
done
exit $bad
