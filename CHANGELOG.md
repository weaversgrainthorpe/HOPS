# Changelog

All notable changes to HOPS (Home Operations Portal System) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-01-04

### Pre-release

HOPS is a modern, self-hosted homepage dashboard for organizing and accessing your services.

### Features

#### Dashboard System
- Multiple dashboards with unique URLs (/home, /work, etc.)
- Tabbed organization within dashboards
- Collapsible groups within tabs
- Drag-and-drop for tiles, tabs, and cross-group movement

#### Visual Customization
- 8 built-in theme presets (Ocean, Forest, Sunset, etc.)
- Light/dark/auto mode support
- Custom colors and opacity at dashboard, tab, group, and tile levels
- Theme hierarchy system with cascading styles
- Automatic text contrast based on WCAG 2.0 guidelines

#### Background System
- Single image, slideshow, or solid color backgrounds
- 64 curated background images across 8 categories
- Smooth crossfade transitions for slideshows
- Custom URL support for personal images
- Per-tab background customization
- Upload your own background images

#### Icon System
- 150,000+ icons via Iconify integration
- 280+ curated homelab application presets
- 16 preset categories (Containers, Media, Monitoring, etc.)
- Custom icon upload support (PNG, JPG, SVG, WebP)
- Icon search functionality
- Inline icon management from the picker

#### Entry/Tile Features
- Multiple open modes: iframe, new tab, same tab, popup
- Status monitoring with up/down indicators
- Custom colors and sizes (small, medium, large, wide)
- Copy/cut/paste with keyboard shortcuts

#### Admin Features
- Secure authentication system
- Session management with automatic cleanup
- Import from Homer and Dashy configurations
- JSON import/export for backup
- Rate-limited login attempts
- Help and About modals

#### Technical
- Go backend with SQLite database
- SvelteKit 5 frontend with runes
- RESTful API
- Session-based authentication
- Configurable via environment variables

### Credits
Created by Jonathan Brown with Claude (Anthropic)

[0.9.0]: https://github.com/jmagar/hops/releases/tag/v0.9.0
