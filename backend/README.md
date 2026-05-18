# HOPS Backend (v1.4.5)

The backend for HOPS (Home Operations Portal System) — a single Go binary serving a REST API + the static frontend.

## Tech Stack

- **Language**: Go 1.24+
- **HTTP**: `net/http` stdlib only (no framework — `http.ServeMux` with method-aware handler dispatch)
- **Database**: SQLite via `modernc.org/sqlite` (pure-Go, no CGO required); WAL mode, foreign keys enforced
- **Auth**: Bcrypt password hashing + HttpOnly session cookies + CSRF double-submit cookies
- **Logging**: `log/slog` (stdlib structured logging) with configurable level via `LOG_LEVEL` env var
- **Build**: `CGO_ENABLED=0` — produces a fully static binary that cross-compiles to any platform without a C toolchain

## Project Structure

```
backend/
├── cmd/
│   ├── hops/
│   │   └── main.go              # Entry point: flag parsing, logger setup, DB init, HTTP server, graceful shutdown
│   └── hashpw/
│       └── main.go              # Standalone CLI to generate bcrypt password hashes
├── internal/
│   ├── api/
│   │   ├── router.go            # Route registration, middleware (auth, CSRF, CORS, security headers, logging), rate limiter
│   │   ├── handlers.go          # All HTTP handlers (config, auth, icons, backgrounds, backups, status)
│   │   └── csrf.go              # CSRF middleware (double-submit cookie pattern)
│   ├── auth/
│   │   └── auth.go              # Login, session validation, password change, must_change_password flag
│   ├── config/
│   │   └── config.go            # Config struct + validation (port, paths, rate limit, allowed origins)
│   ├── converters/              # Format converters for import (Homer, Dashy, Heimdall)
│   ├── database/
│   │   ├── database.go          # Schema, migrations (addColumnIfMissing helper), default config seed
│   │   ├── backup.go            # Backup manager: create, list, restore, delete, cleanup
│   │   ├── dashboard_icons.go   # One-time import of homarr-labs/dashboard-icons collection
│   │   └── icon_seeds.go        # Seed data for icon categories
│   ├── models/
│   │   └── models.go            # Shared data types
│   ├── status/
│   │   └── checker.go           # Background HTTP/ICMP status checker (batched DB writes)
│   └── version/
│       └── version.go           # Version constants
├── go.mod
└── go.sum
```

## Getting Started

### Prerequisites

- Go 1.24 or higher

### Installation

```bash
cd backend
go mod download
```

### Running in Development

```bash
go run cmd/hops/main.go --port 8080 --data ../data
```

Command-line flags:

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | `8080` | Port the HTTP server listens on |
| `--data` | `../data` | Data directory (SQLite database, backups, uploads) |
| `--frontend` | `../frontend/build` | Path to the frontend `build/` directory |

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |

### Building

```bash
go build -o hops ./cmd/hops
```

For optimized production build:

```bash
CGO_ENABLED=0 go build -ldflags="-s -w" -o hops ./cmd/hops
```

- `-s` — omit symbol table
- `-w` — omit DWARF debugging information
- `CGO_ENABLED=0` — pure-Go SQLite, no C toolchain needed; binary works on any platform with the matching `GOOS`/`GOARCH`

### Running Production Build

```bash
./hops --port 8080 --data /path/to/data --frontend /path/to/frontend/build
```

## API Endpoints

All API responses are JSON. Errors use a consistent shape:

```json
{ "error": "Method not allowed", "status": 405 }
```

Mutation methods (POST/PUT/PATCH/DELETE) on protected routes require both:
1. Valid `hops_session` cookie (set by `/api/auth/login`)
2. Matching `X-CSRF-Token` header against the `hops_csrf` cookie (also set by login)

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check + version + uptime + DB connectivity |
| `GET` | `/api/version` | Version info |
| `GET` | `/api/config` | Public dashboard configuration |
| `GET` | `/api/status/{entryId}` | Cached status check result for one tile |
| `POST` | `/api/auth/login` | Admin login (rate-limited 20/min/IP). Sets `hops_session` + `hops_csrf` cookies. |
| `GET` | `/api/auth/check` | Returns `{authenticated, mustChangePassword}`. Also re-issues a CSRF cookie if missing (handles upgrade path for old sessions). |
| `GET` | `/api/icon-categories` | List icon categories |
| `GET` | `/api/icons` | List icons (optionally `?category=<id>`) |
| `GET` | `/api/icons/dashboard/{filename}` | Serve from the homarr-labs/dashboard-icons collection |
| `GET` | `/api/backgrounds` | List background images |
| `GET` | `/icons/{filename}` | Serve uploaded custom icon |
| `GET` | `/backgrounds/{filename}` | Serve uploaded background |
| `GET` | `/presets/{filename}` | Serve preset background |

