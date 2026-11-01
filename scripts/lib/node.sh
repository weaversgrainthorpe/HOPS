# Shared Node setup for HOPS scripts: source this, do not run it.
#
# Prefers the private Node at $HOME/.local/hops-node (used when the system Node is
# too old for the frontend toolchain), then checks the Node in use against the
# "engines" range in frontend/package.json and stops with a clear message if it
# is too old, rather than letting the build fail confusingly.
_hops_node_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -d "$HOME/.local/hops-node/bin" ]]; then
  export PATH="$HOME/.local/hops-node/bin:$PATH"
fi
_hops_need=$(sed -n 's/.*"node": *">=\([0-9.]*\)".*/\1/p' "$_hops_node_root/frontend/package.json" | head -1)
if [[ -z "$_hops_need" ]]; then
  echo "✗ Can't read the Node version HOPS needs: frontend/package.json \"engines\" should say \"node\": \">=X\"." >&2
  return 2 2>/dev/null || exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  echo "✗ node is not installed. HOPS needs Node.js $_hops_need+ (see CONTRIBUTING.md)." >&2
  return 2 2>/dev/null || exit 2
fi
_hops_have=$(node -p 'process.versions.node')
if [[ "$(printf '%s\n%s\n' "$_hops_need" "$_hops_have" | sort -V | head -1)" != "$_hops_need" ]]; then
  echo "✗ Node $_hops_have is too old: HOPS needs Node $_hops_need or newer (frontend/package.json \"engines\")." >&2
  echo "  Install a newer Node, or place one at \$HOME/.local/hops-node (its bin/ is used first)." >&2
  return 2 2>/dev/null || exit 2
fi
unset _hops_node_root _hops_need _hops_have
