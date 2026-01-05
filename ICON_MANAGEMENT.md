# HOPS Icon Management (v0.10.0)

## Overview

HOPS features a complete database-backed icon management system that allows users to manage icons directly from the icon picker without interrupting their workflow.

## Key Features

### 1. Database Storage
- **All icons stored in SQLite database** - including 280+ curated presets
- **`is_preset` column** - distinguishes preset icons from user-created icons
- **Categories table** - organize icons into categories
- **Automatic seeding** - presets automatically loaded on first run

### 2. Inline Management
Users can manage icons directly from the icon picker modal:
- **Add icons** - Click "Add Icon to [Category]" button
- **Add categories** - Click "Add Category" button
- **Delete icons** - Hover over user icons to see delete button
- **Delete categories** - Hover over user categories to see delete button
- **Protected presets** - Preset icons and categories cannot be deleted

### 3. Seamless Workflow
- No need to leave the dashboard editor
- Add icons on-the-fly while creating entries
- Changes immediately reflected in the picker
- Auto-reload after adding/deleting

## Database Schema

### `icon_categories` Table
```sql
CREATE TABLE icon_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  order_num INTEGER NOT NULL,
  is_preset BOOLEAN NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### `icons` Table
```sql
CREATE TABLE icons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,  -- Iconify icon name (e.g., "mdi:docker")
  category_id TEXT NOT NULL,
  color TEXT,  -- Optional hex color (e.g., "#2496ED")
  is_preset BOOLEAN NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES icon_categories(id) ON DELETE CASCADE
)
```

## API Endpoints

### Icon Categories
- `GET /api/icon-categories` - List all categories
- `POST /api/icon-categories` - Create category (admin)
- `PUT /api/icon-categories/:id` - Update category (admin)
- `DELETE /api/icon-categories/:id` - Delete user category (admin)

### Icons
- `GET /api/icons` - List all icons
- `GET /api/icons?category=<id>` - List icons in category
- `POST /api/icons` - Create icon (admin)
- `PUT /api/icons/:id` - Update icon (admin)
- `DELETE /api/icons/:id` - Delete user icon (admin)

## Preset Categories (14)

1. **Containers** - Docker, Kubernetes, Portainer, Podman, Rancher
2. **Media & Streaming** - Plex, Jellyfin, Spotify, YouTube, Kodi
3. **Downloads** - qBittorrent, Radarr, Sonarr, Lidarr, Prowlarr
4. **Monitoring** - Grafana, Prometheus, Uptime Kuma, Netdata
5. **Storage & Cloud** - Nextcloud, Syncthing, MinIO, Google Drive
6. **Networking** - Nginx, Traefik, WireGuard, Pi-hole, pfSense
7. **Databases** - PostgreSQL, MySQL, MongoDB, Redis, SQLite
8. **Development** - GitHub, GitLab, Jenkins, VS Code, Gitea
9. **Communication** - Discord, Slack, Telegram, Matrix, Zoom
10. **Operating Systems** - Ubuntu, Debian, TrueNAS, Windows, macOS
11. **Security** - Bitwarden, Vaultwarden, Authelia, Let's Encrypt
12. **Cloud Providers** - AWS, Azure, Google Cloud, DigitalOcean
13. **Hardware** - Raspberry Pi, Synology, QNAP, HP, Dell
14. **Virtualization** - Proxmox, VMware, ESXi, VirtualBox

## Usage Guide

### Adding a Custom Icon

1. Open the icon picker from any entry editor
2. Select the category where you want to add the icon
3. Click "Add Icon to [Category]" button
4. Fill in the form:
   - **Name**: Display name (e.g., "My Custom Service")
   - **Icon**: Iconify icon name (e.g., "mdi:server" or "simple-icons:docker")
   - **Color**: Optional hex color (e.g., "#FF5733")
5. Click "Add Icon"
6. Your icon appears immediately in the grid

### Creating a Custom Category

1. Open the icon picker
2. Click "Add Category" button in the category tabs
3. Fill in the form:
   - **ID**: Unique identifier (e.g., "my-category")
   - **Name**: Display name (e.g., "My Category")
   - **Icon**: Icon for the tab (e.g., "mdi:star")
4. Click "Add Category"
5. New category appears in the tabs

### Finding Icons

Browse 200,000+ icons at [iconify.design](https://icon-sets.iconify.design/):
1. Search for your service/app
2. Click the icon you want
3. Copy the full name (e.g., "simple-icons:docker")
4. Paste into HOPS icon form

## Technical Details

### Frontend
- [IconPickerModal.svelte](frontend/src/lib/components/admin/IconPickerModal.svelte) - Icon picker with inline management
- [api.ts](frontend/src/lib/utils/api.ts) - API client with icon CRUD functions
- Loading states and error handling
- Real-time updates after changes

### Backend
- [database.go](backend/internal/database/database.go) - Schema and migrations
- [icon_seeds.go](backend/internal/database/icon_seeds.go) - 280+ preset icons
- [handlers.go](backend/internal/api/handlers.go) - API endpoints
- Cascading deletes for categories
- Protection for preset data

## Design Philosophy

> "Powerful features, but easy to use"

The icon management system follows HOPS core principles:
- **No workflow interruption** - manage icons without leaving the editor
- **Inline controls** - everything accessible where you need it
- **Immediate feedback** - changes appear instantly
- **Safe defaults** - presets protected from deletion
- **Progressive disclosure** - advanced features don't clutter the UI

## Future Enhancements

Potential additions for future versions:
- Bulk import/export of custom icons
- Icon preview when entering Iconify names
- Search across all icons
- Favorite icons
- Recent icons
- Icon usage statistics
- Duplicate icon detection
- Icon color picker
