# Screenshots

These images are used by the project [README.md](../../README.md) and the
GitHub Pages site ([docs/index.html](../index.html)). Both reference them by
the exact file names below.

## Capture from the Sample only

Every capture uses the **Sample** dashboard that a fresh install creates
(**Settings › Factory reset** brings it back). Its addresses are made-up
(`*.example.lan`), so there is nothing private to hide. Don't capture a real
dashboard.

Before capturing:

- Use a fresh install or a factory reset, signed in, with the default
  password already changed.
- Crop out the browser's address bar and tabs.
- Use the default theme unless a shot says otherwise.

## Files needed

| File | What to capture | Shape | Width (target) |
|------|-----------------|-------|----------------|
| `dashboard-hero.png` | The Sample's **Home** tab on a desktop, in view mode: tiles in all three sizes, folders (one with a folder inside it), and the background picture. This is the main shot and the video poster. | 16:9 or 16:10 landscape | 1600–1920px |
| `folders.png` | Open folders, nesting and folder shapes: the Sample's **Shapes** tab (every **Look**, tabs on the left, centre and right, *Upstairs* nested), or the **Folders** tab with *Projects › Lab › Dashboards* opened so the path shows in the title bar. | 16:9 landscape | 1400–1600px |
| `edit-mode.png` | A dashboard in edit mode: the **Editing** badge in the top bar, the toolbar at the bottom (**Save**, **Discard**, **Undo**, **Redo**, **Add tile**, **Add folder**, **Add tab**, **Dashboard**), and two or more items selected (Ctrl-click). | 16:9 landscape | 1400–1600px |
| `edit-tile.png` | The tile dialog open over the dashboard: **Tile type**, **Name**, **Address**, **Away address (optional)**, **Size**, **Open Mode** and the **Status checks** row visible. | Portrait-ish (dialog) | 600–900px |
| `icon-picker.png` | The icon picker open from **Edit icon**, with a search typed (e.g. "prox") and a grid of matches. | About 3:2 | 900–1200px |
| `mobile.png` | The Sample on a phone (≤ 480px wide): use browser DevTools device emulation (iPhone 12 Pro or Pixel 5). | 9:19 portrait | 390–600px |
| `settings.png` | The Settings page, **Dashboards** open, showing the dashboard list with its buttons and the settings menu (Dashboards with Dead links, Duplicates and Status check overrides; Icons, Global settings, Discovery, Backups, Logs, Password, Factory reset). | 16:9 landscape | 1400–1600px |
| `qr.png` | The QR code dialog for the Sample (**Settings › Dashboards**, the dashboard's QR button), with the dashboard name above the code and **Copy URL**. | About 4:3 | 900–1200px |
| `discovery.png` | Network Discovery results for a scan: the draft list with confidence, names and icons, ideally with the new / changed / gone counts from a re-scan. Scan only a test network of made-up or documentation addresses (192.168.1.x), and check no real hostname shows. | 16:9 landscape | 1400–1600px |

## How to capture

### Desktop shots

1. Open HOPS in a browser.
2. Resize the window to the target width (e.g. 1600px).
3. Capture just the page, not the browser frame:
   - **macOS**: `Cmd+Shift+4`, then Space, then click the window.
   - **Linux GNOME**: `Shift+PrtScn` and drag, or use Flameshot.
   - **Windows**: `Win+Shift+S` and drag.

### Phone shot (`mobile.png`)

1. Open HOPS in Chrome or Firefox and open DevTools (F12).
2. Turn on the device toolbar (`Ctrl+Shift+M` / `Cmd+Shift+M`).
3. Pick iPhone 12 Pro or Pixel 5.
4. Capture just the device viewport.

## Demo recording

A short looping clip shows HOPS better than any still. The README uses the
GIF; the site uses the MP4 (with `dashboard-hero.png` as its poster).

| File | Format | Duration | Size |
|------|--------|----------|------|
| `demo.gif` | GIF, no audio | 30–45s | 800–1200px wide, under 5 MB |
| `demo.mp4` | MP4 (H.264), no audio | 30–45s | 1280×720 or 1920×1080 |

Both are the same recording, from the Sample.

### Suggested storyboard

1. **0–5s**: the Sample in view mode. Open a minimised folder, then a folder
   inside it, and click the path to go back up.
2. **5–15s**: click the pencil. Drag a tile onto another and hold to make a
   folder. Press Ctrl+Z to undo it, then Ctrl+Shift+Z to redo.
3. **15–25s**: **Add tile**: type a name and address, click **Edit icon**,
   search "proxmox", pick one, **Create**, then **Save** in the toolbar.
4. **25–35s**: switch to the **Shapes** tab; flip **Home** / **Away** (the
   Sample has no away addresses, so give one tile an **Away address
   (optional)** before recording).
5. **35–45s**: narrow the window to phone width, then open
   **Settings › Dashboards** and show the QR code.

### Capture tips

- **macOS**: `Cmd+Shift+5` → Record Selected Portion.
- **Linux**: [Peek](https://github.com/phw/peek) for GIF, [OBS](https://obsproject.com) for MP4.
- **Windows**: Xbox Game Bar (`Win+G`) or [ShareX](https://getsharex.com/).
- Hide the mouse cursor where you can, and cut dead time.
- Record large, then scale down and compress. Run the GIF through
  [gifski](https://gif.ski/).

## File size

Keep each PNG under about 500 KB (the GIF can go up to about 5 MB). Run PNGs
through `pngquant` or [TinyPNG](https://tinypng.com/).
