# HOPS Roadmap

A wishlist of what might come next. **Nothing here is promised** — HOPS
is a side project, so nothing on the list has a date and anything could
get bumped by a real-world bug or a change of mind.

Items are grouped by rough size, not by importance. A small item near
the top might matter more to you than a sprawling one near the bottom.

> Bug reports and feature suggestions are welcome via
> [GitHub Issues](https://github.com/weaversgrainthorpe/HOPS/issues).
> Security issues go through [SECURITY.md](SECURITY.md) instead.

---

## Already shipped

What was on the list and is now in released code. Full release notes
live in the [CHANGELOG](CHANGELOG.md).

- **Network Discovery** *(v2.0.0)*. Point HOPS at your home network and
  let it find what's already running — about 70 common homelab services
  recognised out of the box, plus a draft + curate flow so nothing
  lands on your dashboard until you tick it.
- **Install on a phone or tablet** *(in the next release)*. HOPS now
  works as a web-app: use your browser's "Add to Home Screen" and you
  get a full-screen icon that opens HOPS without any browser tabs or
  address bar around it — handy for a wall-mounted tablet. There's a
  small banner if you go offline, and tile status colours hold their
  last known state rather than turning everything red, so a Wi-Fi
  blip doesn't look like an outage.

---

## Small things — could happen soon

A few days of work each. Quality-of-life improvements that don't change
what HOPS is.

*(Nothing on this list right now — the PWA work that lived here
just shipped. Suggestions welcome via GitHub Issues.)*

## Medium things — would take a couple of weeks

Bigger, but each one is self-contained.

- **More ways to recognise a service** (extending Network Discovery):
  - **Pattern matching** instead of literal text matching, so a
    detector keeps working when a service's response wording drifts
    between versions.
  - **TLS certificate names**. HOPS already reads the certificate when
    it probes an HTTPS service — using the name on the certificate as
    a recognition signal is the next obvious thing to add.
  - **Manage the bundled favicon list**. There's a (currently empty)
    table of well-known favicon fingerprints HOPS could lean on. An
    admin page to add to it would help.
  - **Bulk-import favicon numbers** so you can paste a list rather
    than typing them one at a time.
- **Select several tiles at once** to delete, move, or edit in one go.
  Useful once a dashboard gets big.
- **Custom CSS**. Paste-your-own-styles in Settings, with a one-click
  reset for the "I broke it" case.
- **Smarter status checks**. Today HOPS treats only the usual "200 OK"
  family as up. Adding configurable expected codes (so a login page
  that returns "401" reads as up rather than down), per-tile timeouts,
  and an optional "the page must contain this text" check would cover
  the awkward cases.
- **A small status history on each tile** — a sparkline or a
  twenty-four-hour heatmap. HOPS already records the data; this just
  shows it.
- **Scheduled and off-site backups**. HOPS makes a backup every time
  it starts; adding a schedule and an off-site destination
  (S3-compatible, SFTP, rclone-style) means a dead SD card doesn't
  take everything with it.
- **A second login factor** (authenticator-app style). The pentest
  flagged the admin login as the highest-value target, and a TOTP
  flow with recovery codes is the standard next step.

## Bigger things — multiple weeks

These are still self-contained but a bit harder to get right.

- **Undo and redo**. Keep a history of recent changes so you can step
  backwards. Easier as a "this session only" feature first; tricker
  if it has to survive a reload.

## Stretch things — much bigger jobs

These would each turn HOPS into something a bit different. Worth
thinking about, not necessarily planning around.

- **A small helper that runs on each computer** in your house,
  reporting which apps are installed — so a tile for "Obsidian" only
  appears on the laptops that actually have Obsidian. Separate from
  Network Discovery: that asks "what's running on the network",
  this asks "what's installed on this machine".
- **Widgets** — tiles that show live content (weather, calendar,
  system stats) instead of just linking somewhere. Each widget is its
  own ongoing maintenance commitment.
- **First-class integrations** with specific apps (Pi-hole, Proxmox,
  the *arr stack, etc.). Each one is its own moving target, so this
  only makes sense once the widgets idea above has settled.

---

## Why no dates?

HOPS is maintained in spare time. The roadmap is a way to think out
loud about what's worth doing next, not a schedule. The CHANGELOG
is what's actually shipped.
