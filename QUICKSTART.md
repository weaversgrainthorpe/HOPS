# Zero to Dashboard Hero

Get HOPS running, sign in, build your first dashboard, then make it yours.
No experience needed. This is a guided walk through the basics; the
[User Guide](USER_GUIDE.md) has every detail when you want it.

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
| macOS (Intel) | `hops-darwin-amd64` |
| macOS (Apple Silicon) | `hops-darwin-arm64` |
| Windows (x86-64) | `hops-windows-amd64.exe` |

HOPS needs a **64-bit** OS: on a Pi, `getconf LONG_BIT` should say `64`.
The original Pi Zero / Zero W can't run one, so it isn't supported.

## Step 1: Install HOPS

Pick one. The [Installation & Deployment Guide](DEPLOY.md) has the details
for each, plus services, reverse proxies and HTTPS.

### Option A: One-line installer (Linux, Raspberry Pi)

For Linux machines with systemd: Debian, Ubuntu, Raspberry Pi OS, a Proxmox
container. It installs HOPS as a service that starts on boot.

```bash
curl -fsSL https://github.com/weaversgrainthorpe/HOPS/releases/latest/download/install.sh | sudo bash
```

It picks the right download, checks it, starts HOPS and prints the address
to open, for example `http://192.168.1.20:8080`. If anything goes wrong it
stops and says what. More: [Linux install script](DEPLOY.md#linux-install-script-installsh).

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
`msg="server starting" version="HOPS v3.1.0" addr=:8080` when it is ready.
To run it as a service, see [Binary download](DEPLOY.md#binary-download).

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

Then run `docker compose up -d`. Your data lives in the `hops-data` volume.
(Network Discovery sees less from inside Docker; see
[Network Discovery on Docker](DEPLOY.md#network-discovery-on-docker--important).)

### Option D: Proxmox VE container

In the **Proxmox host shell** (the node's Shell in the Proxmox web UI, or SSH
to the host as root):

```bash
curl -fsSLO https://github.com/weaversgrainthorpe/HOPS/releases/latest/download/hops-proxmox.sh
bash hops-proxmox.sh
```

It asks a few questions, creates a small Debian container, installs HOPS in
it with the installer from Option A, and prints the address to open. More:
[Proxmox container](DEPLOY.md#proxmox-container-hops-proxmoxsh).

## Step 2: Sign in and look around

1. Open **http://\<your-server-address\>:8080** in a browser (on the same
   machine: **http://localhost:8080**). You land on the **Sample**
   dashboard. Anyone on your network can view dashboards; you only sign in
   to change things.
2. Click the **pencil** in the top bar (*Sign in to edit this dashboard*),
   or the **gear** (Settings).
3. Sign in with username `admin` and password `admin`.
4. HOPS asks you to **Set a new password** straight away. Type `admin` as
   the current password, then your new one twice (8 to 72 characters), and
   click **Set password**. The eye button in each box shows what you typed.

Forgot it later? The sign-in dialog's **Forgot password?** shows how to
reset it; see [Password and sessions](USER_GUIDE.md#password-and-sessions).

**The Sample** shows what HOPS can do. Its addresses are made up
(`*.example.lan`), so the tiles don't go anywhere. Click through its three
tabs:

- **Home**: tiles in all three sizes, and folders. *Monitoring*,
  *Databases* and *Cloud* start **minimised**: each is a single folder tile
  until you click it.
- **Folders**: folders inside folders, up to *Projects › Lab › Dashboards*.
- **Shapes**: every folder **Look**, from a rounded box to a cartoon folder.

Hover over a tile to see its name and description. Try **Search** (or press
`/`), the two **A** buttons for text size, and **Theme settings**. When you're
done with the Sample, delete it from **Settings › Dashboards**, or keep it
to look back at.

## Step 3: Build your first dashboard

HOPS is organised like this:

```
Dashboard        one page with its own path, e.g. /home
└── Tab          the row of tabs across the top
    ├── Tile     a link to one of your services
    └── Folder   a box with a title, holding tiles, other folders, or both
```

### Create the dashboard

1. Click the **gear** (Settings). You are on **Dashboards**.
2. Click **New dashboard** and type a **Name**, for example `Home`. The
   **URL path** fills itself in (`/home`).
3. Click **Save**, then click the new dashboard in the list to open it. It
   starts with one empty tab called *Home*.

### Enter edit mode

Click the **pencil** in the top bar. It turns into an **Editing** badge and
a toolbar appears at the bottom of the screen: **Add tile**, **Add
folder**, **Add tab** and **Dashboard** on the left; **Undo**, **Redo**,
**Discard** and **Save** on the right.

### Add three tiles

1. Click **Add tile**. Leave **Tile type** on **Link**.
2. Type a **Name**, `Router`, and an **Address**, `http://192.168.1.1`.
   Those are the only required fields. Add a **Description** and an icon
   (**Edit icon**, then type a name such as `mdi:router`) if you like.
3. Click **Create**.

Add two more the same way: `NAS` (`http://192.168.1.10`) and `Media
server` (`http://192.168.1.10:32400`). The addresses don't need to work
yet.

### Make a folder, two ways

**Drag one tile onto another.** Drag *NAS* onto the middle of *Media
server* and hold it there for half a second. The cue says *Hold to make a
folder*, then *Make a folder*. Let go: the two tiles become a folder and its
dialog opens. Name it `Storage` and click **Save**.

**Use the toolbar.** Click **Add folder**, type a **Name**, `Network`, and
click **Create**. Then drag *Router* onto the *Network* folder: the cue says
*Into "Network"*. Let go, and the tile is inside.

### Add a tab

Click **Add tab**, give it a **Name** (and an icon or colour if you like),
and click **Create**. Drag tabs by their names to reorder them. Some people
give each area its own tab; others keep one tab and use folders. There is
no right answer.

### Save

While you edit, you are changing a draft. Nobody else sees it, and nothing
is kept until you click **Save** in the toolbar. A dialog's **Create** or
**Save** only puts that change into your draft, and the toolbar then shows
*Unsaved changes*. **Undo** (Ctrl+Z) takes back one step at a time, and
**Discard** throws away everything since the last save. Click **Save** now,
then **Editing** to leave edit mode.

Phones are for viewing: at 480 pixels wide or narrower, the edit button is
hidden. Tablets can edit, though a mouse is easier.

More: [The editor](USER_GUIDE.md#the-editor), [Tiles](USER_GUIDE.md#tiles)
and [Folders](USER_GUIDE.md#folders).

## Step 4: Make it yours

### Theme and text size

**Theme settings** (in the top bar) has a **Brightness mode** (*Dark*,
*Light* or *Auto*) and eight looks under **Theme preset**. Click **Apply
theme**. The two **A** buttons make the text smaller or larger. Both are
kept in this browser, so each person and device can choose their own.

### A background picture

In edit mode, click **Dashboard** in the toolbar and open **Background**.
Turn on **Show background picture**, choose **Image** as the **Background
type**, and click a picture in the **Image gallery** (or **Upload** your
own). Click **Save** in the dialog, then **Save** in the toolbar. Tabs and
folders can have their own pictures too; see
[Backgrounds](USER_GUIDE.md#backgrounds).

### Text colour

Give a tile or a tab a **Colour** in its dialog. **Text colour** stays on
*Auto*, which picks black or white, whichever is easier to read. Choose
*Light* or *Dark* to fix it; HOPS warns you if that would be hard to read.
More: [Text colour](USER_GUIDE.md#text-colour).

## Step 5: Fill it faster

### Add to HOPS bookmark

On **Settings › Dashboards**, drag the **Add to HOPS** button to your
browser's bookmarks bar. On any service's web page, click it: HOPS opens
with the page's name, address and icon filled in, and you pick where it
goes. More: [Add to HOPS bookmark](USER_GUIDE.md#add-to-hops-bookmark).

### Network Discovery

**Settings › Discovery › New scan** looks for services with a web page on
your network. Enter the **Targets to scan** (for example `192.168.1.0/24`)
and click **Start scan**. Each scan is a draft: you tick the
results you want and add them to a dashboard. Expect a few misses and a few
false finds. More: [Network Discovery](USER_GUIDE.md#network-discovery).

### Import from Homer, Dashy or Heimdall

On **Settings › Dashboards**, click **Import**, then **Select file**. HOPS
reads Homer and Dashy YAML, Heimdall JSON, and HOPS's own exports. Moving
from another HOPS? Click **Export all** there and import the file here.
HOPS lists the dashboards in the file first, and you choose **Replace**,
**Keep both** or **Skip** for each one with a name you already have.
Nothing changes until you click **Import**. More: [Import and
export](USER_GUIDE.md#import-and-export).

## Step 6: On your phone

- **QR code**: on **Settings › Dashboards**, click a dashboard's QR button
  (*Show QR code (scan with phone)*) and scan it with the phone's camera.
- **Android**: in Chrome, tap the **⋮** menu, then **Add to Home screen**
  (or **Install app**).
- **iPhone or iPad**: in Safari (it must be Safari), tap **Share**, then
  **Add to Home Screen**.

Over `https://`, HOPS installs as a full-screen app and keeps an offline
copy, so your dashboards still open when the server is down. Over plain
`http://`, it's a home-screen shortcut with no offline copy. More: [Open
HOPS like an app](USER_GUIDE.md#open-hops-like-an-app) and [When HOPS can't
be reached](USER_GUIDE.md#when-hops-cant-be-reached).

## Step 7: Keep it safe

HOPS backs itself up: when it starts, before every save, before a restore
and before a factory reset. You'll find the backups on **Settings ›
Backups**, where you can also **Create backup**, **Download** one to keep
somewhere else, and **Restore**. Unlike an export, a backup holds the whole
app. More: [Backups](USER_GUIDE.md#backups).

## Where next

You can also:

- open other addresses when you're out: [Home and away](USER_GUIDE.md#home-and-away);
- see which services are up: [Status checks](USER_GUIDE.md#status-checks);
- nest folders: [Folders inside folders](USER_GUIDE.md#folders-inside-folders);
- choose folder looks: [The folder dialog](USER_GUIDE.md#the-folder-dialog);
- move dashboards between installs: [Import and export](USER_GUIDE.md#import-and-export);
- tidy up: [Dead links and duplicates](USER_GUIDE.md#dead-links-and-duplicates);
- find anything fast: [Search](USER_GUIDE.md#search) and [Keyboard shortcuts](USER_GUIDE.md#keyboard-shortcuts);
- pick, upload and manage icons: [Icons in HOPS](ICON_MANAGEMENT.md);
- hide the edit buttons from visitors, and more: [Global settings](USER_GUIDE.md#global-settings);
- change the port: [Changing the port](USER_GUIDE.md#changing-the-port);
- run HOPS as a service, behind a proxy, with HTTPS: [Installation & Deployment Guide](DEPLOY.md).

## Upgrading

Run the same install again: the installer command, a new download with the
same `--data` folder, or `docker compose pull && docker compose up -d`.
Coming from HOPS 2? HOPS 3 converts your dashboards by itself, after a
protected backup. See [Upgrading](DEPLOY.md#upgrading) and [Upgrading from
HOPS 2](USER_GUIDE.md#upgrading-from-hops-2).
