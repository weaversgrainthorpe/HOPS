# Docs to-do

Working file for documentation items not yet landed. Two categories:
**user-facing-but-deferred** (would benefit a reader of the public docs;
slot into a future pass) and **internal-only** (test-author notes,
API-design contracts).

Feature ideas live in [ROADMAP.md](ROADMAP.md), not here.

## User-facing — slot into the next docs pass

### Discovery — invariants worth surfacing in help text or tooltips

These don't need new doc sections; they need a `title=` tooltip or a
hint paragraph in the relevant admin page so admins find them at the
moment of confusion rather than by spelunking the source.

- **Scan port set is frozen at scan start.** Adding a user detector
  with a new port while a scan is running won't extend the port set in
  that scan. Surface near the "Add detector" button.
- **Forward-enum follows up to 5 redirect hops per FQDN with a 60 s
  overall budget.** If a service hides behind a longer chain, configure
  shorter redirects or shorter chains.
- **Per-host probe budget is 15 s** (or 15× the
  `discovery.per_host_timeout_seconds` setting, whichever is greater).
  Surface near that setting.
- **Override semantics**: customizing a bundled detector creates an
  override that shadows the shipped definition. Deleting the override
  "resets to bundled". Worth explaining on the Manage detectors page.
- **Favicon-hash priority**: a user detector's favicon-hash match wins
  over the bundled favicon corpus when both fire. Tooltip on the
  favicon-hash form field.
- **HTTP fallback follows same-host redirects**: services whose root
  `/` 302s to `/dashboard` show up in unidentified-services with the
  dashboard's title, not the redirect stub. Tooltip near unidentified
  rows.
- **Status checker exponential backoff**: a failing entry skips
  progressively more polls (2× → 4× → 8× → 16× → 32× the interval).
  On a successful check, the backoff clears. Help text near
  `status.check_interval_seconds` in Settings.

### Screenshots — Discovery feature is not in the README grid

The screenshot grid in [README.md](README.md) shows admin / QR / edit
mode / tile editor / icon picker / mobile. The 2.0 headline feature has
no screenshot. Captures needed (can be scripted via Playwright like the
demo gif):

- `docs/screenshots/admin-discovery.png` — scan list with one
  completed scan
- `docs/screenshots/admin-discovery-draft.png` — curate UI with
  results populated
- `docs/screenshots/admin-discovery-detectors.png` — Manage detectors
  page (sortable list)
- `docs/screenshots/admin-discovery-diagnostics.png` — diagnostics
  view with unidentified rows and a "+ Create detector" hover state

Once captured, extend the README `<table>` and the
`docs/index.html` screenshot section to include them.

## Internal — API quirks and test-scaffolding notes

### API surface — document deliberate non-conventions

The HOPS API has a few endpoints that diverge from strict REST. They
are intentional, but a passing reader could "tidy" them away. Worth a
short paragraph in an `API.md` or in `DEPLOY.md`'s reverse-proxy
section so the surface is documented as a contract.

- **`POST /api/backups/{name}` does a restore, not a create.** The
  create endpoint is `POST /api/backups`. Document this asymmetry so
  it doesn't get split into `/api/backups/{name}/restore` without
  thought.
- **`POST /api/discovery/detectors/reset-bundled` is a sentinel
  inside `/api/discovery/detectors/{id}`.** The trailing-slash router
  catches the path; the handler peels off the literal `reset-bundled`
  before treating the rest as an ID.
- **`GET /api/status/{entryID}` is public** (no auth). Used by the SPA's
  polling for tile colour indicators on first paint before login. Entry
  IDs are random UUIDs from the user's own config so this is not a
  data-leak vector — but worth a note in case anyone tries to
  "tighten" it.
- **`GET /api/discovery/scans/{id}?resultsSince=<rfc3339>`** — cursor
  for delta polling. Pass nothing on first call (returns full set);
  on subsequent polls pass the max `createdAt` you've seen.

### Test scaffolding gotchas worth a top-of-file comment

- **`SetMaxOpenConns(1)` is required for in-memory SQLite tests**
  that involve background goroutines (orchestrator, status checker).
  Without it, the connection pool can hand a new goroutine a fresh
  empty `:memory:` DB. See `setupTestRouter` in `api_test.go`.
- **Smoke test pattern**: `TestSmokeRoutesNoFiveHundred` walks every
  registered route. When adding a new route, add a probe entry to its
  list. The test doesn't assert behaviour, just that the route doesn't
  5xx — it catches route shadowing / nil pointer panics / forgotten
  imports.
