# Pre-release test suite

Heavier than the per-commit CI tests — this suite spins up a fresh HOPS
process (clean tempdir, isolated DB) and drives it through Chromium via
Playwright to catch the class of bug that "all unit tests pass but the
deployed app is broken in a different feature than the one you
changed."

Run it before tagging a release.

## What's covered

| Area | File | Catches |
|------|------|---------|
| Dashboard hierarchy + colour cascade | `e2e/dashboards.spec.ts` | Group / tile colour cascade silently breaking on save → reload |
| Tile CRUD round-trip | `e2e/tiles.spec.ts` | Edit modal losing fields between save and reload |
| Config save pipeline | `e2e/import-export.spec.ts` | GET → PUT round-trip dropping fields; export bundle shape regression |
| Settings | `e2e/settings.spec.ts` | Settings page renders + setting PUTs persist |
| Discovery | `e2e/discovery.spec.ts` | Scan create / detector list / draft page rendering |
| API contracts | `api/contracts.spec.ts` | Response field disappeared from a key endpoint |
| Auth boundaries | `api/boundaries.spec.ts` | Unauth getting in; CSRF middleware bypassed; rate limit not firing |
| Migration safety | `backend/internal/database/migration_safety_test.go` (Go) | Migration dropping rows / columns on upgrade from older schemas |

## Run

```bash
./scripts/test-prerelease.sh
```

This runs version-drift check → Go tests → svelte-check → vitest →
Playwright suite. Exits 1 on the first failure.

To run just the Playwright suite:

```bash
cd tests/prerelease
npx playwright test
```

Useful flags:

- `--ui` — opens the Playwright Inspector for interactive debugging
- `--headed` — runs in a visible browser window
- `e2e/dashboards.spec.ts` — narrow to a single file
- `--grep "regression class"` — narrow by test name

After a failed run, traces and screenshots are in `test-results/`.
View with `npx playwright show-trace test-results/.../trace.zip`.

## How the harness works

`playwright.config.ts` declares a `webServer` block that runs
`start-test-server.sh` before tests start. That script:

1. Builds the Go binary + frontend if they're stale.
2. Creates a fresh tempdir for the data directory.
3. Pre-seeds `app_settings.server.port` to 18080 (port is normally a
   GUI setting, not a CLI flag).
4. Starts hops listening on 127.0.0.1:18080.
5. On exit, cleans up the tempdir.

The `setup` project (`setup.ts`) authenticates as the default admin,
walks the forced-password-change modal, and saves the storage state
to `auth.json`. All other specs `dependsOn: ['setup']` so they reuse
the authenticated session — except `api/boundaries.spec.ts`, which
overrides `storageState` to test unauthenticated paths.

The whole suite runs serially (`fullyParallel: false`) — parallel
tests fighting over the same SQLite DB produce flakes that aren't
real bugs. Trade is ~13 s wall-clock vs ~5 s parallel, which is fine
for a pre-release gate.

## Adding a new test

1. Pick a file under `e2e/` or `api/` (or add a new one).
2. Start with `import { test, expect } from '@playwright/test'`. The
   setup project guarantees you're logged in.
3. Use unique names (`uniqueName('Foo')` from `../helpers`) for any
   created fixtures so re-runs don't collide.
4. For API mutations, use the `apiRequest` helper or pull a CSRF token
   via `getCsrfToken(context)`.

Bias toward tests that exercise *cross-feature* paths — those are
what unit tests can't catch.

## Excluded by design

- Visual-regression / screenshot diffs. Maintaining baselines is real
  work and the cost/benefit isn't worth it for a single-dev project.
  Reconsider if false-negatives ever bite.
- Cross-browser (Firefox / WebKit). Chromium covers ~95% of the bug
  surface for an admin tool, and adding browsers triples runtime.
- Accessibility audits (axe-core). Worth doing once on a major release;
  noisy as a per-release gate.
