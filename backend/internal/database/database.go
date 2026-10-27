package database

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/assets"
	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"

	_ "modernc.org/sqlite"
)

// Initialize creates and initializes the SQLite database
func Initialize(dbPath string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Test connection with a timeout to fail fast if database is unreachable
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close() // #nosec G104 -- Close on an error path or after a read-only/bounded read; the primary error is already surfaced and nothing was written
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	// Enable foreign key enforcement (SQLite disables this by default)
	if _, err := db.Exec("PRAGMA foreign_keys=ON"); err != nil {
		return nil, fmt.Errorf("failed to enable foreign keys: %w", err)
	}

	// Enable WAL mode for better concurrency (allows concurrent reads during writes)
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		return nil, fmt.Errorf("failed to set WAL mode: %w", err)
	}

	// Set busy timeout to wait up to 5 seconds if database is locked
	if _, err := db.Exec("PRAGMA busy_timeout=5000"); err != nil {
		return nil, fmt.Errorf("failed to set busy timeout: %w", err)
	}

	// Set synchronous mode to NORMAL for better performance with WAL
	if _, err := db.Exec("PRAGMA synchronous=NORMAL"); err != nil {
		return nil, fmt.Errorf("failed to set synchronous mode: %w", err)
	}

	// Set connection pool settings - SQLite works best with single writer
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	// Run migrations
	if err := runMigrations(db); err != nil {
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	// Import dashboard icons from the embedded filesystem
	iconsFS, err := fs.Sub(assets.DashboardIcons, "dashboard-icons")
	if err != nil {
		return nil, fmt.Errorf("failed to scope dashboard icons filesystem: %w", err)
	}
	if err := ImportDashboardIcons(db, iconsFS); err != nil {
		return nil, fmt.Errorf("failed to import dashboard icons: %w", err)
	}

	return db, nil
}

// RunMigrations is the exported entry point so test scaffolding can
// initialise a test database against the same schema production uses,
// instead of hand-rolling a partial CREATE TABLE list that drifts as
// new tables are added.
func RunMigrations(db *sql.DB) error { return runMigrations(db) }

