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
		defaultHash := "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
		_, err := db.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", "admin", defaultHash)
		if err != nil {
			return fmt.Errorf("failed to create default admin user: %w", err)
		}
	}

	// Initialize empty config if none exists
	var configCount int
	err = db.QueryRow("SELECT COUNT(*) FROM config").Scan(&configCount)
	if err != nil {
		return fmt.Errorf("failed to check config: %w", err)
	}

	if configCount == 0 {
		defaultConfig := `{"dashboards":[]}`
		_, err := db.Exec("INSERT INTO config (id, data) VALUES (1, ?)", defaultConfig)
		if err != nil {
			return fmt.Errorf("failed to create default config: %w", err)
		}
	}

	return nil
}
