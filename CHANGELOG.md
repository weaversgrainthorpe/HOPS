# Changelog

All notable changes to HOPS (Home Operations Portal System) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] - 2026-05-24 — GUI-configurable runtime settings

A meaningful step in HOPS's GUI-first principle: all admin-tunable runtime
knobs now live in one place — the admin **Settings** page — and are no
longer scattered across CLI flags, environment variables, or hardcoded
constants. This is a breaking release for operators who use environment
variables or the `--port` flag.

### Added

- **Admin Settings page** at `/settings` (accessible from the Settings
  button next to Backups in the admin header). Lists every runtime knob
  with inline help, defaults, validation bounds, and a *Restart required*
  badge where applicable. Saves are validated server-side and stored in
  a new `app_settings` table in SQLite.
- **Live updates** for knobs that don't need a restart — change the log
  level, login rate limit, status-check interval/timeout, session
  lifetime, or upload caps in the GUI and the running server picks up
  the change immediately, no restart needed. Other knobs (port, trusted
  proxies, HTTP server timeouts) are marked *Restart required*.
- **Settings covered** (14 total): server port; log level; reverse-proxy
  trusted CIDRs; login rate limit per IP per minute; session lifetime
  hours; status-check interval and per-request timeout; per-endpoint
  upload caps (config import / background / icon); the four HTTP server
  timeouts (read-header / read / write / idle).
- New `/api/settings` admin endpoints — `GET` returns the full schema
  and current values; `PUT /api/settings/{key}` updates one with
  validation.

### Changed (breaking — operator-visible)

- **Removed the `--port` CLI flag.** The port is now stored in settings
  (default `8080`). Operators must remove `--port 8080` from their
  systemd unit / docker-compose / startup script — the new binary
  rejects the flag at startup. Change the port via the GUI thereafter.
- **Removed the `LOG_LEVEL` environment variable.** Set the log level
  via the GUI (Settings → Logging → Level).
- **Removed the `HOPS_TRUSTED_PROXIES` environment variable.** Set the
  trusted-proxy CIDR list via the GUI (Settings → Reverse proxy →
  trusted_cidrs); the input is a JSON array.
- The `config.Config` struct shrinks to just `DataDir` and `FrontendDir`
  (the two genuine bootstrap flags). Everything else moved to the
  settings service.

### Hardening

Also folded the remaining v1.5.6-planned hardening items into this release:

- **PopupModal tile-URL scheme validation** (LOW-5). The two "Open in…"
  anchors in the popup modal now route through `safeOpenUrl` and only
  accept the rendered `href` if `isValidUrl` passes — `javascript:` /
  `data:` / `vbscript:` schemes can no longer be opened from the popup,
  matching `Entry.svelte`'s existing behaviour.
- **Frontend dependency advisories** (LOW-6). Ran `npm audit fix` —
  `@sveltejs/kit` moved from 2.49.1 → 2.61.1 (and transitive bumps).
  Build + 163 test cases still pass. The remaining 4 low-severity
  advisories chain from `cookie <0.7.0`, which `@sveltejs/kit` pins as
  a sub-dependency; they are upstream-blocked until kit ships a release
  that bumps it. `npm audit fix --force` is **not safe** here — it
  proposes downgrading kit to a pre-release 0.0.30, which would nuke
  the app.
- **New `--host` CLI flag** for binding to a specific interface (e.g.
  `--host 127.0.0.1` for loopback-only when HOPS sits behind a same-host
  reverse proxy). Empty default preserves the historical "bind all"
  behaviour. This is a flag, not a setting, because restricting the
  bind interface must be possible without first reaching the GUI.

### Upgrade notes

For an existing v1.5.x install:

1. Edit the HOPS systemd unit (or docker-compose, or any other launcher)
   to remove the `--port 8080` argument from the ExecStart / command —
   the new binary will refuse to parse it.
2. If you had `LOG_LEVEL` or `HOPS_TRUSTED_PROXIES` set in the
   environment, note their values; they are now ignored. Set them in
   the GUI after the first boot.
3. Defaults are seeded automatically on first start, so a fresh
   `/api/settings` listing will already have sensible values.
4. The `data/` SQLite database gains a single new table (`app_settings`).
   The migration is idempotent; no manual step required.

## [1.5.5] - 2026-05-20 — Hardening follow-up

Low-severity hardening items from the v1.5.4 penetration test. No data
migration is required.

### Security

- **Request bodies are capped before they are read.** Config import,
  background upload, and icon upload now wrap the request body in
  `http.MaxBytesReader` (50 MB / 50 MB / 8 MB), so an oversized upload is
  rejected up front instead of being buffered into memory or spilled to
  disk.
- **Error messages no longer echo parser or filesystem internals.** The
  config-import / converter failures, the image-decode failure, and the
  backup list/create/restore/delete failures now return a generic message
  to the client; the underlying error is logged server-side instead.