### Protected Endpoints (require login + CSRF token for mutations)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/logout` | Log out current session; clears both cookies |
| `POST` | `/api/auth/change-password` | Change admin password; clears the `must_change_password` flag |
| `PUT` | `/api/config` | Update dashboard configuration |
| `GET` | `/api/config/export` | Export configuration (with embedded assets as base64) |
| `POST` | `/api/config/import` | Import configuration (HOPS JSON, Homer YAML, Dashy YAML, Heimdall JSON) |
| `POST` | `/api/config/reset` | Reset to default configuration |
| `GET` | `/api/backups` | List available backups |
| `POST` | `/api/backups` | Create a new backup |
| `POST` | `/api/backups/{name}` | Restore a backup |
| `DELETE` | `/api/backups/{name}` | Delete a backup |
| `POST` | `/api/icons/upload` | Upload a custom icon (multipart, ≤5MB) |
| `POST` | `/api/icons` | Create icon metadata |
| `PUT` | `/api/icons/{id}` | Update icon metadata |
| `DELETE` | `/api/icons/{id}` | Delete a user icon (presets are protected) |
| `POST` | `/api/icon-categories` | Create an icon category |
| `PUT` | `/api/icon-categories/{id}` | Update an icon category |
| `DELETE` | `/api/icon-categories/{id}` | Delete a user icon category |
| `POST` | `/api/backgrounds` | Upload a background image |
| `PUT` | `/api/backgrounds/{id}` | Update background metadata |
| `DELETE` | `/api/backgrounds/{id}` | Delete a background |
| `GET` | `/api/backgrounds/categories` | List background categories |
| `POST` | `/api/backgrounds/categories` | Create background category |
| `PUT` | `/api/backgrounds/categories/{id}` | Update background category |
| `DELETE` | `/api/backgrounds/categories/{id}` | Delete background category |

### Authentication Example

```bash
# Login — captures hops_session AND hops_csrf cookies
curl -c cookies.txt -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'

# Read endpoints don't need CSRF
curl -b cookies.txt http://localhost:8080/api/config/export

# Mutation endpoints need the CSRF header. Extract the cookie value first:
CSRF=$(grep hops_csrf cookies.txt | awk '{print $7}')
curl -b cookies.txt -X PUT http://localhost:8080/api/config \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"dashboards":[]}'

# Logout — clears both cookies server-side
curl -b cookies.txt -X POST http://localhost:8080/api/auth/logout \
  -H "X-CSRF-Token: $CSRF"
```

## Database Schema

### `users`

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0,  -- 1 forces password change on next login
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### `sessions`

```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,                              -- random 32-byte hex token
    user_id INTEGER NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
```

### `config`

