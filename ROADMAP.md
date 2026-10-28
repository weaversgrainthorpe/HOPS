# HOPS Roadmap

A wishlist of what might come next. **Nothing here is promised.** HOPS
is a side project, so nothing on the list has a date, and anything could
get bumped by a real-world bug or a change of mind.

Items are grouped by rough size, not by importance. A small item near
the top might matter more to you than a sprawling one near the bottom.
What has already shipped is in the [CHANGELOG](CHANGELOG.md).

> Bug reports and feature suggestions are welcome via
> [GitHub Issues](https://github.com/weaversgrainthorpe/HOPS/issues).
> Security issues go through [SECURITY.md](SECURITY.md) instead.

---

## What HOPS is (and isn't)

HOPS is a fast, good-looking **launcher**. It's a menu of links that get
you to your tools' own web pages quickly. Everything is set up through
HOPS's own screens, and it runs happily on something as small as a
Raspberry Pi Zero 2 W. Ideas are judged against that. See
[Not planned](#not-planned-and-why) at the bottom for things that would
turn HOPS into something else.

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
