# HOPS Installation & Deployment Guide

**Version 3.0.0**

This guide covers installing HOPS, running it as a service, upgrading it,
backing it up and removing it. For a step-by-step first install, see
[Zero to Dashboard Hero](QUICKSTART.md).

## Contents

- [Installation methods](#installation-methods)
- [Linux install script (install.sh)](#linux-install-script-installsh)
- [Proxmox container (hops-proxmox.sh)](#proxmox-container-hops-proxmoxsh)
- [Binary download](#binary-download)
- [Docker](#docker)
- [Build from source](#build-from-source)
- [Command-line options](#command-line-options)
- [Runtime configuration](#runtime-configuration)
- [Running as a system service](#running-as-a-system-service)
- [Reverse proxy](#reverse-proxy)
- [Upgrading](#upgrading)
- [Backup & restore](#backup--restore)
- [Uninstalling](#uninstalling)
- [Troubleshooting](#troubleshooting)
- [Security](#security)

## Installation methods

| Method | Best for |
|--------|----------|
| [Linux install script](#linux-install-script-installsh) | Linux and Raspberry Pi with systemd. Installs a service; re-run it to upgrade. |
| [Proxmox container](#proxmox-container-hops-proxmoxsh) | Proxmox VE. Creates a small Debian 12 container with HOPS in it. |
| [Binary download](#binary-download) | Any OS, including Windows. One self-contained file, nothing to install. |
| [Docker](#docker) | If you already run a Docker / Compose stack. |
| [Build from source](#build-from-source) | Contributors and custom builds. |

HOPS needs a **64-bit** OS. 32-bit systems are not supported, and the
original Raspberry Pi Zero / Zero W can't run a 64-bit OS. The smallest
supported machine is a Raspberry Pi Zero 2 W running 64-bit Raspberry Pi OS.

> **Not yet tried on real hardware:** the Linux ARM64 build (Raspberry Pi and
> other ARM64 boards) and both macOS builds. They come from the same code as
> the Linux x86-64 and Windows builds, which have been tested on real
> machines; the ARM64 build has been run under emulation only. If you run
> one, please [report how it went](https://github.com/weaversgrainthorpe/HOPS/issues).

---

## Linux install script (install.sh)

On a Linux machine with systemd (Debian, Ubuntu, Raspberry Pi OS, a Proxmox
container), one script installs HOPS as a service, and re-running it upgrades:

```bash
curl -fsSL https://github.com/weaversgrainthorpe/HOPS/releases/latest/download/install.sh | sudo bash
```

- It checks your **userland**, not just the kernel (so 32-bit Raspberry Pi
  OS on a 64-bit kernel counts as 32-bit and is refused). It downloads the
  binary with `SHA256SUMS` and refuses to install on a checksum mismatch.
- Program: `/opt/hops/hops`. Data: `/var/lib/hops`. Service: `hops.service`,
  run as the `hops` system user with systemd hardening.
- It finishes only when `/api/health` answers, then prints the address to
  open. A new install listens on port 8080; change the port in HOPS under
  **Settings › Global settings › Server › Port**.
- It needs root, `curl` or `wget`, `sha256sum` and systemd. It works out the
  architecture (`amd64` or `arm64`) by itself.
- If anything goes wrong it stops and says what. A failed new install is
  undone (the service is removed and the binary moved aside), so a re-run
  starts clean.
- Options go after `bash -s --`, for example
  `curl -fsSL <url>/install.sh | sudo bash -s -- --version 3.0.0`:

  | Option | Meaning |
  |--------|---------|
  | `--url <base>` | Download from this directory instead of the latest GitHub release. It must hold `hops-linux-<arch>` and `SHA256SUMS`. |
  | `--version <x.y.z>` | Install release `v<x.y.z>` (when `--url` is not given). HOPS must then report this version on `/api/health`, or the install counts as failed. |
  | `--port <n>` | The port to check health on. Default: the port HOPS last used, else 8080. This does **not** set HOPS's port (that is a Settings item); it must match it. |
  | `-h`, `--help` | Show the help. |

- **Upgrading:** re-run the same command. The previous binary and unit are
  kept as `/opt/hops/hops.prev` and `/etc/systemd/system/hops.service.prev`.
  If the new version does not come up healthy, both are put back and the
  script fails loudly (and says so if the old version does not come back
  either).
- **Interrupted upgrades:** if an upgrade is interrupted after HOPS was
  stopped (Ctrl+C, or your SSH session drops), install.sh puts the previous
  binary and service unit back, restarts HOPS if it was running, and checks
  it answers. It records what it did in `/opt/hops/install-interrupted.log`:
  if you lost the session, read that file. The next run points to it, and a
  successful run moves it aside to `install-interrupted.log.old`.
- **Customising the service:** do not edit `/etc/systemd/system/hops.service`.
  The installer rewrites it on every run and prints what it changed. If its
  `ExecStart` line was edited, the installer refuses to run until you move
  that change into a drop-in. Put local changes in a drop-in, which the
  installer never touches: `sudo systemctl edit hops`. For example, to listen
  on loopback only:

  ```ini
  [Service]
  ExecStart=
  ExecStart=/opt/hops/hops --data /var/lib/hops --host 127.0.0.1
  ```

  The health check follows `--host`.
- **Trust:** the checksum proves the download is intact, not who served it.
  Over `https://` (the default) the transport is authenticated and the
  script refuses redirects to plain http. A plain `http://` `--url` (for
  example a LAN test server) gives no such guarantee, and the script warns
  when you use one.

A v2 install that you set up yourself is not taken over by install.sh. See
[Upgrading from 2.x](#upgrading-from-2x).

---

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
  the message tells you how to remove it (`pct destroy <ID> --purge --force`).
- Inside the container HOPS is an ordinary install.sh install: the program
  is `/opt/hops/hops`, the data `/var/lib/hops`.
- **Upgrading:** `pct enter <ID>`, then run the install.sh command from
  [Linux install script](#linux-install-script-installsh).
- HOPS starts on port 8080. Change it in HOPS under Settings, then run
  `systemctl restart hops` in the container.

---

## Binary download

HOPS is a single program with no runtime dependencies: no database server,
no runtime environment, nothing else to install.

### 1. Download

Go to the [Releases](https://github.com/weaversgrainthorpe/HOPS/releases)
page and download the file for your platform:

- `hops-linux-amd64`: Linux x86-64
- `hops-linux-arm64`: Linux ARM64 (Raspberry Pi 3, 4, 5 or Zero 2 W running a 64-bit OS)
- `hops-darwin-amd64`: macOS Intel
- `hops-darwin-arm64`: macOS Apple Silicon
- `hops-windows-amd64.exe`: Windows x86-64

Each download is a single file with the web interface built in; there's
nothing to extract. A `SHA256SUMS` file is published alongside the binaries
if you want to verify the download.

From the command line (replace the file name with yours):

```bash
curl -LO https://github.com/weaversgrainthorpe/HOPS/releases/latest/download/hops-linux-amd64
```

### 2. Run

**Linux / macOS:**

```bash
chmod +x hops-linux-amd64
mkdir -p data
./hops-linux-amd64 --data ./data
```

**Windows** (PowerShell):

```powershell
curl.exe -LO https://github.com/weaversgrainthorpe/HOPS/releases/latest/download/hops-windows-amd64.exe
mkdir data
.\hops-windows-amd64.exe --data .\data
```

HOPS prints a line like
`msg="server starting" version="HOPS v3.0.0" addr=:8080 data_dir=...` when
it is ready. Open **http://localhost:8080**, sign in with `admin` / `admin`,
and set a new password when asked.

> On macOS, a file downloaded with a web browser may be blocked as "from an
> unidentified developer". Downloading with `curl` as above avoids that.

### The data folder

Everything HOPS keeps (dashboards, settings, backups, uploads) lives in one
folder, the **data folder**. Pass it with `--data`. If you leave `--data`
out, HOPS uses a folder called `data` **next to the HOPS program** (not the
folder you started it from), so the same data is found however you start it.
If that folder has no database but HOPS 2's default place (`../data`) does,
HOPS shows a *HOPS can't start safely* page with the `--data` to use, and
creates nothing. Giving `--data` explicitly is still the clearest choice for
a service.

```
data/
├── hops.db          # the SQLite database (with hops.db-wal / hops.db-shm while running)
├── backups/         # automatic and manual backups
├── backgrounds/     # uploaded background pictures
├── icons/           # uploaded icons
└── .last-port       # the port HOPS last used (for install.sh and the recovery page)
```

To run HOPS permanently, see [Running as a system service](#running-as-a-system-service).

---

## Docker

Docker is entirely optional: the binary download above needs nothing
installed. It's here for people who already run a Docker / Compose stack.

### 1. Get the compose file

A ready-to-use `docker-compose.yml` ships with each release. It pulls the
published multi-arch image (x86-64 and ARM64; the ARM64 image has so far
been run under emulation only):

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

Each release is also tagged with its version (for example
`ghcr.io/weaversgrainthorpe/hops:3.0.0`) if you'd rather pin one and upgrade
on your own schedule. To build the image from source instead, replace the
`image:` line with `build: .` in a clone of the repository.

### 2. Start HOPS

```bash
docker compose up -d
```

### 3. Open HOPS

Open **http://localhost:8080**, sign in with `admin` / `admin`, and set a
new password when asked.

### Customising the port

Change the port mapping in `docker-compose.yml`, not the port in Settings:

```yaml
ports:
  - "3000:8080"  # open HOPS on port 3000
```

### Data persistence

Your database, backups, uploaded backgrounds and icons are in the `hops-data`
volume, mounted at `/app/data`. It survives container restarts and image
updates.

To copy the volume to a file (stop HOPS first, so the database is not
being written):

```bash
docker compose stop
docker run --rm -v hops-data:/data -v "$(pwd)":/backup alpine tar czf /backup/hops-backup.tar.gz -C /data .
docker compose start
```

### Network Discovery on Docker — important

If you plan to use **Network Discovery** from inside a container, be aware
of a Docker networking limit that's beyond HOPS's control.

By default, Docker puts containers on a **bridge network** behind NAT.
Bridge networks **don't pass multicast traffic** to or from the host LAN,
and the container's ARP table reflects its bridge, not your physical
network. So:

- **mDNS / Bonjour, UPnP / SSDP and ARP-table sweeps return nothing** when
  HOPS runs in a default-bridge container. Smart TVs, AirPlay receivers,
  Sonos speakers, HomeKit devices and routers that announce themselves
  won't appear from those sources.
- **Active TCP/HTTP scanning, forward DNS and SNMP still work.** They are
  unicast and pass through NAT normally.

For full discovery from Docker, switch the container to **host networking**
(Linux):

```yaml
services:
  hops:
    image: ghcr.io/weaversgrainthorpe/hops:latest
    network_mode: host
    # remove the `ports:` block: host mode binds directly on the host
    volumes:
      - hops-data:/app/data
```

Host mode shares the host's network stack: multicast works, ARP works, IPs
match. On Docker Desktop (macOS / Windows) `network_mode: host` works
differently: Docker Desktop runs Docker in a VM, so "host" is the VM, not
your machine. The native binary is the cleaner option there.

On a default-bridge container Discovery isn't broken, just thinner. Most
homelab services (Pi-hole, Plex, the *arr apps, NAS pages) answer HTTP on a
known port and are still found. See the
[Network Discovery chapter in the User Guide](USER_GUIDE.md#network-discovery).

---

## Build from source

Most people should use the [binary download](#binary-download): it needs
nothing installed and is the same program built here. Build from source if
you want to:

- **run unreleased changes**, such as a fix that hasn't shipped in a release yet;
- **target a platform not in [Releases](https://github.com/weaversgrainthorpe/HOPS/releases)**
  (for example Windows on ARM64);
- **apply your own changes**; or
- **compile it yourself** rather than trust a prebuilt binary.

You need Go 1.27.3 or later (the `go` line in `backend/go.mod`) and Node.js
24+ with npm.

```bash
git clone https://github.com/weaversgrainthorpe/HOPS.git
cd HOPS
./scripts/build.sh
```

This builds the web interface, embeds it in the program and compiles
`backend/hops`. Run it with:

```bash
./backend/hops --data ./data
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and tests.

---

## Command-line options

Only start-up options that are needed before HOPS can open its database are
flags. Everything else, the port included, is set in HOPS under
**Settings › Global settings** (see [Runtime configuration](#runtime-configuration)).

| Flag | Default | Description |
|------|---------|-------------|
| `--data <folder>` | a `data` folder next to the HOPS program | The data folder: database, backups and uploads. |
| `--host <address>` | _(empty)_ | Interface to listen on. Empty means all interfaces. Use `127.0.0.1` to listen on loopback only, for example when HOPS sits behind a reverse proxy on the same machine and shouldn't be reachable directly. |

`hops --help` lists them. Any other flag is an error and HOPS will not
start. (In particular, `--frontend` from HOPS 2.1 and earlier no longer
exists; remove it from old service files.)

---

## Runtime configuration

Everything else is set in HOPS itself. Sign in and click the **gear**
(Settings) in the top bar, then **Global settings**. Each setting shows its
default and what it does, and the few that only apply after a restart are
marked **Restart required**. Values are kept in the database, so they
survive upgrades.

The groups are:

- **Server:** **Port** (restart required), **Log level**, the HTTP server
  timeouts (restart required), and backup retention (**Keep the newest
  backups**, **Also keep backups newer than (days)**, **Most backups kept**).
- **Sign-in & security:** **Stay signed in for (hours)**, **Sign out after
  being idle for**, **Failed sign-ins allowed per minute**, and **Trusted
  proxy ranges (CIDR)** (restart required; see [Reverse proxy](#reverse-proxy)).
- **Uploads:** **Largest background upload**, **Largest icon upload**,
  **Largest import**.
- **Editing:** **Edit mode times out after (minutes)**.
- **Look & motion:** **Animations**, **Animated folder backgrounds**.
- **Status checks:** **Status checks** (the global default), **Check every
  (minutes)**, **Give up after (seconds)**, **Treat a link as dead after**.
- **Discovery:** **Parallel probes**, **Time per host (seconds)**,
  **Longest scan (minutes)**.

The defaults suit a typical homelab.

---

## Running as a system service

### Linux (systemd)

Use the [Linux install script](#linux-install-script-installsh). It creates
`hops.service` (program `/opt/hops/hops`, data `/var/lib/hops`, the `hops`
system user, `Restart=on-failure`, systemd hardening), starts it, and waits
until HOPS answers. Re-running it upgrades HOPS. Put local changes in a
drop-in (`sudo systemctl edit hops`).

If you write your own unit instead, install.sh will not manage it later: it
refuses to touch a `hops.service` it did not write. Give your unit an
explicit `--data` and `Restart=on-failure` (or `always`). Restoring a backup
restarts HOPS: it normally starts itself again in place, and only if that
fails does it exit with code 75 for the service manager to restart it.

Check the service:

```bash
sudo systemctl status hops
```

View logs (they are also in HOPS under **Settings › Logs**):

```bash
sudo journalctl -u hops -f
```

### Windows (NSSM)

On Windows, run HOPS as shown in [Binary download](#binary-download), or
run it as a service so it starts at boot.

HOPS is a console program, not a native Windows service, so the Service
Control Manager can't run `hops-windows-amd64.exe` directly.
[NSSM](https://nssm.cc/) (the Non-Sucking Service Manager) is a small, free
wrapper that runs it as an auto-restarting service.

Assuming HOPS lives in `C:\hops` (the program plus a `data` folder):

1. Download NSSM from [nssm.cc/download](https://nssm.cc/download), unzip
   it, and put `win64\nssm.exe` somewhere handy, such as `C:\hops`.

2. From an **Administrator** PowerShell, create and configure the service:

   ```powershell
   C:\hops\nssm.exe install HOPS C:\hops\hops-windows-amd64.exe
   C:\hops\nssm.exe set HOPS AppParameters "--data C:\hops\data"
   C:\hops\nssm.exe set HOPS AppDirectory C:\hops
   C:\hops\nssm.exe set HOPS Start SERVICE_AUTO_START
   ```

3. (Optional) Keep HOPS's log output in a file as well:

   ```powershell
   C:\hops\nssm.exe set HOPS AppStdout C:\hops\logs\hops.log
   C:\hops\nssm.exe set HOPS AppStderr C:\hops\logs\hops.log
   ```

4. Start it:

   ```powershell
   C:\hops\nssm.exe start HOPS
   ```

HOPS now starts at boot and restarts if it stops, which a backup restore
relies on: under a service manager, HOPS exits after a restore and NSSM
starts it again. Manage it with `nssm stop HOPS`, `nssm restart HOPS` and
`nssm status HOPS`, or from the **Services** app (`services.msc`).

Then open **http://localhost:8080** to check it's running. If other
machines can't reach it, allow HOPS (or its port) through Windows
Firewall.

### macOS

There is no ready-made launchd setup. Run the binary as shown in
[Binary download](#binary-download), or write a launchd job that runs it
with `--data` and restarts it if it exits.

---

## Reverse proxy

HOPS has no special reverse-proxy needs. Proxy everything at the root of a
host name (HOPS does not support being served from a sub-path such as
`/hops/`) to the HOPS port, 8080 by default.

Then tell HOPS about the proxy: add its address under **Settings › Global
settings › Sign-in & security › Trusted proxy ranges (CIDR)** (for example
`192.168.1.5/32`, or `127.0.0.1/32` if the proxy runs on the same machine),
and restart HOPS. Only then does HOPS believe the proxy's
`X-Forwarded-For` and `X-Forwarded-Proto` headers: for the per-client
sign-in limit, the logs, and marking its cookies `Secure` over HTTPS. Left
empty (the default), HOPS ignores those headers, so nobody can fake them.

If the proxy runs on the same machine, you can also make HOPS listen on
loopback only with `--host 127.0.0.1` (see
[Linux install script](#linux-install-script-installsh) for doing that with
a drop-in).

### Caddy

```
hops.example.lan {
    reverse_proxy localhost:8080
}
```

Caddy obtains and renews certificates automatically.

### nginx

```nginx
server {
    listen 80;
    server_name hops.example.lan;

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
      - "traefik.http.routers.hops.rule=Host(`hops.example.lan`)"
      - "traefik.http.services.hops.loadbalancer.server.port=8080"
```

### HTTPS

HOPS does not handle TLS itself. Use a reverse proxy (Caddy, nginx,
Traefik) for HTTPS. This is strongly recommended for anything reachable
from outside your home network.

---

## Upgrading

HOPS backs up its database every time it starts. Settings, dashboards and
uploads are kept across upgrades.

- **install.sh or Proxmox:** run the install.sh command again (for Proxmox,
  inside the container: `pct enter <ID>` first). It keeps the previous
  version and puts it back if the new one does not start properly.
- **Binary download:** stop HOPS, replace the program file, and start it
  again with the same `--data` folder.
- **Docker:** `docker compose pull && docker compose up -d`. (If you pinned
  a version tag, change it first.)

Within 3.x, that's all there is to it.

### Upgrading from 2.x

**The upgrade is automatic.** Start HOPS 3 on your 2.x data folder and it
converts your dashboards on its first start. Just before it does, it takes a
**protected backup** of the whole 2.x database, named
`hops-backup-<date>_pre-v3-migration.db`, in `backups/`. If that backup
can't be made, HOPS does not convert anything.

- The conversion is all-or-nothing. If it can't convert or check the
  result, nothing is changed: HOPS shows *HOPS couldn't migrate your
  configuration* with the reason, instead of your dashboards. The advice
  depends on what failed:
  - **The conversion:** go back to 2.2.1 using the pre-v3-migration backup
    (see [Rolling back from 3.x to 2.2.1](#rolling-back-from-3x-to-221)),
    and report the problem with the message shown.
  - **The pre-v3 backup:** no copy was saved and nothing was converted. The
    data is untouched and 2.2.1 opens it as before. Fix the cause in the
    message (often disk space, or permission to write to `backups/`), then
    start HOPS 3 again.
  - **Data from a pre-release build of HOPS 3:** it has no update path; the
    message says what to do.
- The pre-v3-migration backup is never deleted automatically. It is your
  way back to 2.x (see [Rolling back from 3.x to 2.2.1](#rolling-back-from-3x-to-221)).
- After the upgrade, tiles that didn't have status checks ticked in 2.x are
  set to **Off** and ticked ones to **Inherit**, so the same tiles are
  checked as before. A notice links to
  **Settings › Dashboards › Status check overrides** if you'd rather let them
  inherit.
- You don't need to export and import. An export is not the upgrade path.

Before you start, check these, depending on how you ran 2.x:

- **Keep the same data folder.** HOPS 2 used `../data` (relative to the
  folder it was started from) when `--data` was not given; HOPS 3 uses a
  `data` folder next to the program. If your 2.x start command or service
  had no `--data`, add one that points at your existing data folder. (If you
  forget and HOPS 3 finds your HOPS 2 database at `../data`, it won't start
  empty: it shows a page with the `--data` to use and creates nothing.)
- **Remove `--frontend`.** Releases before 2.2.0 needed
  `--frontend <folder>`. HOPS 3 doesn't have that option and won't start
  with it; remove it from your service file or start command.
- **Docker** needs nothing special: the volume and its path are the same.
  Pull the new image and start it.

#### Upgrading from v2 with install.sh

install.sh refuses to touch a `hops.service` it did not write. A 2.x install
set up with `scripts/install-service.sh`, or with a hand-written unit, is
stopped with an error that names that unit, and nothing is changed.

Upgrade such an install **in place** first: stop it, replace its program
with the 3.x one (with the checks above), and start it again. HOPS 3
converts the data on its first start, after taking the backup.

To move it to the install.sh layout afterwards (optional):

1. Stop and remove the old service:
   `sudo systemctl disable --now hops && sudo rm /etc/systemd/system/hops.service && sudo systemctl daemon-reload`
2. Create the service user:
   `sudo useradd --system --user-group --home-dir /var/lib/hops --no-create-home --shell /usr/sbin/nologin hops`
3. Copy the data, then hand it to that user (`<old-data>` is the old
   `--data` folder):
   `sudo mkdir -p /var/lib/hops && sudo cp -a <old-data>/. /var/lib/hops/ && sudo chown -R hops:hops /var/lib/hops && sudo chmod 0750 /var/lib/hops`
4. Run install.sh. It refuses, with a `chown` hint, if any file under
   `/var/lib/hops` is not owned by `hops`.

#### Rolling back from 3.x to 2.2.1

HOPS 3 stores dashboards in a new format that 2.x cannot read (2.x would
show empty or broken dashboards). To go back:

1. Stop HOPS.
2. In the data folder, move `hops.db` aside, along with `hops.db-wal` and
   `hops.db-shm` if they are there.
3. Copy `backups/hops-backup-<date>_pre-v3-migration.db` to `hops.db`.
4. Put the v2.2.1 program in place of the 3.x one and start it.

Changes made under 3.x are not carried back. Don't restore this backup from
the 3.x Backups page: 3.x would simply convert it again on its next start.

---

## Backup & restore

### Automatic backups

HOPS backs up its database by itself: when it starts, before every save,
before a restore or a factory reset, and just before it converts a 2.x
configuration. Backups are in the data folder under `backups/`.

A backup that fails is never silent: Settings shows a warning (with the
time and the reason) until a backup succeeds. A restore or factory reset
whose safety backup fails is refused, and nothing is changed.

**Retention** is set in **Settings › Global settings › Server** (the
**Change** link on the Backups page goes there):

- **Keep the newest backups** (default 10): the newest automatic backups are
  never deleted, however old.
- **Also keep backups newer than (days)** (default 0 = off).
- **Most backups kept** (default 100): a ceiling that protects the disk. If
  there are still more automatic backups than this, the oldest are deleted
  even if they are within the days above (never the newest ones), and
  Settings says so.

Cleanup runs after every backup, once a day, and from **Clean up now** on
the Backups page, which first lists exactly what it would delete, and why.

Backups you **create** or **upload**, and the **pre-v3-migration** backup,
are never deleted automatically and don't count toward these numbers. The
Backups page marks them *kept until you delete it*.

### The Backups page

On **Settings › Backups** you can:

- **Create Backup** at any time.
- **Download** a backup: a `.zip` holding the database, the uploaded
  images it uses, and a manifest with each file's SHA-256. Keep a copy
  somewhere other than the HOPS machine.
- **Upload a backup**: a HOPS backup `.zip` (or an older plain `.db`,
  accepted with a warning). It is checked and listed as `…_uploaded`; it is
  not restored until you restore it.
- **Restore** a backup. HOPS takes a safety backup of the current data
  first, then restarts and applies the restore before it opens the
  database. Changes made in the few seconds before the restart are not
  included. If the restore can't be applied, HOPS keeps running on its
  current data, keeps the staged file as `hops.db.restore-failed`, and says
  so in Settings. A restore that is waiting for a restart can be undone with
  **Discard staged restore**.
- **Delete** backups you no longer need.

Images: when you delete an uploaded icon or background, HOPS keeps the file
as long as a backup still uses it, so restoring an older backup brings its
pictures back. The Backups page shows how much space those kept images take.

If HOPS is stopped part-way through applying a restore, the next start
finishes it or undoes it, and Settings says which. In the rare case where
it can't tell which files are safe to keep, HOPS doesn't open its database
at all (it would otherwise create an empty one). Instead, on the port it
last used, it serves a page saying it can't start safely: it lists the
files present and the exact steps to put your data back, and nothing is
deleted. Every address, including `/api/health`, answers 503 until the files
are fixed and HOPS is restarted.

### Manual backup

The simplest manual backup is a copy of the whole data folder, made while
HOPS is stopped (the database is written while HOPS runs):

```bash
sudo systemctl stop hops
sudo cp -a /var/lib/hops /var/lib/hops-backup-$(date +%Y%m%d)
sudo systemctl start hops
```

(For install.sh and Proxmox installs the data folder is `/var/lib/hops`;
otherwise use your `--data` folder.) Without stopping HOPS, use **Download**
on the Backups page instead.

To restore a whole-folder copy, stop HOPS, put the copied folder back in
place of the data folder, and start HOPS.

### Export and import

An export is a single JSON file holding one or all dashboards, with your
uploaded icons and backgrounds inside it, so it can be imported into another
HOPS. Use it to move dashboards between servers or share a setup. It is not
a backup: it holds dashboards only, not settings or your password.

Export one dashboard with the **Export** button next to it in **Settings ›
Dashboards**, or while editing with **Export Dashboard** in the top bar
(which also offers **Export All Dashboards**). **Import** on the same page
reads HOPS exports and Homer, Dashy and Heimdall files; see
[QUICKSTART.md](QUICKSTART.md#import-from-homer-dashy-or-heimdall).

---

## Uninstalling

Copy anything you want to keep first (a backup **Download**, an export, or
the data folder).

**install.sh** (and inside a Proxmox container):

```bash
sudo systemctl disable --now hops
sudo rm -f /etc/systemd/system/hops.service /etc/systemd/system/hops.service.prev
sudo rm -rf /etc/systemd/system/hops.service.d   # your drop-ins, if any
sudo systemctl daemon-reload
sudo rm -rf /opt/hops
sudo rm -rf /var/lib/hops                         # your data: skip this to keep it
sudo userdel hops
```

**Proxmox container:** on the host, `pct stop <ID>` and then
`pct destroy <ID> --purge`. This deletes the container and everything in it.

**Docker:** `docker compose down` stops and removes the container. The
`hops-data` volume is kept; `docker compose down -v` (or
`docker volume rm hops-data`) deletes it too.

**Binary download:** stop HOPS and delete the program and its data folder.
On Windows with NSSM, first run `nssm stop HOPS` and
`nssm remove HOPS confirm`.

---

## Troubleshooting

### HOPS won't start

- Read its startup log (the terminal, `journalctl -u hops`, or
  `docker compose logs`). HOPS says why it stopped.
- Check the data folder exists and is writable by the user HOPS runs as.
- Check the port isn't already in use: `ss -tlnp | grep 8080` (or
  `lsof -i :8080`).
- `flag provided but not defined`: the start command has an option HOPS
  doesn't know, often an old `--frontend`. See
  [Command-line options](#command-line-options).

### HOPS starts but my dashboards are missing

HOPS is probably looking at a different data folder. The startup log line
`server starting ... data_dir=...` shows which one. Start it with `--data`
pointing at your real data folder. If you upgraded from HOPS 2 without
`--data` and HOPS finds your old database at `../data`, it doesn't start
empty: it shows a *HOPS can't start safely* page naming the `--data` to use.

### Can't reach the web interface

- Check the port: HOPS logs it on startup (`addr=:8080`).
- Check firewall rules, for example `sudo ufw allow 8080` with UFW.
- With Docker, check the port mapping in `docker-compose.yml`.
- If HOPS was started with `--host 127.0.0.1`, it only answers on that
  machine.

### Database problems

Restore a backup from **Settings › Backups**. If HOPS can't start at all:

1. Stop HOPS.
2. In the data folder, move `hops.db`, `hops.db-wal` and `hops.db-shm` (if
   present) aside.
3. Copy a backup from `backups/` (a `hops-backup-<date>_<reason>.db` file) to `hops.db`.
4. Start HOPS.

With no `hops.db` at all, HOPS starts fresh with the Sample dashboard and
`admin` / `admin`, so keep the files you moved aside until you're sure.

### Logs

**Settings › Logs** shows what HOPS has been doing, with **Copy** and
**Download .txt** for when you ask for help. The same lines go to:

```bash
# install.sh / systemd service
sudo journalctl -u hops -f

# Docker
docker compose logs -f

# Run by hand: the terminal
```

---

## Security

HOPS has one admin password. Anyone who can reach HOPS can view every
dashboard; signing in is only needed to change things. So:

- **Use HTTPS** through a reverse proxy if HOPS is reachable from outside
  your home network, and set **Trusted proxy ranges (CIDR)**.
- **Limit who can reach it** with firewall rules, a VPN, or an
  authenticating reverse proxy if your dashboards show anything you
  consider private.
- **Keep off-site copies** of your backups.
- **Keep HOPS updated.** Fixes ship through
  [GitHub Releases](https://github.com/weaversgrainthorpe/HOPS/releases).

See [SECURITY.md](SECURITY.md) for the security model, supported versions
and how to report a vulnerability.
