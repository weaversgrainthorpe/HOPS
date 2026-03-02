# Changelog

All notable changes to HOPS (Home Operations Portal System) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.2.0]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.2.0
[1.1.0]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.1.0
[1.0.1]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.0.1
[1.0.0]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.0.0
