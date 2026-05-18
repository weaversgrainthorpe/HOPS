# Changelog

All notable changes to HOPS (Home Operations Portal System) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
