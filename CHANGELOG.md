# Changelog

All notable changes to HOPS (Home Operations Portal System) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.1] - 2026-06-06 — UI/UX cleanup pass

A focused interior-design release: no new features, but the frontend
is meaningfully tidier underneath. Several months of small UI/UX
audit findings closed in one pass — shared table/empty/badge/lede
utilities replace per-page reimplementations, the shared `<Button>`
component reaches more sites, the Toast component now meets WCAG
2.2.1, and a long-running idle-mode papercut (lose your edits because
edit mode timed out while you were thinking) is finally fixed at the
session-watcher layer.

### Added
- **authWatcher proactive session check.** A new `authWatcher.ts`
  store revalidates the session whenever the tab regains visibility,
  regains focus, or every 5 minutes — and clears edit mode if the
  session has expired. Previously, leaving HOPS in edit mode for hours
  meant your eventual save attempt logged you out and threw away your
  in-flight edits. Now the timeout fires before you start editing,
  not after.
- **Shared `.data-table` utility** in `app.css` — replaces five
  near-identical per-page table chrome blocks across Discovery
  (scans, summary, detectors, diag, results). Pages keep their
  size-specific tweaks; the shared shell handles surface, border,
  radius, header row, and last-row border.
- **Toast pause/resume API** (`toast.pause(id)` / `toast.resume(id)`)
  wired to the Toast component's hover and focus handlers — meets
  WCAG 2.2.1 (Timing Adjustable).

### Changed
- **Reverse-proxy setting merged into Authentication.** The single
  `proxy.trusted_cidrs` setting didn't earn its own group heading and
  is conceptually an auth concern (it decides which X-Forwarded-For
  hops to trust during login). The "Reverse proxy" section heading
  is gone.
- **Group edit modal trimmed.** Text Color, Display Style, and Row
  Width collapsed into an `<details>Advanced</details>` disclosure so
  the primary fields (Name, Icon, Color, Opacity) breathe.
- **Discovery empty states** unified — every empty list/table now
  uses the `.empty-state` utility with a consistent icon size, dashed
  border, and centred layout. The shared rule drives the icon size
  via `--icon-empty`, eliminating the per-page `width="40"` vs `"48"`
  inconsistency.
- **Lede paragraphs** standardised. Local `.lede` / `.lede-aside`
  duplicates removed from three Discovery pages; the shared
  utilities in `app.css` own the styling now.
- **Restart-pill consolidated** with the badge taxonomy
  (`.badge.badge--warning.badge--pill`) — no more bespoke
  amber-on-amber pill CSS.
- **Discovery border-radius literals** (`0.25rem` → `0.75rem`)
  migrated to `var(--radius-{sm,md,lg,xl})` tokens.
- **Discovery bulk-action buttons** ("Select all", "Select none",
  "Select all high-confidence") use the shared `<Button>` component
  in ghost/small variant instead of bespoke `.bulk button` CSS.

### Fixed
- **Dev-badge contrast.** Navbar's "DEV" badge background moved from
  amber-700 (`#b45309`, 3.69:1 with white text — fails WCAG AA) to
  amber-800 (`#92400e`, 5.12:1 — passes).
- **aria-labels on icon-only action buttons** across Discovery (scan
  list, detector list) and IconPicker close button — screen readers
  now announce "Delete scan draft" instead of "button".

### Internal
- **Pre-push gate** runs version-source check + `go build` + CSS
  lint on every push (catches mismatched VERSION / `version.go` /
  `package.json` / doc surfaces before they ship — the failure mode
  that ate v2.0.0 and v2.0.1).

### Migration notes
- No schema changes, no config changes. Drop in the new binary +
  restart.

## [2.1.0] - 2026-05-29 — Install as an app, plain-English pass, polish

