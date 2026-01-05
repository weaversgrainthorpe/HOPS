# HOPS Deployment Guide (v0.10.0)

## Quick Start

### Development Mode

**Terminal 1 - Backend:**
```bash
cd backend
go run cmd/hops/main.go --port 8080 --data ../data
```

**Terminal 2 - Frontend:**
```bash
cd frontend
pnpm install
pnpm dev
```

**Access:**
- Frontend: http://localhost:5173
- Admin: http://localhost:5173 (login page)
- API: http://localhost:8080/api

**Default Credentials:**
- Username: `admin`
- Password: `admin`

## Production Deployment

### 1. Build for Production

**Backend:**
```bash
cd backend
go build -ldflags="-s -w" -o hops ./cmd/hops
```

**Frontend:**
```bash
cd frontend
pnpm build
```

### 2. Run Production Build

```bash
./backend/hops --port 8080 --data ./data --frontend ./frontend/build
```

The Go backend serves both the API and the built frontend files. Only one port needed.

### 3. Install as System Service

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
sudo systemctl status hops
```

### 4. Reverse Proxy (Optional)

HOPS has no special reverse proxy requirements. Simply proxy to the backend port with your preferred solution (Caddy, nginx, Traefik, etc.).

Example with Caddy:
```
hops.example.com {
    reverse_proxy localhost:8080
}
```

Example with nginx:
```nginx
server {
    listen 80;
    server_name hops.example.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Command-Line Options

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | 8080 | HTTP port |
| `--data` | ../data | Data directory (SQLite database, uploads) |
| `--frontend` | (none) | Path to frontend build directory |

## Troubleshooting

### Backend won't start
```bash
cd backend
go build -o hops ./cmd/hops
./hops --port 8080 --data ../data
```

Check that the data directory exists and is writable.

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

## Security

- Change the default admin password immediately after first login
- Use HTTPS in production (via reverse proxy)
- Consider firewall rules if not using a reverse proxy

## Version History

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes.
