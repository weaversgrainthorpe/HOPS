# Zero to Dashboard Hero

Get HOPS running, sign in, look around the Sample, build your first
dashboard, then make it yours. No experience needed.

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

HOPS needs a **64-bit** OS. Not sure which Pi OS you have? Run
`getconf LONG_BIT` on the Pi: `64` is fine; `32` means you need to install
the 64-bit Raspberry Pi OS first. The original Pi Zero / Zero W can't run a
64-bit OS, so it isn't supported.

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
(`*.example.lan`), so the tiles don't go anywhere real. It has a background
picture, and three tabs across the top:

- **Home**: tiles in all three sizes (Small, Medium, Large) placed straight
  on the tab, and folders. *Media* holds a folder inside a folder (*More to
  watch*). *Monitoring*, *Databases* and *Cloud* start **minimised**: each
  shows as a single folder tile (in three sizes) until you click it.
- **Folders**: folders inside folders. *Projects › Lab › Dashboards* goes
  three deep. The minimise button on a folder's title bar shrinks it to a
  folder tile; click that tile to open it again. Each browser remembers
  what its viewer minimised.
- **Shapes**: every folder **Look**: Rounded box, Simple tab, and the folder
  styles (flat, with paper, outlined, cartoon, open flap), with the folder's
  tab on the left, in the centre or on the right. *Upstairs* nests shapes
  inside shapes.

Other things in the top bar: **Search** (or press `/`) finds tiles and
folders on the dashboard you are looking at; the two **A** buttons change
text size; **Theme Settings** picks light, dark and colour themes; **Help**
(once signed in) lists keyboard shortcuts; **About HOPS** (once signed in)
shows the version and a list of features. Step 8 covers these in more
detail.

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
4. The **URL Path** fills itself in from the name as you type (`Home` becomes
   `/home`). You can change it if you'd like a different address.
5. Click **Save**.
6. Click the new dashboard in the list to open it. It starts with one empty
   tab called *Home*.

The buttons next to each dashboard in the list let you move it up or down,
rename it (and change its path), export it, show a **QR code** to open it on
your phone, open it in a new browser tab, or delete it. Your first dashboard
in the list is the one `http://<server>:8080/` opens.

### Edit mode

Click the **pencil** in the top bar. It turns into an **Editing** badge and
a toolbar appears, pinned to the bottom of the screen:

- **Save** (Ctrl+S) and **Discard**.
- **Undo** (Ctrl+Z) and **Redo** (Ctrl+Shift+Z or Ctrl+Y).
- **Add tile**, **Add folder**, **Add tab**.
- **Dashboard**: the dashboard's own settings, in three parts: **Header**,
  **Background** and **Settings**.

Click **Editing** again to leave edit mode.

### Saving, and what "unsaved" means

While you edit, you are changing a draft. Nobody else sees it, and nothing
is kept until you click **Save** in the toolbar.

- In a tile, folder or tab dialog, **Create** or **Save** puts that change
  into your draft; **Cancel** throws away just that dialog's changes. The
  toolbar then shows **Unsaved changes**.
- **Save** in the toolbar stores the whole draft. A *Changes saved*
  message tells you it worked.
- **Discard** throws away everything since the last save. It asks first
  (*Discard changes?*), and **Keep editing** backs out.
- **Undo** and **Redo** step through your changes one at a time: a drag, a
  resize, a delete, or everything you changed in one dialog.
- If you leave edit mode with unsaved changes, HOPS asks: **Save**,
  **Discard**, or **Keep editing**. Closing or reloading the page makes your
  browser ask before you lose them.

Edit mode switches itself off after 15 minutes with no activity (change it
under Settings › Global settings › Editing: **Edit mode times out after
(minutes)**; 0 turns it off). With unsaved changes it never throws them
away: it asks Save, Discard or Keep editing, and waits.

### Add a tile

1. Click **Add tile**.
2. Fill in **Name** (e.g. `Router`) and **URL** (e.g. `http://192.168.1.1`).
   Those are the only required fields.
3. Optional: a **Subtitle/Description**, an **Icon** (click **Edit icon**
   to search the built-in icons or upload your own), and the **Size**.
   Step 5 covers the rest.
4. Click **Create**, then **Save**.

### Add a folder

