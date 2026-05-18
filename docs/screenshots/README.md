# Screenshots

These images are referenced from the main project [README.md](../../README.md).

## Files needed

Drop PNG files matching these exact names into this directory. The main README already references them by path.

| File | What to capture | Aspect | Width (target) |
|------|-----------------|--------|----------------|
| `dashboard-hero.png` | A polished dashboard view — multiple tabs visible, a few groups with a healthy mix of tile sizes, a nice background. The "marketing money shot." | 16:9 or 16:10, landscape | 1600–1920px |
| `admin.png` | Admin page with 2–3 dashboards listed in the dashboard list, QR icons visible, header showing the version chip. | 16:9, landscape | 1400–1600px |
| `edit-mode.png` | A dashboard in **edit mode** — the orange **Editing** indicator visible in the navbar, ideally with an edit affordance shown (e.g. a tile edit modal open, or hover state revealing the edit pencil on a tile). | 16:9 or 16:10, landscape | 1400–1600px |
| `icon-picker.png` | The icon picker modal open, showing a category tab with a grid of icons. Search bar visible if possible. | Roughly 4:3, the modal is usually portrait-ish | 1000–1200px |
| `mobile.png` | A dashboard rendered at phone width (≤480px). Use Chrome/Firefox DevTools device emulation — iPhone 12 Pro or Pixel 5 work well. Show the responsive layout with collapsed navbar icons. | 9:19 portrait (phone) | 400–600px |

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

## File size

GitHub renders inline images directly, so keep these reasonable — under ~500 KB each. Run through [TinyPNG](https://tinypng.com/) or `pngquant` if larger.

## Commit

```bash
git add docs/screenshots/*.png
git commit -m "Add README screenshots"
git push
```

The images will appear in the main README automatically once pushed.
