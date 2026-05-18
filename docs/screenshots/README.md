# Screenshots

These images are referenced from the main project [README.md](../../README.md).

## Files needed

Drop PNG files matching these exact names into this directory. The main README already references them by path.

| File | What to capture | Aspect | Width (target) |
|------|-----------------|--------|----------------|
| `dashboard-hero.png` | A polished dashboard view — multiple tabs visible, a few groups with a healthy mix of tile sizes, a nice background. The "marketing money shot." | 16:9 or 16:10, landscape | 1600–1920px |
| `admin.png` | Admin page with 2–3 dashboards listed in the dashboard list, QR icons visible, header showing the version chip. | 16:9, landscape | 1400–1600px |
| `admin1.png` | QR code modal open over the admin page, showing a real dashboard URL encoded into the QR. Shows off a feature unique to HOPS. | 16:9, landscape | 1100–1400px |
| `edit-mode.png` | A dashboard in **edit mode** — the orange **Editing** indicator visible in the navbar, with the **+ Add Tab** and per-row **+ Add Tile** affordances visible. Use a different tab/background from the hero so it doesn't look redundant. | 16:9 or 16:10, landscape | 1400–1600px |
| `edit-tile.png` | The Tile editor modal open over a dashboard, showing all fields (Name, URL, Icon with custom/Iconify options, Background Color, Opacity, Delete/Cancel/Save). | Portrait-ish (modal) | 450–700px |
| `icon-picker.png` | The icon picker modal open, with the search bar populated (e.g. "prox") and a grid of filtered matches visible. | Roughly 3:2, modal is wider than tall | 700–1200px |
| `mobile.png` | A dashboard rendered at phone width (≤480px). Use Chrome/Firefox DevTools device emulation — iPhone 12 Pro or Pixel 5 work well. Show the responsive layout with collapsed navbar icons. | 9:19 portrait (phone) | 300–600px |

## Redaction checklist

The plan is to use real dashboards, so before saving:

- [ ] Blur or rename any **internal hostnames** (e.g. `proxmox.lan` → `nas.example`)
- [ ] Blur or rename any **internal IPs** (e.g. `10.10.0.5` → `192.168.1.5`)
- [ ] Blur or remove any **service names that reveal infrastructure** (e.g. specific Plex library names)
- [ ] Make sure no **session cookies, tokens, or login state** are visible in URL bars (crop the URL bar out, or screenshot just the page content)
- [ ] Tile subtitles that name family members or addresses → blur or replace

Use any image editor (GIMP, Photopea, macOS Preview's Markup) — a Gaussian blur over sensitive text is usually enough.

## How to capture

### Desktop screenshots (`dashboard-hero`, `admin`, `edit-mode`, `icon-picker`)

1. Open the running HOPS instance in a browser
2. Resize the window to your target width (e.g. 1600px wide)
3. Use the OS screenshot tool to capture just the browser viewport (not the chrome):
   - **macOS**: `Cmd+Shift+4`, then press Space, then click the browser window — captures the window without the OS frame
   - **Linux GNOME**: `Shift+PrtScn` and drag, or use Flameshot
   - **Windows**: Win+Shift+S, drag

### Mobile screenshot (`mobile.png`)

1. Open HOPS in Chrome or Firefox
2. Open DevTools (F12)
3. Click the device toolbar icon (Ctrl+Shift+M / Cmd+Shift+M)
4. Pick a device — iPhone 12 Pro or Pixel 5
5. Screenshot just the device viewport area

## Demo recording (optional but high-impact)

In addition to the still screenshots, a short looping clip of HOPS in action converts much better than any static shot. Used by both the README and the landing page.

| File | What to capture | Format | Duration | Width |
|------|-----------------|--------|----------|-------|
| `demo.gif` | A 30–45s walkthrough: enter Edit Mode, drag a tile, switch tabs, open the icon picker and search, hit the QR code icon on the admin page. Keep it tight — no dead time. | GIF (no audio) | 30–45s | 800–1200px |
| `demo.mp4` | Same recording as `.gif`, just exported as MP4 for the landing page's `<video>` element (autoplay, muted, loop). | MP4 (h.264, no audio) | 30–45s | 1280×720 or 1920×1080 |

### Capture tips

- **macOS**: `Cmd+Shift+5` → "Record Selected Portion" → drag, hit Record.
- **Linux**: [Peek](https://github.com/phw/peek) for GIF (one-click), [OBS](https://obsproject.com) for MP4.
- **Windows**: Xbox Game Bar (Win+G), or [ShareX](https://getsharex.com/).
- Hide the mouse cursor when possible — most tools have an option.
- Record at the largest size, then downscale + compress (the source quality matters more than you'd think).
- For GIF, run through [gifski](https://gif.ski/) to keep file size manageable while preserving quality. Target: under 5 MB for a 30s loop.

### Suggested 30-second storyboard

1. **0–5s**: Land on a dashboard in view mode, click a tile (zoom out / bounce a little to show it's live)
2. **5–10s**: Click the pencil icon → "Editing" chip appears → drag a tile to a new group
3. **10–18s**: Click "+ Add Tile" → modal opens → type name + URL → click Browse on icon → search "proxmox" → pick one → Create
4. **18–25s**: Switch tabs (show responsiveness) → resize browser to phone width to show responsive layout
5. **25–30s**: Back to admin page → click QR icon → big QR code appears

After recording, drop the file(s) into `docs/screenshots/` and uncomment the placeholder blocks in `README.md` and `docs/index.html`.

## File size

GitHub renders inline images directly, so keep these reasonable — under ~500 KB each (the demo GIF can go up to ~5 MB). Run PNGs through [TinyPNG](https://tinypng.com/) or `pngquant`, GIFs through [gifski](https://gif.ski/).

## Commit

```bash
git add docs/screenshots/*.png
git commit -m "Add README screenshots"
git push
```

The images will appear in the main README automatically once pushed.
