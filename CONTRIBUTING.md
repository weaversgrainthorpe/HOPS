# Contributing to HOPS

Thanks for your interest in contributing to HOPS! This document covers the guidelines for contributing to the project.

## Ways to Contribute

- **Bug Reports** — Found something broken? [Open an issue](https://github.com/weaversgrainthorpe/HOPS/issues/new) with steps to reproduce.
- **Feature Requests** — Have an idea? Open an issue describing what you'd like and why.
- **Pull Requests** — Bug fixes and improvements are welcome. For larger changes, please open an issue first to discuss.

## Development Setup

### Prerequisites

- Go 1.27.3+ (the `go` line in `backend/go.mod`)
- Node.js 24+ with npm

SQLite is built into HOPS (pure Go, `CGO_ENABLED=0`); there is nothing else
to install.

### Running HOPS while you work

```bash
./scripts/dev.sh
```

This builds a `dev` backend, starts it on port 8080 with its data in `./data`
(not checked in), and starts the Vite dev server on port 5173, which proxies
the API to the backend. Open http://localhost:5173 and sign in with
`admin` / `admin` (you'll be asked to set a new password). Ctrl+C stops both.

To run the two halves yourself:

```bash
# Backend (dev build; serves the UI from frontend/build on disk)
cd frontend && npm install && npm run build && cd ..
cd backend
go build -tags dev -o hops ./cmd/hops
./hops --data ../data --frontend ../frontend/build

# Frontend with hot reload, in another terminal
cd frontend
npm run dev
```

Use a data folder of its own for development, never the data of a HOPS you
actually use.

### The `dev` build tag

Code that only helps development is behind the `dev` build tag and is left
out of release binaries entirely (CI checks this). Today that is:

- `--frontend <folder>`: serve the web UI from a folder on disk instead of
  the copy embedded in the binary;
- `--no-lan-multicast`: Network Discovery sends no mDNS/SSDP onto the LAN
  (used by the test suite).

Build with `go build -tags dev ./cmd/hops` to get them. A release build
(`scripts/build.sh`, or `go build ./cmd/hops`) rejects them as unknown flags.
New dev-only code belongs in a `//go:build dev` file with a release
counterpart, the way `backend/cmd/hops/dev_flags.go` and
`dev_flags_release.go` do it.

### Building a release binary

```bash
./scripts/build.sh
```

This builds the frontend (including the offline icon bundle), copies it into
`backend/internal/web/build` so it can be embedded, and compiles
`backend/hops` with the UI inside. That one file is all HOPS needs; run it
with `./backend/hops --data ./data`.

If you add an icon to the UI, regenerate the offline icon bundle with
`npm run icons:bundle` in `frontend/` (the build does this too) and commit
the result. `npm run icons:check` fails if the bundle is out of date.

### Project Structure

```
hops/
├── backend/
│   ├── cmd/hops/              # Main program, flags, data-folder default
│   └── internal/
│       ├── api/               # HTTP handlers, routing, CSP and CSRF
│       ├── assets/            # Embedded Dashboard Icons and background presets
│       ├── auth/              # Sign-in and sessions
│       ├── configdoc/         # The dashboard document: v3 format, v2→v3 conversion
│       ├── converters/        # Imports from Homer, Dashy, Heimdall
│       ├── database/          # SQLite, backups, restore, retention
│       ├── discovery/         # Network Discovery
│       ├── netguard/          # The outbound-connection (SSRF) guard
│       ├── safemode/          # The "can't start safely" recovery page
│       ├── settings/          # Global settings (defaults, limits)
│       ├── status/            # Status checks
│       └── web/               # The embedded web UI
├── frontend/
│   └── src/
│       ├── lib/               # Components, editor, layout, stores, icons, utils
│       └── routes/            # Dashboards, Settings pages
├── packaging/                 # install.sh and the Proxmox script
├── scripts/                   # Build, dev, test and check scripts
├── tests/prerelease/          # Playwright end-to-end and API suite
├── Dockerfile
└── docker-compose.yml
```

## Pull Request Guidelines

1. **One concern per PR.** Keep changes focused. A bug fix and a new feature should be separate PRs.
2. **Test your changes.** Run the tests below, and try the change in a running HOPS.
3. **Check the [tenets](TENETS.md).** `./scripts/check-tenets.sh` runs the mechanical checks; the rest is judgement.
4. **Follow existing patterns.** Match the code style and conventions already in the project.
5. **Update documentation.** If your change affects user-facing behaviour, update the relevant docs (README, QUICKSTART, USER_GUIDE, DEPLOY, etc.).
6. **Write clear commit messages.** Describe *what* changed and *why*.

### Running Tests

```bash
# Backend (Go)
cd backend
CGO_ENABLED=0 go test ./...
go vet ./...

# Frontend type check (svelte-check)
cd frontend
npm run check

# Frontend unit tests (vitest)
npm test
```

CI runs these on every push, plus the icon-bundle and tenet checks.

#### The Playwright suite

`tests/prerelease` holds the end-to-end and API tests. They start a fresh
HOPS (a throwaway data folder, port 18080, listening on 127.0.0.1 only) and
drive it in Chromium. To run everything, from version checks through Go,
svelte-check and vitest to Playwright:

```bash
./scripts/test-prerelease.sh
```

Or just the Playwright suite:

```bash
cd tests/prerelease
npm install
npx playwright install chromium   # first time only
npx playwright test               # add e.g. e2e/tiles.spec.ts to run one file
```

By default the suite uses a `dev` build (`backend/hops-testdev`) serving
`frontend/build`. `HOPS_TEST_BUILD=release npx playwright test` runs it
against the real release binary from `scripts/build.sh` instead. See
[tests/prerelease/README.md](tests/prerelease/README.md) for more.

### Git hooks

`git config core.hooksPath scripts/hooks` enables a pre-push check (version
numbers agree, the Go build works, CSS lint).

## Code Style

- **Go** — Standard `gofmt` formatting. Keep dependencies minimal.
- **Svelte/TypeScript** — Follow existing component patterns. Use TypeScript types for all data structures.
- **CSS** — Scoped component styles per Svelte convention. Design tokens (colors, spacing, radii, shadows, transitions, z-index layers) are CSS custom properties defined at `:root` in `frontend/src/app.css` — reference them as `var(--accent)`, `var(--radius-md)`, etc. instead of hardcoded values. Shared button classes (`.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-sm`) live in `app.css` too — don't redefine them per-component.

## Reporting Security Issues

Please do **not** open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## License

By contributing to HOPS, you agree that your contributions will be licensed under the [MIT License](LICENSE).
