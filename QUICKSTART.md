# Zero to Dashboard Hero

Get HOPS running, sign in, look around the Sample, and build your first
dashboard. No experience needed.

## What you need

- A computer that stays on: a Raspberry Pi, a spare PC, a VM or container, or
  your own laptop to try it out.
- About 10 minutes.

HOPS is one file. It has its own database (SQLite) and its own web
interface built in, so there is nothing else to install.

| You have | Download |
|----------|----------|
| Linux on a normal PC or server (x86-64) | `hops-linux-amd64` |
| 64-bit ARM: Raspberry Pi 3, 4, 5 or Zero 2 W with a **64-bit** OS, and other ARM64 boards | `hops-linux-arm64` |
| 32-bit ARM: the original Pi Zero / Zero W, or any Pi running **32-bit** Raspberry Pi OS | `hops-linux-armv6` |
| macOS (Intel) | `hops-darwin-amd64` |
| macOS (Apple Silicon) | `hops-darwin-arm64` |
| Windows (x86-64) | `hops-windows-amd64.exe` |

Not sure which Pi OS you have? Run `getconf LONG_BIT` on the Pi: `64` means
arm64, `32` means armv6. (The one-line installer below works this out for
you.)

## Step 1: Install HOPS

Pick one.

### Option A: One-line installer (Linux, Raspberry Pi)

For Linux machines with systemd: Debian, Ubuntu, Raspberry Pi OS, a Proxmox
container. It installs HOPS as a service that starts on boot.

```bash
curl -fsSL https://github.com/weaversgrainthorpe/HOPS/releases/latest/download/install.sh | sudo bash
```

It picks the right download for your machine, checks it against the
published checksums, starts HOPS, and waits until HOPS answers. It ends by
printing the address to open, for example `http://192.168.1.20:8080`.
If anything goes wrong it stops and says what, rather than leaving a
half-installed HOPS.