The headline addition is **Progressive Web App support**: visit HOPS
on a phone or tablet, "Add to Home Screen", and you get a full-screen
icon that opens HOPS without any browser tabs or address bar in the
way — ideal for wall-mounted dashboards. The release also includes a
broad plain-English pass across the docs and in-product help, a real
fix for a long-standing auth-state race in protected pages, the four
Discovery screenshots the marketing surfaces were missing, and a
fistful of small bug fixes.

### Added
- **Install as an app (PWA).** Web App Manifest, service worker that
  pre-caches the SPA shell, and selective runtime caching of the
  dashboard config + icons so the last-loaded dashboard keeps
  rendering when Wi-Fi blips. Includes iOS meta tags so Safari's
  "Add to Home Screen" gets the same full-screen treatment.
- **"You're offline" banner** that appears below the navbar when the
  HOPS server is unreachable (combines `navigator.onLine` with a 30 s
  heartbeat to `/api/version`). Shows how long since HOPS was last
  reachable.
- **Frozen status indicators when offline.** Tile status icons hold
  their last-known state rather than every tile turning red the
  moment Wi-Fi drops. A small "we can't tell right now" cloud-off
  icon signals the indicator isn't fresh.
- **Discovery screenshots in the README + landing page.** The scan
  list, curate UI, detector manager, and diagnostics view all now
  have a place in the marketing surfaces. A `scripts/demo-record/screenshots.mjs`
  generator script lives next to `record.mjs` so they can be
  refreshed alongside the demo video.
- **In-product help tooltips** for several Discovery invariants that
  previously required reading the source: status-checker backoff
  behaviour (on the Settings page), per-host probe budget (likewise),
  what "next scan" means for detector edits (Manage detectors lede),
  favicon-hash priority over the bundled corpus (DetectorEditModal),
  same-host-redirect handling (Diagnostics aside), and the
  forward-enum redirect/time budget (new-scan internal-domain hint).