## [1.5.4] - 2026-05-20 — Security hardening

A security-hardening release following a full penetration test of HOPS. No
data migration is required.

### Security

- **Forced password change is now enforced server-side.** Previously the
  "change the default password" gate was a frontend redirect only — every
  admin API endpoint was reachable while the flag was still set. The auth
  middleware now blocks all protected routes (except change-password and
  logout) until the password has actually been changed.
- **Login rate limiting can no longer be bypassed with a spoofed
  `X-Forwarded-For` header.** `X-Forwarded-For` / `X-Forwarded-Proto` are
  now honoured only from configured trusted proxies (new
  `HOPS_TRUSTED_PROXIES` environment variable — comma-separated CIDRs).
  Left unset, the headers are ignored and the rate limiter keys on the
  real connection address, so the 20/min login limit cannot be defeated.
- **SSRF hardening on the status checker.** Status-check requests are
  refused if the target resolves to a link-local address (the
  `169.254.0.0/16` range where cloud-metadata endpoints live), to a
  multicast or unspecified address, or uses a non-HTTP(S) scheme.
  Validation is applied at connection time, so it also covers redirects
  and DNS rebinding. LAN and loopback targets remain allowed — HOPS is a
  homelab dashboard and those are its legitimate monitoring targets.
- **Uploaded SVGs can no longer execute script.** Icon and background
  responses are served with a strict `Content-Security-Policy`
  (`default-src 'none'; sandbox`), so an SVG containing `<script>` cannot
  run even when opened directly. `<img>` embedding is unaffected.
- **A Content-Security-Policy is now sent on all app responses** —
  blocking external script loading, `<object>`/`<embed>` plugins,
  `<base>` hijacking, cross-origin form posts, and data exfiltration to
  hosts other than the Iconify icon CDNs.
- **Session cookies are marked `Secure`** when the request arrives over
  HTTPS (directly or via a trusted proxy that sets `X-Forwarded-Proto`).
- **All other sessions are invalidated when a password is changed**, so a
  session captured beforehand stops working.
- Bumped `golang.org/x/image` to v0.40.0, clearing a WEBP-decode panic
  advisory (GO-2026-4961) that affected 32-bit builds.

### Notes

- **All HOPS dashboards are public** — there is no per-dashboard privacy
  model. Anyone who can reach an instance can view every dashboard.
  SECURITY.md now states this explicitly; put HOPS behind an auth-aware
  reverse proxy or a restricted network if its contents are sensitive.
- The backend now builds with **Go 1.25** (required by the updated
  `golang.org/x/image`).

## [1.5.3] - 2026-05-19 — Modal backdrop escape via portal

### Fixed

- **Modal backdrops not covering the full viewport.** `TabPanel`'s `.tab-content-wrapper` uses `backdrop-filter: blur(...)` to dim the dashboard background, which CSS treats as a containing block for `position: fixed` descendants. Any modal opened from inside a tab (edit-tile, edit-group, icon picker, confirm dialogs) had its full-screen backdrop pinned to the tab content box instead of the viewport, leaving dashboard tiles visibly bleeding through on the sides. Fixed by adding a `portal` Svelte action ([`portal.ts`](frontend/src/lib/utils/portal.ts)) that mounts the modal backdrop directly onto `document.body`, escaping every ancestor stacking context. Applied to the shared `Modal` component, `IconPickerModal`, and `ConfirmModal`.
- The z-index bump from 1.5.2 is retained; together with the portal fix, nested modals now layer cleanly over their parents.

## [1.5.2] - 2026-05-19 — Icon picker z-index fix

### Fixed

- **Icon picker modal rendering behind its parent edit modal.** When opening the icon picker from the Tile/Group/Tab edit modal via the Browse button, the picker's backdrop sat at the same z-index as the parent modal, causing the parent form to bleed through and intercept clicks. Bumped `IconPickerModal` to `--z-modal-overlay` (1100), the same tier used by `PopupModal` and `IframeModal`, so child icon pickers always paint on top of the modal that opened them.

## [1.5.1] - 2026-05-19 — Bundled assets + accurate docs

This patch fixes a packaging gap in v1.5.0 where the bundled icons and background presets weren't actually shipped to end users, and corrects documentation claims that didn't match the running code.

### Fixed

