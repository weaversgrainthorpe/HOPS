# HOPS Tenets

These are the load-bearing promises of HOPS — the things it *is*, not just
features it happens to have. They define the product's identity and are meant
to be stable across releases.

Treat them as a checklist: every pull request and every release should be able
to answer "does this still hold?" for each tenet below. If a change would break
one, that's not a normal trade-off — it's a deliberate decision to redefine what
HOPS is, and should be called out explicitly.

Each tenet states the **principle**, what it means **in practice**, and what
would **violate** it (so it can be validated rather than admired).

---

## 1. GUI-first, zero config files

**Principle.** Everything is configured by clicking and dragging in the admin
UI. No YAML, no JSON, no TOML, no env-var soup.

**In practice.** Even runtime settings — port, log level, reverse-proxy trust,
rate limits, timeouts, upload caps, session lifetime — live on the Settings page
and persist in SQLite. The only command-line inputs are the bootstrap paths that
must exist *before* the database is open: `--data` (and `--host` as an operator
security choice; `--frontend` is a dev-only override).

**Violated by.** Introducing a config file users are expected to edit; requiring
an env var to enable a feature; adding a setting that can *only* be changed via
flag or file rather than the GUI.

## 2. Single self-contained binary

**Principle.** HOPS is one executable plus a SQLite database. Download one file,
run it, done.

**In practice.** The release asset for each platform is a single binary with the
web UI compiled in (`//go:embed`). Nothing to unpack, no sidecar folder, no
separate frontend to deploy, no runtime to install, no database server.

**Violated by.** Shipping a release that requires a companion directory or a
second process to serve the UI; splitting the download into multiple files the
user must keep together; depending on an external service to boot.

> Note: this tenet regressed once — the UI quietly became a `frontend/build/`
> folder served from disk alongside the binary. Restored by embedding the UI
> back into the binary. This is exactly the kind of drift these tenets exist to
> catch.

## 3. Everything embedded

**Principle.** What HOPS needs to run ships *inside* HOPS.

**In practice.** The web UI, the ~2,300 dashboard icons, and the background
presets are all embedded in the binary. Config exports are self-contained too —
uploaded icons and backgrounds are inlined as base64 so an export imports cleanly
on a different host.

**Violated by.** Fetching icons/UI/assets from a CDN at runtime; an export that
references files it doesn't contain; a "first run" that downloads assets.

## 4. Runs anywhere

**Principle.** From a Raspberry Pi Zero 2 W to a full server, on the OS you
already have.

**In practice.** Linux, macOS, and Windows; x86-64 and ARM64. Pure Go, `CGO_ENABLED=0`,
statically linked — no glibc dependency, no platform-specific runtime. Modest
footprint (runs in 256 MB RAM).

**Violated by.** Adding a CGO dependency; dropping a supported OS/arch from the
release matrix; a feature that only works on one platform; a hard RAM/CPU floor
that excludes small boards.

## 5. Cancel-safe editing

**Principle.** Nothing changes until you commit it.

**In practice.** Every edit — tiles, groups, tabs, settings — is applied only on
an explicit Create/Save. Cancelling or navigating away leaves state exactly as it
was. No autosave surprises, no partial writes.

**Violated by.** An editor that mutates persisted state before the user confirms;
a "live" setting that takes effect mid-edit; losing the ability to back out of a
change cleanly.

## 6. Batteries-included onboarding

**Principle.** A fresh install becomes useful in minutes, not an evening.

**In practice.** Built-in network discovery scans the LAN and proposes tiles, so
a new user isn't staring at an empty dashboard hand-entering every service.

**Violated by.** Requiring extensive manual setup before HOPS does anything
useful; gating first-run value behind external accounts or integrations.

## 7. Multiple dashboards from one instance

**Principle.** One HOPS hosts many dashboards.

**In practice.** Distinct dashboards live at distinct URLs (`/home`, `/network`,
`/media`, …), each independently customisable, from a single running instance and
database.

**Violated by.** Forcing one dashboard per process/install; coupling dashboards
so they can't be configured independently.

## 8. Free, open source, self-hosted, homelab-first

**Principle.** HOPS is MIT-licensed, runs on your hardware, and is built for the
homelab.

**In practice.** No paywalled features, no hosted-only capabilities, no vendor
account required. The whole thing runs under your control.

**Violated by.** A feature locked behind a license key or paid tier; a capability
that only works against a hosted backend; relicensing away from open source.

## 9. Effortless upgrades & data safety

**Principle.** Upgrading is a drop-in binary swap, and your data is protected
across it.

**In practice.** Replace the binary and restart — no migration dance, no
config-format breakage. Schema migrations run automatically on startup, and a
database backup is taken automatically at startup before anything touches the DB.

**Violated by.** An upgrade that requires manual migration steps or hand-editing
data; a release that breaks an existing config/DB without an automatic path
forward; removing or weakening the startup backup.

## 10. No telemetry, fully offline-capable

**Principle.** HOPS never phones home, and never *requires* the public internet
to install or run.

**In practice.** Zero analytics, zero crash-reporting to a vendor, zero
update/license/activation calls. The UI loads no external CDN, fonts, or scripts.
HOPS installs and runs fully on an air-gapped LAN.

"Offline-capable" means HOPS never *needs* the internet — not that it never
touches it. The *only* outbound traffic is what the user explicitly directs, and
HOPS makes none of it about you:

- **Status checks** — HOPS polls the tile URLs you configured to show up/down
  state. If a tile points at a public address, that check legitimately leaves
  your network; if all your tiles are internal (or status checks are off), HOPS
  stays entirely on the LAN. Either way it's your configuration choosing the
  destination, and HOPS sends nothing about itself or you — just a reachability
  probe to a service you asked it to watch.
- **Network discovery** — LAN probes (SSDP/SNMP/DNS/HTTP) to find services,
  scoped to the ranges you scan.

These are HOPS reaching out *on your behalf*, to destinations *you* chose — never
reporting back about you to anyone.

Icons are embedded, not fetched. The UI uses Iconify, but every icon the app
references (its own chrome plus the service logos it suggests) is bundled into
the build at compile time (`frontend/scripts/generate-icon-bundle.mjs`), so the
interface renders fully offline with no call to `api.iconify.design`. The *one*
documented exception: if a user manually types an arbitrary Iconify name that
isn't in the bundled set, that single icon is fetched on demand — a user-chosen
convenience, never required for HOPS to function. Guarded by `npm run
icons:check` and `tests/prerelease/e2e/offline-icons.spec.ts`.

**Violated by.** Adding an analytics/telemetry SDK; an automatic "check for
updates" call to a HOPS/author server; the UI loading scripts/styles/fonts/icons
it needs from a CDN at runtime (e.g. shipping Iconify without the offline
bundle); *any* outbound connection HOPS initiates on its own rather than because
the user configured a tile, a scan, or a by-name icon.

## 11. Docker is optional, never required

**Principle.** The single binary is the first-class path and is complete on its
own. Docker is a convenience, never a dependency.

**In practice.** Every feature works identically as a bare binary or in a
container — nothing is Docker-only. Docs lead with the binary; Docker is offered
as the alternative for people already running a Compose stack.

**Violated by.** A feature that only works in Docker; documentation or tooling
that treats Docker as the default/required path; letting the binary path rot
because the container path still works.

---

*If you're reviewing a change and unsure whether it touches a tenet, it probably
does — raise it.*
