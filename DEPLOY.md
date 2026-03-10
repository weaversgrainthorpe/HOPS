# HOPS Installation & Deployment Guide

**Version 1.2.0**

This guide covers installing and running HOPS. For a quick first-time walkthrough, see the [Zero to Dashboard Hero](QUICKSTART.md) guide.

## Installation Methods

| Method | Best For |
|--------|----------|
| [Docker](#docker) | Easiest setup, automatic updates |
| [Binary download](#binary-download) | No Docker needed, minimal footprint |
| [Build from source](#build-from-source) | Contributors and custom builds |

---

## Docker

The simplest way to run HOPS. Requires Docker and Docker Compose.

### 1. Create a docker-compose.yml

```yaml
services:
  hops:
    build: .
    container_name: hops
    ports:
      - "8080:8080"
    volumes:
      - hops-data:/app/data
    restart: unless-stopped

volumes:
  hops-data:
```

### 2. Start HOPS

```bash
docker compose up -d
```

### 3. Access HOPS

Open **http://localhost:8080** in your browser. Log in with `admin` / `admin` and change the password immediately.

### Customising the Port

Change the port mapping in `docker-compose.yml`:

```yaml
ports:
  - "3000:8080"  # Access on port 3000 instead
```

### Data Persistence

Your database, uploaded backgrounds, and icons are stored in the `hops-data` Docker volume. This persists across container restarts and updates.

To back up the volume:
```bash
docker run --rm -v hops-data:/data -v $(pwd):/backup alpine tar czf /backup/hops-backup.tar.gz -C /data .
```

---

## Binary Download

HOPS is a single binary with no runtime dependencies. No database server, no runtime environment, nothing to install.

### 1. Download

Go to the [Releases](https://github.com/weaversgrainthorpe/HOPS/releases) page and download the package for your platform:

- `hops-linux-amd64.tar.gz` — Linux x86-64
- `hops-linux-arm64.tar.gz` — Linux ARM64 (Raspberry Pi 3B+/4/5/Zero 2 W)
- `hops-darwin-amd64.tar.gz` — macOS Intel
- `hops-darwin-arm64.tar.gz` — macOS Apple Silicon
- `hops-windows-amd64.zip` — Windows x86-64

Each package contains the binary and the web interface — everything you need in a single file.

Or download directly from the command line (replace the filename with your platform):
```bash
curl -LO https://github.com/weaversgrainthorpe/HOPS/releases/download/v1.2.0/hops-linux-amd64.tar.gz
```

### 2. Extract and Run

```bash
# Extract the package
tar -xzf hops-linux-amd64.tar.gz

# Create a data directory
mkdir -p data

# Start HOPS
./hops-linux-amd64 --port 8080 --data ./data --frontend ./frontend/build
```

Open **http://localhost:8080** in your browser. Log in with `admin` / `admin` and change the password immediately.

### Directory Layout

After extracting, your directory should look like this:

```
hops/
├── hops-linux-amd64      # The binary
├── frontend/
│   └── build/            # Web interface
└── data/
    ├── hops.db           # SQLite database (created on first run)
    ├── backups/          # Automatic backups
    ├── backgrounds/      # Uploaded background images
    └── icons/            # Uploaded custom icons
```

---

## Build from Source

Requires Go 1.24+, Node.js 24+, and pnpm.

```bash
git clone https://github.com/weaversgrainthorpe/HOPS.git
cd HOPS
./scripts/build.sh
```

This builds the frontend and backend. Run with:

```bash
./backend/hops --port 8080 --data ./data --frontend ./frontend/build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full development setup instructions.

---

## Command-Line Options

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | `8080` | Port the server listens on |
| `--data` | `../data` | Data directory for SQLite database, backups, and uploads |
| `--frontend` | `../frontend/build` | Path to the frontend build directory |

All configuration is via command-line flags. There are no configuration files or environment variables.

---

## Running as a System Service

### Systemd (Linux)

HOPS includes an install script:

```bash
sudo ./scripts/install-service.sh
```

Or create the service file manually at `/etc/systemd/system/hops.service`:

```ini
[Unit]
Description=HOPS - Home Operations Portal System
After=network.target

[Service]
Type=simple
User=hops
WorkingDirectory=/opt/hops
ExecStart=/opt/hops/hops-linux-amd64 --port 8080 --data /opt/hops/data --frontend /opt/hops/frontend/build
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable hops
sudo systemctl start hops
sudo systemctl status hops
```

View logs:

```bash
sudo journalctl -u hops -f
```

---

## Reverse Proxy

HOPS has no special reverse proxy requirements. Proxy to the backend port (default 8080) with your preferred solution.

### Caddy

```
hops.example.com {
    reverse_proxy localhost:8080
}
```

Caddy handles HTTPS automatically with Let's Encrypt.

### nginx

```nginx
server {
    listen 80;
    server_name hops.example.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Traefik

Add labels to your `docker-compose.yml`:

```yaml
services:
  hops:
    # ... existing config ...
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.hops.rule=Host(`hops.example.com`)"
      - "traefik.http.services.hops.loadbalancer.server.port=8080"
```

### HTTPS

HOPS does not handle SSL/TLS directly. Use a reverse proxy (Caddy, nginx, Traefik) to terminate HTTPS. This is strongly recommended for any deployment exposed beyond your local network.

---

## Backup & Restore

### Automatic Backups

HOPS creates an automatic backup of the database every time the server starts. Backups are stored in your data directory under `backups/`.

### Managing Backups

From the Admin panel, click **Backups** to:
- View all available backups
- Restore a previous backup
- Delete old backups

### Manual Backup

The simplest manual backup is to copy the data directory:

```bash
cp -r /opt/hops/data /opt/hops/data-backup-$(date +%Y%m%d)
```

### Export/Import

HOPS supports self-contained exports that bundle your configuration with all uploaded assets (icons, backgrounds) into a single JSON file. This is useful for:

- Migrating to a new server
- Sharing a dashboard setup
- Creating a portable backup

Export from the Admin panel or from Edit Mode (click the download icon in the header for single-dashboard export).


---

## Troubleshooting

### HOPS won't start

- Check the data directory exists and is writable
- Check the frontend build directory exists and contains `index.html`
- Check the port isn't already in use: `lsof -i :8080` or `ss -tlnp | grep 8080`

### Can't access the web interface

- Verify the port: HOPS logs its port on startup
- Check firewall rules: `sudo ufw allow 8080` (if using UFW)
- If using Docker, check port mapping in `docker-compose.yml`

### Database issues

If the database becomes corrupted:

1. Stop HOPS
2. Check for backups in `data/backups/`
3. Replace `data/hops.db` with a backup file
4. Restart HOPS

As a last resort, delete `data/hops.db` and restart — HOPS will create a fresh database.

### Check logs

```bash
# Systemd service
sudo journalctl -u hops -f

# Docker
docker compose logs -f

# Manual run — logs print to the terminal
```

---

## Security

- **Change the default password** immediately after first login
- **Use HTTPS** via a reverse proxy if exposed beyond your local network
- **Restrict access** with firewall rules if not behind a reverse proxy
- **Back up regularly** — HOPS backs up on startup, but keep off-site copies too

See [SECURITY.md](SECURITY.md) for the full security policy and responsible disclosure instructions.
