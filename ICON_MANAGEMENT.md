# HOPS Icon Management (v1.5.2)

## Overview

HOPS features a complete database-backed icon management system that allows users to manage icons directly from the icon picker without interrupting their workflow.

## Key Features

### 1. Database Storage
- **All icons stored in SQLite database** — both preset icons (seeded on first run) and user-added icons live in the same `icons` table.
- **Two preset sources** combine into the library you see in the picker:
  - **18 categories + ~155 generic Iconify icons** seeded from [`icon_seeds.go`](backend/internal/database/icon_seeds.go) — these are the category tabs and the generic icons that appear in each (e.g., `mdi:docker` for Containers, `mdi:play-circle` for Media, `mdi:waveform` for Audio). The seed function is idempotent (`INSERT OR IGNORE`), so new bundled icons added in patch releases are picked up by existing installs on next startup, with no migration step.
  - **~2,300 app-specific SVG icons** imported from the [homarr-labs/dashboard-icons](https://github.com/homarr-labs/dashboard-icons) collection — bundled inside the HOPS binary via `//go:embed` ([`backend/internal/assets/`](backend/internal/assets/)) and seeded into the database on first run. See [`dashboard_icons.go`](backend/internal/database/dashboard_icons.go).
- **`is_preset` column** — distinguishes preset icons from user-created icons (presets are protected from deletion).
- **`image_url` column** — set for icons that resolve to an SVG file on disk (dashboard-icons and uploaded user icons); empty for pure Iconify-name icons.
- **Categories table** — organizes icons into category tabs.
- **Automatic seeding** — runs once on first start; subsequent starts skip re-seeding.

### 2. Inline Management
Users can manage icons directly from the icon picker modal:
- **Search bar** — case-insensitive search across icon name, ID, and `image_url`; filters the current category view.
- **Recently Used tab** — your last 20 selected icons (stored in `localStorage`), so frequently-used picks are one click away.
- **Add icons** — click "Add Icon to [Category]" button
- **Add categories** — click "Add Category" button
- **Upload custom icon image** — JPEG, PNG, GIF, WebP, or SVG (max 5 MB). Raster images are auto-resized to 128×128 PNG; SVG is kept as-is. See [Upload endpoint](#icons) below.
- **Delete icons** — hover over user icons to see delete button
- **Delete categories** — hover over user categories to see delete button
- **Protected presets** — preset icons and categories cannot be deleted

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
  icon TEXT NOT NULL,            -- Iconify icon name (e.g., "mdi:docker")
  category_id TEXT NOT NULL,
  color TEXT,                    -- Optional hex color (e.g., "#2496ED")
  image_url TEXT,                -- Path for SVG-on-disk icons (dashboard-icons / user uploads); NULL for pure Iconify icons
  is_preset BOOLEAN NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES icon_categories(id) ON DELETE CASCADE
)
```

Indexes: `idx_icons_category` on `category_id`, `idx_icons_preset` on `is_preset`.

## API Endpoints

All write operations (POST/PUT/DELETE) require:
- a valid `hops_session` cookie (admin login), AND
- a matching `X-CSRF-Token` header (value from the `hops_csrf` cookie — issued at login).

Read operations (GET) are public — no auth required.

### Icon Categories
- `GET /api/icon-categories` - List all categories
- `POST /api/icon-categories` - Create category (admin + CSRF)
- `PUT /api/icon-categories/{id}` - Update category (admin + CSRF)
- `DELETE /api/icon-categories/{id}` - Delete user category (admin + CSRF; presets are protected)

### Icons
- `GET /api/icons` - List all icons
- `GET /api/icons?category=<id>` - List icons in category
- `POST /api/icons` - Create icon (admin + CSRF)
- `PUT /api/icons/{id}` - Update icon (admin + CSRF)
- `DELETE /api/icons/{id}` - Delete user icon (admin + CSRF; presets are protected)
- `POST /api/icons/upload` - Upload a custom icon image (admin + CSRF; multipart/form-data, max 5 MB).
  - Accepted formats: JPEG, PNG, GIF, WebP, SVG.
  - Raster images are auto-resized to 128×128 PNG; SVG is stored verbatim.
  - Stored under `<data-dir>/icons/<random-id>.png|svg`; the returned `image_url` is what gets written to the `icons.image_url` column.

## Preset Categories (18)

1. **Containers** - Docker, Kubernetes, Portainer, Podman, Rancher
2. **Media & Streaming** - Plex, Jellyfin, Spotify, YouTube, Kodi
3. **Downloads** - qBittorrent, Radarr, Sonarr, Lidarr, Prowlarr
4. **Monitoring** - Grafana, Prometheus, Uptime Kuma, Netdata
5. **Storage & Cloud** - Nextcloud, Syncthing, MinIO, Google Drive
6. **Networking** - Nginx, Traefik, WireGuard, Pi-hole, pfSense
7. **Databases** - PostgreSQL, MySQL, MongoDB, Redis, SQLite
8. **Development** - GitHub, GitLab, Jenkins, VS Code, Gitea
9. **Communication** - Discord, Slack, Telegram, Matrix, Zoom
10. **Automation** - Home Assistant, Node-RED, n8n, Ansible, Cron
11. **Operating Systems** - Ubuntu, Debian, TrueNAS, Windows, macOS
12. **Security** - Bitwarden, Vaultwarden, Authelia, Let's Encrypt
13. **Cloud Providers** - AWS, Azure, Google Cloud, DigitalOcean
14. **Hardware** - Raspberry Pi, Synology, QNAP, HP, Dell
15. **Virtualization** - Proxmox, VMware, ESXi, VirtualBox
16. **Audio** *(new in v1.5.0)* - speakers, microphones, soundwaves, music, podcasts, headphones, equalizer
17. **Cameras & Surveillance** *(new in v1.5.0)* - CCTV, IP cameras, doorbells, motion sensors, NVR, monitors
18. **Smart Home & Sensors** *(new in v1.5.0)* - thermostats, lights, switches, doors, windows, water, fire, fan, blinds

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

#### Inside HOPS

The icon picker has a **Search bar** at the top — type any part of an icon's name or ID to filter the currently selected category. Tip: switch to the **Recently Used** tab first to see icons you've used in the last 20 picks.

#### Browsing Iconify

For icons not already in HOPS, browse 200,000+ at [iconify.design](https://icon-sets.iconify.design/):
1. Search for your service/app
2. Click the icon you want
3. Copy the full name (e.g., `simple-icons:docker`)
4. Paste into HOPS icon form (or directly into a tile's Icon field)

## Technical Details

### Frontend
- [IconPickerModal.svelte](frontend/src/lib/components/admin/IconPickerModal.svelte) - Icon picker with inline management
- [api.ts](frontend/src/lib/utils/api.ts) - API client with icon CRUD functions
- Loading states and error handling
- Real-time updates after changes

### Backend
- [database.go](backend/internal/database/database.go) - Schema and migrations
- [icon_seeds.go](backend/internal/database/icon_seeds.go) - ~170 generic Iconify icon seeds across 18 categories
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
- Favorite icons (pin specific icons above the Recently Used row)
- Icon usage statistics
- Duplicate icon detection
- Icon color picker (currently a plain text input for hex codes)