Where things go: the program is `/opt/hops/hops`, your data is in
`/var/lib/hops`, and the service is `hops.service`
(`sudo systemctl status hops`). For options and details, see
[Linux install script](DEPLOY.md#linux-install-script-installsh).

### Option B: Download and run the file (Linux, macOS, Windows)

Good for trying HOPS out. It runs while the terminal is open.

**Linux / macOS** (use the file name for your machine from the table above):

```bash
curl -LO https://github.com/weaversgrainthorpe/HOPS/releases/latest/download/hops-linux-amd64
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

Always give `--data`: it is the folder that holds your dashboards, backups
and uploads. HOPS prints a line like
`msg="server starting" version="HOPS v3.0.0" addr=:8080` when it is ready.

> On macOS, a file downloaded with a web browser may be blocked as "from an
> unidentified developer". Downloading with `curl` as above avoids that.

To run it permanently as a service, see the
[Installation & Deployment Guide](DEPLOY.md).

### Option C: Docker

For x86-64 and 64-bit ARM machines that already run Docker. Save this as
`docker-compose.yml`:

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

Then start it:

```bash
docker compose up -d
```

Your data lives in the `hops-data` volume. (Network Discovery sees less from
inside Docker; see [Network Discovery on Docker](DEPLOY.md#network-discovery-on-docker--important).)

### Option D: Proxmox VE container

In the **Proxmox host shell** (the node's Shell in the Proxmox web UI, or SSH
to the host as root):

```bash
curl -fsSLO https://github.com/weaversgrainthorpe/HOPS/releases/latest/download/hops-proxmox.sh
bash hops-proxmox.sh
```

It asks a few questions (container ID, name, cores, memory, disk, storage,
bridge), then creates a small unprivileged Debian 12 container
(1 core, 256 MB RAM, 2 GB disk, DHCP on `vmbr0` by default), installs HOPS
in it with the installer from Option A, and prints the address to open.
For a root shell in the container, run `pct enter <container ID>` on the
host. For all the options, see [Proxmox container](DEPLOY.md#proxmox-container-hops-proxmoxsh).

## Step 2: Sign in

1. Open **http://\<your-server-address\>:8080** in a browser (on the same
   machine: **http://localhost:8080**).
2. You land on the **Sample** dashboard. Anyone on your network can view
   dashboards; you only sign in to change things.
3. To sign in, click the **pencil** button in the top bar (its tooltip says
   *Sign in to edit this dashboard*), or the **gear** (Settings).
4. Sign in with username `admin` and password `admin`.
5. HOPS asks you to **Set a New Password** straight away, and you can't
   carry on until you do. Type `admin` as the current password, then your
   new one twice (8 to 72 characters), and click **Set Password**.

You can change the password later under **Settings › Password**. A
**Log out** button sits at the right of the top bar.

## Step 3: Look around the Sample

The Sample shows what HOPS can do. Its addresses are made-up
(`*.example.lan`), so the tiles don't go anywhere real. It has three tabs
across the top:

- **Home**: tiles in all three sizes (Small, Medium, Large) placed straight
  on the tab, and folders. *Media* holds a folder inside a folder (*More to
  watch*). *Monitoring*, *Databases* and *Cloud* start **minimised**: each
  shows as a single folder tile (in three sizes) until you click it.
- **Folders**: folders inside folders. *Projects › Lab › Dashboards* goes
  three deep. The minimise button on a folder's title bar shrinks it to a
  folder tile; click that tile to open it again. Each browser remembers
  what its viewer minimised.
- **Shapes**: every folder **Look**: Rounded box, Simple tab, and the folder
  styles (flat, with paper, outlined, cartoon, open flap). *Upstairs* nests
  shapes inside shapes.

Other things in the top bar: **Search** (or press `/`) finds any tile on any
dashboard; the two **A** buttons change text size; **Theme Settings** picks
light, dark and colour themes; **Help** (once signed in) lists keyboard
shortcuts.

Done with the Sample? Delete it from **Settings › Dashboards**, or keep it
to look back at.

## Step 4: Build your first dashboard

### How HOPS is organised

```
Dashboard        one page with its own address, e.g. /home
└── Tab          the row of tabs across the top
    ├── Tile     a link to one of your services (Small, Medium or Large)
    └── Folder   a box of tiles (and other folders) with a title
        └── Tile / Folder ...
```

Tiles and folders sit on a grid on each tab. Folders can hold folders.

### Create the dashboard

1. Click the **gear** (Settings). You are on **Dashboards**.
2. Click **New Dashboard**.
3. Type a **Name**, for example `Home`.
4. The **URL Path** is filled in with something like `/dashboard-1793124317105`.
   Change it to something you will remember, such as `/home`.
5. Click **Save**.
6. Click the new dashboard in the list to open it. It starts with one empty
   tab called *Home*.

The buttons next to each dashboard in the list let you move it up or down,
rename it (and change its path), export it, show a **QR code** to open it on
your phone, open it in a new browser tab, or delete it. Your first dashboard
in the list is the one `http://<server>:8080/` opens.

### Edit mode

Click the **pencil** in the top bar. It turns into an **Editing** badge and
a toolbar appears under the tabs:

- **Save** (Ctrl+S) and **Discard**: nothing you change is kept until you
  click **Save**. Discard throws away everything since the last save.
- **Undo** (Ctrl+Z) and **Redo** (Ctrl+Shift+Z or Ctrl+Y).
- **Add tile**, **Add folder**, **Add tab**.
- **Dashboard**: the dashboard's own settings (header, background,
  settings).

Click **Editing** again to leave edit mode. Edit mode also switches itself
off after a while with no activity (Settings › Global settings › Editing).

### Add a tile

1. Click **Add tile**.
2. Fill in **Name** (e.g. `Router`) and **URL** (e.g. `http://192.168.1.1`).
   Those are the only required fields.
3. Optional: a **Subtitle/Description**; an **Icon** (click **Edit icon**
   to search the built-in icons or upload your own); a **Background Color**;
   the **Size** (*Small*, *Medium* or *Large*; Medium is the default);
   the **Open Mode** (*New Tab* is the default; also *Same Tab*,
   *iFrame Modal*, *Popup Modal*); and **Status checks**, which show
   whether the service is up.
4. Click **Create**, then **Save**.

**Tile type** at the top also offers **SSH** (opens your computer's SSH
app) and **Note** (text only, no link). **Away address** is for when you are
away from home: once a dashboard has a tile with one, a **Home** / **Away**
button appears in the top bar to switch this browser between the two.

### Add a folder

1. Click **Add folder**, type a **Folder name** (e.g. `Media`).
2. Choose a **Look** (*Folder (flat)* is the default; *Rounded box*,
   *Simple tab* and the other folder styles are there too) and a colour.
3. **Display**: whether it **Starts** *Expanded* or *Collapsed*.
   **Contents size** sets the size of every tile inside it, and
   **Size when minimised** the size of its tile when collapsed.
4. Click **Create**, then **Save**.

To put things in a folder, drag them onto it. To make a new folder from two
tiles, drag one onto the middle of the other and hold it there: the cue
says *Hold to make a folder*, then *Make a folder*. Let go, and the new
folder's settings open. Hold a dragged item over
another tab's name to switch to that tab and drop it there. Right-click inside a folder
(or a tab) for **Add tile here**, **Add folder here** and **Paste here**.
Right-click a tile or folder for **Edit**, **Duplicate**, **Cut**, **Copy**,
**Move/Copy to…**, **Minimise** and **Delete**. Every item also has a small
pencil button that opens its settings.