1. Click **Add folder**, type a **Folder name** (e.g. `Media`).
2. Choose a **Look** (*Folder (flat)* is the default) and a colour.
3. Click **Create**, then **Save**.

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
like), and click **Create**. Drag tabs to reorder them. To change a tab
later, click the pencil next to its name (or right-click it): the **Edit
Tab** dialog also has **Duplicate** and **Delete**.

### Editing on phones and tablets

On screens 480 pixels wide or narrower (phones), the edit button is hidden:
phones are for viewing. On tablets and other touch screens wider than that,
editing works, but dragging and the larger dialogs are fiddly, so a
computer with a mouse is recommended.

## Step 5: Tiles and folders in depth

Everything here is in the item's dialog: in edit mode, click the item's pencil (or right-click › **Edit**).

### Tile types

**Tile type**, at the top of the tile dialog, has three choices:

- **Link — opens a URL when clicked**: the usual tile.
- **SSH — opens your computer's SSH app**: give a **Host** (and optionally
  a **Port** and **User**). On Windows you may need to set up an SSH app
  first, such as PuTTY or Windows Terminal.
- **Note — text only, no link**: a heading and some **Body text**. Handy
  for reminders, such as which port a service uses.

### Size, colour and icon

- **Size**: *Small*, *Medium* (the default) or *Large*. Inside a folder,
  a tile is shown at the folder's **Contents size** instead (see below).
- **Background Color**: pick a swatch, any colour, or *None* to use the
  theme's colour.
- **Background opacity**, **Text opacity** and **Icon opacity**: fade each
  part on its own. Lower lets the background picture show through.
- **Edit icon**: type a name for suggestions, browse the icon library,
  upload your own, and set an **Icon background**. Click **Done**.

### How a tile opens

**Open Mode** decides what a click does:

- **New Tab** (the default): opens the address in a new browser tab.
- **Same Tab**: replaces HOPS with the service.
- **iFrame Modal**: shows the service in a window on top of HOPS. Some
  sites refuse to be shown this way; use New Tab for those.
- **Popup Modal**: asks first, with **Open in New Tab** and **Open in Same
  Tab** buttons.

SSH tiles always open your SSH app, so they have no Open Mode choice.

### Status checks

A status check asks the service now and then whether it is up, and shows a
small badge on the tile. Hover over it for *Online* (with the response
time), *Offline* or *Error*.

The check asks whether the service is reachable and answering, not whether
its certificate is trusted, so self-signed HTTPS (Proxmox, UniFi, TrueNAS
and the like) counts. A service that answers with a login prompt (HTTP 401
or 403) is *Online*. *Error* means it answered with another 4xx code such as
404 (often a wrong path); *Offline* means it couldn't be reached or answered
with a 5xx server error.

Each tile, folder and tab has a **Status checks** row with **Inherit**,
**On** and **Off**. In plain words:

- A new tile starts **Off**: checks only run where you turn them on.
- Choose **On** to check that tile. Choose **Inherit** to let it follow the
  folder, tab or dashboard it is in.
- A folder or tab set to **On** or **Off** decides for every tile inside
  it that is set to **Inherit**. The nearest setting wins: the tile's own,
  then its folder, then the tab, then the dashboard.
- The dashboard's setting is in **Dashboard › Settings**: tick **Override
  for this dashboard** to set it, or leave it to follow the global
  **Status checks** setting (Settings › Global settings › Status checks).
  That global switch is on by default; turn it off and no checks run at all.

The line under the choices always says what is in effect and where it comes
from, for example *Inherited from the tab: on*. **Reset to inherit** puts a
row back to Inherit. How often checks run is under Settings › Global
settings › Status checks (**Check every (minutes)**, 5 by default).

### Home and away addresses

At home you might open your NAS at `http://192.168.1.10`; away from home,
through Tailscale, a VPN or a public address. A tile can hold both:

- **URL** is the home address. **Away address (optional)** is the other one.
  SSH tiles have **Away host (optional)** and **Away port**.
- Once a dashboard has a tile with an away address, a **Home** / **Away**
  button appears in the top bar. Click it to switch which address tiles
  open, in this browser only. Your phone can be on Away while your desktop
  stays on Home.
- Status checks still use the home address.

### Folder looks

The **Edit Folder** dialog shows a live preview of each **Look**: *Rounded
box*, *Simple tab*, *Folder (flat)*, *Folder with paper*, *Folder
(outlined)*, *Folder (cartoon)* and *Folder (open flap)*. Every look except
Rounded box has a tab; **Tab position** puts it on the *Left*, *Centre* or
*Right*.

