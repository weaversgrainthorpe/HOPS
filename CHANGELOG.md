# Changelog

All notable changes to HOPS (Home Operations Portal System) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.3.0]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.3.0
[1.2.0]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.2.0
[1.1.0]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.1.0
[1.0.1]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.0.1
[1.0.0]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.0.0
