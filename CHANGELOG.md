# Changelog

All notable changes to HOPS (Home Operations Portal System) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.9] - 2026-05-18

### Added
- **Published multi-arch container image at `ghcr.io/weaversgrainthorpe/hops`** (tags: `:latest`, `:1.4.9`, `:v1.4.9`). Linux amd64 + arm64 (Raspberry Pi 3B+/4/5/Zero 2 W). The release workflow now builds and pushes on every tag.
- `docker-compose.yml` updated to use the published image by default (`build: .` still works as a commented-out fallback for source builds).
- QUICKSTART Docker section updated to point at the published image and mention multi-arch support.

## [1.4.8] - 2026-05-18

### Fixed
- **Add Tab is now lazy**, matching the Add Group and Add Tile flows. Previously, clicking **+ Add Tab** eagerly created a tab named "New Tab" *then* opened the edit modal — so cancelling left an orphan tab behind, and the modal momentarily rendered against `dashboard.tabs[editingTabIndex]` which could be transiently undefined under the right race. Now the modal opens first with empty fields; the tab is only created when the user clicks **Create**. Cancelling leaves nothing behind.

## [1.4.7] - 2026-05-18

### Fixed
- **Brand-new dashboards were a UX dead-end**: the tab bar (which contains the **+ Add Tab** button) was only rendered when at least one tab existed, so a fresh dashboard had no visible way to add the first tab. The empty state then pointed users to "Go to Admin Panel" — useless guidance when they were already in edit mode having just come from admin. Now:
  - The tab bar is rendered whenever **edit mode is on**, even with zero tabs, so the **+ Add Tab** button is always reachable.
  - The empty-state CTA is context-aware: shows a prominent **"Add Your First Tab"** button when in edit mode, falls back to the "Go to Admin Panel" link only when viewing as a non-admin.
  - Fixed the empty-state link to point at `/` instead of `/admin` (the admin page IS `/` — `/admin` doesn't exist as a route).
- QUICKSTART Step 6 updated to mention the new **"Add Your First Tab"** button.

## [1.4.6] - 2026-05-18

### Documentation
Full refresh of all documentation — most had been stale since v1.2.0.

- **Version numbers** updated everywhere (was `1.2.0` in 9 places)
- **Download URLs** in QUICKSTART and DEPLOY now point at `/latest/` instead of a hardcoded version tag
- **README.md**: added QR codes, mobile experience section, and built-in security features
- **QUICKSTART.md**: rewrote "Change Your Password" step to reflect the forced password change on first login (auto-prompted now); added QR mention; updated log output sample to the new slog format
- **DEPLOY.md**: added `LOG_LEVEL` env var section, rewrote Security section to document built-in protections (CSRF, forced password change, rate limiting, path-traversal hardening, security headers, graceful shutdown, FK enforcement)
- **USER_GUIDE.md**: new sections for **Mobile Experience** (editing hidden on phones, why) and **QR Codes** (admin panel feature); fixed "Add Entry" → "Add Tile" terminology; corrected theme preset names
- **ICON_MANAGEMENT.md**: documented CSRF requirement on mutation endpoints; added missing upload endpoint
- **SECURITY.md**: new "Built-in Security Features" section; updated supported versions table (was stuck on `1.2.x`)
- **CONTRIBUTING.md**: fixed dead reference to deleted `frontend/src/lib/constants/` design-token files (they're CSS custom properties in `app.css` now)
- **backend/README.md**: full rewrite — corrected the wrong API endpoint (`PUT /api/config/update` → `PUT /api/config`), wrong sessions schema (`token` → `id`), missing `must_change_password` column, ghost file references; added CSRF middleware section, slog logging, graceful shutdown, backup manager, full test coverage summary
- **frontend/README.md**: full rewrite — removed Fuse.js reference (we deleted it in v1.3.0), added Vitest test infrastructure, added `qrcode` dep, modernized project structure listing, added CSS design tokens and responsive breakpoints sections

### In-app help/about modals
- **HelpModal**: added QR codes, automatic backups, security overview, and Heimdall to the import list. New "On Mobile" section explains editing is desktop/tablet only. Tile features now mention popup open mode and 1,900+ curated icon presets.
- **AboutModal**: feature list now includes QR codes, automatic backups, CSRF/bcrypt security, and Heimdall import. Updated tech-stack line to mention Svelte 5 explicitly.

## [1.4.5] - 2026-05-17

### Changed
- **Hide edit and export controls on phones (≤480px).** Drag-and-drop editing on a touchscreen is awkward, and the edit-toggle's `padding: 0 1rem` combined with `box-sizing: border-box` was squeezing its inner icon down to ~8px AND pushing the admin gear off-screen on narrow phones. Removing it both improves mobile UX and restores the admin gear icon's visibility. Editing remains available on tablet/desktop.

## [1.4.4] - 2026-05-17

### Fixed
- Edit-toggle pencil icon was rendering at 24px while every other navbar icon was 32px — visibly smaller on mobile. Bumped to 32px to match.
- Added missing `aria-label` to the edit-toggle button (only had `title` before).

## [1.4.3] - 2026-05-17

### Fixed
- **Mobile navbar: version chip was being hidden** by an overly-broad `.logo span` selector (the `<span class="version">` got swept up with the wordmark). Added an explicit `.wordmark` class so the version chip stays visible at 360-480px screens as intended.
- **Mobile navbar: theme/export/help/about icons were invisible** at <480px. The `.icon-wrapper :global(svg) { width: 100% !important }` override added in v1.4.2 was silently breaking Iconify SVG rendering. Removed the wrapper-shrinking entirely; just made the buttons 40px (vs 44px default) so the native 32px icons fit with a clean 4px ring of padding.

## [1.4.2] - 2026-05-03

### Fixed
- **Mobile navbar regression**: the 480px breakpoint added in v1.3.0 was hiding the Help icon, About icon, and version chip on phones — too aggressive. Now keeps all action icons visible on phones (~360-480px wide), just with smaller 36×36px buttons and 24px icons. Only the HOPS wordmark and dev badge drop at this size. The dropping of secondary icons and the version chip is now reserved for tiny screens (<360px) where horizontal overflow is a real concern.
- SVG icons inside navbar buttons now actually scale with their wrapper on mobile (their inline `width="32" height="32"` was overriding CSS).

## [1.4.1] - 2026-05-03

### Fixed
- **CI/release workflows now build successfully**: switched from `pnpm install --frozen-lockfile` to `npm ci`. The pnpm lockfile had drifted from `package.json` because day-to-day development uses npm, which silently broke the v1.3.0 and v1.4.0 release builds (no artifacts published). Both lockfiles existing was the underlying rot — only `package-lock.json` is kept now.
- Dockerfile updated to use `npm` (was using `pnpm`)

### Changed
- CI workflow now also runs `npm test` (frontend test suite added in v1.3.0)
- Documentation references (CONTRIBUTING.md, DEPLOY.md, frontend/README.md, scripts/build.sh, scripts/dev.sh, PR template) updated from pnpm to npm

This is the first release that actually publishes binaries since v1.2.0. It bundles all changes from v1.3.0 and v1.4.0 (those tags exist but their release workflows failed at the install step, so no artifacts were ever produced).

## [1.4.0] - 2026-04-12

### Added
- **QR code generation** for dashboards, accessible from each row in the admin panel. Click the new QR button to open a modal showing a scannable code, the full URL (with copy-to-clipboard), and a "Download SVG" option. Useful for sharing dashboard URLs with phones/tablets without typing.
  - URL is generated from `window.location.origin + dashboard.path` so it works for any deployment topology (local IP, mDNS, reverse proxy, port forwarding) without configuration
  - QR is rendered in the browser as scalable SVG (no backend changes; lazy-loaded so it doesn't bloat the initial bundle)
  - 9 new component tests cover URL generation, copy/download actions, error states, and modal lifecycle

## [1.3.0] - 2026-04-12

### Security
- **CSRF protection** via double-submit cookie pattern: server issues a `hops_csrf` cookie on login (and on `/api/auth/check` for sessions that pre-date this version), frontend echoes it back in the `X-CSRF-Token` header on all mutation requests, server validates with constant-time comparison
- **Forced password change on first login**: default `admin/admin` user now has `must_change_password=1`; the SPA shows a non-dismissible password change modal until the flag is cleared
- **SQLite foreign keys enabled** (`PRAGMA foreign_keys=ON`) — were silently disabled before, meaning `ON DELETE CASCADE` was never enforced
- **`ON DELETE CASCADE`** added to sessions FK so deleting a user properly cleans up their sessions
- **Path traversal hardening** on backup `RestoreBackup` and `DeleteBackup` (now use `filepath.Base()` to strip directory components)
- Auth middleware moved from inline to route-level registration for icon and category mutation endpoints (consistent auditability)
- Rate limiter no longer leaks memory: stale IP entries pruned every 5 minutes via background goroutine

### Performance
- **N+1 query eliminated** in icon matching: `applyIconMatching` (called during config import) now pre-loads all icons into memory once instead of issuing 7+ SQL queries per entry. Importing 100 entries went from ~500+ queries to 1.
- Status checker batches all per-entry writes into a single transaction with a prepared statement (no longer contends with config reads on the single SQLite writer connection)
- Added missing indexes: `idx_sessions_expires_at`, `idx_sessions_user_id`
- Added `LIMIT` clauses to icon and category queries (was unbounded)

### Robustness
- HTTP server now uses graceful shutdown: `http.Server` with read/write/idle timeouts, listens for `SIGINT`/`SIGTERM`, drains in-flight requests up to 30s before exit
- Database initialization uses `PingContext` with a 5s timeout — startup fails fast instead of hanging on a stuck filesystem
- Health check endpoint's `db.Ping` now uses a 3s context timeout
- Frontend directory existence is verified at startup with a clear warning if missing
- Theme store's media query listener is now properly cleaned up on HMR (no listener accumulation in dev)
- Status store polling guarded with `isPolling` flag and ref-counted subscribers — no more duplicate intervals
- Backend status store has a `beforeunload` cleanup safety net

### Added
- **Config validation** (`Config.Validate()`): port required + numeric + 1-65535, data dir required, frontend dir required, rate limit non-negative, allowed origins non-empty when listed. Wired into `main.go` so config errors fail fast at startup.
- **Test infrastructure for the frontend**: Vitest + jsdom + svelte-testing-library + user-event. New `npm test`, `test:watch`, `test:ui`, `test:coverage` scripts.
- **Comprehensive test suite** added across the codebase:
  - **Backend: ~80 new Go tests** covering CSRF (8 dedicated), auth flows including must-change-password, database schema/migrations/cascades, backup operations including path traversal, dashboard icon import, config validation
  - **Frontend: 154 Vitest tests** covering utility functions (validation, URL safety incl. XSS vectors, color contrast, CSRF helpers), all stores (auth with mocked API, toast, textSize, selection, clipboard, confirmModal), and component tests (Button, Toast)
- Empty states now include actionable hints (e.g. "Click Add Group below to organize tiles" instead of just "No groups yet")
- Loading states added to icon picker (initial load shows spinner, delete buttons show spinner) and backup modal (delete button now shows spinner; restore was already correct)
- Toast feedback for copy/paste operations in edit mode

### Changed
- **`POST /api/config/update` → `PUT /api/config`** (the `/api/config` route now dispatches by method: `GET` for public read, `PUT` for authenticated update). Old endpoint removed; frontend updated atomically.
- **`log` → `log/slog` migration** across the backend (~50 call sites in 7 files). Output is now structured key=value text by default with timestamps and levels. New `LOG_LEVEL` env var (`debug|info|warn|error`).
- **Button styles consolidated** into global `app.css` and removed from 16 modal components — `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-sm` now have a single source of truth (~250 lines of duplicated CSS removed)
- **Admin page buttons** migrated to the shared `<Button>` component
- **Secondary text contrast** bumped to clear WCAG AAA (8:1+) on all background tones, both themes
- **Three responsive breakpoints** (480px / 768px / 1024px) replace the single 768px breakpoint across navbar, group grid, tab panel, and admin page — proper mobile/tablet adaptation
- **Aria labels** added to all icon-only navbar buttons (theme, export, help, about, admin)
- **Form labels**: hidden file input and select dropdowns in EntryEditModal now have explicit `aria-label`s
- Dev badge color contrast fixed: was `#000` on `#f59e0b` (~2.5:1, fails WCAG AA), now `#fff` on `#b45309` (~4.8:1)
- Version text size bumped from 10px → 12px (was below readability minimum)
- Terminology standardized to "Tile" in user-facing strings (`placeholder="Service Name"` → `"Tile name"`, etc.); internal code keeps `Entry` types
- Default `writeJSONSuccess()` helper for the 14+ mutation endpoints that return `{"success": true}`
- All error responses use `writeJSONError` (no remaining `http.Error` plain-text responses)
- CORS preflight (OPTIONS) returns 403 for disallowed origins instead of 200

### Removed
- **Dead code files**: `frontend/src/lib/utils/loading.ts`, `frontend/src/lib/constants/{ui,iconPresets,zIndex}.ts` — all four had zero references
- **Unused exports** trimmed from `errors.ts` (kept `logError`, `logWarn`; removed `ApiError`, `NetworkError`, `handleAsync`, `handleApiResponse`, `showError`, `showSuccess`, `parseError`, `getErrorMessage`)
- **Unused exports** trimmed from `selection.ts` (7 of 12)
- **Unused** `setTextSize` from `textSize.ts`, `normalizeUrl` made private in `url.ts`
- **`fuse.js`** removed from `package.json` (declared but never imported)

### Fixed
- `writeJSON` and `writeJSONError` now check and log `json.Encode` errors instead of silently swallowing them
- `handleUpdateConfig` now requires `PUT` (was accepting both `PUT` and `POST`)

## [1.2.0] - 2026-03-02

### Added
- Configurable background overlay opacity and blur (per-background sliders in Background Config modal)
- Self-contained export/import with base64-embedded assets (icons, backgrounds, presets)
- Backup deletion from the admin Backup modal
- `DeleteBackup()` method on BackupManager

### Changed
- All API error responses now return consistent JSON format (`{"error": "...", "status": 400}`)
- All JSON responses use `writeJSON()` helper consistently
- Edit modals (Entry, Tab, Group, ChangePassword) use Modal footer snippet for pinned action buttons
- Import and Export modals migrated to shared Modal component
- Toast messages standardized (no trailing periods on short phrases)
- Dev mode detection uses hostname instead of hardcoded port number
- Removed dead code: unused `theme.ts`, `designTokens.ts`, unused validation/color functions
- Removed unused `secrets` database table
- Removed commented-out `handleIntegrations` code

### Fixed
- Cut/paste now correctly deletes source entry (was behaving as copy)
- Modal save buttons no longer overflow off-screen on smaller viewports
- SQL injection vulnerability in `VACUUM INTO` backup path (single-quote escaping)
- Silent error swallowing in status polling store (now logs via `logError`)
- Swallowed error in expired session cleanup (now logged)
- README "Coming Soon" removed from status checks (already implemented)

## [1.1.0] - 2026-02-27

### Added
- Docker support with Dockerfile and docker-compose.yml
- GitHub Actions CI workflow (build, test, Windows cross-compile)
- GitHub Actions release workflow (multi-platform binaries on tag push)
- Comprehensive test suite for auth service and API handlers
- HttpOnly cookie-based session authentication
- `/api/auth/check` endpoint for verifying auth status
- Security headers middleware (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy)
- CONTRIBUTING.md, SECURITY.md, and GitHub issue/PR templates
- `.env.example` for environment variable reference

### Changed
- Swapped `mattn/go-sqlite3` (CGO) for `modernc.org/sqlite` (pure Go) for cross-platform compatibility
- Backend builds with `CGO_ENABLED=0` — no C compiler required
- Frontend auth uses HttpOnly cookies instead of localStorage
- Windows `.exe` builds now supported

### Fixed
- Missing `import os` in `fix_icon_categories.py` script
- Python scripts use relative paths instead of hardcoded absolute paths

## [1.0.1] - 2026-02-25

### Changed
- Dev environment banner: uses border + badge instead of overlay that blocked nav
- Updated frontend config and API utilities

### Fixed
- Dev banner no longer blocks navigation elements

## [1.0.0] - 2026-01-07

### 🎉 First Public Release

HOPS (Home Operations Portal System) is now ready for public use! A modern, self-hosted homepage dashboard for organizing and accessing your homelab services.

### Features

#### Dashboard System
- Multiple dashboards with unique URLs (/home, /work, etc.)
- Tabbed organization within dashboards
- Collapsible groups within tabs
- Drag-and-drop for tiles, groups, tabs, and cross-group movement
- Group duplication with immediate insertion after source

#### Visual Customization
- 8 built-in theme presets (Ocean, Forest, Sunset, etc.)
- Light/dark/auto mode support
- Custom colors and opacity at dashboard, tab, group, and tile levels
- Theme hierarchy system with cascading styles
- Automatic text contrast based on WCAG 2.0 guidelines
- Text size controls in navbar (increase/decrease)

#### Group & Tab Customization
- **Display Style** option for groups: "Full Header" or "Folder Tab" (compact Windows Explorer-style)
- Icon support for groups (Iconify icons or custom image URLs)
- Icon support for tabs (Iconify icons or custom image URLs)
- Color, opacity, and text color options for tabs

#### Background System
- Single image, slideshow, or solid color backgrounds
- 64 curated background images across 8 categories
- 18 slideshow transition effects (crossfade, slide, zoom, curtain, diamond, dissolve, glitch, ken burns, random, and more)
- Custom URL support for personal images
- Per-tab background customization
- Upload your own background images

#### Icon System
- 150,000+ icons via Iconify integration
- 1,900+ curated homelab application presets across 15 categories
- **"My Uploads"** category - automatically shows all uploaded custom icons for easy reuse
- **"Recently Used"** category - tracks last 20 selected icons with localStorage persistence
- Custom icon upload support (PNG, JPG, SVG, WebP)
- Icon search functionality with filename matching
- Inline icon management from the picker

#### Entry/Tile Features
- Multiple open modes: iframe, new tab, same tab, popup
- Status monitoring with up/down indicators
- Custom colors and sizes (small, medium, large, wide)
- Copy/cut/paste with keyboard shortcuts

#### Admin Features
- Secure authentication system with bcrypt password hashing
- Session management with automatic cleanup (24-hour expiry)
- Rate-limited login attempts (20/minute per IP)
- Import from Homer, Dashy, and Heimdall configurations
- JSON/YAML import/export for backup
- Auto-match icons feature during import
- Help and About modals
- Change password functionality

#### Technical
- Go backend with SQLite database (WAL mode for performance)
- SvelteKit 5 frontend with runes
- RESTful API with centralized error handling
- Session-based authentication with Bearer tokens
- Configurable via environment variables
- Automatic database backups on startup and config changes
- CSS design tokens for consistent styling
- TypeScript throughout frontend

### Credits
Created by Jonathan Brown with Claude (Anthropic)

[1.4.7]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.4.7
[1.4.6]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.4.6
[1.4.5]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.4.5
[1.4.4]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.4.4
[1.4.3]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.4.3
[1.4.2]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.4.2
[1.4.1]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.4.1
[1.4.0]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.4.0
[1.3.0]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.3.0
[1.2.0]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.2.0
[1.1.0]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.1.0
[1.0.1]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.0.1
[1.0.0]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.0.0
