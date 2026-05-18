# Changelog

All notable changes to HOPS (Home Operations Portal System) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.15] - 2026-05-18

### Fixed
- **Background config modal: "Random" transition preview now actually animates randomly.** The preview was applying `transition-{transitionEffect}` directly to the layer divs, so when the user picked **Random** the class became `transition-random` — which has no CSS rule, so nothing animated. The actual slideshow on the page worked correctly (it resolves random to a concrete transition each cycle); only the in-modal preview was broken. Now the preview resolves `random` to a fresh concrete transition each cycle and the label shows `random → <rolled>` so you can see what's about to happen.

## [1.4.14] - 2026-05-18

### Added
- **Three new bundled icon categories** in the picker: **Audio** (speakers, microphones, soundwaves, music, podcasts), **Cameras & Surveillance** (CCTV, doorbells, motion sensors, NVR), **Smart Home & Sensors** (thermostats, lights, switches, doors, windows, water/fire/fan/blinds). 90 new icons total. The seed function is now idempotent — bundled icons added in future patch releases will be picked up by existing installs on next startup without a migration.
- **Copy a group to another tab.** The Group editor's "Move to Another Tab" section is now "Move or Copy to Another Tab" with two action buttons.
- **Copy a tile to another tab/group.** Same pattern on the Tile editor.

### Fixed
- **All-class data-loss races eliminated by a save queue refactor.** Every mutation handler now goes through `mutateDashboard(dashboardId, mutator)` — the mutator runs against the *latest* dashboard state at execution time, and saves are serialized through a single queue. Previously each handler took a snapshot of the dashboard prop and called `updateDashboard` independently; if two mutations fired in quick succession, both snapshots predated the other's change → whichever PUT landed last silently overwrote the other. This was the root cause of the drag-then-delete tile-vanishing bug, and a class of similar races on rapid edits, cross-group drags, and cut-paste.
- **Cross-group drag no longer silently loses tiles.** Two compounding bugs were fixed:
  1. Source group's `handleDndConsider` was overwriting the `_sourceGroupId` tag on entries that had just arrived in the target zone, so `handleMoveEntry` was being called with `sourceGroupId == targetGroupId` and the splice silently failed. Now entries are pre-tagged at items-init/sync time and never re-tagged in consider events.
  2. Source group's `handleDndFinalize` was also firing a "reorder" save (with the moved entry removed) while target's `handleMoveEntry` was still trying to splice the entry out of source. Source now detects "entry left this group" and skips saving — the target's `handleMoveEntry` owns the cross-group save.
