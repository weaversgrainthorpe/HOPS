# HOPS Installation & Deployment Guide

**Version 3.0.0**

This guide covers installing and running HOPS. For a quick first-time walkthrough, see the [Zero to Dashboard Hero](QUICKSTART.md) guide.

## Installation Methods

| Method | Best For |
|--------|----------|
| [Linux install script](#linux-install-script-installsh) | Linux and Raspberry Pi with systemd — installs a service, re-run to upgrade |
| [Proxmox container](#proxmox-container-hops-proxmoxsh) | Proxmox VE — creates a small Debian 12 container with HOPS in it |
| [Binary download](#binary-download) | Any OS — one self-contained file, nothing to install |
| [Docker](#docker) | If you already run a Docker / Compose stack |
| [Build from source](#build-from-source) | Contributors and custom builds |

---

## Linux install script (install.sh)

On a Linux machine with systemd (Debian, Ubuntu, Raspberry Pi OS, a Proxmox
container), one script installs HOPS as a service, and re-running it upgrades:

```bash
curl -fsSL https://github.com/weaversgrainthorpe/HOPS/releases/latest/download/install.sh | sudo bash
```

- It checks your **userland**, not just the kernel (so 32-bit Raspberry Pi
  OS on a 64-bit kernel counts as 32-bit and is refused; see below),
  downloads the binary with `SHA256SUMS` and refuses to install on a
  checksum mismatch.
- Binary: `/opt/hops/hops`. Data: `/var/lib/hops`. Service: `hops.service`,
  run as the `hops` system user with systemd hardening.
- It finishes only when `/api/health` answers, then prints the address.
  A new install listens on port 8080; change the port in HOPS under
  Settings.
- It needs root, `curl` or `wget`, `sha256sum` and systemd. It works out the
  architecture as `amd64` or `arm64`. HOPS needs a 64-bit OS: it refuses
  any 32-bit system, and says so.
- Options go after `bash -s --`, for example
  `curl -fsSL <url>/install.sh | sudo bash -s -- --version 3.0.0`:

  | Option | Meaning |
  |--------|---------|
  | `--url <base>` | Download from this directory instead of the latest GitHub release. It must hold `hops-linux-<arch>` and `SHA256SUMS`. |
  | `--version <x.y.z>` | Install release `v<x.y.z>` (when `--url` is not given). HOPS must then report this version on `/api/health`, or the install counts as failed. |
  | `--port <n>` | The port to check health on. Default: the port HOPS last used, else 8080. This does **not** set HOPS's port (that is a Settings item); it must match it. |
  | `-h`, `--help` | Show the help. |

- **Upgrading:** re-run the same command. The previous binary and unit are
  kept as `/opt/hops/hops.prev` and `hops.service.prev`; if the new version
  does not come up healthy, both are put back and the script fails loudly
  (and says so if the old version does not come back either). HOPS itself
  takes a backup before it upgrades the data.
- **Interrupted upgrades:** if an upgrade is interrupted after HOPS was
  stopped (Ctrl+C, or your SSH session drops), install.sh puts the previous
  binary and service unit back, restarts HOPS if it was running, and checks
  it answers. It records what it did in `/opt/hops/install-interrupted.log`:
  if you lost the session, read that file. The next run points to it, and a
  successful run moves it aside to `install-interrupted.log.old`.
- **Customising the service:** do not edit `/etc/systemd/system/hops.service`.
  The installer rewrites it on every run and prints what it replaced. Put
  local changes in a drop-in, which the installer never touches:
  `sudo systemctl edit hops`. For example, to listen on loopback only:

  ```ini
  [Service]
  ExecStart=
  ExecStart=/opt/hops/hops --data /var/lib/hops --host 127.0.0.1
  ```

  The health check follows `--host`.
- **Trust:** the checksum proves the download is intact, not who served it.
  Over `https://` (the default) the transport is authenticated and the
  script refuses redirects to plain http. A plain `http://` `--url` (for
  example a LAN test server) gives no such guarantee. The script warns
  when you use one.

### Upgrading from v2 with install.sh

install.sh refuses to touch a `hops.service` it did not write. A v2 install
set up with `scripts/install-service.sh`, or with a hand-written unit, is
stopped with an error that names that unit. Nothing is changed.

To upgrade a v2 install, upgrade it **in place** first: stop it, replace its
binary with the v3 one, and start it again. v3 converts the v2 data on first
start and takes a backup first.

To move it to the install.sh layout afterwards (optional):

1. Stop and remove the old service:
   `sudo systemctl disable --now hops && sudo rm /etc/systemd/system/hops.service && sudo systemctl daemon-reload`
2. Create the service user:
   `sudo useradd --system --user-group --home-dir /var/lib/hops --no-create-home --shell /usr/sbin/nologin hops`
3. Copy the data, then hand it to that user (`<old-data>` is the old
   `--data` folder):
   `sudo mkdir -p /var/lib/hops && sudo cp -a <old-data>/. /var/lib/hops/ && sudo chown -R hops:hops /var/lib/hops && sudo chmod 0750 /var/lib/hops`
4. Run install.sh. It refuses with a `chown` hint if any file under
   `/var/lib/hops` is not owned by `hops`.

## Proxmox container (hops-proxmox.sh)

Run this in the **Proxmox VE host shell** as root (the node's **Shell** in
the Proxmox web UI, or SSH to the host). It refuses to run anywhere else.

```bash
curl -fsSLO https://github.com/weaversgrainthorpe/HOPS/releases/latest/download/hops-proxmox.sh
bash hops-proxmox.sh            # asks: menus, or a y/N question without whiptail
bash hops-proxmox.sh --yes      # no questions: flags and defaults
bash hops-proxmox.sh --dry-run  # print what it would do, change nothing
```

Download it first rather than piping it to `bash`: the menus need the
terminal.

It creates an unprivileged Debian 12 LXC container (`nesting=1`, starts on
boot), downloading the Debian 12 template if it isn't there yet. It then
downloads `install.sh`, checks it against `SHA256SUMS`, runs it inside the
container, and waits until HOPS answers on `http://<container-ip>:8080`
from the host. It prints that address and the container ID.

| Option | Default |
|--------|---------|
| `--id <n>` | the next free ID |
| `--hostname <name>` | `hops` |
| `--cores <n>` | 1 |
| `--memory <MB>` | 256 |
| `--disk <GB>` | 2 |
| `--storage <name>` | `local-lvm` if present, else the first active storage that can hold containers |
| `--bridge <name>` | `vmbr0` (DHCP) |
| `--template-storage <name>` | `local` if it allows container templates, else the first storage that does (where the Debian 12 template is kept) |
| `--url <base>` | the latest GitHub release (passed through to install.sh) |
| `--version <x.y.z>` | none; when given, HOPS must report this version |
| `--ssh-key <file>` | none; a public key to allow root SSH into the container |
| `--yes` | off: it asks (menus, or y/N without whiptail). Needed when there is no terminal |
| `--dry-run` | off; prints every `pct`/`pveam`/`pvesm`/`pvesh` command instead |

- **No root password** is set in the container. Get a shell with
  `pct enter <ID>` on the host (or SSH with `--ssh-key`).
- **If a step fails**, the script stops with the reason. A container it
  already created is left in place for you to inspect (`pct enter <ID>`);
  remove it with `pct destroy <ID>` when you are done.
- **Upgrading:** `pct enter <ID>`, then run the install.sh command from
  [Linux install script](#linux-install-script-installsh).
- HOPS starts on port 8080. Change it in HOPS under Settings, then
  `systemctl restart hops` in the container.

## Binary Download

HOPS is a single binary with no runtime dependencies. No database server, no runtime environment, nothing to install — download and run.

### 1. Download

Go to the [Releases](https://github.com/weaversgrainthorpe/HOPS/releases) page and download the binary for your platform:

- `hops-linux-amd64` — Linux x86-64
- `hops-linux-arm64` — Linux ARM64 (Raspberry Pi 3B+/4/5/Zero 2 W running a 64-bit OS)
- `hops-darwin-amd64` — macOS Intel
- `hops-darwin-arm64` — macOS Apple Silicon
- `hops-windows-amd64.exe` — Windows x86-64

> **Not yet tried on real hardware:** `hops-linux-arm64` (Raspberry Pi and other ARM64 boards) and both macOS builds. They come from the same code as the Linux x86-64 and Windows builds, which have been tested on real machines; the ARM64 build has been run under emulation only. If you run one, please [report how it went](https://github.com/weaversgrainthorpe/HOPS/issues).

Each download is a single self-contained binary with the web interface built in — there's nothing to extract. (A `SHA256SUMS` file is published alongside the binaries if you want to verify the download.)

Or download directly from the command line (replace the filename with your platform):
```bash
curl -LO https://github.com/weaversgrainthorpe/HOPS/releases/latest/download/hops-linux-amd64
```

### 2. Run

```bash
# Make it executable
chmod +x hops-linux-amd64

# Create a data directory
mkdir -p data

# Start HOPS
./hops-linux-amd64 --data ./data
```

Open **http://localhost:8080** in your browser. Log in with `admin` / `admin` and change the password immediately.

### Directory Layout

The binary is fully self-contained; the only thing it creates on disk is your data directory:

```
hops/
├── hops-linux-amd64      # The binary (web UI embedded)
└── data/
    ├── hops.db           # SQLite database (created on first run)
    ├── backups/          # Automatic backups
    ├── backgrounds/      # Uploaded background images
    └── icons/            # Uploaded custom icons
```

---

## Docker

Docker is entirely optional — the binary download above needs nothing installed. It's here for people who already run a Docker / Compose stack and would rather keep HOPS alongside it. Requires Docker and Docker Compose.

### 1. Get the compose file

A ready-to-use `docker-compose.yml` ships with each release. It pulls the published multi-arch image (built for x86-64 and ARM64 / Raspberry Pi; the ARM64 image has so far been run under emulation only):

```yaml
services:
  hops:
    image: ghcr.io/weaversgrainthorpe/hops:latest
    container_name: hops
    ports:
      - "8080:8080"
    volumes:
      - hops-data:/app/data
    restart: unless-stopped

volumes:
  hops-data:
```

To build the image locally from source instead, replace the `image:` line with `build: .`.

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

### Network Discovery on Docker — important

If you plan to use the **Network Discovery** feature (v2.0+) from inside a container, be aware of a Docker networking limitation that's beyond HOPS's control:

By default, Docker puts containers on a **bridge network** behind NAT. Bridge networks **don't pass multicast traffic** to or from the host LAN, and the container's ARP table reflects its bridge, not your physical network. This means:

- **mDNS / Bonjour, UPnP / SSDP, and ARP-table sweeps return empty** when HOPS runs in a default-bridge container. Smart TVs, AirPlay receivers, Sonos speakers, HomeKit devices, and IGD routers won't appear from those sources.
- **Active TCP/HTTP scanning, forward DNS, and SNMP still work** — they're unicast and traverse NAT normally.

If you want full discovery coverage from Docker, switch the container to **host networking** (Linux):

```yaml
services:
  hops:
    image: ghcr.io/weaversgrainthorpe/hops:latest
    network_mode: host
    # remove the `ports:` block — host mode binds directly on the host
    volumes:
      - hops-data:/app/data
```

Host mode shares the host's network stack: multicast works, ARP works, IPs match. On Docker Desktop (macOS / Windows) `network_mode: host` exists but works differently — Docker Desktop runs Docker in a VM, so "host" is the VM, not your machine. Native binary installation is the cleaner option there.

The active-scan and DNS-based parts of Discovery still work on a default-bridge container, so the feature isn't "broken" — just thinner. Most homelab services (Pi-hole, Plex, *arr, NAS GUIs) are HTTP-on-known-port and will still be found. See the [Network Discovery chapter in the User Guide](USER_GUIDE.md#network-discovery) for the full picture.

---

## Build from Source

Most people should use the [binary download](#binary-download) — it needs nothing
installed and is the same artifact built here. Build from source only if you specifically
need to:

- **Run unreleased changes** — a fix or feature on `main` that hasn't shipped in a tagged release yet.
- **Target a platform or architecture not in [Releases](https://github.com/weaversgrainthorpe/HOPS/releases)** — the prebuilt binaries cover Linux and macOS on x86-64 and ARM64, and Windows on x86-64; anything else (Windows on ARM64, other OSes/arches) you build yourself.
- **Apply your own modifications** — a fork or a local patch.
- **Compile it yourself** rather than trust a prebuilt binary, as a supply-chain / audit preference.

Requires Go 1.27.3 or later (the `go` line in `backend/go.mod`) and Node.js 24+ (with npm).

```bash
git clone https://github.com/weaversgrainthorpe/HOPS.git
cd HOPS
./scripts/build.sh
```

This builds the frontend, embeds it into the backend binary, and compiles it. Run with:

```bash
./backend/hops --data ./data
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full development setup instructions.

---

## Command-Line Options

Only the bootstrap paths are CLI flags. Everything else (port,
log level, trusted proxies, rate limits, timeouts, upload caps, session
lifetime) is configured at runtime via the admin **Settings** page in the
GUI — see [Runtime Configuration](#runtime-configuration) below.

| Flag | Default | Description |
|------|---------|-------------|
| `--data` | a `data` folder next to the hops program | Data directory for SQLite database, backups, and uploads |
| `--host` | _(empty)_ | Interface to bind to. Empty = all interfaces (default). Set to `127.0.0.1` to bind loopback-only when HOPS sits behind a reverse proxy on the same host and shouldn't be reachable directly. |

## Runtime Configuration

All other configuration is set through the GUI. Sign in and click the
**gear** (Settings) in the top bar — `http://<host>:8080/settings`.
Each setting carries inline help, its default value, validation
constraints, and (where applicable) a **Restart required** badge.

Available settings, grouped:

- **Server** — Port (restart required)
- **Logging** — Log level (debug / info / warn / error)
- **Reverse proxy** — Trusted-proxy CIDRs (whose `X-Forwarded-For` /
  `X-Forwarded-Proto` headers are honoured for client-IP attribution
  and HTTPS detection; restart required)
- **Authentication** — Login rate limit per IP per minute; session lifetime
- **Edit mode** — Idle timeout before edit mode switches itself back to view-only
- **Status checks** — Polling interval; per-request timeout
- **Uploads** — Per-endpoint body caps (config import / background / icon)
- **HTTP server timeouts** — read-header / read / write / idle (restart required)

The values persist in the SQLite database. Defaults are sensible for a
typical homelab deployment.

---

## Running as a System Service

### Systemd (Linux)

Use the [Linux install script](#linux-install-script-installsh). It creates
`hops.service` (binary `/opt/hops/hops`, data `/var/lib/hops`, the `hops`
system user, `Restart=on-failure`, systemd hardening), starts it, and waits
until HOPS answers. Re-running it upgrades HOPS. Put local changes in a
drop-in (`sudo systemctl edit hops`), as described there.

If you write your own unit instead, install.sh will not manage it later: it
refuses to touch a `hops.service` it did not write (see
[Upgrading from v2 with install.sh](#upgrading-from-v2-with-installsh)). A
hand-written unit needs `Restart=on-failure` (or `always`), because
restoring a backup restarts HOPS by exiting with code 75.

Check the service:

```bash
sudo systemctl status hops
```

View logs:

```bash
sudo journalctl -u hops -f
```

### Windows (NSSM)

HOPS is a console application, not a native Windows service, so the Service
Control Manager can't run `hops-windows-amd64.exe` directly. [NSSM](https://nssm.cc/)
(the Non-Sucking Service Manager) is a small, free wrapper that runs it as a
proper auto-restarting service.

Assuming HOPS lives in `C:\hops` (the binary plus a `data` folder):

1. Download NSSM from [nssm.cc/download](https://nssm.cc/download), unzip it, and
   put the `win64\nssm.exe` somewhere handy — e.g. `C:\hops`.

2. From an **Administrator** PowerShell, create and configure the service:

   ```powershell
   C:\hops\nssm.exe install HOPS C:\hops\hops-windows-amd64.exe
   C:\hops\nssm.exe set HOPS AppParameters "--data C:\hops\data"
   C:\hops\nssm.exe set HOPS AppDirectory C:\hops
   C:\hops\nssm.exe set HOPS Start SERVICE_AUTO_START
   ```

3. (Optional) Capture HOPS's log output to a file:

   ```powershell
   C:\hops\nssm.exe set HOPS AppStdout C:\hops\logs\hops.log
   C:\hops\nssm.exe set HOPS AppStderr C:\hops\logs\hops.log
   ```

4. Start it:

   ```powershell
   C:\hops\nssm.exe start HOPS
   ```

HOPS now starts automatically at boot and restarts if it crashes. Manage it with
`nssm stop HOPS` / `nssm restart HOPS` / `nssm status HOPS`, or from the **Services**
app (`services.msc`). To remove the service later: `nssm remove HOPS confirm`.

Then open **http://localhost:8080** to confirm it's running.

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

HOPS backs up the database automatically when the server starts, before every save, before a restore or a factory reset, and before an upgrade. Backups are stored in your data directory under `backups/`.

A backup that fails is never silent: Settings shows a warning (with the time and the reason) until a backup succeeds. A restore or factory reset whose safety backup fails is refused, and nothing is changed.

**Retention** is set in Settings › Global settings › Server:
- **Keep the newest backups** (default 10): the newest automatic backups are never deleted, however old.
- **Also keep backups newer than (days)** (default 0 = off).
- **Most backups kept** (default 100): a ceiling that protects the disk. If there are still more automatic backups than this, the oldest are deleted even if they are within the days above (never the newest ones), and Settings shows a notice saying so.

Cleanup runs after every backup, once a day, and from **Clean up now** on the Backups page, which first lists exactly what it would delete, and why.

Backups you **create** or **upload**, and the **pre-v3-migration** backup (`hops-backup-<date>_pre-v3-migration.db`), are never deleted automatically and don't count toward these numbers. The pre-v3-migration backup is taken just before HOPS 3 converts a 2.x configuration; it is the only way back to 2.x.

### Rolling back from 3.x to 2.2.1

HOPS 3 stores the configuration in a new format that 2.x cannot read (2.x would show empty or broken dashboards). To go back:

1. Stop HOPS.
2. Copy `data/backups/hops-backup-<date>_pre-v3-migration.db` over `data/hops.db`.
3. Install the v2.2.1 binary and start it.

Changes made under 3.x are not carried back. Don't restore this backup from the 3.x Backups page: 3.x would simply migrate it again on its next start.

### Managing Backups

In **Settings › Backups** you can:
- View all available backups
- Restore a previous backup (a safety backup of the current data is taken first; HOPS then restarts and applies the restore before it opens the database, so the service must be set to restart automatically, e.g. `Restart=on-failure`. Changes made in the few seconds before the restart are not included. If the restore can't be applied, HOPS keeps running on its current data, keeps the staged file as `hops.db.restore-failed` and says so in Settings; a restore that is waiting for a restart can be discarded from the Backups page)

If HOPS is stopped part-way through applying a restore, the next start finishes it or undoes it (Settings says which). In the rare case where it can't tell which files are safe to keep, HOPS doesn't open its database at all (it would otherwise create an empty one). Instead, on the port it last used, it serves a page saying it can't start safely: it lists the files present and the exact steps to put your data back, and nothing is deleted. Every address, including `/api/health`, answers 503 until the files are fixed and HOPS is restarted. HOPS keeps that port in `data/.last-port` for this purpose.
- Download a backup: a `.zip` holding the database, the uploaded images it uses, and a manifest with each file's SHA-256
- Upload a backup file: a HOPS backup `.zip` (or an older plain `.db`, accepted with a warning). It is checked and listed as `…_uploaded`; it is not restored until you restore it
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

Export one dashboard from **Settings › Dashboards** (the Export button next to it), or in edit mode click the export icon in the top bar to export all dashboards or one.


---

## Troubleshooting

### HOPS won't start

- Check the data directory exists and is writable
- Check the port isn't already in use: `lsof -i :8080` or `ss -tlnp | grep 8080`
- Check HOPS's startup log — it prints the bind address (`addr=...`) and the resolved data directory

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

### Built-in protections

HOPS ships with several security mechanisms enabled by default:

- **Forced password change on first login** — the default `admin/admin` account must set a new password before any other action. A non-dismissible modal blocks the UI until done.
- **Bcrypt password hashing** — passwords are never stored or logged in plaintext.
- **HttpOnly session cookies** — `hops_session` cannot be read by JavaScript, mitigating XSS-based session theft.
- **CSRF protection** — double-submit cookie pattern. The server issues a `hops_csrf` cookie on login; the frontend echoes it back in the `X-CSRF-Token` header for all mutation requests. The server validates with constant-time comparison.
- **Per-IP login rate limiting** — 20 attempts per minute by default, with automatic cleanup of stale entries.
- **Path-traversal hardening** — backup names taken from requests must match a strict pattern (no separators, no `..`) and must be regular files in the backups folder (no symlinks).
- **Graceful shutdown** — `SIGINT`/`SIGTERM` drain in-flight requests for up to 30s; HTTP server has read/write/idle timeouts (slow-loris mitigation).
- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
- **SQLite foreign keys enabled** with `ON DELETE CASCADE` where appropriate (sessions, icons).

### Operational recommendations

- **Use HTTPS** via a reverse proxy if exposed beyond your local network
- **Restrict access** with firewall rules if not behind a reverse proxy
- **Back up regularly** — HOPS backs up on startup, but keep off-site copies too
- **Keep HOPS updated** — patch releases ship through the same GitHub Releases pipeline

See [SECURITY.md](SECURITY.md) for the full security policy and responsible disclosure instructions.
