# HOPS User Guide (v1.4.5)

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
12. [Import/Export](#importexport)

## Getting Started

### First Time Setup

1. Navigate to `/admin` to access the admin panel
2. Login with default credentials:
   - Username: `admin`
   - Password: `admin`
3. **HOPS will force you to change your password** before doing anything else — a non-dismissible modal appears immediately after the first login with the default credentials. Set a new password to continue.

### Interface Overview

- **Header**: Contains navigation, theme settings, and admin controls
- **Dashboard Area**: Displays your tabs, groups, and tiles
- **Edit Mode Toggle**: Click the pencil icon (when authenticated) to enter edit mode

## Navigation

### Multiple Dashboards

HOPS supports multiple dashboards accessible via different URLs:
- `/home` - Your home dashboard
- `/network` - Network services dashboard
- `/media` - Media services dashboard
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
1. Ensure you're logged in (visit `/admin` to login)
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

1. Go to `/admin`
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
2. Click the "+ New Tab" button
3. Enter tab name
4. Click "Save"

### Editing a Tab

1. Enter Edit Mode
2. Click on the tab you want to edit
3. Edit the following:
   - **Name**: Tab display name
   - **Color**: Custom color (optional)
   - **Opacity**: Background opacity (optional)
   - **Background**: Tab-specific background

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
2. Click "+ Add Group" at the bottom of the tab
3. Enter group name
4. Click "Save"

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

### Reordering Groups

1. Enter Edit Mode
2. Drag the group by its header
3. Drop it in the desired position

### Deleting a Group

1. Enter Edit Mode
2. Click "Edit Group"
3. Click "Delete Group"

**Note**: You can only delete empty groups. Remove all tiles first.

## Working with Tiles

### Adding a Tile

1. Enter Edit Mode
2. Click "**Add Tile**" in the group
3. Fill in the tile details:
   - **Name**: Display name
   - **URL**: Target URL
   - **Icon**: Choose from 150,000+ icons via Iconify
     - Type an icon name directly (e.g., `mdi:docker`, `simple-icons:plex`)
     - OR click "Browse" to open the **Icon Picker** with 1,900+ curated homelab icons
     - Search by name or browse by category (Containers, Media, Monitoring, etc.)
     - **My Uploads**: Previously uploaded custom icons appear here for easy reuse
     - **Recently Used**: Your last 20 selected icons are tracked for quick access
   - **Description**: Optional subtitle
   - **Size**: Small, Medium, or Large
   - **Open Mode**: How the link opens (New Tab, Same Tab, iFrame, Modal)
   - **Color**: Custom background color (optional)
   - **Opacity**: Background opacity (optional)
4. Click "Save"

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
- Add multiple images from the **64 curated backgrounds** across 12 categories (Network, Servers, Docker, Homelab, Smart Home, Apps, Multimedia, Weather, Storage, Tech, Space, Minimal)
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

### Global Shortcuts
- **Esc** - Close modals and dialogs

### Edit Mode Shortcuts
- **Ctrl+C** / **Cmd+C** - Copy selected tile
- **Ctrl+X** / **Cmd+X** - Cut selected tile
- **Ctrl+V** / **Cmd+V** - Paste tile into focused group
- **Ctrl+Enter** / **Cmd+Enter** - Save in modals
- **Esc** - Cancel/close modals

### Mouse Shortcuts
- **Right-click** on tile (in Edit Mode) - Open context menu
- **Click** on group - Focus group for paste operation

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
4. **Icon Variety**: Use the Icon Picker to browse 1,900+ curated homelab icons, or search from 150,000+ Iconify icons
5. **Text Readability**: Use Auto text color mode on group headers for optimal contrast on any background color
6. **Background Library**: Explore the 64 curated backgrounds across 12 categories for quick setup

## Troubleshooting

### Can't Enter Edit Mode
- Ensure you're logged in (visit `/admin`)
- Check you're on a dashboard page (not `/admin` or `/`)
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
| Add Tab | Click "+ New Tab" (in Edit Mode) |
| Add Group | Click "+ Add Group" (in Edit Mode) |
| Add Tile | Click "Add Tile" (in Edit Mode) |
| Change Theme | Click theme icon in header |
| Export Dashboard | Click download icon in header (Edit Mode) |
| Import Config | Click Import button on Admin page |
| Generate QR code | Click QR icon next to a dashboard on Admin page |