- **Bundled icons and background presets now ship with the binary.** v1.5.0 documented "bundled icons and presets" but they were under `data/` (gitignored, not copied by Dockerfile, not included in release tarballs) — so fresh installs got no app/service icons and no preset backgrounds. The ~2,300 homarr-labs/dashboard-icons SVGs and ~90 curated background images are now embedded directly into the HOPS binary via `//go:embed` ([`backend/internal/assets/`](backend/internal/assets/)). Binary size grows from ~17MB to ~62MB but installs are now fully self-contained.
- **Removed undelivered feature claims.** The "Auto-fetch favicon" tile option was documented and had a UI checkbox but no implementation — checkbox and field removed, claim dropped from CHANGELOG/QUICKSTART/USER_GUIDE/docs site. ICMP status monitoring was documented but only HTTP is implemented — copy + dead `'icmp'` enum value removed. "Wide" tile size was listed in feature copy but the type only supports small/medium/large — listing corrected.
- **Inflated numeric claims corrected.** Bundled icons: `~7,000` → `~2,300` (actual file count). Background presets: `64` → `~90`. Generic Iconify seed icons: `1,900+` → `~155`. Iconify framing made explicit that the 200,000+ icons are loaded on demand from iconify.design rather than bundled.
- Migration comment in `database.go` no longer mentions ICMP.

### Notes

- No database migration is required. Existing installs will pick up the bundled icons/presets on next start via the existing idempotent seed path.
- The release artifact format is unchanged; only the binary contents grew.

## [1.5.0] - 2026-05-19 — Initial release

HOPS is a self-hosted homepage dashboard for your homelab, configured entirely through a GUI — no YAML or JSON files. v1.5.0 is the initial public release.

### Highlights

- **GUI-first editor** — Drag-and-drop tiles, groups, and tabs. Add anything by clicking, never by editing a config file. Cancel any edit and nothing changes — every action is committed only on Create/Save.
- **Multiple dashboards** at different URLs (`/home`, `/network`, `/media`, etc.) from one install. Each dashboard has its own tabs, groups, tiles, background, and theme.
- **Public dashboards, private admin** — `http://<host>:8080/<dashboard-path>` needs no login, so dashboards can be shared with family, pinned to wall tablets, or scanned via QR. The admin page at `/` is the only thing behind authentication.
- **Built-in QR code generator** — A scannable QR for any dashboard URL from the admin panel. Open dashboards on a phone without typing.
- **Single binary** + SQLite. No external runtime dependencies. Multi-arch Docker image at `ghcr.io/weaversgrainthorpe/hops:latest` (linux/amd64 + linux/arm64 — works on Raspberry Pi 3B+/4/5/Zero 2 W).
- **~2,300 bundled app/service icons** (homarr-labs/dashboard-icons collection) plus 18 curated categories of generic Iconify icons (Containers, Media, Networking, Audio, Cameras & Surveillance, Smart Home & Sensors, and more) plus access to 200,000+ Iconify icons by name (loaded on demand from iconify.design) plus custom image uploads (auto-resized to 128×128 PNG).
- **Move and copy** groups and tiles between tabs from the editor (in addition to drag-and-drop within a tab).
- **Background slideshow** with ~90 curated images, per-dashboard or per-tab. 18 transition effects (crossfade, slide, zoom, blur, flip, swirl, dissolve, glitch, kenburns, and more, plus a Random mode that picks a different one each slide).
- **Optional per-tile status checks** showing up/down indicators.
- **Imports your existing config** from Homer, Dashy, or Heimdall — try HOPS without redoing your bookmarks.
- **Built-in security**: forced password change on first login, bcrypt password hashing, CSRF protection on all mutations, HttpOnly session cookies, path-traversal hardening, rate limiting, security headers, graceful shutdown, SQLite foreign key enforcement.
- **Mobile-friendly** — responsive layout adapts at 480px / 768px / 1024px breakpoints. Editing is disabled on phone-sized screens; browsing and tile-opening work everywhere.
- **Robust save pipeline** — every mutation runs through a serialized queue that reads the latest state at execution time, eliminating the classic stale-snapshot races that can cause data loss when users drag, edit, and delete in rapid succession.

### Tech stack

- **Backend**: Go 1.24 (single static binary), `modernc.org/sqlite` (pure-Go, no CGO), stdlib `net/http`, `log/slog`
- **Frontend**: SvelteKit 2 + Svelte 5 (with runes), TypeScript, Vite 7
- **Storage**: SQLite with WAL mode, foreign key enforcement, idempotent migrations and icon seeds
- **Container**: Multi-stage Docker build, non-root user, multi-arch (linux/amd64 + linux/arm64)
- **License**: MIT

### Getting started

See the [Quick Start guide](QUICKSTART.md) for a full walkthrough, or jump straight in:

```yaml
# docker-compose.yml
services:
  hops:
    image: ghcr.io/weaversgrainthorpe/hops:latest
    ports: ["8080:8080"]
    volumes: [hops-data:/app/data]
    restart: unless-stopped
volumes:
  hops-data:
```

Then `docker compose up -d` and open `http://localhost:8080`. Default login `admin/admin` — you'll be forced to set a new password on first login.
