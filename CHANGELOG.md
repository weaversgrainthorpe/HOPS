# Changelog

All notable changes to HOPS (Home Operations Portal System) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-01-02

### Added
- **Cross-Group Drag & Drop**: Drag tiles between different groups within the same tab with smooth visual feedback
- **Keyboard Shortcuts**: Ctrl+V/Cmd+V paste support, integrated with existing copy (Ctrl+C) and cut (Ctrl+X) shortcuts
- **Background Image System**:
  - Full background customization for dashboards and tabs
  - Support for single images, slideshows, and solid colors
  - **Smooth dual-layer crossfade transitions** for slideshows (1.5s professional fade)
  - **Live animated preview** of crossfade transition in background picker
  - Customizable rotation intervals for slideshows
  - Three fit modes: cover, contain, and fill
  - **64 curated backgrounds** across 8 categories:
    - Network & Infrastructure (8 images)
    - Servers & Data Centers (8 images)
    - Docker & Containers (8 images)
    - Homelab (8 images)
    - Smart Home (8 images)
    - Technology & Abstract (8 images)
    - Space & Futuristic (8 images)
    - Minimal & Clean (8 images)
  - Custom URL support for personal images
- **Icon Picker System**:
  - Integrated icon picker with **128+ homelab application icons**
  - Browse icons by 16 categories: Containers, Media, Downloads, Automation, Monitoring, Storage, Virtualization, Networking, Databases, Development, Backup, Communication, Security, Hardware, OS, Generic
  - Search functionality to quickly find icons
  - One-click icon selection for entry tiles
  - Includes popular homelab services: Docker, Kubernetes, Portainer, Plex, Jellyfin, Sonarr, Radarr, Home Assistant, Node-RED, Grafana, Prometheus, TrueNAS, Proxmox, pfSense, Pi-hole, and many more
  - Icons from Material Design Icons and Simple Icons collections
- **Automatic Text Contrast**:
  - Smart text color detection for group headers
  - Auto mode automatically determines light or dark text based on background color
  - Manual override options (Auto, Light, Dark)
  - Ensures readable text on any background color
  - Based on WCAG 2.0 accessibility guidelines
- **Theme Hierarchy System**: Dashboard → Tab → Group → Tile
  - Color and opacity cascade from parent to child levels
  - Each level can override parent theme settings
  - Utility functions for theme cascading
  - Visual consistency across all levels
- Version number display in header (v0.3.0)
- Import/Export button properly protected (auth + dashboard page required)

### Changed
- Import/Export button moved to align with Edit Mode button positioning
- Enhanced visual feedback during drag operations
- Better focus management for paste operations
- Improved group focus chain (Dashboard → TabPanel → Group)

### Fixed
- Fixed 401 error when saving backgrounds (better error handling with user-friendly messages)
- Fixed circular dependency between auth.ts and editMode.ts causing ReferenceError on admin page
- Fixed admin page rendering with proper variable declarations
- Fixed admin page layout (centered login card for proper display)
- Fixed nested button HTML error in Entry.svelte (invalid HTML structure causing hydration errors)
- Fixed TypeScript type errors in api.ts (HeadersInit type safety)
- Fixed config.ts type safety issues (using get() instead of subscribe pattern)
- Fixed incorrect default admin password hash in database initialization
- Added missing Entry interface properties (showStatus, fetchFavicon)
- Improved session expiration handling with clear user feedback
- Enhanced Ocean and Forest theme gradients for better visibility (cyan→blue→purple, teal→green→lime)
- Restructured routes: / now serves admin panel (was /admin), dashboards at named paths (/home, /work, etc.)

## [0.2.0] - 2025-12-XX

### Added
- Tab drag-and-drop reordering
- Tile drag-and-drop within groups
- Copy/cut/paste functionality for tiles
- Right-click context menu for tiles (Copy, Cut, Delete options)
- Keyboard shortcuts: Ctrl+C/Cmd+C (copy), Ctrl+X/Cmd+X (cut)
- Multiple open modes for entries: iframe, new tab, same tab, popup modal
- Comprehensive theme system with 8 presets
- Light/dark mode support for all themes
- Gradient theme support
- Auto theme mode (follows system preferences)
- Custom colors and opacity for tiles and tabs
- 150,000+ icons via Iconify integration
- Import from Homer and Dashy configurations
- JSON import/export for configurations

### Changed
- Migrated to Svelte 5 with new runes syntax
- Enhanced UI with better visual feedback
- Improved drag-and-drop experience with visual indicators

## [0.1.0] - 2025-11-XX

### Added
- Initial release
- Go backend with SQLite database
- SvelteKit frontend
- Authentication system
- Multiple dashboards support
- Tabs within dashboards
- Collapsible groups within tabs
- Tile/entry display
- Basic visual editor
- Admin panel
- Config storage in SQLite

[0.3.0]: https://github.com/yourusername/hops/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/yourusername/hops/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/yourusername/hops/releases/tag/v0.1.0
