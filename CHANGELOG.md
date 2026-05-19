# Changelog

All notable changes to HOPS (Home Operations Portal System) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
