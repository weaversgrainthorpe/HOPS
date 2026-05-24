package database

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/assets"

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
		db.Close()
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

		// Status cache for HTTP checks
		`CREATE TABLE IF NOT EXISTS status_cache (
			entry_id TEXT PRIMARY KEY,
			status TEXT NOT NULL,
			response_time INTEGER,
			last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

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

		// Indexes for faster lookups
		`CREATE INDEX IF NOT EXISTS idx_icons_category ON icons(category_id)`,
		`CREATE INDEX IF NOT EXISTS idx_icons_preset ON icons(is_preset)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
	}

	for _, migration := range migrations {
		if _, err := db.Exec(migration); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}

	// Add must_change_password column to existing users tables (idempotent upgrade)
	if err := addColumnIfMissing(db, "users", "must_change_password", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return fmt.Errorf("failed to add must_change_password column: %w", err)
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

	if configCount == 0 {
		defaultConfig := DefaultConfig
		_, err := db.Exec("INSERT INTO config (id, data) VALUES (1, ?)", defaultConfig)
		if err != nil {
			return fmt.Errorf("failed to create default config: %w", err)
		}
	}

	return nil
}

// ResetConfig resets the configuration to the default state
func ResetConfig(db *sql.DB) error {
	_, err := db.Exec("UPDATE config SET data = ? WHERE id = 1", DefaultConfig)
	return err
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

// DefaultConfig is the initial configuration for a fresh HOPS installation
const DefaultConfig = `{
  "dashboards": [
    {
      "id": "sample",
      "name": "Sample",
      "path": "/sample",
      "order": 0,
      "tabs": [
        {
          "id": "main",
          "name": "Main",
          "color": "#3b82f6",
          "opacity": 0.95,
          "order": 0,
          "groups": [
            {
              "id": "services",
              "name": "Services",
              "color": "#8b5cf6",
              "opacity": 0.95,
              "collapsed": false,
              "order": 0,
              "entries": [
                {
                  "id": "google",
                  "name": "Google",
                  "url": "https://google.com",
                  "icon": "mdi:google",
                  "description": "Search Engine",
                  "openMode": "newtab",
                  "size": "medium",
                  "order": 0
                },
                {
                  "id": "github",
                  "name": "GitHub",
                  "url": "https://github.com",
                  "icon": "mdi:github",
                  "description": "Code Repository",
                  "openMode": "newtab",
                  "size": "medium",
                  "order": 1
                },
                {
                  "id": "youtube",
                  "name": "YouTube",
                  "url": "https://youtube.com",
                  "icon": "mdi:youtube",
                  "description": "Video Platform",
                  "openMode": "newtab",
                  "size": "medium",
                  "order": 2
                }
              ]
            },
            {
              "id": "tools",
              "name": "Development Tools",
              "color": "#10b981",
              "opacity": 0.95,
              "collapsed": false,
              "order": 1,
              "entries": [
                {
                  "id": "stackoverflow",
                  "name": "Stack Overflow",
                  "url": "https://stackoverflow.com",
                  "icon": "mdi:stack-overflow",
                  "description": "Q&A for Developers",
                  "openMode": "newtab",
                  "size": "medium",
                  "order": 0
                },
                {
                  "id": "mdn",
                  "name": "MDN Web Docs",
                  "url": "https://developer.mozilla.org",
                  "icon": "mdi:firefox",
                  "description": "Web Development Documentation",
                  "openMode": "newtab",
                  "size": "medium",
                  "order": 1
                }
              ]
            }
          ]
        },
        {
          "id": "media",
          "name": "Media",
          "color": "#f59e0b",
          "opacity": 0.95,
          "order": 1,
          "groups": [
            {
              "id": "streaming",
              "name": "Streaming Services",
              "color": "#ef4444",
              "opacity": 0.95,
              "collapsed": false,
              "order": 0,
              "entries": [
                {
                  "id": "netflix",
                  "name": "Netflix",
                  "url": "https://netflix.com",
                  "icon": "mdi:netflix",
                  "description": "Streaming Service",
                  "openMode": "newtab",
                  "size": "large",
                  "order": 0
                },
                {
                  "id": "spotify",
                  "name": "Spotify",
                  "url": "https://spotify.com",
                  "icon": "mdi:spotify",
                  "description": "Music Streaming",
                  "openMode": "newtab",
                  "size": "medium",
                  "order": 1
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}`
