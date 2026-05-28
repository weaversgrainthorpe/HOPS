# HOPS User Guide (v2.0.2)

Welcome to HOPS (Home Operations Portal System)! This guide will help you get started and make the most of your dashboard.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Navigation](#navigation)
3. [Mobile Experience](#mobile-experience)
4. [Edit Mode](#edit-mode)
5. [Working with Dashboards](#working-with-dashboards)
6. [QR Codes (open on phone/tablet)](#qr-codes)
7. [Working with Tabs](#working-with-tabs)
8. [Working with Groups](#working-with-groups)
9. [Working with Tiles](#working-with-tiles)
10. [Theming and Customization](#theming-and-customization)
11. [Keyboard Shortcuts](#keyboard-shortcuts)
12. [Server Settings](#server-settings)
13. [Import/Export](#importexport)
14. [Network Discovery](#network-discovery)

## Getting Started

### First Time Setup

1. Navigate to `/` (the root URL) to access the admin panel
2. Login with default credentials:
   - Username: `admin`
   - Password: `admin`
3. **HOPS will force you to change your password** before doing anything else — a non-dismissible modal appears immediately after the first login with the default credentials. Set a new password to continue.

### Interface Overview

- **Header**: Contains navigation, theme settings, and admin controls
- **Dashboard Area**: Displays your tabs, groups, and tiles
- **Edit Mode Toggle**: Click the pencil icon (when authenticated) to enter edit mode

## Navigation

### URL structure

HOPS exposes two kinds of URL on the same port:

| URL                                   | Shows                          | Login required?                          |
|---------------------------------------|--------------------------------|------------------------------------------|
| `http://<host>:8080/`                 | Admin page                     | **Yes** — admin login                    |
| `http://<host>:8080/<dashboard-path>` | A dashboard                    | **No** — public to anyone on the network |

You define `<dashboard-path>` when you create the dashboard (e.g. `/home`, `/network`, `/media`). Because dashboard URLs are unauthenticated, you can:

- Pin a dashboard URL on a wall-mounted tablet
- Share a dashboard link with family or housemates
- Use [QR Codes](#qr-codes) to open a dashboard on a phone without typing the URL

The admin page (`/`) only needs to be reached when you're creating or changing things — day-to-day use goes straight to a dashboard URL.

### Multiple Dashboards

HOPS supports multiple dashboards, each with their own URL path. Examples:
- `/home` — Your home dashboard
- `/network` — Network services dashboard
- `/media` — Media services dashboard
- etc.

### Tabs

Each dashboard can have multiple tabs to organize your content. Click on a tab name to switch between them.

### Groups

Within each tab, content is organized into collapsible groups. Click a group header to expand/collapse it.

## Mobile Experience

HOPS is mobile-friendly with responsive layouts that adapt at three breakpoints:

- **Desktop / large tablet (≥1024px)**: full layout with all controls
- **Tablet portrait / mobile landscape (768–1024px)**: tighter spacing; the per-dashboard nav links collapse but everything else remains
- **Mobile portrait (≤480px)**: compact icons; editing is **disabled**

### Why no editing on phones?

Editing involves drag-and-drop, dense modals, and small targets — all of which are awkward on a touchscreen. To avoid frustration, the **Edit** and **Export** buttons are hidden on phones. You can still:

- Browse any dashboard
- Click/tap tiles to open services
- Switch between dashboards via the tabs
- Reach the admin panel (the gear icon stays visible)

To edit dashboards, switch to a tablet or desktop browser. The forced-password-change modal works on mobile.

### Sharing a dashboard URL with a phone

See [QR Codes](#qr-codes) below — the admin panel can generate a scannable QR for any dashboard URL, so users don't have to type it.

## Edit Mode

Edit Mode allows you to modify your dashboards. To enter Edit Mode:
1. Ensure you're logged in (visit `/`, the admin page)
2. Navigate to any dashboard on **desktop or tablet** (editing is hidden on phones)
3. Click the **pencil icon** in the header

### What You Can Do in Edit Mode

- Add, edit, and delete tabs
- Add, edit, and delete groups
- Add, edit, and delete tiles
- Drag and drop to reorder items
- Copy, cut, and paste tiles
- Configure backgrounds and themes

## Working with Dashboards

### Creating a Dashboard

1. Go to `/` (the admin page)
2. Click "Create New Dashboard"
3. Enter a name and URL path
4. Click "Save"

### Dashboard Settings

- **Name**: Display name shown in navigation
- **Path**: URL path (e.g., `/home`)
- **Background**: Set dashboard-wide background (image, slideshow, or color)
- **Header Configuration**: Customize header text and visibility

## QR Codes

You can share any dashboard with a phone or tablet by generating a QR code — useful when you don't want to type the URL on a small keyboard.

### How to generate a QR code

1. Go to the Admin page (`/`)
2. Find the dashboard you want to share
3. Click the **QR icon** (next to the export and "open in new tab" buttons on that dashboard's row)
4. A modal opens showing:
   - The QR code itself (scannable with any phone camera)
   - The full URL as text (with a **copy** button)
   - A **Download SVG** button to save it for printing or embedding elsewhere

### How it works

The QR encodes `<current site URL>` + the dashboard's path. Because it uses your browser's current URL, it works correctly for any deployment topology — local IP, mDNS hostname (`hops.local`), reverse proxy (`hops.example.com`), port-forwarding — without any configuration. Whatever URL the admin is using is the URL the phone needs.

### Tips

- Generate the QR from the SAME network the phone will use. A QR generated while you're connected to your home WiFi will encode the LAN URL — your phone needs to be on the same network for it to resolve.
- Print or download the SVG and stick it on a fridge/wall for guests to scan.

## Working with Tabs

### Adding a Tab

1. Enter Edit Mode
2. Click the **+ Add Tab** button at the end of the tab bar.
   - On a brand-new dashboard with no tabs yet, a centred **"Add Your First Tab"** button appears instead — same flow.
3. The **New Tab** modal opens. Fill in:
   - **Name** *(required)*
   - **Icon** *(optional)* — type an Iconify name or click **Browse**
   - **Background Color** + **Opacity** slider *(optional)*
4. Click **Create**.

The tab is only created when you click Create — cancelling leaves nothing behind.

### Editing a Tab

1. Enter Edit Mode
2. Click on the tab you want to edit
3. Edit the following:
   - **Name**: Tab display name
   - **Icon**: Optional icon shown next to the tab name
   - **Color**: Custom background color (optional)
   - **Opacity**: Background opacity (optional)
   - **Background**: Tab-specific background image (only when **per-tab backgrounds** is enabled on the dashboard)
4. Click **Save**.

### Reordering Tabs

1. Enter Edit Mode
2. Drag the tab by the drag handle icon
3. Drop it in the desired position

### Deleting a Tab

1. Enter Edit Mode
2. Click the tab to edit it
3. Click the "Delete" button in the edit modal

## Working with Groups

### Adding a Group

1. Enter Edit Mode
2. Click **Add Group** at the bottom of the tab
3. The **New Group** modal opens. Fill in:
   - **Name** *(required)*
   - **Icon** *(optional)* — type an Iconify name or click **Browse**
   - **Background Color** + **Opacity** slider *(optional)*
   - **Text Color**: Auto (recommended), Light, or Dark
   - **Display Style**: Full Header (default) or Folder Tab
   - **Row Width**: Full (default), Half, or Third — see [Multi-column group layouts](#multi-column-group-layouts) below
4. Click **Create**.

All of these can be changed later from the group's edit modal.

### Editing a Group

1. Enter Edit Mode
2. Click the "Edit Group" button on the group header
3. Edit the following:
   - **Name**: Group display name
   - **Icon**: Optional icon for the group header
   - **Color**: Custom color (optional)
   - **Opacity**: Background opacity (optional)
   - **Text Color**: Choose Auto (smart contrast), Light, or Dark
     - **Auto** (recommended): Automatically determines light or dark text based on background color for optimal readability
     - **Light**: Force white text
     - **Dark**: Force black text
   - **Display Style**: Choose how the group header appears
     - **Full Header** (default): Full-width header bar spanning the entire group width
     - **Folder Tab**: Compact folder-style tab at the top-left, similar to file folder tabs
   - **Row Width**: how much of the row this group takes up — see below

### Multi-column group layouts

By default a group spans the full tab width. Set **Row Width** to **Half** or
**Third** to put multiple groups side by side on the same row:

- **Full** — the group spans the whole row (default).
- **Half** — the group takes half a row. Two Half groups in a row sit
  side-by-side.
- **Third** — the group takes a third of a row. Up to three Third groups
  fit in a single row.

Groups flow left-to-right in their existing order, so to get a "Half + Half"
row, put two Half groups consecutively. A row that doesn't fill cleanly
(e.g., Half + Full) wraps the oversized group onto its own row.

Width is a manual setting — drag-and-drop only reorders groups; it doesn't
change widths. To rearrange a multi-column tab, set each group's width
explicitly via its edit modal.

On narrow screens (phones; width below ~768px), all groups collapse to full
width regardless of setting, to keep the layout readable.

### Reordering Groups

1. Enter Edit Mode
2. Drag the group by its header
3. Drop it in the desired position

### Moving or Copying a Group to Another Tab

For across-tab moves (which can't be done by drag), open the group editor:
1. Enter Edit Mode → click the group's pencil to open its editor
2. Expand **"Move or Copy to Another Tab"**
3. Pick a target tab
4. Click **Move Group** (relocates everything, original gone) or **Copy Group** (deep-clones the group and all its tiles with fresh IDs; original stays)

### Deleting a Group

1. Enter Edit Mode
2. Click "Edit Group"
3. Click "Delete Group"

**Note**: You can only delete empty groups. Remove all tiles first.

## Working with Tiles

### Tile types

HOPS supports two kinds of tile, set via the **Tile type** dropdown at the
top of the tile edit modal:

- **Link** (default) — the classic HOPS tile. Opens a URL when clicked,
  shows an icon, and can run status checks.
- **Note** — a text-only tile. Renders a name and an optional longer
  description, doesn't open anything when clicked, and doesn't run status
  checks. Useful as a section header, a stand-in for a service you haven't
  set up yet, or a small inline note.

The fields shown in the edit modal change to match the tile type — Notes
hide the URL, icon, open-mode and status-check sections, since none of
those apply.

### Adding a Tile

1. Enter Edit Mode
2. Click **Add Tile** in the group
3. The **New Tile** modal opens. Fill in:
   - **Tile type**: **Link** (default) or **Note** — see above
   - **Name** *(required)*: Display name
   - **Subtitle/Description** *(optional)*: small text under the name (for
     Notes, this is the body text and renders as a larger paragraph)
   - **URL** *(required for Link, hidden for Note)*: Target URL
   - **Icon** *(Link only)*: Choose an icon
     - Type an Iconify icon name directly (e.g., `mdi:docker`, `simple-icons:plex`) — loaded on demand from iconify.design (~200,000 icons available)
     - OR click **Browse** to open the **Icon Picker** with ~2,300 bundled app/service icons (search by name or browse by category — Containers, Media, Monitoring, etc.)
     - OR click **Upload** to use your own image file
     - **My Uploads**: previously uploaded custom icons appear here for easy reuse
     - **Recently Used**: your last 20 selected icons are tracked for quick access
   - **Background Color** + **Opacity** slider *(optional — leave blank to inherit the group's colour)*
   - **Size**: Small, Medium, or Large
   - **Open Mode** *(Link only)*: how the link opens (New Tab, Same Tab, iFrame, Modal)
   - **Enable Status Check** *(Link only, optional)*: HOPS will ping the URL and show an up/down indicator on the tile
4. Click **Create**.

For Link tiles, only **Name** and **URL** are required. For Note tiles,
only **Name** is required. Everything else can be added or changed later
via the tile's edit modal.

### Editing a Tile

1. Enter Edit Mode
2. Click on the tile
3. Make your changes
4. Click "Save"

### Moving Tiles

#### Within a Group (Reorder)
1. Enter Edit Mode
2. Drag the tile
3. Drop it in the desired position

#### Between Groups (Cross-Group Drag & Drop)
1. Enter Edit Mode
2. Drag a tile from one group
3. Drop it into another group

#### Between Tabs (Move or Copy via the Tile editor)
For moves across tabs (which can't be done by drag), open the tile editor:
1. Enter Edit Mode → click the tile to open its editor
2. Expand **"Move or Copy to Different Tab/Group"**
3. Pick a target tab, then a target group
4. Click **Move** (relocates the tile) or **Copy** (duplicates the tile, original stays)

#### Copy, Cut, and Paste
1. Enter Edit Mode
2. Right-click on a tile
3. Select "Copy" or "Cut"
4. Click on the target group to focus it
5. Press Ctrl+V (or Cmd+V on Mac) to paste

Alternatively:
- **Copy**: Right-click → Copy (or Ctrl+C / Cmd+C)
- **Cut**: Right-click → Cut (or Ctrl+X / Cmd+X)
- **Paste**: Click target group, then Ctrl+V / Cmd+V

### Deleting a Tile

Method 1: Edit Modal
1. Enter Edit Mode
2. Click the tile
3. Click "Delete"

Method 2: Quick Delete
1. Enter Edit Mode
2. Hover over the tile
3. Click the red X button that appears

Method 3: Context Menu
1. Enter Edit Mode
2. Right-click on the tile
3. Select "Delete"

## Theming and Customization

### Global Theme

Click the **theme icon** in the header to open theme settings:

- **8 Theme Presets**: Default (Blue), Metallic, Modern (Indigo), Subtle, Cyberpunk, Sunset, Ocean, Forest
- **Light/Dark Mode**: Each theme has light and dark variants
- **Auto Mode**: Automatically follows your system theme preference
- **Gradient themes**: Sunset, Ocean, and Forest use animated CSS gradients

### Text Size

Adjust the text size using the **A buttons** in the navbar:
- **A↑** - Increase text size
- **A↓** - Decrease text size
- Text size preference is saved in your browser

### Theme Hierarchy

HOPS uses a cascading theme system:

**Dashboard** → **Tab** → **Group** → **Tile**

Each level can define:
- **Color**: Background/accent color
- **Opacity**: Background transparency

Child levels inherit parent colors/opacity unless overridden.

### Setting Backgrounds

#### Dashboard Background
1. Enter Edit Mode
2. Click "Background" button in the dashboard header
3. Choose type:
   - **None**: Use default theme background
   - **Color**: Solid color background
   - **Image**: Single background image
   - **Slideshow**: Multiple rotating images

For slideshows:
- Add multiple images from the **~90 curated backgrounds** across 12 categories (Network, Servers, Docker, Homelab, Smart Home, Apps, Multimedia, Weather, Storage, Tech, Space, Minimal)
- OR upload your own images (they appear in a "My Uploads" category for reuse)
- OR add custom image URLs
- Set rotation interval (seconds) — default is 30s
- Choose fit mode (Cover, Contain, Fill)
- **Overlay**: Adjust overlay opacity and blur to improve text readability over busy backgrounds
- **Preview**: Live animated preview shows smooth crossfade transition (1.5s professional fade)

#### Tab Background
1. Enter Edit Mode
2. Click "Tab Background" button in the tab
3. Configure like dashboard background

Tab backgrounds override dashboard backgrounds when set.

### Customizing Colors

You can set custom colors at multiple levels:

- **Dashboard**: Set via dashboard background settings
- **Tab**: Edit tab → Set color and opacity
- **Group**: Edit group → Set color and opacity
- **Tile**: Edit tile → Set color and opacity

Colors cascade down the hierarchy!

## Keyboard Shortcuts

### Global Shortcuts (any mode)
- **/** - Open global search. Type to filter tiles across every dashboard by
  name, URL, or description. Arrow keys to move through results, **Enter**
  to open the highlighted tile, **Esc** to close. The hotkey doesn't fire
  while you're typing into an input or textarea (so a literal `/` in your
  data still works).
- **Esc** - Close modals, dialogs, and the search modal

### Browse-mode Tile Navigation
- **↑ ↓ ← →** - Move focus between tiles. Navigation is spatial: it picks
  the nearest tile in the direction you press, weighting off-axis distance
  so up/down picks the tile above/below and left/right picks the row
  neighbour. The focused tile gets a blue halo.
- **Enter** - Activate the focused tile (open the link, or trigger the
  tile's default action)

Arrow-key navigation is disabled in Edit Mode so it doesn't interfere with
selection and drag operations.

### Edit Mode Shortcuts
- **Ctrl+C** / **Cmd+C** - Copy selected tile
- **Ctrl+X** / **Cmd+X** - Cut selected tile
- **Ctrl+V** / **Cmd+V** - Paste tile into focused group
- **Ctrl+Enter** / **Cmd+Enter** - Save in modals
- **Esc** - Cancel/close modals

### Mouse Shortcuts
- **Right-click** on tile (in Edit Mode) - Open context menu
- **Click** on group - Focus group for paste operation

## Server Settings

Everything HOPS does at runtime — the port it listens on, how chatty the logs are, how quickly it status-checks tiles, how big an upload it will accept, how long a login session lasts — is configured in one place: the **Settings** page in the admin panel. There are no config files to edit and (as of v1.6.0) no environment variables to set.

### Opening Settings

From the Admin page (`/`), click the **Settings** button in the header (next to **Backups**). You can also navigate directly to `/settings`. The page is admin-only — you must be logged in.

### What's there

Settings are grouped into seven sections, each with inline help on every entry — there's no need to memorise the list below:

- **Server** — TCP port HOPS listens on
- **Logging** — log verbosity (debug / info / warn / error)
- **Reverse proxy** — trusted-proxy IP ranges if HOPS sits behind nginx, Caddy, Traefik, etc.
- **Authentication** — login rate limit per IP per minute; session lifetime
- **Status checks** — how often tiles are pinged and the per-request timeout
- **Uploads** — maximum file size for config import, background images, icons
- **HTTP server timeouts** — read / write / idle timeouts on the underlying server

Every entry shows its current value, default, valid range (where applicable), and a short description of what it does.

### Live changes vs Restart required

Most settings apply **immediately** — change them, hit Save, the running server picks up the new value on the next request. Things like log level, status-check interval, and rate limits work this way.

A few are marked with an orange **Restart** pill next to their name. These (server port, reverse-proxy trusted ranges, HTTP server timeouts) are bound when HOPS first starts and can't be changed mid-flight. Saving them persists the value, but the change takes effect only when you restart HOPS — `sudo systemctl restart hops` on the prod box, or stop/start your container.

### Editing a setting

1. Find the setting you want to change.
2. Type the new value (or pick from the dropdown for log level).
3. Click **Save**. You'll see a green confirmation toast.

The **Revert** button next to Save discards your unsaved change. **Reset to default** (visible when the current value isn't the default) restores HOPS's out-of-the-box setting for that entry.

If you enter something invalid (out of range, malformed JSON for the trusted-proxy list, an unknown log level), Save will reject it with a specific error message; the running value is unchanged until validation passes.

### Common things you might want to change

- **Increase log verbosity to diagnose an issue** — set `log.level` to `debug` (live; no restart). Remember to set it back to `info` afterwards or your `journalctl` will get noisy.
- **Run HOPS behind a reverse proxy** — set `proxy.trusted_cidrs` to a JSON array of CIDRs, e.g. `["10.0.0.0/8"]` or `["192.168.1.5/32"]`. Restart required. This lets HOPS honour `X-Forwarded-For` (so login rate limiting keys on the real client) and `X-Forwarded-Proto` (so cookies are marked Secure over HTTPS).
- **Change the port** — set `server.port`. Restart required, and remember to update any reverse-proxy / firewall / port-forward that targets the old port.
- **Allow larger background images** — bump `upload.max_bytes_background`. Live.
- **Make the status checker more aggressive** — drop `status.check_interval_minutes` from 5 to 1. Live.

### Defaults are sensible

You should not need to touch the Settings page for a typical homelab install. The defaults are tuned for that. Open the page if you have a specific need — debugging, a reverse proxy in front, very large backgrounds, etc. — otherwise, leave it alone.

## Import/Export

### Exporting Configuration

Exports are **self-contained** — all uploaded assets (icons, backgrounds) are embedded in the export file as base64 data. This means you can import on a different server without losing any custom images.

**Export everything (from the Admin Page):**
1. Go to the Admin page (`/`)
2. Find the dashboard you want to export
3. Click the **download icon** next to that dashboard
4. Your configuration downloads as a JSON file with embedded assets

**Export a single dashboard (from Edit Mode):**
1. Enter Edit Mode on any dashboard
2. Click the **download icon** in the header
3. Only that dashboard's configuration and assets are exported

### Importing Configuration

Import is done from the Admin page:

1. Go to the Admin page (`/`)
2. Click the **Import** button next to "New Dashboard"
3. Select your configuration file
4. Click "Import Configuration"

#### Supported Formats
- **HOPS JSON** - Native format (exported from HOPS)
- **Homer YAML** - config.yml from Homer dashboard
- **Dashy YAML** - conf.yml from Dashy dashboard
- **Heimdall JSON** - Export from Heimdall dashboard

### Import Notes

- **Merges with existing**: Imported dashboards are added alongside your existing ones
- **Path conflicts**: If a dashboard path already exists, the imported one gets a suffix (e.g., /home becomes /home-1)
- **Backup first**: Always export your current config before importing
- **Authentication required**: Import/Export requires admin login
- **Format conversion**: Import from other tools is best-effort

## Network Discovery

*(new in v2.0)* HOPS can scan your LAN for services and bulk-add the ones you want as dashboard tiles. Open **Admin → Network Discovery** from the navbar.

### What to expect first

Discovery is **a head-start, not a magic wand**. Real-world results depend on:

- **Network topology** — switched vs Wi-Fi, VLAN segmentation, isolated guest networks
- **Firewalls and host-based AV** — Windows Defender, ufw, iptables, Norton/AVAST etc. can silently block probes
- **Service configuration** — apps bound to `localhost` aren't reachable from another host; apps behind reverse proxies look like the proxy until you tell HOPS about your internal domain
- **Whether the service responds to unauthenticated requests** — some services 401 immediately and never reveal their identity to a probe
- **Where HOPS is running** — see the Docker note immediately below

You'll likely see:
- **False positives** — a probe that matches a body string in something unrelated
- **Missing services** — apps on unusual ports, apps that don't speak HTTP, apps that aggressively rate-limit
- **Generic "Web service on X" rows** — HOPS saw something but doesn't have a fingerprint for it yet

That's why every scan is a **reviewable draft you curate** before any tile lands on a dashboard, and why the **Diagnostics** view exists to turn "I see something HOPS missed" into a new detector in two clicks. Coverage grows release-over-release as the bundled detector set expands.

### Running HOPS in Docker?

**This is a Docker networking constraint, not a HOPS limitation, and it's beyond our control.** Worth understanding before you wonder why a scan from a containerised HOPS looks thin.

By default, Docker puts containers on a **bridge network** — a private virtual network behind NAT, with no direct view of the host's physical LAN. The container's ARP table is its own bridge, multicast frames (mDNS, SSDP) stop at the bridge boundary, and outbound packets get NAT'd so the destination sees the host's IP rather than the container's.

What this means for Network Discovery on a default-bridge container:

| Source | Works? | Why |
| --- | --- | --- |
| Active TCP port scan (light / full) | ✅ Mostly | NAT routes unicast TCP fine; some services that filter by source IP may behave differently |
| HTTP fingerprint detectors | ✅ Yes | Standard outbound TCP, no multicast involved |
| Forward DNS enumeration | ✅ Yes | Standard DNS lookups via the container's resolver |
| SNMP v2c | ✅ Yes | Unicast UDP, works through NAT |
| **mDNS** (HomeKit / AirPlay / Chromecast) | ❌ Silently empty | Multicast traffic doesn't cross the bridge boundary |
| **UPnP / SSDP** (smart TVs / Sonos / Roku / routers) | ❌ Silently empty | Same multicast limitation |
| **ARP table sweep** | ❌ Empty | The container's ARP table reflects its bridge, not the host LAN |
| **DNS PTR enrichment** | ⚠ Depends | Works if the container's resolver knows your LAN; not if it's a default `8.8.8.8` |

The scan-level warnings panel will surface mDNS / SSDP / ARP failures when they happen, so you'll see *that* they didn't work — but the underlying reason is Docker's bridge, not HOPS.

**Two options if you want full discovery coverage**:

1. **Use host networking** (Linux only). Edit your `docker-compose.yml`:
   ```yaml
   services:
     hops:
       image: ghcr.io/weaversgrainthorpe/hops:latest
       network_mode: host
       # Remove the `ports:` block — host mode doesn't use it.
   ```
   The container shares the host's network stack: same ARP table, multicast works, IP visibility identical to running natively. Docker Desktop on Mac and Windows technically support `network_mode: host` but have known limitations (Mac in particular runs Docker in a VM, so "host" isn't really host) — your mileage will vary.

2. **Run HOPS natively** (binary or systemd service, no Docker). Simplest path on a Linux box; the binary is a single file with no runtime dependencies.

The active-scan and DNS-based parts of Discovery still work on a default-bridge container, so it's not "broken" — just thinner. If your homelab is mostly HTTP services on known ports (the typical *arr / NAS / Pi-hole / Proxmox setup), the default bridge gets you most of the way there. The multicast-only devices (TVs, speakers, IoT) are the ones you'd miss.

### Running a scan

1. **Admin → Network Discovery → New Scan**
2. Specify your scan targets. HOPS suggests a CIDR based on your network interface; you can override. Targets can be any combination of:
   - **CIDRs** — `10.10.0.0/24`, `192.168.1.0/24` (anything /16 to /32)
   - **Ranges** — `10.10.0.1-50` (octet shorthand) or `10.10.0.1-10.10.0.50` (full pair)
   - **Single IPs** — `10.10.0.5`
   - **Exclusions** — prefix any of the above with `!` or `NOT ` to skip those addresses, e.g. `10.10.0.0/24, !10.10.0.50`. Useful for skipping a printer that hangs on probes, a known-flaky IoT device, or anything you don't want scanned.
   - The form shows the **effective host count** live (post-exclusion) so you can see what the scan will actually probe before clicking Start
3. Optional: enter an **Internal domain** (e.g. `home.arpa`) if you run internal DNS — HOPS will probe ~80 common subdomains (`sonarr.home.arpa`, `plex.home.arpa`, …) to catch services behind reverse proxies
4. Pick an **intensity**:
   - **Passive** — no port probes at all. ARP / mDNS / DNS / UPnP / SNMP only. Quiet and quick; finds broadcast services, misses everything else
   - **Light** (default) — passive plus active probes on ~40 well-known homelab ports. The right choice for most users
   - **Full** — light plus a wider port sweep (~60 ports). Slower and noisier; may spook IoT firmware
5. Click **Start scan**

### Watching it run

The progress bar shows current phase: *Passive discovery → Probing X hosts → Forward DNS enumeration → Finalising*. A list of in-flight host addresses scrolls below.

If passive sources fail (commonly: mDNS blocked by managed switches, SSDP filtered by Wi-Fi APs), you'll see an **amber warning panel** at the top of the draft after the scan completes. The active probe still ran; you just won't have broadcast-discovered services in this scan.

### Curating results

Each row shows: confidence (high / medium / low), category, suggested name, suggested URL. The favicon thumbnail comes from the discovered service itself. Inline-edit any name, URL, or category before promoting.

**Bulk actions** at the top:
- **Select all** / **Select none**
- **Select all high-confidence** — usually the right starting point
- **Promote N to dashboard** — opens the promote modal

In the promote modal, pick an existing dashboard or create a new one on the fly. Tiles distribute into groups by their category — Sonarr lands in *Downloads*, Pi-hole in *Network*, and so on. No manual group-picking required.

### The Diagnostics view

**Admin → Network Discovery → Diagnostics** shows every HTTP service across all your past scans that no specific detector matched, deduplicated by `(host, port)`. Plus a **detection summary** counting how many results each detector produced.

Click **+ Create detector** on any unidentified row — the detector form opens pre-populated with the port, title, server header, and favicon hash. Adjust signatures (the body or title string that uniquely identifies the service), save, and re-scan. The next scan recognises it natively.

### Custom and customized detectors

**Admin → Network Discovery → Manage detectors** lists every detector — both bundled (shipped with HOPS) and your own.

- **Bundled detectors are customizable.** Click the tune icon on any bundled row to open its definition pre-filled. Save your edits — they create an **override** that supersedes the bundled definition on the next scan. The row gets a "modified" badge. Click **Reset to bundled defaults** to drop the override; the shipped definition takes over again. There's also a header button to **Reset all customizations** in bulk.
- **Add your own detectors** with the **+ Add detector** button. The four signature types are:
  - **Body contains** — case-sensitive substring of the response body (min 4 chars)
  - **Title contains** — case-insensitive substring of the HTML `<title>` (min 3 chars)
  - **Header keys** — any response header whose presence alone identifies the service
  - **Favicon hashes** — Shodan-compatible signed-int32 MMH3 hashes (most stable; survives version bumps)

You can declare any one or any combination. A detector whose only signature is a favicon hash is valid.

### Re-scanning with tweaks

On any past draft, **Re-scan** clones the targets and runs fresh; **Edit & re-scan** opens the New Scan form pre-filled with the old targets so you can add an exclusion (for that printer that hangs on probes, etc.) or change intensity before launching again.

### Upgrading from older versions

Discovery is brand-new in v2.0. Existing v1.x installs upgrade seamlessly — the new tables (`scans`, `scan_results`, `user_detectors`) are created on first boot of the v2.0 binary. No data migration steps, no scan history loss (there was none), no impact on your existing dashboards.

## Tips and Tricks

### Organizing Content

1. **Use Tabs for Categories**: Create tabs like "Media", "Network", "Home Automation"
2. **Use Groups for Services**: Group related services together (e.g., "*arr Stack", "Home Assistant", "Monitoring")
3. **Use Tile Sizes**: Make frequently-used services Large, less-used Small

### Working Efficiently

1. **Copy Template Tiles**: Create a template tile with the right size/color, then copy and edit
2. **Use Keyboard Shortcuts**: Ctrl+C, Ctrl+X, Ctrl+V are faster than right-click menus
3. **Focus Groups**: Click on a group before pasting to control where tiles go
4. **Batch Operations**: Copy multiple tiles from one group to another

### Visual Design

1. **Theme Consistency**: Set colors at the Group or Tab level for consistent look
2. **Slideshow Backgrounds**: Use slow rotation (60-120s) for subtle ambiance with smooth crossfade transitions
3. **Opacity Layering**: Reduce tile opacity slightly to let background show through
4. **Icon Variety**: Use the Icon Picker to browse ~2,300 bundled app/service icons, or type any Iconify icon name (~200,000 available on demand via iconify.design)
5. **Text Readability**: Use Auto text color mode on group headers for optimal contrast on any background color
6. **Background Library**: Explore the ~90 curated backgrounds across 12 categories for quick setup

## Troubleshooting

### Can't Enter Edit Mode
- Ensure you're logged in (visit `/`, the admin page)
- Check you're on a dashboard page (not the admin page at `/`)
- Click the pencil icon in the header

### Tiles Not Opening
- Check the URL is correct in tile settings
- Verify the service is running and accessible
- Try different open modes (New Tab, iFrame, etc.)

### Import Failed
- Verify the format matches (HOPS JSON, Homer YAML, Dashy YAML)
- Check the file/paste content is valid JSON or YAML
- Try exporting first to see the expected format

### Background Images Not Loading
- Verify image URLs are accessible
- Check image URLs use https:// (http:// may be blocked)
- Try a different image URL or use the preset library

## Getting Help

- **Quick Start**: See [Zero to Dashboard Hero](QUICKSTART.md) for first-time setup
- **Deployment**: See [Installation & Deployment Guide](DEPLOY.md) for setup and configuration

## Quick Reference

| Action | Shortcut |
|--------|----------|
| Enter Edit Mode | Click pencil icon (must be logged in) |
| Copy Tile | Right-click → Copy OR Ctrl+C |
| Cut Tile | Right-click → Cut OR Ctrl+X |
| Paste Tile | Click group, then Ctrl+V |
| Delete Tile | Right-click → Delete OR hover X button |
| Reorder Tiles | Drag and drop (in Edit Mode) |
| Move Between Groups | Drag to other group (in Edit Mode) |
| Add Tab | Click "+ Add Tab" (in Edit Mode) |
| Add Group | Click "+ Add Group" (in Edit Mode) |
| Add Tile | Click "Add Tile" (in Edit Mode) |
| Change Theme | Click theme icon in header |
| Export Dashboard | Click download icon in header (Edit Mode) |
| Import Config | Click Import button on Admin page |
| Generate QR code | Click QR icon next to a dashboard on Admin page |