Under **Colour**: the **Folder colour** (or *None* for the theme's colour),
its **Opacity**, and the **Text colour** (*Auto*, *Light* or *Dark*). HOPS
warns you if the text would be hard to read.

### Folder size and pages

Under **Display**:

- **Contents size**: every tile and folder inside is shown at this size
  (*Small*, *Medium* or *Large*). Smaller fits more in.
- **Starts**: *Expanded* or *Collapsed* (minimised), for anyone who hasn't
  minimised or opened it themselves.
- **Size when minimised**: the size of its folder tile on the tab.
- **Show title bar**: untick it for a box without a name bar.

When a folder holds more than fits, it shows one page at a time with a page
bar at the bottom: **«** **‹** the page numbers **›** **»**. Make the folder
bigger (drag its edges in edit mode) to show more on each page. Each
browser remembers which page it was on.

### Folders inside folders

A folder inside a folder shows as its folder tile. Click it, and it opens
in place, inside its parent. The title bar shows the path; click a parent's
name to go back up. In edit mode, drag a folder onto another folder to put
it inside, or make one with **Add folder here** (right-click inside the
folder).

### Minimised folders

The minimise button on a folder's title bar shrinks it to a folder tile.
Click the tile to open it again. This is a viewer's choice, remembered by
each browser, so minimising on your phone doesn't change anyone else's
view. To set how a folder starts for everyone, use **Starts** in its
dialog.

### Move or copy anywhere

Every tile and folder dialog has **Move or copy to…**, and right-click has
**Move/Copy to…**: pick any dashboard, tab or folder as the destination.
Ctrl+C and Ctrl+V copy the selected items too, even to another dashboard.

## Step 6: Make it yours

### Themes and text size

**Theme Settings** (in the top bar) has a **Brightness Mode** (*Dark*,
*Light*, or *Auto* to follow your device) and eight presets under
**Theme Preset**: Default, Metallic, Modern, Subtle, Cyberpunk, Sunset, Ocean and Forest.
Click **Apply Theme**.

The two **A** buttons make the text smaller or larger: *Small*, *Medium*,
*Large* or *Extra Large*.

Both are kept in this browser, so each person and each device can choose
their own. Nothing is saved to the dashboard.

Also in Theme Settings: **Show recently used** adds a row of the tiles you
open most, above the tabs. It is kept in this browser only, and **Clear
history** empties it.

### Backgrounds

A background can go behind the whole dashboard, behind one tab, or inside
one folder. Each one is a draft like any other change: save the dialog,
then click **Save** in the toolbar.

**Dashboard background.** In edit mode, click **Dashboard** in the toolbar
and open **Background**. Turn on **Show background picture**, then choose a
**Background Type**:

- **None**: no background.
- **Color**: one plain colour.
- **Image**: one picture. Click one in the **Image Gallery** (HOPS comes
  with pictures in categories such as Network, Servers, Homelab and Space,
  and they work with no internet connection), click **Upload** to add your
  own (JPEG, PNG, GIF or WebP), or type an **Image URL**.
- **Slideshow**: click several pictures to add them to **Selected Images**.
  Set the **Rotation Interval** (5 to 3600 seconds), a **Transition
  Effect** (Crossfade, Slide, Zoom In, Ken Burns, *Random* and many more)
  and its **Transition Duration**. A preview shows the effect.

For pictures, **Image Fit** chooses *Cover*, *Contain* or *Fill*, and
**Overlay Darkness** and **Overlay Blur** darken and soften the picture so
tiles stay easy to read. **Background opacity** fades the background
itself. Click **Save** in the dialog.

**Tab background.** Open the tab's dialog and click **Configure Tab
Background**. Choose **Same as the dashboard** or **Its own background**
(the same choices as above), then **Save Background**. The tab dialog also
has its own **Background Color** and **Opacity**.

**Folder background.** In **Edit Folder**, the folder's colour and opacity
are under **Colour**. For a picture, click **Background…** and choose **Its
own picture** (an *Image* or a *Slideshow*) or **No picture of its own —
show what's behind**, then **Save Background**. Folder slideshows play only
while **Animated folder backgrounds** is on (it is by default:
Settings › Global settings › Look & motion, or per dashboard in
**Dashboard › Settings**). On a device that asks for reduced motion, they
show the first picture, still.

### Header

**Dashboard › Header** controls the top bar's left and centre: **Show left
section** with **Custom Text (optional)** (empty shows the HOPS logo and
links to your dashboards), and **Show center title** with **Custom Title
(optional)** (empty shows the dashboard's name). The buttons on the
right are always there.

### Animations

In edit mode, a tile dropped into a folder flies into it, and two tiles
merged into a folder are drawn together. **Animations** (Settings › Global
settings › Look & motion) is *On* (plays them unless your device asks for
reduced motion), *Always* or *Off*. They never delay your change.

## Step 7: Fill it faster

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

### Import from Homer, Dashy or Heimdall

Coming from another dashboard? On **Settings › Dashboards**, click
**Import**, then **Select File**. HOPS reads:

- **Homer YAML**: `config.yml` from Homer.
- **Dashy YAML**: `conf.yml` from Dashy.
- **Heimdall JSON**: an export from Heimdall.
- **HOPS JSON**: an export from HOPS itself.

**Auto-match icons** (ticked by default) finds icons from the tile names.
Click **Import**. Imported dashboards are added next to yours, never over
them: if the path is taken, the new one gets a suffix (`/home` becomes
`/home-1`). If only part of a file could be imported, HOPS says what was
left out.

### Export and share

The **Export** button next to a dashboard in Settings › Dashboards (or
**Export Dashboard** in the top bar while editing) saves a HOPS JSON file.
The **Export Configuration** dialog offers **Export All Dashboards** too.
The file carries your uploaded icons and backgrounds with it, so it can be
imported into another HOPS. An export is not a backup: for that, see
Step 9.

### Icons

HOPS comes with thousands of icons that work with no internet connection.
Search them, or upload your own (PNG, JPG, GIF, WebP or SVG), under
**Settings › Icons**, or from a tile's **Edit icon** button.

## Step 8: Getting around

### Search

Click **Search** or press `/`. On a dashboard it searches that dashboard's
tiles and folders, at any depth. Use ↑ and ↓ to move, **Enter** to open
it, and **Shift**+**Enter** (or Shift-click) to show where it lives
instead. **Esc** closes search.

### Keyboard

Outside edit mode, the arrow keys move between tiles and **Enter** opens
the one with the blue halo. In edit mode, as well as the Save and Undo keys
above: Ctrl+C, Ctrl+X and Ctrl+V copy, cut and paste; **Delete** deletes
what is selected (it asks first); Ctrl+Enter saves a dialog and Escape
closes it. **Help** in the top bar lists these.

### Switching dashboards

Once you are signed in, the dashboard's name in the top bar is a menu of
all your dashboards. Everyone else can use the dashboard links on the left
of the top bar (unless you replaced them with custom text), or just go
to the dashboard's address, such as `http://<server>:8080/media`.

### On your phone

- **QR code**: on **Settings › Dashboards**, click a dashboard's QR button
  (*Show QR code (scan with phone)*) and scan it with the phone's camera.
  The dialog also has **Copy URL**.
- **Home screen**: open HOPS in the phone's browser and use the browser's
  *Add to Home Screen* (on iPhone: the Share button). HOPS then opens from
  its own icon, like an app.
- Phones are for viewing: at 480 pixels wide or narrower, the edit button
  is hidden. The gear (Settings) is still there for backups and your
  password.

## Step 9: Keep it tidy and safe

### Dead links and duplicates

Both checks are on **Settings › Dashboards**, under your dashboard list.

- **Dead links** lists tiles whose status check has failed without a break
  for more than a week. Change that with **Treat a link as dead after**
  (Settings › Global settings › Status checks). Each one has **Show it**
  (takes you to the tile) and **Open address**. It only watches tiles that
  have status checks on, and says so if none do.
- **Duplicates** lists tiles that point at the same address, on any
  dashboard, tab or folder. **Show it** takes you to each one. **Merge,
  keeping the selected tile…** shows exactly what it would keep and delete
  before you confirm.

### Backups

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

### Other settings worth knowing

- **Settings › Global settings**: every server setting in one page, in
  groups (Server, Sign-in & security, Uploads, Editing, Look & motion,
  Status checks, Discovery). Each shows its default, and a few say
  **Restart required**.
- **Settings › Logs**: what HOPS has been doing, with **Copy** and
  **Download .txt** for when you ask for help.
- **Settings › Password**: change your password.
- **Settings › Factory reset**: delete every dashboard and start again. A
  backup is made first.

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
