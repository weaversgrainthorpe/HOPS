package database

import (
	"database/sql"
	"fmt"

	_ "github.com/mattn/go-sqlite3"
)

// Initialize creates and initializes the SQLite database
func Initialize(dbPath string) (*sql.DB, error) {
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Test connection
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	// Run migrations
	if err := runMigrations(db); err != nil {
		return nil, fmt.Errorf("failed to run migrations: %w", err)
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
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		// Sessions table for authentication
		`CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			expires_at DATETIME NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id)
		)`,

		// Config table for dashboard configurations
		`CREATE TABLE IF NOT EXISTS config (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			data TEXT NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		// Status cache for HTTP/ICMP checks
		`CREATE TABLE IF NOT EXISTS status_cache (
			entry_id TEXT PRIMARY KEY,
			status TEXT NOT NULL,
			response_time INTEGER,
			last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		// Secrets table for secret dashboard URLs
		`CREATE TABLE IF NOT EXISTS secrets (
			id TEXT PRIMARY KEY,
			dashboard_id TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

		// Migration: Add image_url column if it doesn't exist
		`ALTER TABLE icons ADD COLUMN image_url TEXT`,

		// Index for faster category lookups
		`CREATE INDEX IF NOT EXISTS idx_icons_category ON icons(category_id)`,
		`CREATE INDEX IF NOT EXISTS idx_icons_preset ON icons(is_preset)`,
	}

	for _, migration := range migrations {
		if _, err := db.Exec(migration); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}

	// Create default admin user if none exists
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to check users: %w", err)
	}

	if count == 0 {
		// Default password: "admin" - should be changed on first login
		// This is bcrypt hash of "admin"
		defaultHash := "$2a$10$trkEbQD4PIkE23o.7Gn4TOBCOYo48m70IlqFpJZH98JcIi1s6oeTG"
		_, err := db.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", "admin", defaultHash)
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
		defaultConfig := `{
  "dashboards": [
    {
      "id": "home",
      "name": "Home",
      "path": "/home",
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
		_, err := db.Exec("INSERT INTO config (id, data) VALUES (1, ?)", defaultConfig)
		if err != nil {
			return fmt.Errorf("failed to create default config: %w", err)
		}
	}

	return nil
}
