# HOPS Roadmap

A wishlist of what might come next. **Nothing here is promised.** HOPS
is a side project, so nothing on the list has a date, and anything could
get bumped by a real-world bug or a change of mind.

Items are grouped by rough size, not by importance. A small item near
the top might matter more to you than a sprawling one near the bottom.

> Bug reports and feature suggestions are welcome via
> [GitHub Issues](https://github.com/weaversgrainthorpe/HOPS/issues).
> Security issues go through [SECURITY.md](SECURITY.md) instead.

---

## What HOPS is (and isn't)

HOPS is a fast, good-looking **launcher**. It's a menu of links that get
you to your tools' own web pages quickly. Everything is set up through
HOPS's own screens, and it runs happily on something as small as a
Raspberry Pi Zero. Ideas are judged against that. See
[Not planned](#not-planned-and-why) at the bottom for things that would
turn HOPS into something else.

---

## Already shipped

What was on the list and is now in released code. Full release notes
live in the [CHANGELOG](CHANGELOG.md).

### v3

- **Folders.** They replace v2's groups. Folders can be nested and
  paged, and minimised to a single tile showing a preview of what's
  inside. They come in a choice of shapes, and look the same while you
  view and while you edit.
- **Direct editing.** Drag and drop things where you want them, resize
  folders, merge two tiles into a folder, and move or copy items in and
  out of folders. **Undo and redo** cover the whole editing session.
  **Select several items at once** to move, copy or delete them together.
- **Home and Away addresses.** A tile can have a second address, such as
  your Tailscale or VPN address. Each browser picks Home or Away.
- **"Add to HOPS" bookmark.** Click it on any web page to add that page
  as a tile, with its name and icon already filled in.
- **Search everywhere.** Search reaches inside every folder and shows
  where each tile lives. You can open a tile or jump to it.
- **Recently used.** An optional row of the tiles you open most. It's
  kept on each device and never leaves it.
- **SSH tiles.** These open your computer's SSH app, with a status check
  on the SSH port.
- **Dead-link report and duplicate finder.** These spot tiles that have
  been failing for a while, and tiles that point at the same address.
- **Network Discovery, extended.** Over 90 services are recognised out
  of the box, now including AI tools. Re-scans show what's new, changed
  or gone since last time.
- **Settings, reorganised.** Grouped global settings, a page for managing
  icons (your uploads and everything packaged), and a log viewer.
- **Backups you can trust.** Retention rules, download and upload
  (images included), and restores that never lose your data. Every
  failure is shown, never hidden.
- **Animations**, which you can turn off, plus a security pass:
  stricter browser security headers, hardened uploads and imports, and
  up-to-date dependencies.

### Earlier

- **Network Discovery** *(v2.0.0)*. Point HOPS at your home network and
  let it find what's already running, with a draft and curate step, so
  nothing lands on your dashboard until you tick it.
- **Install on a phone or tablet** *(v2.1)*. HOPS works as a web app.
  Use "Add to Home Screen" for a full-screen icon, handy for a
  wall-mounted tablet. If you go offline, a banner says so, and tiles
  keep their last known status.

---

## Small things: could happen soon

A few days of work each. Quality-of-life improvements that don't change
what HOPS is.

- **Smarter status checks:**
  - configurable "up" status codes, so a login page that returns 401
    reads as up;
  - per-tile timeouts;
  - an optional "the page must contain this text" check.
- **Automatic Home/Away.** Pick Home or Away from the address you used
  to reach HOPS (your home IP vs a remote name), with the manual toggle
  still there to override it.

## Medium things: would take a couple of weeks

Bigger, but each one is self-contained.

- **More ways to recognise a service** (extending Network Discovery):
  - **Pattern matching** instead of literal text matching, so a
    detector keeps working when a service's wording drifts between
    versions.
  - **TLS certificate names.** HOPS already reads the certificate when
    it probes an HTTPS service, so the name on it is an obvious extra
    signal.
  - **Manage the bundled favicon list**, plus bulk-import of favicon
    fingerprints.
  - **mDNS / UPnP listening.** Find web pages that announce themselves
    (printers, NAS boxes) and that port scanning misses.
- **Scheduled and off-site backups.** HOPS already backs up before every
  change and on start-up, keeps them under retention rules, and lets you
  download them. Next: a schedule, and an automatic off-site copy
  (S3-compatible, SFTP), so a dead SD card doesn't take everything with
  it.
- **A second sign-in factor** (authenticator app), with recovery codes.
  The admin sign-in is the highest-value target, and this is the
  standard next step.
- **Full-fidelity editing on smaller screens.** On laptops and tablets,
  a folder sized for a large screen draws taller so it fits. In edit
  mode it currently shows its saved size, with a note. Drawing the
  taller version while editing too needs careful drag-and-drop mapping.
- **Custom CSS.** Paste your own styles in Settings, with a one-click
  reset for the "I broke it" moment. It would have to work within
  HOPS's browser security policy.

## Bigger things: multiple weeks

These are still self-contained, but harder to get right.

- **Easy install.** A one-command Proxmox VM/container script and a
  ready-made appliance image (OVA), alongside the single file and Docker.

## Stretch things: much bigger jobs

These would each stretch what HOPS is. They're worth thinking about,
but not something to plan around.

- **A small helper on each computer.** It could do two things:
  - Report which apps are installed, so a tile for "Obsidian" only
    appears on the computers that have it.
  - Run **named scripts** that you've approved on that computer, from a
    tile. Scripts would never run on the HOPS server itself: with one
    admin password, that would be too much power behind one login.

---

## Not planned (and why)

These come up often. They're deliberately left out to keep HOPS simple,
fast and safe.

- **User accounts and roles.** HOPS has one admin, and dashboards are
  for anyone who can reach it. If you need per-person access control,
  a different product will serve you better.
- **Live-data widgets and app integrations** (download queues, disk
  space, weather, Plex activity). Each one is a moving target to
  maintain, and HOPS is a launcher, not a dashboard of statistics.
  Homepage and Homarr do this well.
- **Monitoring graphs and status history.** Uptime Kuma and friends do
  this properly. HOPS shows whether a tile is up now, and the dead-link
  report covers "it's been down for days".
- **Embedding tools inside HOPS** (a web SSH terminal, for example).
  These need stored credentials and heavy dependencies, which goes
  against HOPS's small, safe footprint.

---

## Why no dates?

HOPS is maintained in spare time. The roadmap is a way to think out
loud about what's worth doing next, not a schedule. The CHANGELOG
is what's actually shipped.
