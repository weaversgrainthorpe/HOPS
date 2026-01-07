# HOPS - Home Operations Portal System

**Version 1.0.0**

A modern, self-hosted homepage dashboard for the homelab community.

## Why Another Dashboard?

Yes, there are already plenty of homelab dashboard and bookmark applications out there: Homer, Dashy, Heimdall, Homepage, Organizr, Homarr, and more. If you're using one and happy with it, stick with it. Seriously.

I created HOPS because none of the existing options matched what I wanted:

- **100% GUI-based editing** - I wanted to click, drag, and configure everything visually. No YAML files. No JSON editing. No "simple" configuration files that inevitably become not-so-simple. If you enjoy hand-crafting configuration files, HOPS isn't for you. Close this tab. Now.

- **Native installation** - I have no experience with Docker or containers, and I didn't want to learn just to run a dashboard. HOPS is a single Go binary with a SQLite database. Download, run, done.

- **Power features without complexity** - Drag-and-drop everything. Multiple dashboards. Tabs. Groups. Background slideshows. Theme customization. Status monitoring. All configurable through the UI.

HOPS won't be for everyone. That's fine. But if you've been frustrated editing YAML indentation at 11pm, or wished you could just *click* to add a new bookmark, maybe give it a try.

Already using Homer, Dashy, or Heimdall? HOPS can import your existing configuration, so you can try it without starting from scratch.

## Features

### Core Features
- **GUI-First**: Full visual editor, no YAML editing required
- **File-Friendly**: Config stored as JSON for easy backup/versioning
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
- Global search with "/" hotkey (Coming Soon)

### Visual Customization
- Per-dashboard and per-tab backgrounds
- Background slideshow with 18 transition effects:
  - Crossfade, Slide (up/down/left/right), Zoom (in/out)
  - Fade to Black, Blur, Flip, Ken Burns (cinematic pan/zoom)
  - Swirl, Wipe, Circle, Curtain, Diamond, Dissolve, Flash, Glitch, Random
- Customizable transition duration and slide intervals
- Upload custom background images
- Curated preset backgrounds by category
- Theme hierarchy: Dashboard -> Tab -> Group -> Tile (color & opacity cascade)
- 150,000+ built-in icons via Iconify
- Multiple tile sizes (small, medium, large, wide)
- 8 theme presets with light/dark modes
- Gradient theme support
- Auto mode (follows system theme)
- Custom colors and opacity for tiles, groups, tabs, and dashboards
- Custom CSS option (Coming Soon)

### Admin Panel
- Create, rename, and delete dashboards
- Open dashboards directly in edit mode
- Import/export configuration (JSON, YAML)
- Import from Homer and Dashy

### Entries/Tiles
- Open modes: iframe, new tab, same tab, popup modal
- HTTP + ICMP status checks with response time (Coming Soon)
- Subtitles/descriptions on tiles
- Custom tile colors and opacity
- Copy/cut/paste entries between groups and tabs
- Cross-group drag & drop
- Right-click context menu
- Multi-select for bulk operations (Coming Soon)

### Widgets (Coming Soon)
- Weather, calendar, system stats
- 50+ service integrations (Pi-hole, Proxmox, *arr apps, etc.)
- Custom HTML/iframe widgets

## Tech Stack

- **Frontend**: SvelteKit 2 + Svelte 5 + TypeScript
- **Backend**: Go (single binary)
- **Database**: SQLite
- **Icons**: Iconify
- **Drag & Drop**: svelte-dnd-action

## Quick Start

### Prerequisites
- Node.js 24+
- Go 1.24+
- pnpm
- SQLite3

### Development

1. **Start the backend:**
```bash
cd backend
go run cmd/hops/main.go --port 8080 --data ../data
```

2. **Start the frontend:**
```bash
cd frontend
pnpm install
pnpm dev
```

3. **Access the application:**
- Viewer: http://localhost:5173
- Admin: http://localhost:5173 (login page)

### Default Credentials
- Username: `admin`
- Password: `admin`

**Important:** Change the default password after first login via the "Change Password" button in the admin panel.

## Building for Production

### Build Backend
```bash
cd backend
go build -o hops ./cmd/hops
```

### Build Frontend
```bash
cd frontend
pnpm build
```

The backend will serve the static frontend files from `../frontend/build`.

### Run Production Build
```bash
cd backend
./hops --port 8080 --data ../data --frontend ../frontend/build
```

## Project Structure

