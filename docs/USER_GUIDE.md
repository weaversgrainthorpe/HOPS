# HOPS User Guide

Welcome to HOPS (Home Operations Portal System) - a modern, self-hosted dashboard for managing all your home services and applications.

## Table of Contents

1. [Getting Started](#getting-started)
2. [User Interface](#user-interface)
3. [Managing Dashboards](#managing-dashboards)
4. [Working with Tabs](#working-with-tabs)
5. [Managing Groups](#managing-groups)
6. [Adding and Editing Tiles](#adding-and-editing-tiles)
7. [Copy, Cut, and Paste](#copy-cut-and-paste)
8. [Customizing Themes](#customizing-themes)
9. [Tips and Tricks](#tips-and-tricks)

## Getting Started

### Accessing HOPS

HOPS has two modes:

1. **Viewer Mode** - Public access to view and use your dashboards (no login required)
   - Access at: `http://your-server:port/`

2. **Admin Mode** - Password-protected mode for editing dashboards
   - Access at: `http://your-server:port/admin`
   - Default credentials:
     - Username: `admin`
     - Password: `admin`
   - **⚠️ Change the default password immediately after first login!**

### First Login

1. Navigate to `/admin`
2. Enter your credentials
3. Click "Sign In"
4. You'll be redirected to the admin panel

## User Interface

### Navigation Bar

The navigation bar appears at the top of every page and contains:

- **HOPS Logo** - Click to return to the first dashboard
- **Dashboard Dropdown** - Switch between different dashboards
- **Edit Mode Toggle** - Enable/disable editing (admin only)
- **Theme Picker** - Change colors and themes
- **Settings** - Configure header visibility and other options
- **Sign Out** - Log out of admin mode

### Dashboard Structure

Each dashboard consists of:

```
Dashboard
├── Tab 1
│   ├── Group 1
│   │   ├── Tile 1
│   │   ├── Tile 2
│   │   └── Tile 3
│   └── Group 2
│       └── Tile 4
└── Tab 2
    └── Group 3
        └── Tile 5
```

## Managing Dashboards

### Creating a Dashboard

1. Click on the dashboard dropdown in the navigation bar
2. Click the "+" button
3. Fill in the dashboard details:
   - **Name** - Display name (e.g., "Home", "Media", "Network")
   - **Path** - URL path (e.g., "/home", "/media", "/network")
4. Click "Add Dashboard"

### Editing a Dashboard

1. Enable Edit Mode
2. Click on the dashboard dropdown
3. Click the edit icon (pencil) next to the dashboard name
4. Update the details
5. Click "Save Dashboard"

### Deleting a Dashboard

1. Enable Edit Mode
2. Click on the dashboard dropdown
3. Click the edit icon next to the dashboard name
4. Click "Delete Dashboard"
5. Confirm the deletion

## Working with Tabs

### Creating a Tab

1. Enable Edit Mode
2. Click the "New Tab" button (appears in edit mode)
3. A new tab will be created and automatically opened for editing
4. Update the tab name, color, and opacity

### Editing a Tab

1. Enable Edit Mode
2. Click the edit icon next to the tab name
3. Modify:
   - **Name** - Tab display name
   - **Color** - Tab background color
   - **Opacity** - Tab background transparency
4. Click "Save Tab"

### Reordering Tabs

1. Enable Edit Mode
2. Tabs become draggable (look for the drag icon)
3. Click and drag a tab to a new position
4. Release to drop
5. Changes are saved automatically

### Deleting a Tab

1. Enable Edit Mode
2. Click the edit icon next to the tab name
3. Click "Delete Tab"
4. Confirm the deletion

## Managing Groups

Groups organize tiles into collapsible sections within a tab.

### Creating a Group

1. Enable Edit Mode
2. Click the "Add Group" button at the bottom of the tab
3. A new group will be created with a default name

### Editing a Group

1. Enable Edit Mode
2. Click the edit icon (pencil) on the group header
3. Update:
   - **Group Name** - Display name for the group
4. Click "Save"

### Collapsing/Expanding Groups

- Click the chevron icon on any group header to collapse or expand it
- This works in both view and edit modes
- Collapsed state is saved automatically

### Deleting a Group

1. Enable Edit Mode
2. Click the trash icon on the group header
3. Confirm the deletion
4. **⚠️ This will delete all tiles within the group!**

## Adding and Editing Tiles

Tiles are the individual links or widgets in your dashboard.

### Adding a Tile

1. Enable Edit Mode
2. Click the "Add Tile" button in any group
3. Fill in the tile details:
   - **Name** - Display name
   - **Subtitle** - Optional description/tagline
   - **URL** - Web address to open
   - **Icon** - Icon identifier (from Iconify)
   - **Size** - Small, Medium, or Large
   - **Color** - Tile background color
   - **Opacity** - Tile background transparency
4. Click "Add Entry"

### Editing a Tile

1. Enable Edit Mode
2. Click on any tile
3. Modify the details in the modal
4. Click "Save Entry"

### Deleting a Tile

Method 1:
1. Enable Edit Mode
2. Click on the tile to open the edit modal
3. Click "Delete Entry"
4. Confirm the deletion

Method 2:
1. Enable Edit Mode
2. Click the small "X" button in the top-right corner of the tile

### Reordering Tiles

1. Enable Edit Mode
2. Tiles become draggable
3. Click and drag a tile to a new position within the same group
4. Release to drop
5. Changes are saved automatically

### Tile Sizes

- **Small** - Compact size, good for simple links
- **Medium** - Default size, shows icon and text clearly
- **Large** - Larger tiles for frequently used items

## Copy, Cut, and Paste

Move tiles between groups and tabs easily.

### Copying a Tile

1. Enable Edit Mode
2. Right-click on any tile
3. Select "Copy" from the context menu
4. The tile is now in the clipboard

### Cutting a Tile

1. Enable Edit Mode
2. Right-click on any tile
3. Select "Cut" from the context menu
4. The tile is now in the clipboard and will be removed when pasted

### Pasting a Tile

1. After copying or cutting a tile
2. Navigate to the destination group (can be in a different tab)
3. Click the "Paste" button that appears in the group
4. The tile will be added to that group
5. If you used "Cut", the tile is removed from the original location

### Tips for Copy/Paste

- You can copy/paste between tabs in the same dashboard
- Copied tiles get a new ID but retain all other properties
- Cut tiles are moved (not duplicated)
- The clipboard is cleared after pasting a cut tile

## Customizing Themes

HOPS includes 8 beautiful theme presets with light and dark variants.

### Opening Theme Picker

1. Click the palette icon in the navigation bar
2. The theme picker modal will open

### Choosing a Brightness Mode

Select one of three modes:

- **Dark** - Always use dark mode
- **Light** - Always use light mode
- **Auto** - Follow system preferences

### Selecting a Theme Preset

Choose from 8 presets:

1. **Default** - Classic blue theme
2. **Metallic** - Chrome and silver tones
3. **Modern** - Clean minimal design with indigo
4. **Subtle** - Muted pastel colors
5. **Cyberpunk** - Neon futuristic vibes (pink/purple)
6. **Sunset** ⚡ - Warm gradient (orange to pink)
7. **Ocean** ⚡ - Cool water gradient (cyan to blue)
8. **Forest** ⚡ - Natural green gradient (green to lime)

⚡ = Gradient theme

### Applying Theme Changes

1. Select your brightness mode
2. Select your theme preset
3. Click "Apply"
4. Your preferences are saved automatically

### How Themes Work

- Each preset has both light and dark variants
- When you switch between Light/Dark/Auto mode, the colors adapt
- Gradient themes use smooth color transitions on buttons and accents
- Themes apply globally across all dashboards

## Tips and Tricks

### Keyboard Shortcuts

- **Escape** - Close any open modal

### Navigation

- Click the HOPS logo to quickly return to your first dashboard
- Use the dashboard dropdown to switch between dashboards
- Tab between different sections without leaving the page

### Organizing Your Dashboards

**Recommended Structure:**

1. **Main Dashboard** (`/home`) - Most frequently used services
   - Tab: Quick Links
   - Tab: Media
   - Tab: Management

2. **Network Dashboard** (`/network`) - Infrastructure and monitoring
   - Tab: Servers
   - Tab: Network Devices
   - Tab: Monitoring

3. **Media Dashboard** (`/media`) - Entertainment services
   - Tab: Streaming
   - Tab: Downloads
   - Tab: Libraries

### Icon Tips

HOPS uses [Iconify](https://icon-sets.iconify.design/) for icons, giving you access to 150,000+ icons.

**Popular icon prefixes:**
- `mdi:` - Material Design Icons (most common)
- `fa:` - Font Awesome
- `simple-icons:` - Brand logos (e.g., `simple-icons:plex`, `simple-icons:netflix`)
- `logos:` - Technology logos

**Examples:**
- `mdi:home`
- `mdi:server`
- `simple-icons:plex`
- `simple-icons:jellyfin`
- `logos:docker`

### Performance Tips

- Use smaller tile sizes when you have many tiles
- Collapse groups you don't use frequently
- Use descriptive group names to stay organized

### Backup Your Configuration

Your configuration is stored in SQLite at `/data/hops.db`. To backup:

```bash
cp data/hops.db data/hops.db.backup
```

### Security Best Practices

1. **Change the default password** immediately
2. Use a strong password for admin access
3. Only expose viewer mode publicly if needed
4. Use HTTPS in production (configure your reverse proxy)
5. Regularly backup your configuration

## Troubleshooting

### Can't Log In

- Verify you're using the correct credentials
- Check if the backend is running
- Clear browser cache and cookies

### Changes Not Saving

- Ensure you're in Edit Mode
- Check browser console for errors (F12)
- Verify the backend is running and accessible

### Icons Not Showing

- Verify the icon name is correct (check Iconify)
- Ensure you have internet connectivity (icons load from CDN)
- Try a different icon to test

### Tiles Not Appearing

- Check that the group isn't collapsed
- Verify the tile has a name and is saved
- Refresh the page

## Getting Help

- Check the main README.md for technical documentation
- Review the API documentation in docs/API.md
- Check the browser console (F12) for error messages
- Review backend logs for server-side errors

## What's Next?

Upcoming features:
- Global search with "/" hotkey
- Background images for dashboards and tabs
- Status checks for services (HTTP/ICMP)
- Service integrations and widgets
- Import from other dashboard systems (Heimdall, Homer, Dashy)

Stay tuned for updates!