### Changed
- **Plain-English pass.** README's Network Discovery section, the
  USER_GUIDE Discovery chapter, the in-app HelpModal card, six
  Settings descriptions, and the docs/index.html landing-page why-grid
  card all rewritten to drop jargon (no more "back off exponentially",
  "in-flight scan", "favicon-hash corpus", "5 same-host redirect
  hops", "deployment topology", "switched vs Wi-Fi VLAN segmentation").
  HOPS is for homelab users, not network engineers.
- **ROADMAP simplified.** Tier 1/2/3/4 jargon replaced with "Small
  things — could happen soon", "Medium things — would take a couple
  of weeks", "Bigger things", "Stretch things". Engineer-speak
  descriptions softened throughout.
- **DOCS-TODO retired.** Items that were done are not to-dos. The
  remaining outstanding work (API quirks worth flagging,
  test-scaffolding gotchas) is now inline as comments at the point
  someone refactoring would actually see it.

### Fixed
- **Auth-state race on protected pages.** `initAuth()` runs async at
  layout mount; protected pages were reading `$isAuthenticated` in
  their own `onMount` before that resolved, seeing the default
  `false`, and bouncing freshly-logged-in users back to the admin
  index. Affected all six protected routes (`/settings` and every
  `/admin/discovery/*` page). A new `waitForAuthChecked()` helper in
  the auth store gives pages a single line to block on.
- **`/api/icons` response shape pinned** by a new pre-release contract
  test. The bare-array vs `{icons: [...]}` shape mismatch had been
  causing intermittent breakage.

### Internal
- **Pre-release test suite expanded** with a Playwright `serviceWorkers: 'block'`
  setting so cross-test cache pollution from the new service worker
  can't poison E2E results.
- **API quirk comments** inlined at the affected routes in
  `backend/internal/api/router.go` — the deliberate restore-via-POST
  asymmetry on `/api/backups/{name}`, the `reset-bundled` sentinel
  inside `/api/discovery/detectors/`, the intentional public
  `/api/status/{id}` path, and the `?resultsSince` polling cursor on
  scan results.

### Migration notes
- **Clean upgrade from any v2.0.x.** No schema migrations beyond the
  additive ones the new release does on first boot. Existing
  dashboards, detectors, scans, settings — all preserved.
- **Service worker activates on first load** of v2.1.0; users who had
  v2.0.x open in another tab might need one reload to pick it up.
  No data implication.

## [2.0.2] - 2026-05-28 — Frontend version chip fix (take two)

The 2.0.1 release bumped the frontend `package.json` from `1.7.0` to
`2.0.0` instead of all the way to `2.0.1`, so the navbar chip still
read one version behind the backend. 2.0.2 brings VERSION, the Go
constants, and `frontend/package.json` into alignment for real.

### Fixed
- Frontend version chip now actually matches the running release.

## [2.0.1] - 2026-05-28 — Frontend version chip fix (partial)

The frontend `package.json` was not bumped in the 2.0.0 release, so the
navbar version chip read `v1.7.0`. 2.0.1 bumped it but to the wrong
value (`2.0.0`); see 2.0.2 for the proper fix.

### Fixed
- Frontend version chip bumped (incorrectly — superseded by 2.0.2).

## [2.0.0] - 2026-05-28 — Network Discovery, GUI-managed detectors, diagnostics

The largest release since 1.0. HOPS now actively discovers services on your
LAN and lets you bulk-promote them into dashboard tiles. A full Phase-4
detector framework with GUI-managed user detectors and bundled-detector
overrides closes the long tail without code changes. The release also
ships substantial reliability, observability, and accessibility
improvements from a pre-release audit.

The 2.0 major bump signals the scope of the change, not breaking
compatibility — **upgrade from any v1.x release is automated**: drop in
the new binary + restart. Schema migrations run on first boot, JSON
config exports from any v1.x version still import cleanly, and existing
SQLite backups can be restored at any time.

### Added — Network Discovery

- **Active LAN scan.** Admin-initiated scan (`/admin/discovery`)
  with three intensity levels (passive / light / full). Targets accept
  CIDRs (`10.10.0.0/24`), ranges (`10.10.0.1-50` or
  `10.10.0.1-10.10.0.50`), single IPs (`10.10.0.5`), comma-separated
  combinations, and per-target exclusions with `!` or `NOT`. The light
  default
  probes ~40 well-known homelab ports per host with a 15-second per-host
  budget; full extends to ~60 ports for broader coverage. SSRF-safe
  dialer enforced everywhere, with IP-range guards rejecting link-local,
  multicast, and unspecified addresses.
- **70 bundled HTTP fingerprint detectors** across 15 categories —
  Pi-hole, Proxmox, Home Assistant, Plex, Jellyfin, every *arr,
  Nginx Proxy Manager, Portainer, UniFi, OPNsense, pfSense, Frigate,
  TrueNAS/QNAP/Synology, Vaultwarden, Immich, Audiobookshelf, Mealie,
  Grafana, Prometheus, Alertmanager, Loki, Traefik, MinIO, Jenkins,
  GitLab, n8n, Apache Guacamole, File Browser, Netdata, ViewPower
  (UPS), pgAdmin / phpMyAdmin / Adminer, and more.
- **Passive discovery sources.** ARP table sweep, mDNS / Bonjour
  broadcast listener (catches HomeKit / AirPlay / Chromecast / Plex
  announcement), DNS PTR reverse-lookup enrichment, opportunistic
  AXFR (zone transfer attempt against the LAN resolver), UPnP/SSDP
  multicast (smart TVs, Sonos, Roku, IGD routers), and SNMP v2c
  (printers, managed switches, UPS units, BMCs).
- **Forward DNS enumeration.** When you supply an "internal domain"
  (e.g. `home.arpa`), HOPS queries a curated set of ~80 common
  subdomains (`sonarr.<domain>`, `proxmox.<domain>`, …) against the
  system resolver. Reverse-proxy-fronted services finally show up.
  Each forward-enum hit follows up to 5 same-host redirects, runs the
  bundled detectors against the final response, and the result wins
  over a direct-IP match for the same service (proxy URLs are usually
  the canonical dashboard tile).
- **Target exclusions.** Targets accept `!` or `NOT ` prefixes to
  exclude a CIDR, range, or single IP from a scan — e.g.
  `10.10.0.0/24, !10.10.0.50`. The form computes effective host count
  live and blocks submission when exclusions cover the whole include
  set.
- **Curate UI.** Reviewable draft per scan, per-result confidence and
  category, inline name / URL / category editing, select-all-high-
  confidence, bulk promote.
- **Auto-grouping on promote.** Selected results distribute into
  dashboard groups by category — Sonarr lands in "Downloads",
  Pi-hole in "Network", and so on. New dashboards and tabs can be
  created on the fly from the promote modal.
- **Live phase indicator** and recent-hosts feed on the draft page so
  the progress bar's non-linear pace ("0 / 254 for 8 seconds" while
  passive runs, then a sudden jump) is intelligible.
