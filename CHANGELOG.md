# Changelog

All notable changes to HOPS (Home Operations Portal System) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-01-02

### Added
- Cross-group drag & drop for tiles - drag tiles between different groups within the same tab
- Keyboard shortcut support: Ctrl+V/Cmd+V to paste copied/cut tiles
- Background image rotation/slideshow system for dashboards and tabs
  - Multiple background images with customizable rotation intervals
  - Support for image, slideshow, and color backgrounds
  - Customizable image fit options (cover, contain, fill)
  - Curated background presets categorized by theme
- Theme hierarchy system: Dashboard → Tab → Group → Tile
  - Color and opacity cascade from parent to child levels
  - Each level can override parent theme settings
- Version number display in header (near logo)
- Import/Export button now properly protected (requires authentication and dashboard page context)

### Changed
- Import/Export button moved to align with Edit Mode button positioning
- Enhanced visual feedback during drag operations

### Fixed
- Import/Export icon visibility protection matching Edit Mode requirements

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
