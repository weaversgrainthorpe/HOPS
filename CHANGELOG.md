# Changelog

All notable changes to HOPS (Home Operations Portal System) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/weaversgrainthorpe/HOPS/releases/tag/v1.0.0