- **Edit & re-scan flow.** A draft's targets / intensity / domain can
  be cloned into a fresh scan with one click, pre-filled in the New
  Scan form so the admin can tweak (add an exclusion, change
  intensity) before launching the next pass.
- **Scan-level warnings** surface non-fatal passive-discovery failures
  (ARP / mDNS / SSDP / forward-enum) instead of silently completing.

> **Expectation-setting**: Discovery is a head-start, not a magic wand.
> Success depends on network topology (switched vs Wi-Fi, VLAN
> segmentation), what's blocking probes (firewalls, host-based AV,
> services bound to localhost), and whether services respond to
> unauthenticated requests. Some false positives and some missing
> services are normal — every scan is a reviewable draft you curate
> before promoting to tiles, and the diagnostics view turns "I see
> something HOPS missed" into a new detector in two clicks. Coverage
> grows release-over-release; Discovery is meant to bootstrap a
> dashboard, not replace knowing your own LAN.

### Added — Phase 4: GUI-managed user detectors

- **`/admin/discovery/detectors`** — list every detector (bundled +
  user), filter by source, sortable columns. Each user detector has
  enable/disable toggle, edit, and delete. Bundled detectors have a
  **Customize** action that creates an override.
- **Override system.** Customizing a bundled detector saves an
  override row that shadows the shipped definition on the next scan.
  A "modified" badge surfaces overridden bundles; **Reset to bundled
  defaults** removes the override. **Reset all customizations** in the
  page header bulk-clears every override at once.
- **Four-way match grammar.** Body substrings (case-sensitive), HTML
  title substrings (case-insensitive), HTTP header keys, and favicon
  MMH3 hashes (Shodan-compatible signed-int32). Any one match
  category satisfies the "at least one signature" rule — a detector
  declaring only a favicon hash is valid.
- **Bootstrap-from-result.** Any unidentified HTTP service in a scan
  (the generic `core/http-fallback` rows) and any unidentified row
  in the **Diagnostics** view gets a **+ Create detector** button that
  opens the detector form pre-filled with port + title + server
  header + favicon hash. Two clicks turn "I see something I don't
  recognise" into a working user detector.
- **Auto-extending port set.** Adding a user detector that targets
  port 8003 automatically gets 8003 probed on every host in the next
  scan — no need to also edit a bundled allowlist.
- **200-detector cap** (only counts `user/*` detectors; overrides are
  unlimited).

### Added — Diagnostics view

- **`/admin/discovery/diagnostics`** surfaces every HTTP service from
  past scans that no specific detector matched, deduplicated by
  `(host, port)`. Each row shows the favicon thumbnail, host, port,
  extracted title, server header, HTTP status, last-seen timestamp,
  and the favicon MMH3 hash.
- **Detection summary** above the unidentified table — count of
  detections grouped by detector, distinct hosts, and last seen.
  Useful for confirming "HOPS is finding what I expect" even when
  the unidentified table is empty.

### Added — Reliability / observability

- **SESSION_EXPIRED global interceptor.** Any 401 fires a single
  toast and redirects to login, instead of stranding the admin on a
  protected page with a raw "SESSION_EXPIRED" error.