```sql
CREATE TABLE config (
    id INTEGER PRIMARY KEY CHECK (id = 1),  -- single-row constraint
    data TEXT NOT NULL,                     -- JSON blob
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### `status_cache`

```sql
CREATE TABLE status_cache (
    entry_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,        -- 'up', 'down', 'error'
    response_time INTEGER,        -- milliseconds
    last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### `icon_categories` and `icons`

Both have an `is_preset` flag distinguishing seeded/curated content from user-created entries. Icons have a FK to categories with `ON DELETE CASCADE`. See [ICON_MANAGEMENT.md](../ICON_MANAGEMENT.md) for the schema and API in detail.

### Migrations

Migrations are idempotent and run on every startup. Schema changes use the `addColumnIfMissing()` helper for additive changes — full table rebuilds aren't currently automated, so FK constraint changes only apply to fresh installs.

## Default Admin User

On first run, a default admin user is created:

- **Username**: `admin`
- **Password**: `admin`
- **`must_change_password`**: `1` — the SPA forces a password change before letting the user do anything else.

For existing installs upgrading from older versions, the `must_change_password` column is added by migration but defaults to `0` for existing users — they keep their current behavior.

## Session Management

- 32-byte cryptographically random session ID, hex-encoded
- 24-hour expiry
- `HttpOnly`, `SameSite=Lax`, `Path=/` cookie
- Expired sessions cleaned up every hour by a background goroutine (`StartCleanupRoutine`)
- Logging out deletes the session row server-side

## CSRF Protection

Implemented in [csrf.go](internal/api/csrf.go) using the double-submit cookie pattern:

1. On `/api/auth/login` success, server generates a fresh 32-byte hex token and sets it as a non-HttpOnly cookie `hops_csrf` (`SameSite=Strict`, 24h)
2. The frontend reads `hops_csrf` from `document.cookie` and echoes it back in the `X-CSRF-Token` header on every POST/PUT/PATCH/DELETE
3. Server middleware compares the cookie and header values using `subtle.ConstantTimeCompare` — returns 403 on mismatch or missing
4. Safe methods (GET/HEAD/OPTIONS) are bypassed
5. `/api/auth/check` re-issues a CSRF cookie if missing — this is the upgrade path for sessions that pre-date the CSRF feature

## File Serving

When `--frontend` is provided, the backend also serves the static frontend:

- Files in `frontend/build/` served at their natural paths
- Any unknown path falls through to `index.html` (SPA support — SvelteKit static export)
- API routes take precedence over file serving
- Path-traversal protection on uploaded-file endpoints (`filepath.Base`)

## Logging

Uses Go's `log/slog` stdlib (text handler by default):

```
time=2026-05-18T10:00:00.000Z level=INFO msg="server starting" version="HOPS v1.4.5" addr=:8080
time=2026-05-18T10:00:00.123Z level=INFO msg="http request" method=GET path=/api/config status=200 duration_ms=2
```

Set `LOG_LEVEL=debug` for verbose output, or `warn`/`error` for less noise.

Most log entries include a `component` attribute: `backup`, `icons`, `import`, `export`, `status`, `auth`, `backgrounds`. The HTTP request logger emits structured fields (`method`, `path`, `status`, `duration_ms`).

## Graceful Shutdown

The HTTP server listens for `SIGINT`/`SIGTERM` and calls `http.Server.Shutdown(ctx)` with a 30s grace period. In-flight requests are allowed to complete before the process exits.

Timeouts are configured to mitigate slow-loris attacks:
- `ReadHeaderTimeout`: 10s
- `ReadTimeout`: 60s
- `WriteTimeout`: 120s
- `IdleTimeout`: 120s

## Backups

Automatic database backups via `BackupManager`:

- Created on startup (`startup` reason)
- Created before config updates and resets (`pre-config-update`, `pre-factory-reset`)
- Created before backup restore (`pre-restore`)
- Stored in `data/backups/` with timestamp + reason in filename
- Last 10 retained, older ones removed by `CleanupOldBackups()`
- Uses SQLite's `VACUUM INTO` for an atomic, consistent snapshot (falls back to file copy if unavailable)

## Testing

```bash
go test ./...
```

The test suite covers:

- **`internal/api`** — auth flows (login, logout, session cookie, change password, must_change_password); CSRF protection (missing token, mismatched token, GET bypass, all mutation methods); config endpoints; icon and category CRUD; cascade deletes; rate limiting
- **`internal/auth`** — session validation, expiry, cleanup, password change clearing the must-change flag
- **`internal/database`** — schema setup, FK enforcement, indexes, migrations (`addColumnIfMissing` idempotency), backup operations (create, list, restore, delete, path-traversal protection, cleanup), dashboard icon import (idempotent, variant skipping), config validation
- **`internal/config`** — port range, required fields, allowed origins validation

Roughly 100 backend tests total. Run with `-v -count=1` for verbose output, or `-run TestName` for a single test.

## Performance Notes

- **SQLite single-writer** (`SetMaxOpenConns(1)`) + WAL mode for concurrent reads
- **Status checker** batches all writes per cycle into a single transaction with a prepared statement (avoids contention with reads)
- **Icon matching** during config import pre-loads all icons into memory once (was N+1 query pattern in pre-1.3 versions)
- **HTTP request logging** skips static assets to reduce log volume

## Contributing

When adding new features:

1. Follow Go idioms (`gofmt`, error wrapping with `%w`, table-driven tests)
2. Use the `protected()` middleware helper for new mutation routes — it composes auth + CSRF in one call
3. Use `slog` (not `log`) for any new log lines, with appropriate level and `component=...` attribute
4. Add tests in the relevant `*_test.go` file
5. Update [CHANGELOG.md](../CHANGELOG.md) and this file if endpoints or schema change
