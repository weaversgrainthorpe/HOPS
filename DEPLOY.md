# HOPS Deployment Guide

## Version: 0.1.0

## What's Complete

✅ **Phase 1 - Foundation (100%)**
- Go backend with REST API
- SQLite database with migrations
- Authentication system
- SvelteKit frontend framework
- Configuration storage
- Logo and favicon
- Semantic versioning
- Documentation

## Current Status

**Running Services:**
- Backend: http://10.10.0.9:8080
- Frontend: http://10.10.0.9:5173
- Admin: http://10.10.0.9:5173/admin

**Credentials:**
- Username: `admin`
- Password: `admin`

**API Endpoints:**
- `GET /api/version` - Version information
- `GET /api/config` - Dashboard configuration
- `POST /api/auth/login` - Admin login
- And more...

## GitHub Setup

The project is initialized with Git and ready to push to:
https://github.com/weaversgrainthorpe/HOPS

### To push to GitHub:

**Option 1: SSH (Recommended)**
```bash
cd /home/jonathan/hops
git remote set-url origin git@github.com:weaversgrainthorpe/HOPS.git
git push -u origin main
```

**Option 2: HTTPS with Token**
```bash
cd /home/jonathan/hops
git push -u origin main
# Enter username: weaversgrainthorpe
# Enter password: <your GitHub Personal Access Token>
```

**Option 3: GitHub CLI**
```bash
gh auth login
git push -u origin main
```

## Next Development Steps

### Phase 2 - Core Dashboard (Next)

1. **Dashboard Viewer** (`frontend/src/lib/components/Dashboard.svelte`)
   - Display dashboards with tabs
   - Render groups and entries as tiles
   - Handle navigation

2. **Entry/Tile Component** (`frontend/src/lib/components/Entry.svelte`)
   - Display service tiles with icons
   - Handle click actions (open modes)
   - Show status indicators

3. **Admin Editor** (`frontend/src/routes/admin/+page.svelte`)
   - Visual dashboard editor
   - Add/edit/delete dashboards, tabs, groups, entries
   - Real-time preview

4. **Icon Integration**
   - Integrate @iconify/svelte for 10K+ icons
   - Implement favicon auto-fetch
   - Custom icon upload

### Phase 3 - Advanced Features

- Drag-and-drop (svelte-dnd-action)
- Multiple open modes (iframe, modal, new tab)
- HTTP/ICMP status checks
- Global search with "/" hotkey
- Theme switcher (dark/light)
- Custom CSS support

### Phase 4 - Widgets & Integrations

- Widget framework
- Weather widget
- Calendar widget
- System stats
- Service integrations (Pi-hole, Proxmox, *arr apps)

## Production Deployment

### Build for Production

```bash
cd /home/jonathan/hops
./scripts/build.sh
```

### Install as System Service

```bash
sudo ./scripts/install-service.sh
sudo systemctl start hops
sudo systemctl status hops
```

### Configure Caddy Reverse Proxy

Copy the included Caddyfile:
```bash
sudo cp Caddyfile /etc/caddy/Caddyfile.d/hops
sudo systemctl reload caddy
```

Access at: https://hops.weaversgrainthorpe.uk

## Project Files

### Key Backend Files
- `backend/cmd/hops/main.go` - Main application
- `backend/internal/api/` - API routes and handlers
- `backend/internal/database/` - SQLite schema and migrations
- `backend/internal/auth/` - Authentication service
- `backend/internal/version/` - Version information

### Key Frontend Files
- `frontend/src/routes/+page.svelte` - Homepage
- `frontend/src/routes/admin/+page.svelte` - Admin interface
- `frontend/src/lib/stores/` - State management
- `frontend/src/lib/utils/api.ts` - API client
- `frontend/static/` - Logo, favicon, assets

### Documentation
- `README.md` - Project overview
- `GETTING_STARTED.md` - Development guide
- `DEPLOY.md` - This file
- `VERSION` - Current version number

## Troubleshooting

### Backend won't start
```bash
cd /home/jonathan/hops/backend
go build -o hops ./cmd/hops
./hops --port 8080 --data ../data
```

### Frontend can't connect
Check that `.env` has the correct API URL:
```bash
cat frontend/.env
# Should be: VITE_API_BASE=http://10.10.0.9:8080/api
```

### Database issues
Delete and recreate:
```bash
rm data/hops.db
# Restart backend to recreate with migrations
```

### Check logs
```bash
# If running as systemd service
sudo journalctl -u hops -f

# If running manually
# Check the terminal where you started the backend
```

## Version History

### v0.1.0 (2026-01-02)
- Initial release
- Backend foundation with Go + SQLite
- Frontend foundation with SvelteKit
- Authentication system
- Basic API endpoints
- Documentation and deployment scripts

## Contributing

This is a personal project for weaversgrainthorpe.uk infrastructure.

## License

MIT
