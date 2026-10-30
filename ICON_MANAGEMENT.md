# Icons in HOPS (v3.0.1)

Every tile, folder and tab can have an icon. HOPS comes with thousands of
icons that work with no internet connection, and you can upload your own.

![The icon picker](docs/screenshots/icon-picker.png)

## Where icons come from

| Source | What it is | Needs the internet? |
|--------|------------|---------------------|
| **Dashboard Icons** | About 2,300 app and service logos (Plex, Proxmox, Home Assistant, …), some with light and dark variants, from the [Dashboard Icons](https://github.com/homarr-labs/dashboard-icons) collection. Built into HOPS and served by your HOPS server. | No |
| **Preset library** | Generic icons in the built-in categories (Containers, Media & Streaming, Networking, …). | No, for the ones in the offline bundle (below) |
| **Offline bundle** | The Material Design and Simple Icons icons HOPS uses itself and suggests, built into the web interface. | No |
| **Your uploads** | PNG, JPG, GIF, WebP or SVG images you upload. Stored on your HOPS server. | No |
| **Any other Iconify name** | Any of the 200,000+ icons at [iconify.design](https://icon-sets.iconify.design/), typed by name (for example `mdi:server`). | Yes: fetched from the Iconify service when first shown |

HOPS never needs the internet to run. The only time it reaches out for an
icon is when you choose an Iconify icon that isn't built in. If you want a
fully offline HOPS, stick to Dashboard Icons, the offline bundle and your
own uploads. **Settings › Icons › Offline and limits** shows exactly how many
icons of each kind your HOPS has.

## Choosing an icon

In edit mode, open a tile, folder or tab dialog and click **Edit icon**. The
**Edit icon** dialog has:

- **The name field.** Type part of a name (`plex`, `router`, `mdi:server`)
  for suggestions. Use ↑ and ↓ to move and Tab or Enter to accept. The
  suggestions cover Dashboard Icons, your uploads, and every name in the
  Material Design and Simple Icons sets. Each suggestion shows a preview; one
  that can't be shown (for example because you're offline and it isn't
  built in) says *Preview unavailable* rather than showing a blank.
- **Browse**, which opens the icon library (see below).
- **Upload**, to use an image of your own. It is stored in HOPS and added to
  the **Uploads** category, so you can reuse it on other tiles.
- **Icon background**, a colour behind the icon: pick a swatch, any colour,
  or none. It helps a dark logo stand out on a dark tile, or gives a
  transparent PNG a solid backing. The preview shows the result.

Click **Done**, then save the tile, folder or tab dialog, then **Save** in the
toolbar. Like every edit, the icon change is part of your draft until you
save.

On a tile, **Icon opacity** (in the tile dialog) fades the icon on its own,
separate from the tile's background and text.

### The icon library

**Browse** opens **Choose an Icon**:

- **Search icons...** searches every category at once.
- **My Uploads** lists the icons you've uploaded. **Recently Used** lists the
  last 20 icons you picked in this browser.
- The category tabs show the built-in categories and any you've added.
  **Add Category** adds one.
- **Add Icon to** *category* adds an icon to the category you're looking at,
  either an Iconify name (with an optional colour) or an uploaded image.

Click an icon to use it.

### Importing

When you import from Homer, Dashy, Heimdall or another HOPS, **Auto-match
icons** (ticked by default) picks icons from the tile names. Icons inside a
HOPS export come with it. Anything HOPS can't bring across is listed when the
import finishes.

## Settings › Icons

**Settings › Icons** is where you manage icons outside a dashboard.

### Uploaded icons

- **Upload icons**: choose one or several images, and the category they go
  in (**Upload into**). Each is named after its file; you can rename it later.
- **Search icons** and **Show category** filter the list.
- Each icon's pencil button lets you change its **Name** and **Category**.
- Deleting an icon that's in use opens **This icon is in use**, which lists
  every dashboard, tab, folder and tile that uses it. **Keep icon** backs
  out; **Delete anyway** deletes it, and those places then show no image.

### Your categories

Add, rename and delete your own categories. Deleting a category asks where
its icons should go (**Move its icons to**) first, so no icon is lost.

The built-in categories, including **Uploads**, come with HOPS and can't be
renamed or deleted, but your own icons can go in them.

### Packaged icons

Search everything built into HOPS: Dashboard Icons, the preset library and
the offline bundle. Filter by **Source** or **Built-in category**, and copy an
icon's name to paste into a tile's **Edit icon** field.

### Offline and limits

How many icons of each kind are built in, which of them work offline, and
where to change the upload limit.

## Uploads

- Formats: PNG, JPG, GIF, WebP and SVG.
- Size limit: **Largest icon upload** in **Settings › Global settings ›
  Uploads** (2 MB by default). A bigger file is refused with a message
  saying so.
- PNG, JPG, GIF and WebP images are resized to 128×128 and stored as PNG.
  SVG files are kept as they are.
- Uploaded icons are stored in the `icons/` folder inside HOPS's data folder.
  They are included when you **Download** a backup, and travel inside an
  export.
- For safety, HOPS serves uploaded files with a policy that stops them
  running scripts, so an SVG with a script in it can't do anything.

When you delete an uploaded icon, HOPS keeps the file for as long as a
backup still uses it, so restoring an older backup brings the icon back.

## Tips

- Looking for a service's logo? Type its name in **Edit icon** first:
  Dashboard Icons covers most homelab apps.
- Need a generic symbol (a server, a lamp, a camera)? Try a Material Design
  name such as `mdi:server`, `mdi:lightbulb` or `mdi:cctv`. Browse the set at
  [iconify.design](https://icon-sets.iconify.design/).
- A logo that disappears against your theme? Give it an **Icon background**.