- **Global panic-recover middleware.** Any panic in a handler logs
  `method + path + traceback` at ERROR and emits a clean JSON 500.
  Before this, a panic killed the goroutine silently.
- **Route-walker smoke tests** added to the Go test suite.
  `TestSmokeRoutesNoFiveHundred` hits every registered route as an
  authenticated admin; `TestSmokeUnauthenticatedRoutesReject`
  confirms protected routes 401 anonymously.
- **Cursor-based discovery polling.** `GET /api/discovery/scans/{id}`
  accepts a `resultsSince` cursor; the curate UI tracks the last
  observed timestamp and only fetches deltas during a running scan.
  Polling bandwidth drops ~95 % on large scans.
- **Status-checker exponential backoff.** An entry that fails 3
  consecutive HEAD checks backs off to 2× the interval, then 4×, 8×,
  16×, 32× (capped). On a successful check, the backoff clears. Down
  services stop hammering the network without forfeiting status
  monitoring entirely.
- **Async startup backup.** Server boot no longer blocks on the
  pre-flight backup — it runs in a background goroutine. Faster
  start on installs with large databases or slow disks.
- **Clean shutdown.** Session-cleanup and rate-limiter goroutines now
  exit gracefully on process stop instead of leaking past the DB
  close.

### Changed

- **HTTP fallback detector** now iterates every open port (not just
  80 / 443) and follows same-host redirects before deciding whether
  a response is noise. Services whose root `/` returns a 302 to
  `/dashboard` (Uptime Kuma, GitLab, …) now land in the unidentified
  table with their actual content, not the redirect stub.
- **Per-host probe budget** of 15× the per-request timeout (default
  15 seconds) added to the active probe pipeline. A single slow host
  can no longer drag scan completion out to minutes.
- **Backup-failure surfacing.** `PUT /api/config` returns a
  `warning` field when the pre-update backup fails, and the UI
  toasts it. Silent failures of the rollback safety-net are
  user-visible now.
- **Discovery target range validator** now requires `end ≥ start` —
  `10.0.0.50-10.0.0.10` is rejected at the API edge instead of
  silently producing an empty target list.

### Accessibility

- Global search input gets an explicit `aria-label`.
- Small badges (icon picker, background category counts) bumped from
  0.7 rem → 0.75 rem to meet the 12 px minimum readability target.

### Removed (internal)

- `Store.MigrateLegacyPromotedScans()` — a one-time helper for
  reopening pre-1.7.5 internal-development scans. Never present in
  any tagged release; safe deletion.
- `AsyncContent.svelte` component — declared but never imported.

### Migration notes

- **Upgrading from any v1.x → v2.0.0 is automated.** Schema
  migrations run on first boot via `CREATE TABLE IF NOT EXISTS` +
  idempotent `ALTER TABLE` helpers; no manual SQL or version-skip
  restrictions.
- **SQLite backups from any v1.x release are forward-compatible.**
  Restoring an old backup into the v2.0 binary triggers a graceful
  process exit (the running connection becomes stale against the
  newly-restored file); systemd / docker-compose auto-restart picks
  it back up and re-runs migrations on the restored DB.
- **JSON config exports from any v1.x version still import cleanly.**
  Exports never carried a HOPS version stamp; the importer parses
  whatever's there and merges with existing dashboards by path.
- Network Discovery data is naturally absent from old exports — run a
  fresh scan after import to populate it.

### Documentation

- README, USER_GUIDE, QUICKSTART, DEPLOY all updated for Network
  Discovery, Phase 4 detectors, Diagnostics view, target exclusions,
  and the v2.0 release framing.
- ROADMAP moves Network Discovery from Tier 4 wishlist to **Done**.
  Tier 4 retains widget framework and service-integration items.
- Landing page at `docs/index.html` updated with v2.0 capabilities.
- A new `Local launcher agent + per-device tiles` Tier 4 entry
  captures the post-2.0 product direction we discussed.