```
hops/
├── backend/
│   ├── cmd/
│   │   └── hops/          # Main application
│   ├── internal/
│   │   ├── api/           # HTTP handlers and routing
│   │   ├── auth/          # Authentication service
│   │   ├── config/        # Configuration management
│   │   ├── database/      # SQLite setup and migrations
│   │   ├── models/        # Data models
│   │   ├── status/        # Status checking (HTTP/ICMP)
│   │   └── integrations/  # External service integrations
│   └── go.mod
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── components/  # Reusable Svelte components
│   │   │   ├── stores/      # Svelte stores (state management)
│   │   │   ├── types/       # TypeScript type definitions
│   │   │   └── utils/       # Utility functions (API client, etc.)
│   │   └── routes/
│   │       ├── admin/       # Admin panel route
│   │       ├── [dashboard]/ # Dynamic dashboard routes
│   │       └── d/[secret]/  # Secret URL dashboards
├── data/                  # SQLite database and uploads
│   └── backgrounds/       # Uploaded background images
└── docs/                  # Documentation
```

## API Endpoints

### Public
- `GET /api/config` - Get dashboard configuration
- `GET /api/status/:entryId` - Get status for an entry
- `POST /api/auth/login` - Admin login
- `GET /api/backgrounds` - List background images and categories

### Admin (Authenticated)
- `PUT /api/config/update` - Update configuration
- `POST /api/auth/logout` - Logout
- `POST /api/auth/change-password` - Change password
- `GET /api/config/export` - Export configuration
- `POST /api/config/import` - Import configuration
- `POST /api/backgrounds` - Upload background image
- `PUT /api/backgrounds/:id` - Update background metadata
- `DELETE /api/backgrounds/:id` - Delete background image
- `GET /api/backgrounds/categories` - List background categories
- `POST /api/backgrounds/categories` - Create background category

## Configuration

The configuration is stored in SQLite as JSON. Example structure:

```json
{
  "dashboards": [
    {
      "id": "home",
      "name": "Home",
      "path": "/home",
      "background": {
        "type": "slideshow",
        "images": ["https://example.com/bg1.jpg", "/backgrounds/custom.jpg"],
        "interval": 30,
        "transition": "kenburns",
        "transitionDuration": 2.5,
        "fit": "cover"
      },
      "tabs": [
        {
          "id": "services",
          "name": "Services",
          "color": "#3b82f6",
          "opacity": 0.95,
          "groups": [
            {
              "id": "media",
              "name": "Media",
              "collapsed": false,
              "color": "#8b5cf6",
              "opacity": 0.9,
              "entries": [
                {
                  "id": "plex",
                  "name": "Plex",
                  "url": "https://plex.local",
                  "icon": "simple-icons:plex",
                  "openMode": "newtab",
                  "size": "medium"
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  "theme": {
    "mode": "dark"
  },
  "settings": {
    "searchHotkey": "/",
    "defaultView": "/home"
  }
}
```

## Reverse Proxy

HOPS has no special reverse proxy requirements. Simply proxy to the backend port (default 8080) with your preferred solution (Caddy, nginx, Traefik, etc.).

## Systemd Service

Create `/etc/systemd/system/hops.service`:

```ini
[Unit]
Description=HOPS - Home Operations Portal System
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/hops/backend
ExecStart=/path/to/hops/backend/hops --port 8080 --data /path/to/hops/data --frontend /path/to/hops/frontend/build
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable hops
sudo systemctl start hops
```

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

- Multi-column group layouts (1/2/3 columns per row)
- Global search with "/" hotkey
- Custom CSS option
- Widget framework (weather, calendar, system stats)
- Service integrations (Pi-hole, Proxmox, etc.)
- Multi-select and bulk operations
- Secret/shareable dashboard URLs
- HTTP/ICMP status checks with response time
- Undo/Redo for accidental changes
- Keyboard navigation (arrow keys)
- PWA support (install as mobile app)

## Tips

- Click the **?** icon in the navbar (when logged in) for help
- Triple-click the HOPS logo when editing for a surprise
- The classics never go out of style: try the Konami code

## Contributing

This is a personal project, but feel free to fork and customize for your needs!

**Found a bug or have an idea?** Please report issues, bugs, or suggestions for improvements via [GitHub Issues](https://github.com/weaversgrainthorpe/HOPS/issues). I maintain this project in my limited spare time, so while I'll do my best to review and consider all feedback, I can't guarantee when (or if) I'll be able to address them. Your patience is appreciated!

## License

MIT
