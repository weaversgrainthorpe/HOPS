# HOPS - Home Operations Portal System

**Version 3.0.0** · **[weaversgrainthorpe.github.io/HOPS →](https://weaversgrainthorpe.github.io/HOPS/)**

HOPS is a self-hosted homepage dashboard for your homelab: one page (or
several) of tiles that open your router, NAS, Proxmox, media server and
everything else you run. You build it by clicking and dragging in the
browser. There are no config files to write.

It's one program with its own database (SQLite) and web interface built in.
Download it, run it, open it in a browser. It runs on a Raspberry Pi, a spare
PC, a VM or container, Docker, or Windows.

![HOPS demo](docs/screenshots/demo.gif)

**New to HOPS?** Follow **[Zero to Dashboard Hero](QUICKSTART.md)**: install,
sign in, tour the Sample dashboard and build your first one in about 10
minutes.

## Why another dashboard?

Yes, there are already plenty of homelab dashboards: Homer, Dashy, Heimdall,
Homepage, Organizr, Homarr, and more. If you're using one and happy with it,
stick with it. Seriously.

I created HOPS because none of them matched what I wanted:

- **100% GUI editing.** Click, drag, and configure everything in the
  browser. No YAML. No JSON. No "simple" config files that inevitably become
  not-so-simple. Even the server settings (port, log level, backups, rate
  limits) are set on the Settings page. If you enjoy hand-crafting config
  files, HOPS isn't for you.
- **One file.** A single binary plus a SQLite database. No runtime, no
  dependencies. Docker works too if that's your thing.
- **Power without complexity.** Multiple dashboards, tabs, folders inside
  folders, backgrounds, themes, status checks, and a network scan that adds
  the services you already run. All through the UI.

HOPS won't be for everyone. That's fine. But if you've been frustrated
editing YAML indentation at 11pm, or wished you could just *click* to add a
new bookmark, give it a try. Already on Homer, Dashy or Heimdall? HOPS can
import your existing setup, so trying it doesn't mean starting over.

## What's new in v3

HOPS 3 is a big rework of how dashboards are laid out and edited.

- **Folders, and folders inside folders.** Tiles and folders sit anywhere on
  each tab's grid, in three sizes. A folder can hold tiles, other folders,
  or both. Folders page when they're full, can start minimised, and come in
  seven **Look**s: Rounded box, Simple tab, and five folder shapes, with the
  tab on the left, centre or right.
- **A new drag-and-drop editor.** Drag tiles and folders around, drop a
  tile on another and hold to make a folder, or drag onto a tab's name to
  move it there. Ctrl-click to select several. Right-click for **Edit**,
  **Duplicate**, **Cut**, **Copy**, **Move/Copy to…** and more, and paste
  across tabs and dashboards. **Undo** and **Redo** step back through every
  change, and nothing is kept until you click **Save**.
- **Home and away addresses.** A tile can have an **Away address** for when
  you're out (Tailscale, VPN or a public address). A **Home** / **Away**
  button in the top bar picks which one tiles open, per browser.
- **Your view, your browser.** Minimised folders, folder pages, Home/Away,
  theme, text size and the optional **Recently used** row are remembered
  by each browser, so your phone and your desktop can differ, and nobody
  else's view changes.
- **Status checks you can control at every level.** Each tile, folder and
  tab can be **Inherit**, **On** or **Off**, and the nearest setting wins
  (tile, folder, tab, dashboard, then the global default). Checks accept
  self-signed HTTPS and count a login prompt as up. **Settings › Dashboards ›
  Status check overrides** lists everything that sets its own value and
  restores inheritance in bulk.
- **Add to HOPS.** Drag a bookmark to your browser's bar. On any service's
  page, click it, and HOPS opens with the address, name and icon filled in.
- **Dead links and duplicates.** One page lists tiles whose status check has
  been failing for a while; another finds tiles that point at the same
  address and merges them on your say-so.
- **Network Discovery** finds 90+ common homelab services, now including
  AI tools, and a re-scan shows what's new, changed and gone since the last
  one.
- **Backgrounds everywhere.** A picture, colour or slideshow behind the
  dashboard, behind each tab, or inside a folder.
- **SSH tiles.** Give a host, port and user. Clicking opens your computer's
  SSH app, and the status check is a TCP connect.
- **Note tiles** for headings, reminders and scratchpad text.
- **Imports** from Dashy, Homer and Heimdall, with a list of anything HOPS
  couldn't bring across.
- **Backups with retention.** HOPS backs itself up when it starts, before
  every save, and before a restore, reset or upgrade. You choose how many to
  keep. A backup download includes its images. Restoring takes a safety
  backup first, then HOPS restarts itself.
- **Automatic upgrade from v2.** See [Upgrading from HOPS 2](#upgrading-from-hops-2).
- **New ways to install:** a one-line Linux installer and a Proxmox VE
  container script.

## Screenshots

<table>
  <tr>
    <td width="33%" valign="top">
      <a href="docs/screenshots/dashboard-hero.png"><img src="docs/screenshots/dashboard-hero.png" alt="The Sample dashboard on a desktop" /></a>
      <p align="center"><sub><b>Dashboard</b>: tiles and folders on a tab, with a background picture</sub></p>
    </td>
    <td width="33%" valign="top">
      <a href="docs/screenshots/folders.png"><img src="docs/screenshots/folders.png" alt="Open folders, folders inside folders, and folder shapes" /></a>
      <p align="center"><sub><b>Folders</b>: open, nested, and in seven looks</sub></p>
    </td>
    <td width="33%" valign="top">
      <a href="docs/screenshots/edit-mode.png"><img src="docs/screenshots/edit-mode.png" alt="Edit mode with the editing toolbar and a selection" /></a>
      <p align="center"><sub><b>Edit mode</b>: drag and drop, undo and redo, save when you're done</sub></p>
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <a href="docs/screenshots/edit-tile.png"><img src="docs/screenshots/edit-tile.png" alt="The tile dialog" /></a>
      <p align="center"><sub><b>Tile dialog</b>: every option in one place, nothing hidden in config files</sub></p>
    </td>
    <td width="33%" valign="top">
      <a href="docs/screenshots/icon-picker.png"><img src="docs/screenshots/icon-picker.png" alt="Icon picker" /></a>
      <p align="center"><sub><b>Icon picker</b>: thousands of icons that work offline, or upload your own</sub></p>
    </td>
    <td width="33%" valign="top">
      <a href="docs/screenshots/mobile.png"><img src="docs/screenshots/mobile.png" alt="A dashboard on a phone" /></a>
      <p align="center"><sub><b>Phone</b>: the same dashboard, sized for a small screen</sub></p>
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <a href="docs/screenshots/settings.png"><img src="docs/screenshots/settings.png" alt="The Settings page" /></a>
      <p align="center"><sub><b>Settings</b>: dashboards, backups and every server setting, in the GUI</sub></p>
    </td>
    <td width="33%" valign="top">
      <a href="docs/screenshots/qr.png"><img src="docs/screenshots/qr.png" alt="A dashboard's QR code" /></a>
      <p align="center"><sub><b>QR codes</b>: open any dashboard on a phone, no typing</sub></p>
    </td>
    <td width="33%" valign="top">
      <a href="docs/screenshots/discovery.png"><img src="docs/screenshots/discovery.png" alt="Network Discovery results" /></a>
      <p align="center"><sub><b>Network Discovery</b>: find what's already running, tick what you want</sub></p>
    </td>
  </tr>
</table>

## Install

Pick one. **[Zero to Dashboard Hero](QUICKSTART.md)** walks through each
option step by step, and the
**[Installation & Deployment Guide](DEPLOY.md)** has every detail.

**One-line installer** (Linux with systemd: Debian, Ubuntu, Raspberry Pi OS,
a Proxmox container). Installs HOPS as a service that starts on boot. Run it
again to upgrade; if the new version doesn't start, it puts the old one back.

```bash
curl -fsSL https://github.com/weaversgrainthorpe/HOPS/releases/latest/download/install.sh | sudo bash
```

**Proxmox VE container.** In the Proxmox host shell, this creates a small
Debian 12 container and installs HOPS in it:

```bash
curl -fsSLO https://github.com/weaversgrainthorpe/HOPS/releases/latest/download/hops-proxmox.sh
bash hops-proxmox.sh
```

**Docker** (x86-64 and 64-bit ARM). Use the
[`docker-compose.yml`](docker-compose.yml) in this repo, or the one in the
Quick Start, then:

```bash
docker compose up -d
```

**Single binary** (Linux, macOS). Download one file and run it:

```bash
curl -LO https://github.com/weaversgrainthorpe/HOPS/releases/latest/download/hops-linux-amd64
chmod +x hops-linux-amd64
mkdir -p data
./hops-linux-amd64 --data ./data
```

**Windows** (PowerShell). The same single file; to run it as a service, see
[Windows (NSSM)](DEPLOY.md#windows-nssm).

```powershell
curl.exe -LO https://github.com/weaversgrainthorpe/HOPS/releases/latest/download/hops-windows-amd64.exe
mkdir data
.\hops-windows-amd64.exe --data .\data
```

Then open `http://<your-server>:8080` and sign in with `admin` / `admin`.
HOPS makes you choose a new password straight away.

### Platforms

| You have | Download |
|----------|----------|
| Linux, x86-64 | `hops-linux-amd64` |
| 64-bit ARM: Raspberry Pi 3, 4, 5 or Zero 2 W with a **64-bit** OS, and other ARM64 boards | `hops-linux-arm64` |
| macOS (Intel / Apple Silicon) | `hops-darwin-amd64` / `hops-darwin-arm64` |
| Windows, x86-64 | `hops-windows-amd64.exe` |

- HOPS needs a **64-bit** OS. 32-bit systems aren't supported, and the
  installer refuses them. The original Pi Zero / Zero W can't run a 64-bit
  OS; the smallest Pi HOPS runs on is a Zero 2 W with 64-bit Raspberry Pi OS.
- Linux (x86-64) and Windows are tested on real machines.
- **Not yet tried on real hardware:** the Raspberry Pi / ARM64 build (run
  under emulation only) and the macOS builds. If you try one, please
  [tell us how it went](https://github.com/weaversgrainthorpe/HOPS/issues).

### Upgrading from HOPS 2

It's automatic. Install v3 over v2 with the same data folder and start it.
On its first start, HOPS 3 takes a protected backup of the whole v2 database
(`hops-backup-<date>_pre-v3-migration.db`) before it converts anything. If
that backup fails, it doesn't convert. The backup is never deleted
automatically, and it's your way back to 2.2.1. Tiles keep the status checks
they had in v2, and a one-time notice points you to the overrides page if
you'd rather they inherit.

You don't need to export and import. See [Upgrading](QUICKSTART.md#upgrading),
[Upgrading from v2 with install.sh](DEPLOY.md#upgrading-from-v2-with-installsh)
and [Rolling back from 3.x to 2.2.1](DEPLOY.md#rolling-back-from-3x-to-221).

## Features

### Layout and editing
- Multiple dashboards, each at its own address (`/home`, `/network`,
  `/media`); a new dashboard's path follows its name
- Tabs on each dashboard; tiles and folders on each tab's grid, in Small,
  Medium and Large
- Folders inside folders (up to 12 levels), paging when full, minimisable,
  in seven looks with their own colours, text colour and **Contents size**
- Drag and drop for tabs, folders and tiles; hold a tile over another to make
  a folder; resize folders by their edges
- Select several with Ctrl-click; copy, cut and paste, and **Move or copy
  to…** any dashboard, tab or folder
- Right-click menus on tiles, folders, tabs and the empty space inside them
- Undo / redo; edits are a draft until you click **Save**
- Edit mode switches itself off after a while with no activity, and never
  throws away unsaved changes
- Search (`/`) finds tiles and folders at any depth on the dashboard you're
  viewing, and can show you where each one lives
- Arrow-key navigation between tiles

### Tiles
- **Link** (opens a URL), **SSH** (opens your SSH app) and **Note** (text
  only) tile types
- Open modes: New Tab, Same Tab, iFrame Modal, Popup Modal
- **Address** and optional **Away address**, with a per-browser Home / Away
  switch
- Status badge with response time; Inherit / On / Off at every level
- Subtitles, custom colours, and separate background, text and icon opacity

### Look
- 8 theme presets with Dark, Light and Auto modes, and four text sizes, chosen
  per browser
- Backgrounds on the dashboard, each tab and each folder: a colour, a
  picture, or a slideshow with 18 transition effects
- About 90 built-in background pictures that work offline, or upload your own
- About 2,300 bundled service icons (Dashboard Icons), Iconify icons by name,
  and your own uploads; **Settings › Icons** shows where each upload is used
- Optional animations for drops and folder moves (On / Always / Off)
- Header with your own text and title

### Network Discovery
- **Scan your network**: an IP range (`192.168.1.0/24`, `192.168.1.1-50`,
  single addresses, or a mix). Skip anything with a `!` prefix
- **Recognises 90+ common homelab services** out of the box: Pi-hole, Plex,
  Proxmox, Home Assistant, the *arr apps, UniFi, OPNsense/pfSense, TrueNAS,
  Synology, Vaultwarden, Immich, Grafana, Traefik, AI tools such as Open
  WebUI and ComfyUI, and many more
- **Three intensities**: *Passive only* listens for services that announce
  themselves (mDNS, UPnP) and asks your DNS, the ARP cache and SNMP without
  probing web ports. *Light active* (the default) checks about 65 ports.
  *Full active* sweeps about 115
- **Knows about subdomains**: give it your internal domain and it tries
  common names, so services behind a reverse proxy aren't missed
- **Review before adding**: every scan is a draft. Tick what you want, edit
  names, addresses and icons, and HOPS files them into sensible folders
- **Re-scans show the difference**: what's new, changed and gone since last
  time
- **Add or tweak the recognisers yourself**, in the GUI. **Diagnostics**
  lists what HOPS saw but couldn't name, and turns one into a new detector

> **A reality check.** Discovery is a head start, not magic. What it finds
> depends on your network (Wi-Fi vs wired, guest networks that isolate
> devices), what's blocking it (firewalls, antivirus, services that only
> answer on localhost), and whether each service answers polite "are you
> there?" questions at all. Expect a few false matches and a few misses.
> That's why every scan is a **draft**, and nothing lands on your dashboard
> until you accept it. It also sees less from inside Docker; see
> [Network Discovery on Docker](DEPLOY.md#network-discovery-on-docker--important).

### Settings (signed in)
- Create, reorder, rename, export and delete dashboards; a **QR code** for
  each
- **Add to HOPS** bookmark, **Dead links**, **Duplicates** and **Status check
  overrides**
- Import from Homer, Dashy, Heimdall and HOPS exports; exports carry their
  uploaded icons and backgrounds
- **Backups**: create, download, upload, restore and clean up, with
  retention rules. A failed backup shows a warning until one succeeds
- **Global settings**: every server setting, grouped, each with its default
- **Logs**, **Password** and **Factory reset** (which backs up first)

### Phones and tablets
- Responsive layout for phones and tablets
- Add HOPS to your phone's home screen; over HTTPS it opens full screen like
  an app
- Editing is hidden on phones (480 pixels wide or less). Tablets can edit,
  though a mouse is easier

### Security
- No login to view; one admin login to edit and change settings
- Bcrypt password hashing, forced change of the default password on first
  sign-in
- HttpOnly session cookies and CSRF protection
- Login rate limiting per IP (20 a minute by default)
- Browser security headers, checked uploads, and hardened outbound requests
  for status checks and discovery

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Keyboard shortcuts

| Shortcut | Action | Mode |
|----------|--------|------|
| `/` | Search this dashboard | Viewing |
| `↑ ↓ ← →` | Move between tiles | Viewing |
| `Enter` | Open the highlighted tile | Viewing |
| `Escape` | Close a dialog or search | Anywhere |
| `Ctrl+S` | Save the draft | Edit |
| `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y` | Undo / redo | Edit |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste | Edit |
| `Delete` | Delete what's selected (asks first) | Edit |
| `Shift+Arrow` | Resize the selected folder | Edit |
| `Ctrl+Enter` | Save and close a dialog | Edit |

## Tech stack

- **Frontend**: SvelteKit 2 + Svelte 5 + TypeScript, built into the binary
- **Backend**: Go (pure Go, no CGO)
- **Database**: SQLite (modernc.org/sqlite)
- **Icons**: Dashboard Icons (homarr-labs) and Iconify; the icons the UI uses
  are bundled for offline use
- **Drag and drop**: HOPS's own

## Documentation

- **[Zero to Dashboard Hero](QUICKSTART.md)**: install and build your first
  dashboard
- **[User Guide](USER_GUIDE.md)**: full feature reference
- **[Installation & Deployment Guide](DEPLOY.md)**: services, reverse
  proxies, HTTPS, backups and security
- **[Changelog](CHANGELOG.md)**: what changed in each release
- **[Roadmap](ROADMAP.md)**: ideas under consideration. Nothing on it is
  promised; HOPS is maintained in spare time

## Tips

- Signed in, **Help** in the top bar lists the keyboard shortcuts
- Triple-click the HOPS logo while editing for a surprise
- The classics never go out of style: try the Konami code

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for
development setup and guidelines.

**Found a bug or have an idea?** Please report it via
[GitHub Issues](https://github.com/weaversgrainthorpe/HOPS/issues). I
maintain this project in my limited spare time, so while I'll do my best to
review all feedback, I can't promise when (or if) I'll get to it. Your
patience is appreciated!

**Security issues?** See [SECURITY.md](SECURITY.md) for responsible
disclosure. Please don't open public issues for vulnerabilities.

## License

MIT