## [1.7.0] - 2026-05-25 — Note tiles, global search, keyboard nav, multi-column groups

Four roadmap Tier-1 features land together. All four are additive — existing
dashboards load and behave exactly as before; the new capabilities only
appear when you opt into them.

### Added

- **Note tiles.** A new tile *type* alongside the existing link tile,
  picked via a **Tile type** dropdown at the top of the tile edit modal.
  Notes render a name and an optional longer description, have no click
  action, and are excluded from status checks. Useful as section
  headings, layout breaks, scratchpad text, or stand-ins for services
  you haven't set up yet. The edit modal hides URL / icon / open-mode /
  status-check fields when **Note** is selected.
- **Global search.** Press `/` anywhere (outside text inputs) to open a
  search modal that indexes every tile across every dashboard. Filter
  by tile name, URL, or description; arrow keys to move through the
  result list, **Enter** to open the highlighted tile, **Esc** to close.
  Results show the dashboard → tab → group breadcrumb so it's obvious
  where each match lives. Notes jump to their parent dashboard since
  they have no URL of their own.
- **Keyboard tile navigation.** Arrow keys move focus between dashboard
  tiles in browse mode using spatial nearest-neighbour selection
  (off-axis distance weighted ×2, so up/down picks the column above and
  left/right picks the row's neighbour). Focused tiles get a blue halo.
  **Enter** activates the focused tile. Disabled in Edit Mode so it
  doesn't fight selection and drag.
- **Multi-column group layouts.** Each group has a new **Row Width**
  setting (Full / Half / Third), set via the group edit modal. Two Half
  groups sit side-by-side, three Third groups fit on a row, and any
  combination that doesn't fit cleanly wraps the over-sized group onto
  its own row. On narrow screens (below ~768 px) everything collapses
  back to full width regardless of setting. Width is a manual choice —
  drag-and-drop only reorders groups, it never changes widths.

### Documentation

- README, USER_GUIDE, QUICKSTART, DEPLOY, ICON_MANAGEMENT and the
  GitHub Pages landing page all updated for the four new features and
  bumped to v1.7.0. USER_GUIDE gains a dedicated **Tile types**
  subsection, a **Multi-column group layouts** subsection, and an
  expanded **Keyboard Shortcuts** chapter covering `/` search and
  arrow-key navigation.
- ROADMAP gained a new Tier 4 entry — **Network discovery + draft
  dashboard** — as the prerequisite for the widget framework and
  service-integration work that comes after it.

### Notes

No data migration needed. Configs from v1.6.x load as-is: tiles with no
`type` field are treated as links, groups with no `width` field render at
full width.

## [1.6.1] - 2026-05-24 — Settings page polish

A small follow-up to v1.6.0 — UX polish on the new Settings page, plus a
User Guide section. No data migration, no API or behaviour change.

### Changed

- **Navbar simplifies on `/settings`.** The dashboard tabs, font-size
  controls, theme picker, export/download icon, and Edit-mode toggle
  are hidden on the Settings page — none of them apply there. The
  logo, Help, About, the Settings cog itself, and login/logout
  remain. Normal full navbar returns the moment you navigate to an
  actual dashboard.
- **Reverse-proxy CIDR list is now a list-builder, not a JSON
  textarea.** Each configured CIDR shows as a removable chip; an input
  + Add button (or Enter) appends new entries. Client-side validation
  catches obvious typos before they leave the browser; the server
  still runs strict `net.ParseCIDR` on save. Empty state explains
  itself ("No CIDRs configured — HOPS will not honour forwarded
  headers"). The on-the-wire format is unchanged.

### Documentation

- New **Server Settings** section in [USER_GUIDE.md](USER_GUIDE.md)
  describing what the Settings page is, how to reach it, live vs
  restart-required, and the common reasons you might change a value
  (debug logging, reverse-proxy CIDRs, port changes, larger backgrounds,
  more aggressive status checks).

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
