# HOPS - Home Operations Portal System

**Version 1.4.8**

A modern, self-hosted homepage dashboard for the homelab community.

## Why Another Dashboard?

Yes, there are already plenty of homelab dashboard and bookmark applications out there: Homer, Dashy, Heimdall, Homepage, Organizr, Homarr, and more. If you're using one and happy with it, stick with it. Seriously.

I created HOPS because none of the existing options matched what I wanted:

- **100% GUI-based editing** - I wanted to click, drag, and configure everything visually. No YAML files. No JSON editing. No "simple" configuration files that inevitably become not-so-simple. If you enjoy hand-crafting configuration files, HOPS isn't for you. Close this tab. Now.

- **Native installation** - HOPS is a single binary with a SQLite database. Download, run, done. Docker is available too if that's your thing.

- **Power features without complexity** - Drag-and-drop everything. Multiple dashboards. Tabs. Groups. Background slideshows. Theme customization. Status monitoring. All configurable through the UI.

HOPS won't be for everyone. That's fine. But if you've been frustrated editing YAML indentation at 11pm, or wished you could just *click* to add a new bookmark, maybe give it a try.

Already using Homer, Dashy, or Heimdall? HOPS can import your existing configuration, so you can try it without starting from scratch.

## Quick Start

HOPS runs on **Linux**, **macOS**, and **Windows** with no dependencies. It works on anything from a Raspberry Pi to a full server.

**Docker:**
```bash
docker compose up -d
```

**Binary:**
```bash
./hops-linux-amd64 --port 8080 --data ./data --frontend ./frontend/build
```

Default login: `admin` / `admin` — change this immediately after first login.

**New to HOPS?** Follow the **[Zero to Dashboard Hero](QUICKSTART.md)** guide for a complete walkthrough from installation to your first dashboard.

For full deployment options (systemd, reverse proxy, backups), see the **[Installation & Deployment Guide](DEPLOY.md)**.

## Features

### Core
- **GUI-First**: Full visual editor — no YAML, no config files, no CLI required
- **Single Binary**: One executable + SQLite database, no runtime dependencies
- **Multi-Platform**: Linux, macOS, Windows — x86-64 and ARM64
- **Docker Support**: Dockerfile and docker-compose.yml included
- **No Login for Viewers**: Just share a URL, it works
- **Admin Mode**: Separate login for editing
- **Built-in Help**: Context-sensitive help system in edit mode

### Navigation
- Multiple dashboards (e.g., /home, /network, /media)
- Tabs within each dashboard
- Collapsible groups within tabs
- Drag-and-drop for tabs, groups, and tiles
- Cross-group drag & drop for tiles
- Copy/cut/paste for tiles between groups and tabs
- Keyboard shortcuts (Ctrl+C, Ctrl+X, Ctrl+V)
- Right-click context menu

### Visual Customization
- Per-dashboard and per-tab backgrounds
- Background slideshow with 18 transition effects (crossfade, slide, zoom, Ken Burns, and more)
- Configurable background overlay opacity and blur
- Upload custom background images or choose from 64 curated presets
- Theme hierarchy: Dashboard → Tab → Group → Tile (colour and opacity cascade)
- 150,000+ built-in icons via Iconify, plus custom icon uploads
- "My Uploads" and "Recently Used" icon categories
- Multiple tile sizes (small, medium, large, wide)
- 8 theme presets with light/dark/auto modes
- Custom colours and opacity at every level

### Entries/Tiles
- Open modes: iframe, new tab, same tab, popup modal
- HTTP and ICMP status monitoring with response time
- Subtitles/descriptions on tiles
- Custom tile colours and opacity
- Cross-group drag & drop
- Right-click context menu

### Admin Panel
- Create, rename, and delete dashboards
- **QR codes** — generate scannable codes for any dashboard URL (open the dashboard on a phone/tablet without typing)
- Self-contained export/import with embedded assets
- Single-dashboard export
- Import from Homer, Dashy, and Heimdall
- Automatic database backups on startup
- Backup management (restore and delete)
- Forced password change on first login (no more accidentally leaving the default `admin/admin` in production)

### Mobile
- Dashboards are mobile-friendly with responsive layouts (480px / 768px / 1024px breakpoints)
- Editing is **disabled on phones** (touchscreen drag-and-drop is awkward) — manage your dashboards from desktop/tablet, view them anywhere

### Security
- Bcrypt password hashing with forced first-login password change
- HttpOnly session cookies + CSRF protection (double-submit cookie pattern)
- Per-IP rate limiting on login (20/min/IP)
- Path-traversal hardening on backup/restore operations
- SQLite foreign-key enforcement and cascading deletes
- All admin endpoints behind authentication + CSRF middleware

## Tech Stack

- **Frontend**: SvelteKit 2 + Svelte 5 + TypeScript
- **Backend**: Go (single binary, pure Go, no CGO)
- **Database**: SQLite (pure Go implementation via modernc.org/sqlite)
- **Icons**: Iconify (150,000+ icons)
- **Drag & Drop**: svelte-dnd-action

## Keyboard Shortcuts

| Shortcut       | Action                        |
|----------------|-------------------------------|
| `Ctrl+C`       | Copy selected tile            |
| `Ctrl+X`       | Cut selected tile             |
| `Ctrl+V`       | Paste tile into focused group |
| `Escape`       | Close modal / Cancel edit     |
| `Ctrl+Enter`   | Save and close modal          |

*Shortcuts work when edit mode is enabled.*

## Roadmap

Future improvements under consideration:

- Global search with "/" hotkey
- Custom CSS injection
- Widget framework (weather, calendar, system stats)
- Service integrations (Pi-hole, Proxmox, *arr apps, etc.)
- Multi-select and bulk operations
- Multi-column group layouts
- Undo/Redo for accidental changes
- Keyboard navigation (arrow keys)
- PWA support (install as mobile app)

## Documentation

- **[Zero to Dashboard Hero](QUICKSTART.md)** — Get up and running in 5 minutes
- **[User Guide](USER_GUIDE.md)** — Full feature reference
- **[Installation & Deployment Guide](DEPLOY.md)** — Reverse proxy, systemd, backups

## Tips

- Click the **?** icon in the navbar (when logged in) for help
- Triple-click the HOPS logo when editing for a surprise
- The classics never go out of style: try the Konami code

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

**Found a bug or have an idea?** Please report issues, bugs, or suggestions for improvements via [GitHub Issues](https://github.com/weaversgrainthorpe/HOPS/issues). I maintain this project in my limited spare time, so while I'll do my best to review and consider all feedback, I can't guarantee when (or if) I'll be able to address them. Your patience is appreciated!

**Security issues?** Please see [SECURITY.md](SECURITY.md) for responsible disclosure instructions. Do not open public issues for vulnerabilities.

## License

MIT
