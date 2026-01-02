# HOPS - Home Operations Portal System

A self-hosted dashboard application that combines the best features of Heimdall, Homer, Dashy, Homepage, Organizr, and Homarr.

## Features

### Core Features
- **GUI-First**: Full visual editor, no YAML editing required
- **File-Friendly**: Config stored as JSON for easy backup/versioning
- **No Login for Viewers**: Just share a URL, it works
- **Admin Mode**: Separate login for editing

### Navigation
- Multiple dashboards (e.g., /home, /network, /media)
- Tabs within each dashboard
- Collapsible groups within tabs
- Drag-and-drop for tabs and tiles
- Copy/cut/paste for tiles between groups and tabs
- Global search with "/" hotkey (Coming Soon)

### Visual Customization
- Per-dashboard and per-tab backgrounds (Coming Soon)
- Background rotation/slideshow (Coming Soon)
- 150,000+ built-in icons via Iconify
- Multiple tile sizes (small, medium, large)
- 8 theme presets with light/dark modes
- Gradient theme support
- Auto mode (follows system theme)
- Custom colors and opacity for tiles and tabs
- Custom CSS option (Coming Soon)

### Entries/Tiles
- Open modes: iframe, new tab, same tab, popup modal (Coming Soon)
- HTTP + ICMP status checks with response time (Coming Soon)
- Subtitles/descriptions on tiles
- Custom tile colors and opacity
- Copy/cut/paste entries between groups and tabs
- Right-click context menu

### Widgets (Coming Soon)
- Weather, calendar, system stats
- 50+ service integrations (Pi-hole, Proxmox, *arr apps, etc.)
- Custom HTML/iframe widgets

## Tech Stack

- **Frontend**: SvelteKit 2 + TypeScript
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
- Admin: http://localhost:5173/admin

### Default Credentials
- Username: `admin`
- Password: `admin`

**Important**: Change the default password after first login!

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
│   └── package.json
├── data/                  # SQLite database and uploads
└── docs/                  # Documentation
```

## API Endpoints

### Public
- `GET /api/config` - Get dashboard configuration
- `GET /api/status/:entryId` - Get status for an entry
- `POST /api/auth/login` - Admin login

### Admin (Authenticated)
- `PUT /api/config/update` - Update configuration
- `POST /api/auth/logout` - Logout
- `POST /api/auth/change-password` - Change password
- `GET /api/config/export` - Export configuration
- `POST /api/config/import` - Import configuration

## Configuration

The configuration is stored in SQLite as JSON. Example structure:

```json
{
  "dashboards": [
    {
      "id": "home",
      "name": "Home",
      "path": "/home",
      "tabs": [
        {
          "id": "services",
          "name": "Services",
          "groups": [
            {
              "id": "media",
              "name": "Media",
              "collapsed": false,
              "entries": [
                {
                  "id": "plex",
                  "name": "Plex",
                  "url": "https://plex.local",
                  "icon": "plex",
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

## Deployment with Caddy

Example Caddyfile for reverse proxy:

```
hops.weaversgrainthorpe.uk {
    reverse_proxy localhost:8080
}
```

## Systemd Service

Create `/etc/systemd/system/hops.service`:

```ini
[Unit]
Description=HOPS - Home Operations Portal System
After=network.target

[Service]
Type=simple
User=jonathan
WorkingDirectory=/home/jonathan/hops/backend
ExecStart=/home/jonathan/hops/backend/hops --port 8080 --data /home/jonathan/hops/data --frontend /home/jonathan/hops/frontend/build
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

## Roadmap

### Phase 1: Foundation ✅
- [x] Project structure
- [x] Go backend with SQLite
- [x] SvelteKit frontend
- [x] Authentication system
- [x] Basic API routes
- [x] Config storage

### Phase 2: Core Dashboard ✅
- [x] Dashboard viewer
- [x] Tabs and groups
- [x] Tile display
- [x] Icon system (150,000+ icons via Iconify)
- [x] Visual editor
- [x] Tab drag-and-drop
- [x] Tile drag-and-drop within groups
- [x] Copy/cut/paste for tiles
- [x] Comprehensive theme system (8 presets with light/dark modes)

### Phase 3: Advanced Features (In Progress)
- [x] Keyboard shortcuts (Ctrl+C/Ctrl+X for copy/cut)
- [x] Multiple open modes (iframe, modal, new tab, same tab)
- [ ] Drag tiles between groups
- [ ] Status checks (HTTP/ICMP)
- [ ] Global search with "/" hotkey
- [ ] Custom CSS option
- [ ] Background images for dashboards and tabs

### Phase 4: Widgets & Integrations
- [ ] Widget framework
- [ ] Weather widget
- [ ] Calendar widget
- [ ] System stats
- [ ] Service integrations (Pi-hole, Proxmox, etc.)

### Phase 5: Polish (In Progress)
- [x] Import/export (JSON)
- [x] Import from Homer (YAML config.yml)
- [x] Import from Dashy (YAML conf.yml)
- [ ] Import from Heimdall (JSON)
- [ ] Multi-select and bulk operations
- [ ] Secret URLs
- [ ] Background images/slideshow

## Contributing

This is a personal project, but feel free to fork and customize for your needs!

## License

MIT
