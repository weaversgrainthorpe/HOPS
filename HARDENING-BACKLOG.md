# HOPS Hardening Backlog

Tracked security/robustness items not yet addressed. Sourced from the
penetration test performed for the v1.5.4 release.

The HIGH and MEDIUM findings were fixed in **v1.5.4** (see CHANGELOG). The
items below are the remaining low-severity / hygiene work — none are
exposed holes — deferred to a focused **v1.5.5 hardening pass**.

## v1.5.5 — planned

### LOW-3 — Generic error messages

Some handlers return parser/decoder internals to the caller, e.g.
`fmt.Sprintf("...: %v", err)` in the config-import path and
`"Failed to decode image: " + err.Error()`.

- Where: `backend/internal/api/handlers.go` — import handler (~1167-1196),
  image decode (~2010).
- Fix: return generic messages to the client; log the detail server-side.
- Impact: low — these are auth-gated admin routes.

### LOW-4 — Cap request body sizes

Config import and background upload read the whole body into memory
(`io.ReadAll` after `ParseMultipartForm(50<<20)`); no global cap. Concurrent
large uploads could pressure memory on a small device.

- Where: `backend/internal/api/handlers.go` — import (~1139-1155),
  background upload (~1837). Icon upload is already capped at 5 MB.
- Fix: wrap request bodies in `http.MaxBytesReader`; stream to disk
  rather than buffering.

### LOW-5 — Validate tile URL scheme in PopupModal

`Entry.svelte` routes tile opens through `isValidUrl` (blocks
`javascript:` / `data:` / `vbscript:`), but `PopupModal.svelte`'s
`<a href={url}>` anchors do not.

- Where: `frontend/src/lib/components/PopupModal.svelte` (~62-66).
- Fix: route the PopupModal anchors through `isValidUrl` / `safeOpenUrl`.
- Note: the global CSP added in v1.5.4 already blunts this; finish it for
  completeness.

### LOW-6 — Frontend dependency advisories

`npm audit` flags `vite` (path traversal / `fs.deny` bypass / dev-server
WebSocket file read) and `svelte` (SSR XSS). The `vite` CVEs affect the
dev server only — not the shipped static build — so real product risk is
low. Bump anyway as hygiene.

- Fix: `cd frontend && npm audit fix`, then re-test the build.

### Optional — `--host` bind flag

HOPS binds `:<port>` (all interfaces) with no way to restrict to loopback.
Some users want a local-only instance.

- Where: `backend/cmd/hops/main.go` (flag), `backend/internal/api` (addr).
- Fix: add a `--host` flag (default `0.0.0.0` to preserve current
  behaviour); document it.

## Reference

- Pentest report: `/tmp/hops-pentest-2026-05-20.md` (regenerate by running
  the `/pentest` skill — see `.claude/skills/pentest/`).
- The skill's static phase is safe to re-run anytime; rerun it after
  adding new routes, since new endpoints are new attack surface.