// runMigrations executes database migrations
func runMigrations(db *sql.DB) error {
	migrations := []string{
		// Users table for admin accounts
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			must_change_password INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		// Sessions table for authentication
		`CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			expires_at DATETIME NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,

		// Config table for dashboard configurations
		`CREATE TABLE IF NOT EXISTS config (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			data TEXT NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		// Archive of config documents replaced by a schema migration.
		// notes holds what the migration changed (renamed ids, as JSON).
		`CREATE TABLE IF NOT EXISTS config_archive (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			schema INTEGER NOT NULL,
			data TEXT NOT NULL,
			archived_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			notes TEXT
		)`,

		// Status cache for HTTP checks
		`CREATE TABLE IF NOT EXISTS status_cache (
			entry_id TEXT PRIMARY KEY,
			status TEXT NOT NULL,
			response_time INTEGER,
			last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		// When each checked tile started failing (dead-link report). Kept in
		// the DB so a restart doesn't reset it; mirrors status.FailingSchema.
		`CREATE TABLE IF NOT EXISTS status_failing (
			entry_id TEXT PRIMARY KEY,
			since TEXT NOT NULL,
			last_error TEXT NOT NULL DEFAULT '',
			last_checked TEXT NOT NULL
		)`,

		// When failure tracking began (one row; mirrors status.HistorySchema).
		`CREATE TABLE IF NOT EXISTS status_history (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			started_at TEXT NOT NULL
		)`,
		`INSERT OR IGNORE INTO status_history (id, started_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`,

		// Icon categories table
		`CREATE TABLE IF NOT EXISTS icon_categories (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			icon TEXT NOT NULL,
			order_num INTEGER NOT NULL,
			is_preset BOOLEAN NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		// Icons table
		`CREATE TABLE IF NOT EXISTS icons (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			icon TEXT NOT NULL,
			category_id TEXT NOT NULL,
			color TEXT,
			image_url TEXT,
			is_preset BOOLEAN NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (category_id) REFERENCES icon_categories(id) ON DELETE CASCADE
		)`,

		// Application settings — single key/value table for all admin-configurable
		// runtime settings (port, log level, rate limits, timeouts, upload caps, etc.).
		// Values are stored as TEXT and parsed per-key by the settings package.
		// Defaults are seeded by the settings service on first start.
		`CREATE TABLE IF NOT EXISTS app_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		// Network discovery — admin-initiated LAN scans for homelab apps.
		// A scan produces a draft (rows in scan_results); the admin curates
		// the draft and promotes selections to real dashboard tiles. Drafts
		// persist between sessions; deleting a scan cascades to its results.
		`CREATE TABLE IF NOT EXISTS scans (
			id              TEXT PRIMARY KEY,
			created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			created_by      INTEGER,
			cidr            TEXT NOT NULL,
			intensity       TEXT NOT NULL,
			state           TEXT NOT NULL,
			progress_total  INTEGER NOT NULL DEFAULT 0,
			progress_done   INTEGER NOT NULL DEFAULT 0,
			started_at      DATETIME,
			finished_at     DATETIME,
			error_message   TEXT NOT NULL DEFAULT '',
			label           TEXT NOT NULL DEFAULT '',
			internal_domain TEXT NOT NULL DEFAULT '',
			FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
		)`,

		`CREATE TABLE IF NOT EXISTS scan_results (
			id               TEXT PRIMARY KEY,
			scan_id          TEXT NOT NULL,
			host             TEXT NOT NULL,
			hostname         TEXT NOT NULL DEFAULT '',
			port             INTEGER NOT NULL,
			detector_id      TEXT NOT NULL,
			confidence       TEXT NOT NULL,
			category         TEXT NOT NULL DEFAULT 'other',
			suggested_name   TEXT NOT NULL,
			suggested_icon   TEXT NOT NULL DEFAULT '',
			suggested_url    TEXT NOT NULL,
			suggested_desc   TEXT NOT NULL DEFAULT '',
			raw_fingerprint  TEXT NOT NULL DEFAULT '{}',
			curate_state     TEXT NOT NULL DEFAULT 'pending',
			curate_overrides TEXT NOT NULL DEFAULT '{}',
			created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
		)`,

		// Phase 4: admin-defined detectors. Same matching grammar as the
		// bundled httpFingerprintDetector. Stored with JSON-encoded array
		// columns (ports / paths / signatures) because the admin never
		// edits this table directly — the GUI form translates between
		// structured fields and the JSON encoding.
		`CREATE TABLE IF NOT EXISTS user_detectors (
			id              TEXT PRIMARY KEY,
			name            TEXT NOT NULL,
			icon            TEXT NOT NULL DEFAULT '',
			category        TEXT NOT NULL DEFAULT 'other',
			description     TEXT NOT NULL DEFAULT '',
			ports           TEXT NOT NULL DEFAULT '[]',
			paths           TEXT NOT NULL DEFAULT '[]',
			url_path        TEXT NOT NULL DEFAULT '',
			body_contains   TEXT NOT NULL DEFAULT '[]',
			title_contains  TEXT NOT NULL DEFAULT '[]',
			header_keys     TEXT NOT NULL DEFAULT '[]',
			favicon_hashes  TEXT NOT NULL DEFAULT '[]',
			confidence      TEXT NOT NULL DEFAULT 'medium',
			enabled         INTEGER NOT NULL DEFAULT 1,
			created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			created_by      INTEGER,
			FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
		)`,

		// One-time notices (e.g. layered-status-checks-v4) the user has
		// dismissed; a dismissed notice is never shown again.
		`CREATE TABLE IF NOT EXISTS dismissed_notices (
			id           TEXT PRIMARY KEY,
			dismissed_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		// Server-side secrets generated once per install, never set by env
		// or by hand (e.g. csrf_hmac: the key that binds a CSRF token to its
		// session, pentest L3). Created on first use.
		`CREATE TABLE IF NOT EXISTS server_secrets (
			name       TEXT PRIMARY KEY,
			value      BLOB NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		// Indexes for faster lookups
		`CREATE INDEX IF NOT EXISTS idx_icons_category ON icons(category_id)`,
		`CREATE INDEX IF NOT EXISTS idx_icons_preset ON icons(is_preset)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans(created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_scans_state ON scans(state)`,
		`CREATE INDEX IF NOT EXISTS idx_scan_results_scan_id ON scan_results(scan_id)`,
		`CREATE INDEX IF NOT EXISTS idx_user_detectors_enabled ON user_detectors(enabled)`,
	}

	for _, migration := range migrations {
		if _, err := db.Exec(migration); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}

	// Additive column migrations for user_detectors that landed after
	// the initial schema. addColumnIfMissing is idempotent: a no-op on
	// fresh installs (CREATE TABLE could have declared the column,
	// but we keep the migration here so older installs upgrade).
	if err := addColumnIfMissing(db, "user_detectors", "favicon_hashes", "TEXT NOT NULL DEFAULT '[]'"); err != nil {
		return fmt.Errorf("failed to add user_detectors.favicon_hashes column: %w", err)
	}

	// Add must_change_password column to existing users tables (idempotent upgrade)
	if err := addColumnIfMissing(db, "users", "must_change_password", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return fmt.Errorf("failed to add must_change_password column: %w", err)
	}

	// Discovery feature additive columns. Each is a fresh-install no-op
	// (CREATE TABLE already declares it) and an upgrade-only ALTER for
	// existing databases.
	if err := addColumnIfMissing(db, "scan_results", "category", "TEXT NOT NULL DEFAULT 'other'"); err != nil {
		return fmt.Errorf("failed to add scan_results.category column: %w", err)
	}
	if err := addColumnIfMissing(db, "scans", "internal_domain", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return fmt.Errorf("failed to add scans.internal_domain column: %w", err)
	}

	// sessions.last_used_at (optional idle sign-out, auth.session_idle_hours).
	// Nullable: a row from before the column counts from its first use after it.
	if err := addColumnIfMissing(db, "sessions", "last_used_at", "DATETIME"); err != nil {
		return fmt.Errorf("failed to add sessions.last_used_at column: %w", err)
	}

	// config_archive.notes (v3 migration renames). Nullable, no default.
	if err := addColumnIfMissing(db, "config_archive", "notes", "TEXT"); err != nil {
		return fmt.Errorf("failed to add config_archive.notes column: %w", err)
	}

	// Create default admin user if none exists
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to check users: %w", err)
	}

	if count == 0 {
		// Default password: "admin" - must be changed on first login
		// This is bcrypt hash of "admin"
		defaultHash := "$2a$10$trkEbQD4PIkE23o.7Gn4TOBCOYo48m70IlqFpJZH98JcIi1s6oeTG"
		_, err := db.Exec(
			"INSERT INTO users (username, password_hash, must_change_password) VALUES (?, ?, 1)",
			"admin", defaultHash,
		)
		if err != nil {
			return fmt.Errorf("failed to create default admin user: %w", err)
		}
	}

	// Seed icon categories if none exist
	if err := seedIconData(db); err != nil {
		return fmt.Errorf("failed to seed icon data: %w", err)
	}

	// Initialize empty config if none exists
	var configCount int
	err = db.QueryRow("SELECT COUNT(*) FROM config").Scan(&configCount)
	if err != nil {
		return fmt.Errorf("failed to check config: %w", err)
	}

	// A fresh data dir (no config row) is seeded with the native v3 Sample,
	// verified first, so a fresh install never runs the v2→v3 converter and
	// never archives an "original". An existing config row is never touched.
	if configCount == 0 {
		doc, err := SampleDoc()
		if err != nil {
			return fmt.Errorf("failed to create default config: %w", err)
		}
		if err := configdoc.Save(db, doc); err != nil {
			return fmt.Errorf("failed to create default config: %w", err)
		}
	}

	return nil
}

// ResetConfig resets the configuration to the default state: the shipped v3
// Sample, verified before it is written. Any failure is returned (the caller
// shows it) and nothing is written.
func ResetConfig(db *sql.DB) error {
	return resetConfigFrom(db, SampleConfig)
}

func resetConfigFrom(db *sql.DB, raw string) error {
	doc, err := parseSample(raw)
	if err != nil {
		return err
	}
	return configdoc.Save(db, doc)
}

// addColumnIfMissing adds a column to a table only if it doesn't already exist.
// SQLite doesn't support "ALTER TABLE ... ADD COLUMN IF NOT EXISTS", so we
// check the table info first.
func addColumnIfMissing(db *sql.DB, table, column, definition string) error {
	rows, err := db.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid       int
			name      string
			ctype     string
			notNull   int
			dfltValue sql.NullString
			pk        int
		)
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dfltValue, &pk); err != nil {
			return err
		}
		if name == column {
			return nil // already exists
		}
	}

	_, err = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, definition))
	return err
}
