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

You should see output like:
```
HOPS v1.2.0 starting on :8080
Data directory: ./data
Frontend directory: ./frontend/build
```

## Step 2: Log In

1. Open your browser and go to **http://localhost:8080**
2. You'll see the HOPS interface — it's empty for now, that's fine
3. Click the **Admin** link or go to **http://localhost:8080/admin**
4. Log in with the default credentials:
   - Username: `admin`
   - Password: `admin`

## Step 3: Change Your Password

Do this now, before anything else.

1. On the Admin page, click **Change Password**
2. Enter the current password (`admin`) and your new password
3. Click **Save**

## Step 4: Create Your First Dashboard

1. On the Admin page, click **Create New Dashboard**
2. Enter a name, for example: `Home`
3. Enter a path, for example: `/home`
4. Click **Save**
5. Click the dashboard name to open it

## Step 5: Enter Edit Mode

You should now be looking at your empty dashboard.

1. Click the **pencil icon** in the header bar — this toggles Edit Mode
2. You'll see editing controls appear throughout the interface

## Step 6: Add a Tab

1. Click **+ New Tab**
2. Enter a name, for example: `Services`
3. Click **Save**

Your tab appears at the top of the dashboard.

## Step 7: Add a Group

Groups organize your tiles within a tab.

1. Click **+ Add Group** (at the bottom of the tab area)
2. Enter a name, for example: `Media`
3. Click **Save**

## Step 8: Add Your First Tile

1. Click **+ Add Entry** inside the group you just created
2. Fill in the details:
   - **Name**: the display name (e.g., `Plex`)
   - **URL**: the address of the service (e.g., `http://plex.local:32400`)
   - **Icon**: type an icon name like `simple-icons:plex`, or click **Browse** to search through 150,000+ icons
   - **Size**: pick Small, Medium, or Large
   - **Open Mode**: how the link opens — New Tab is usually the best choice
3. Click **Save**

Your first tile appears in the group. Click it to make sure the link works.

## Step 9: Make It Yours

Now that you have the basics, try a few things:

- **Add more tiles** to your group, or create new groups
- **Drag and drop** tiles to reorder them, or drag between groups
- **Set a background**: click the **Background** button in Edit Mode and choose from the preset library or upload your own
- **Try a theme**: click the **theme icon** in the header to switch between light/dark modes and colour presets
- **Right-click a tile** for copy, cut, and paste options

## What's Next?

- **[User Guide](USER_GUIDE.md)** — Full feature reference: themes, backgrounds, slideshows, import/export, keyboard shortcuts, and more
- **[Installation & Deployment Guide](DEPLOY.md)** — Permanent setup: systemd services, reverse proxies, and backups
- **[README](README.md)** — Project overview and feature list
