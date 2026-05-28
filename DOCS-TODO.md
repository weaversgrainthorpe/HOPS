# Docs to-do (post-v2.0)

Working file for documentation items that surfaced during the v2.0 audit / build but don't need to land before the release. Most are internal-API notes, in-app help refinements, or website/video work that happens around the release itself rather than as part of the codebase.

## Pre-release docs pass — DONE

The following items WERE addressed in the v2.0 release docs pass:
- ✅ Stale "Scan a CIDR" wording scrubbed in favour of "CIDR, range, single IP, or any combination"
- ✅ "Realistic expectations" note threaded through README, USER_GUIDE, CHANGELOG, ROADMAP, in-app discovery lede
- ✅ Network Discovery chapter added to USER_GUIDE with full walkthrough
- ✅ Network Discovery card added to docs/index.html landing page
- ✅ HelpModal in-app help gains a Network Discovery feature card
- ✅ CHANGELOG 2.0.0 entry with upgrade notes
- ✅ Version-string bump everywhere (README, USER_GUIDE, DEPLOY, QUICKSTART, ICON_MANAGEMENT, docs/index.html, frontend modals — modals already auto-read from runtime)

## Still outstanding (do as part of a future docs pass or post-release)

### Website + video (around release time)

- **GitHub Pages landing page**: the docs/index.html lives in-tree but the published site at hops.weaversgrainthorpe.github.io needs whatever workflow publishes it run/triggered.
- **Demo video update**: docs/screenshots/demo.mp4 + demo.gif show v1.x flow. v2.0 deserves a refreshed clip showing the Network Discovery flow specifically: New Scan → watch progress → curate the draft → bulk-promote → done.
- **Screenshots refresh**: docs/screenshots/admin*.png are from v1.7. Adding admin-discovery.png / admin-discovery-draft.png / admin-discovery-detectors.png / admin-discovery-diagnostics.png to the README and landing-page screenshot grids would showcase the new feature.

### API surface — document deliberate non-conventions

The HOPS API has a few endpoints that diverge from strict REST. They're intentional, but a passing reader could "tidy" them away. Worth a short paragraph in an API.md or in DEPLOY.md's reverse-proxy section so the API surface is documented as a contract.

- **`POST /api/backups/{name}` does a restore, not a create**. The "create" endpoint is `POST /api/backups`. Document this asymmetry so it doesn't get split into `/api/backups/{name}/restore` without thought, and so client code knows what to call.
- **`POST /api/discovery/detectors/reset-bundled` is a sentinel inside `/api/discovery/detectors/{id}`**. The trailing-slash router catches the path; the handler peels off the literal `reset-bundled` before treating the rest as an ID. Document the sentinel so it doesn't disappear in a refactor.
- **`GET /api/status/{entryID}` is public** (no auth). Used by the SPA's polling for tile colour indicators on first paint before login. Worth a note in case anyone tries to "tighten" it; the entry IDs are random UUIDs from the user's own config so this isn't a data-leak vector.
- **`GET /api/discovery/scans/{id}?resultsSince=<rfc3339>`** — cursor for delta polling. Pass nothing on first call (returns full set); on subsequent polls pass the max `createdAt` you've seen.

### Discovery — invariants worth surfacing in help text

These don't require a docs section, just a `title=` tooltip or hint paragraph in the relevant admin page so admins find them at moments of confusion.

- **Scan port set is frozen at scan start.** Adding a user detector with a new port while a scan is running won't extend the port set in that scan. Surface near the "Add detector" button.
- **Forward-enum follows up to 5 redirect hops per FQDN with a 60 s overall budget.** If a service is found behind a longer redirect chain, configure shorter redirects or shorter chains.
- **Per-host probe budget is 15 s** (or 15× the `discovery.per_host_timeout_seconds` setting, whichever is greater). Surface near the per-host-timeout setting.
- **Override semantics**: customizing a bundled detector creates an override that shadows the shipped definition. Deleting the override "resets to bundled". Help text on the Manage detectors page would explain this.
- **Favicon-hash priority**: a user detector's favicon-hash match wins over the bundled favicon corpus when both fire. Tooltip on the favicon-hash form field.
- **HTTP fallback follows same-host redirects**: services whose root `/` 302s to `/dashboard` show up in unidentified-services with the dashboard's title, not the redirect stub. Tooltip near unidentified rows.
- **Status checker exponential backoff**: a failing entry skips progressively more polls (2× → 4× → 8× → 16× → 32× the interval). On a successful check, the backoff clears. Help text near `status.check_interval_seconds` in Settings.

### Future ratchets

These are not v2.0 items but worth a note so the design intent isn't lost:

- **Editing the bundled favicon-hash table via GUI**: currently the seed table in `backend/internal/discovery/favicon_table.go` is empty by design (Shodan corpus is noisy). When a corpus management UI is built, this is where it slots in.
- **TLS cert subject as a signature type**: HOPS already captures the leaf cert CN + SANs on every HTTPS probe (and uses them as a fallback name hint). Adding them as a user-detector signature category is the natural next signal.

### Test scaffolding gotchas worth a comment

Not user-facing docs, but worth a top-of-file comment so the next test author doesn't trip on them:

- **`SetMaxOpenConns(1)` is required for in-memory SQLite tests** that involve background goroutines (orchestrator, status checker). Without it, the connection pool can hand a new goroutine a fresh empty `:memory:` DB.
- **Smoke test pattern**: `TestSmokeRoutesNoFiveHundred` walks every registered route. When adding a new route, add a probe entry to its list. The test doesn't assert behaviour, just that the route doesn't 5xx — it catches route shadowing / nil pointer panics / forgotten imports.