- **Tile `openMode` mismatch — popup tiles now actually open as popups.** The Tile editor was saving `openMode: 'popup'`, the TypeScript type union said `'modal'`, and `Entry.svelte`'s switch handled `'modal'` (not `'popup'`). Any tile configured as "Popup Modal" silently fell through to the default and opened in a new tab. Standardised on `'popup'` everywhere.
- **Move and Copy buttons in the Tile/Group editors are now disabled during the in-flight save.** Previously a double-click could fire the operation twice against the same stale snapshot, with both PUTs racing and one silently overwriting the other.
- **Cut + Paste (Ctrl+X / Ctrl+V) was racing.** The paste handler in `Dashboard.svelte` and `Group.svelte` was not awaiting the add before firing the delete; both saves went out in parallel against the same starting state and one silently won. Both flows now await properly.
- **Removed the redundant per-tab `BackgroundSlideshow`** in `TabPanel.svelte`. The dashboard-level slideshow already routes via `effectiveBackground()` (picking the active tab's background when `perTabBackgrounds` is on); the second one in TabPanel was painting stale tab backgrounds on top when `perTabBackgrounds` was off.
- **Icon picker no longer hangs the browser when opening a category with many icons.** The grid was loading all SVGs upfront, hitting browser concurrent-connection limits and flooding the console with `net::ERR_FAILED`. Added `loading="lazy"` and `decoding="async"` to icon `<img>` elements so they load as you scroll.
- **`structuredClone` → `$state.snapshot` in all mutation handlers.** `structuredClone` was failing on Svelte 5 reactive Proxies, occasionally throwing `DataCloneError` (visible during drag operations). `$state.snapshot` is the Svelte-5-aware deep clone.
- **Same `$state.snapshot` fix applied to svelte-dnd-action's `items` prop** in Group, TabPanel, and Dashboard. svelte-dnd-action does its own internal `structuredClone()` on items, which was throwing `DataCloneError` on Svelte 5 Proxies.

### Internal
- Added `scripts/deploy-local.sh` — local-only build + deploy without going through GitHub Releases. Useful during rapid iteration when the release workflow is disabled (or just slow due to multi-arch Docker build).

## [1.4.12] - 2026-05-18

### Added
- **Copy a group to another tab.** Group editor's "Move to Another Tab" section is now "Move or Copy to Another Tab" with two action buttons — **Move** (relocates the group, original gone) and **Copy** (deep-clones the group with new IDs into the target tab, original untouched).
- **Copy a tile to another tab/group.** Tile editor's "Move to Different Tab/Group" section is now "Move or Copy to Different Tab/Group" with the same Move/Copy button pair. Copy creates a fresh tile in the target with a new ID; original stays in place.

### Fixed
- **Background image no longer disappears in the lower parts of a tall dashboard.** The background element was using `position: absolute` + `background-attachment: fixed` to anchor the image to the viewport, but the fixed-attachment trick is unreliable when ancestors use `backdrop-filter` (which `.tab-content-wrapper` does for the overlay blur) and the absolute element could effectively run out of visible space below the fold. Switched to `position: fixed` directly on the background element with `100vw × 100vh` — the image now always covers the entire viewport, so the semi-transparent overlay reveals it everywhere on the page.

## [1.4.11] - 2026-05-18

### Fixed
- **Deleting a group, deleting a tile, and other edits that mutated nested data now actually persist visually.** The handlers in `Dashboard.svelte` were doing a shallow copy (`{ ...dashboard }`) before mutating tabs/groups/tiles inside it — the nested tab/group references were still shared with the old dashboard, so Svelte saw the same prop references and didn't re-render the affected children. Previously hidden by the forced `{#key}` remount removed in v1.4.10. Switched all 18 affected handlers to `structuredClone(dashboard)` for proper immutable updates. Edits now re-render correctly *and* keep the active-tab-on-delete fix from v1.4.10.

## [1.4.10] - 2026-05-18

### Fixed
- **Tabs are now switchable while in edit mode.** Clicking a tab in edit mode was opening that tab's edit modal instead of switching to it, forcing you to exit edit mode just to move between tabs. The per-tab pencil button (already shown in edit mode) remains the way to edit a tab's name/icon/etc.; clicking the tab body now always switches.
- **Deleting a group no longer jumps back to the first tab.** The route page was wrapping `<Dashboard>` in `{#key dashboardKey}` keyed on the full serialized dashboard, so every save destroyed and recreated the Dashboard component — wiping `activeTabIndex` and any other local UI state. Removed the wrapper; Svelte 5's reactivity handles prop updates without it. Bonus: edits are snappier (no full-DOM remount on every save).

## [1.4.9] - 2026-05-18 — First public release

HOPS is a self-hosted homepage dashboard for your homelab, configured entirely through a GUI — no YAML or JSON files. v1.4.9 is the first release published for general use. Earlier versions (v1.0.0 through v1.4.8) are preserved on the [GitHub Releases page](https://github.com/weaversgrainthorpe/HOPS/releases) as pre-releases for reference but were not intended for wider audiences.

### Highlights

- **GUI-first editor** — Drag-and-drop tiles, groups, and tabs. Add anything by clicking, never by editing a config file. Cancel any edit and nothing changes — every action is committed only on Create/Save.
- **Multiple dashboards** at different URLs (`/home`, `/network`, `/media`, etc.) from one install. Each dashboard has its own tabs, groups, tiles, background, and theme.
- **Public dashboards, private admin** — `http://<host>:8080/<dashboard-path>` needs no login, so dashboards can be shared with family, pinned to wall tablets, or scanned via QR. The admin page at `/` is the only thing behind authentication.
- **Built-in QR code generator** — A scannable QR for any dashboard URL from the admin panel. Open dashboards on a phone without typing.
- **Single binary** + SQLite. No external runtime dependencies. Multi-arch Docker image at `ghcr.io/weaversgrainthorpe/hops:latest` (linux/amd64 + linux/arm64 — works on Raspberry Pi 3B+/4/5/Zero 2 W).
- **~7,000 bundled icons** (homarr-labs/dashboard-icons collection) plus full Iconify search across 200,000+ icons plus custom image uploads (auto-resized to 128×128 PNG).
- **Background slideshow** with 64 curated images, per-dashboard or per-tab.
- **Optional per-tile status checks** showing up/down indicators.
- **Auto-fetch favicon** for tiles where no Iconify icon fits.
- **Imports your existing config** from Homer, Dashy, or Heimdall — try HOPS without redoing your bookmarks.
- **Built-in security**: forced password change on first login, bcrypt password hashing, CSRF protection on all mutations, HttpOnly session cookies, path-traversal hardening, rate limiting, security headers, graceful shutdown, SQLite foreign key enforcement.
- **Mobile-friendly** — responsive layout adapts at 480px / 768px / 1024px breakpoints. Editing is disabled on phone-sized screens; browsing and tile-opening work everywhere.

### Tech stack

- **Backend**: Go 1.24 (single static binary), `modernc.org/sqlite` (pure-Go, no CGO), stdlib `net/http`, `log/slog`
- **Frontend**: SvelteKit 2 + Svelte 5 (with runes), TypeScript, Vite 7
- **Storage**: SQLite with WAL mode, foreign key enforcement, idempotent migrations
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
