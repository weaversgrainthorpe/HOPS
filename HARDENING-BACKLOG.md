# HOPS Hardening Backlog

Tracked security/robustness items from the penetration test performed for
the v1.5.4 release.

## Done

- **LOW-3 — Generic error messages** *(v1.5.5)*. Config-import / converter,
  image-decode, and backup handlers no longer echo parser or filesystem
  internals; detail is logged server-side instead.
- **LOW-4 — Cap request body sizes** *(v1.5.5)*. Config import, background
  upload, and icon upload wrap the request body in `http.MaxBytesReader`
  (50 / 50 / 8 MB).
- **LOW-5 — PopupModal tile-URL scheme validation** *(v1.6.0)*. The two
  "Open in…" anchors route through `safeOpenUrl` and only accept the
  rendered `href` if `isValidUrl` passes; `javascript:` / `data:` /
  `vbscript:` schemes are blocked from the popup, matching `Entry.svelte`.
- **LOW-6 — Frontend dependency advisories** *(v1.6.0)* (safely). Ran
  `npm audit fix` — `@sveltejs/kit` 2.49.1 → 2.61.1 plus transitive
  bumps; build + 163 tests still pass. **4 remaining low-severity items
  are upstream-blocked**: they chain from `cookie <0.7.0`, which
  `@sveltejs/kit` pins as a sub-dependency. `npm audit fix --force`
  proposes downgrading kit to a pre-release 0.0.30 and is not safe.
  Resolution requires an upstream kit release that pins
  `cookie >= 0.7.0`. **Action when it appears:** `npm install
  @sveltejs/kit@latest && npm audit && npm test && npm run build`.
- **`--host` bind flag** *(v1.6.0)*. New CLI flag, defaults to empty
  (bind all interfaces, the prior behaviour). Set `--host 127.0.0.1`
  for loopback-only.

## Open

Nothing tracked. The original v1.5.4 pentest is fully closed except for
the upstream-blocked `cookie <0.7.0` chain noted above.

The `/pentest` skill (`.claude/skills/pentest/SKILL.md`) is repeatable —
re-run its static phase whenever new routes are added or external
dependencies change significantly, since new endpoints / surfaces are
new attack surface.
