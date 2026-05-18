# Zero to Dashboard Hero

A step-by-step guide to getting HOPS running and creating your first dashboard. No experience required.

## What You'll Need

- A computer running **Linux**, **macOS**, or **Windows**
- 5 minutes

That's it. HOPS is a single binary with no dependencies — no database server, no runtime, no containers required (though Docker is available if you prefer it).

### Supported Platforms

| Platform | Architectures |
|----------|--------------|
| Linux | x86-64, ARM64 (Raspberry Pi 3B+/4/5/Zero 2 W) |
| macOS | Intel, Apple Silicon |
| Windows | x86-64 |

### Minimum Requirements

- **CPU**: Any single-core processor
- **RAM**: 256 MB
- **Disk**: 50 MB (more if you upload custom backgrounds/icons)

## Step 1: Install HOPS

Choose whichever method suits you best.

### Option A: Docker

Create a `docker-compose.yml` file:

```yaml
services:
  hops:
    build: .
    container_name: hops
    ports:
      - "8080:8080"
    volumes:
      - hops-data:/app/data
    restart: unless-stopped

volumes:
  hops-data:
```

Start it:

```bash
docker compose up -d
```

Skip to [Step 2](#step-2-log-in).

### Option B: Download

1. Go to the [Releases](https://github.com/weaversgrainthorpe/HOPS/releases) page
2. Download the package for your platform:
   - `hops-linux-amd64.tar.gz` — Linux x86-64
   - `hops-linux-arm64.tar.gz` — Linux ARM64 (Raspberry Pi 3B+/4/5/Zero 2 W)
   - `hops-darwin-amd64.tar.gz` — macOS Intel
   - `hops-darwin-arm64.tar.gz` — macOS Apple Silicon
   - `hops-windows-amd64.zip` — Windows x86-64

   Or download directly from the command line (replace the filename with your platform):
   ```bash
   curl -LO https://github.com/weaversgrainthorpe/HOPS/releases/latest/download/hops-linux-amd64.tar.gz
   ```

3. Extract and run:

**Linux / macOS:**
```bash
# Extract the package
tar -xzf hops-linux-amd64.tar.gz

# Create a data directory
mkdir -p data

# Start HOPS
./hops-linux-amd64 --port 8080 --data ./data --frontend ./frontend/build
```

**Windows:**
```powershell
# Extract hops-windows-amd64.zip (right-click → Extract All, or use 7-Zip)

# Create a data directory
mkdir data

# Start HOPS
.\hops-windows-amd64.exe --port 8080 --data .\data --frontend .\frontend\build
```

You should see structured-log output like:
```
time=2026-05-18T10:00:00.000Z level=INFO msg="server starting" version="HOPS v1.4.5" addr=:8080 data_dir=./data frontend_dir=./frontend/build
```

> **Tip:** Set `LOG_LEVEL=debug` for verbose output, or `warn`/`error` for quieter logs.

> **Note:** You may see a message about "Dashboard icons directory not found" on first run. This is normal — the directory is created automatically when you upload your first custom icon.

> **Note:** This runs HOPS in the foreground — it will stop when you close the terminal. To run HOPS as a background service, see the [Installation & Deployment Guide](DEPLOY.md).

## Step 2: Log In

1. Open your browser and go to **http://\<your-server-ip\>:8080** (or **http://localhost:8080** if running on the same machine). You'll land on the **admin login page** — that's HOPS's home screen until you've created some dashboards.
2. Log in with the default credentials:
   - Username: `admin`
   - Password: `admin`

> HOPS ships with a small "Sample" dashboard pre-installed so you can see what one looks like — visit `http://\<your-server-ip\>:8080/sample-1` to view it. The admin page (`/`) is where you create and manage dashboards.

## Step 3: Change Your Password

On first login with the default `admin`/`admin` credentials, HOPS will **automatically prompt you to set a new password** — the modal can't be dismissed until you do. Type your new password and click **Set Password**.

> If you ever want to change it later, click the **Change Password** button on the Admin page.

## Step 4: Create Your First Dashboard

1. On the Admin page, click **+ New Dashboard**
2. Enter a name, for example: `Home`
3. The URL path is auto-generated — change it if you like (e.g., `/home`)
4. Click **Save**
5. Click the dashboard name to open it — this also enables Edit Mode automatically

> **Tip:** You can rename a dashboard or change its path later by clicking the **pencil icon** next to it in the Admin page.

## Step 5: Edit Mode

You should now be looking at your empty dashboard with Edit Mode already enabled — you'll see an orange **Editing** indicator in the top bar.

You can toggle Edit Mode on and off at any time using the **pencil icon** in the navbar.

## Step 6: Add a Tab

On a brand new dashboard you'll see a centred **"Add Your First Tab"** button. Click it.

A new tab named **"New Tab"** appears in the tab bar immediately, and an edit modal opens so you can customise it. (Tabs are created first then edited — different from Groups and Tiles, which prompt for details before creation.)

1. Click **Add Your First Tab** (or **+ Add Tab** at the end of the tab bar if you already have one)
2. The tab is created instantly as `New Tab`. The edit modal opens — change the **Tab Name** to something like `Services`
3. Optionally set an icon, colour, opacity, or a tab-specific background
4. Click **Save**

> **Closed the modal by accident?** The tab still exists as `New Tab`. To rename it, hover over the tab in the tab bar — a small pencil icon appears next to it. Click that to reopen the edit modal.

## Step 7: Add a Group

Groups organize your tiles within a tab.

1. Click **Add Group** (at the bottom of the tab area)
2. Enter a name, for example: `Media`
3. Click **Create**

## Step 8: Add Your First Tile

1. Click **Add Tile** inside the group you just created
2. Fill in the details:
   - **Name**: the display name (e.g., `Plex`)
   - **URL**: the address of the service (e.g., `http://plex.local:32400`)
   - **Icon**: type an icon name like `simple-icons:plex`, or click **Browse** to search through 150,000+ icons
   - **Size**: pick Small, Medium, or Large
   - **Open Mode**: how the link opens — New Tab is usually the best choice
3. Click **Create**

Your first tile appears in the group. Click it to make sure the link works.

## Step 9: Make It Yours

Now that you have the basics, try a few things:

- **Add more tiles** to your group, or create new groups
- **Drag and drop** tiles to reorder them, or drag between groups
- **Set a background**: click the **Background** button in Edit Mode and choose from the preset library or upload your own
- **Try a theme**: click the **theme icon** in the header to switch between light/dark modes and colour presets
- **Right-click a tile** for copy, cut, and paste options
- **Open on your phone via QR**: on the Admin page, click the **QR icon** next to any dashboard to get a scannable code — point your phone camera at it to open the dashboard without typing the URL

## What's Next?

- **[User Guide](USER_GUIDE.md)** — Full feature reference: themes, backgrounds, slideshows, import/export, keyboard shortcuts, and more
- **[Installation & Deployment Guide](DEPLOY.md)** — Permanent setup: systemd services, reverse proxies, and backups
- **[README](README.md)** — Project overview and feature list
