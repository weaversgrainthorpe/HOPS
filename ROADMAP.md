# HOPS Roadmap

Future improvements under consideration. **Nothing here is committed work** —
no dates, no priorities beyond the rough sequencing below, no SLAs. HOPS is
maintained in limited spare time; this is a living wishlist used to think
about what comes next, not a schedule.

Items are grouped by effort and architectural risk, not by user value. A
low-risk Tier 1 item may be more useful to you than a sprawling Tier 4 one.

> Bug reports and feature suggestions are welcome via
> [GitHub Issues](https://github.com/weaversgrainthorpe/HOPS/issues).
> Security-sensitive items go through [SECURITY.md](SECURITY.md) instead.

---

## Shipped

These were on the roadmap as Tier 4 ambitions and are now live in
released code. Kept here briefly for the historical paper trail; see
the [CHANGELOG](CHANGELOG.md) for full release notes.

- **Network Discovery + draft dashboard** *(v2.0.0)*. Scan a CIDR,
  IP range, or specific IP (any combination, with per-target
  exclusions) at three intensity levels; passive sources (ARP, mDNS, DNS PTR
  +AXFR, UPnP/SSDP, SNMP) plus active port + HTTP fingerprinting;
  forward DNS enumeration of an internal domain for reverse-proxy-
  fronted services; 70 bundled detectors; curate-before-promote;
  auto-grouping by category on promote; Phase-4 GUI-managed user
  detectors with one-click bundled-detector overrides and reset; a
  diagnostics view that surfaces every unidentified service as a
  promotion candidate. SQLite-backed, no YAML, never auto-committed.
  Discovery is intentionally a starting point — results depend on
  network topology, firewall/AV interference, and whether services
  respond to unauthenticated probes; every scan is a reviewable
  draft. Coverage continues to improve release-over-release.

---

## Tier 1 — Quick wins

Frontend-mostly, low risk, days of work each. These make HOPS noticeably
nicer for daily use without changing what it is.

- **PWA support.** Manifest, service worker, offline fallback. SvelteKit
  makes most of this near-free; the payoff is "install HOPS as an app" on
  a phone or tablet, which fits the wall-mounted-dashboard use case.

## Tier 2 — Useful, modest scope

A week or two each. Higher value but more state to wrangle.

- **Multi-select and bulk operations.** Checkbox-select multiple tiles to
  delete, move between groups, or edit common properties in one go. Scales
  with how many tiles you maintain.
- **Custom CSS injection.** Admin-pastes-CSS-in-Settings, injected as a
  `<style>` tag. Powerful but introduces a "user broke their own UI" mode;
  needs a reset-CSS escape hatch and probably a preview/confirm step.
- **Richer status checks.** Today's HTTP HEAD treats only 2xx/3xx as up.
  Configurable expected status codes (so 401 from a service requiring auth
  reads as up), per-tile timeout overrides, and an optional response-body
  substring match would catch the cases where HEAD's verdict is misleading.
- **Per-tile status history.** A small sparkline or 24-hour heatmap on each
  tile showing recent up/down/error. The data is already collected —
  extending `status_cache` from latest-only to a small ring buffer and
  rendering a tiny chart per tile is modest work.
- **Scheduled / off-site backup.** HOPS already writes a startup backup
  into `data/backups/`. Add a configurable schedule and an off-site
  destination (S3-compatible / SFTP / rclone-style) so the "I lost the SD
  card" failure mode doesn't take the whole install with it. Aligns with
  the "config = one SQLite file" pitch.
- **TOTP / 2FA on admin login.** A standard TOTP flow (authenticator app,
  recovery codes) layered on top of the existing bcrypt + rate-limit +
  Secure cookies. The pentest flagged the admin login as the high-value
  target; MFA is the next defensive step.

## Tier 3 — Real complexity, state-heavy

Several weeks. State management is the hard part.

- **Undo / Redo.** Keep an action history with reversible mutations.
  Tractable as in-session-only first, much harder as a persistent feature.
  Best tackled after iteration patterns on the save pipeline have stabilised
  so the action model doesn't churn.

## Tier 4 — Major architectural shift

Months, and arguably "next-major-version" work. Each item turns HOPS into
something meaningfully bigger.

- **Local launcher agent + per-device tiles.** A small companion binary the
  user runs on each daily-driver machine (Mac / Linux / Windows) that
  enumerates installed URL protocol handlers — Obsidian, VS Code, Steam,
  Spotify, Slack desktop, 1Password, etc. — and reports them to HOPS. The
  dashboard then renders a per-device set of "quick launcher" tiles so an
  `obsidian://` link only shows up on devices where Obsidian is installed.
  Real cost is the surrounding plumbing, not the agent: per-user device
  registry, device-token issuance, per-device tile filtering in the
  frontend, signed multi-platform binary distribution, refresh cadence
  (manual re-run vs LaunchAgent / cron / Task Scheduler). Distinct from
  Network Discovery — that asks "what's on the wire"; this asks "what's
  installed on this endpoint".
- **Widget framework.** Tiles today launch URLs; widgets would render live
  content — weather, calendar, system stats, etc. Needs a widget API,
  registry, per-widget config, polling, and error handling. Every widget is
  a new failure surface and a new ongoing maintenance commitment.
- **Service integrations (Pi-hole, Proxmox, \*arr apps, etc.).** Natural
  extension of widgets but each integration is its own ongoing work — APIs
  change, auth schemes vary, breakage in any one can affect every user.
  Best deferred until the widget framework above is mature enough to host
  them as plugins rather than core code.

---

## Why no dates?

HOPS is a side project maintained alongside everything else. The roadmap is
a thinking tool, not a contract. Tier 1 items will probably ship sooner
than Tier 4, but anything could be pre-empted by a real-world bug,
security finding, or shift in personal priorities. The CHANGELOG records
what actually shipped.