Resize a folder by dragging its edges (or select it and press
Shift+Arrow keys). Drag items to move them around the grid. Every move
can be undone.

### Add a tab

Click **Add tab**, give it a **Tab Name** (and an icon or colour if you
like), and click **Create**. Drag tabs to reorder them.

### Editing on phones and tablets

On screens 480 pixels wide or narrower (phones), the edit button is hidden:
phones are for viewing. On tablets and other touch screens wider than that,
editing works, but dragging and the larger dialogs are fiddly, so a
computer with a mouse is recommended.

## Step 5: Fill it faster

### Add to HOPS bookmark

On **Settings › Dashboards**, under **Add to HOPS bookmark**, drag the
**Add to HOPS** button to your browser's bookmarks bar. Then, on any
service's web page, click that bookmark: HOPS opens with the page's address,
name and icon filled in. Pick the **Dashboard**, **Tab** and (optionally)
**Folder**, and click **Add**. (Desktop browsers; a few sites block it.)

### Network Discovery

**Settings › Discovery › New Scan** scans your network for services with a
web page (NAS, router, Proxmox, Home Assistant, media servers and many
more). Enter the **Targets to scan** (e.g. `192.168.1.0/24`), choose a
**Scan intensity** (*Light active* is the default), and click
**Start scan**. Each scan is a draft: you tick the results you want and add
them to a dashboard. Nothing is added without you. Results depend on your
network, so expect a few misses and a few false finds. See the
[User Guide](USER_GUIDE.md#network-discovery) for more.

### Icons

HOPS comes with thousands of icons that work with no internet connection.
Search them, or upload your own (PNG, JPG, GIF, WebP or SVG), under
**Settings › Icons**, or from a tile's **Edit icon** button.

## Step 6: Keep it safe

HOPS backs up its database by itself: when it starts, before every save,
before a restore or factory reset, and before an upgrade.

On **Settings › Backups** you can:

- **Create Backup** at any time.
- **Download** a backup (the download includes the images it uses). Keep a
  copy somewhere other than the HOPS machine.
- **Upload a backup**, and **Restore** one. Restoring takes a safety backup
  first, then restarts HOPS.
- **Clean up now**: it shows exactly what it would delete first.

By default HOPS keeps the newest 10 automatic backups. To change that, click
**Change** on the Backups page (it opens Settings › Global settings ›
Server: **Keep the newest backups**, **Also keep backups newer than (days)**
and **Most backups kept**). Backups you create or upload, and the one taken
before an upgrade from v2, are never deleted automatically.

If a backup ever fails, HOPS shows a warning in Settings until one succeeds.

## Change the port

HOPS listens on port 8080. To use another port:

1. **Settings › Global settings › Server › Port**: type the new port and
   click **Save**. It is marked **Restart required**.
2. Restart HOPS: `sudo systemctl restart hops` for the installer and Proxmox
   options; stop and start it again for Option B; for Docker, change the
   `ports:` line instead (see [Customising the Port](DEPLOY.md#customising-the-port)).
3. Open HOPS on the new port.

If you used the installer, pass the new port when you next upgrade, so its
health check looks in the right place:
`curl -fsSL https://github.com/weaversgrainthorpe/HOPS/releases/latest/download/install.sh | sudo bash -s -- --port 8181`
(it also finds the port by itself if HOPS was last running on it).

## Upgrading

- **Installer or Proxmox:** run the Option A command again (inside the
  container for Proxmox: `pct enter <ID>` first). It keeps the previous
  version and puts it back if the new one does not start properly.
- **Downloaded file:** stop HOPS, replace the file, start it again with the
  same `--data` folder.
- **Docker:** `docker compose pull && docker compose up -d`.

**From HOPS 2.x:** HOPS 3 converts your 2.x dashboards automatically the
first time it starts. Just before it does, it takes a protected backup
(`hops-backup-<date>_pre-v3-migration.db`) that is never deleted
automatically; it is your way back to 2.x. If you installed 2.x as a service
yourself, the installer will not take it over; see
[Upgrading from v2 with install.sh](DEPLOY.md#upgrading-from-v2-with-installsh)
and [Rolling back from 3.x to 2.2.1](DEPLOY.md#rolling-back-from-3x-to-221).

## Where next

- **[User Guide](USER_GUIDE.md)**: everything HOPS does, in detail.
- **[Installation & Deployment Guide](DEPLOY.md)**: services, reverse
  proxies, HTTPS, backups and security.
