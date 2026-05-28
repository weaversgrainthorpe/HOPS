package database

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

// TestMigrationSafety_OldSchema_Upgrade simulates a v1.x database that
// pre-dates several v2.0 tables/columns and verifies Initialize() brings
// it forward without losing existing rows.
//
// The bug class this guards against is: a future release ships a
// migration that drops or renames a column the old schema depended on,
// silently destroying a homelab's saved dashboards on upgrade.
func TestMigrationSafety_OldSchema_Upgrade(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "old.db")

	// Hand-roll a pared-down "v1.x-ish" schema:
	//   - users + sessions + config + status_cache exist
	//   - app_settings exists with a non-default value
	//   - the v2.0 user_detectors / scans / scan_results tables do NOT exist
	//   - the v2.0+ user_detectors.favicon_hashes column does NOT exist (n/a here — whole table missing)
	{
		raw, err := sql.Open("sqlite", dbPath)
		if err != nil {
			t.Fatalf("open: %v", err)
		}
		stmts := []string{
			`CREATE TABLE users (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				username TEXT UNIQUE NOT NULL,
				password_hash TEXT NOT NULL,
				must_change_password INTEGER NOT NULL DEFAULT 0,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE config (
				id INTEGER PRIMARY KEY,
				data TEXT NOT NULL
			)`,
			`CREATE TABLE app_settings (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			// Insert known data — these rows must survive the migration.
			`INSERT INTO users (id, username, password_hash, must_change_password) VALUES (42, 'precious', '$2a$10$abc', 0)`,
			`INSERT INTO config (id, data) VALUES (1, '{"dashboards":[{"name":"Precious","tabs":[]}]}')`,
			`INSERT INTO app_settings (key, value) VALUES ('auth.login_rate_limit_per_min', '99')`,
		}
		for _, s := range stmts {
			if _, err := raw.Exec(s); err != nil {
				t.Fatalf("seed: %v\n%s", err, s)
			}
		}
		raw.Close()
	}

	// Bring it forward through HOPS's normal init path
	db, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("Initialize on old schema failed: %v", err)
	}
	defer db.Close()

	// 1. Pre-existing user is intact (and not overwritten by the default-admin seed)
	var (
		gotUsername string
		mustChange  int
	)
	if err := db.QueryRow(`SELECT username, must_change_password FROM users WHERE id = 42`).Scan(&gotUsername, &mustChange); err != nil {
		t.Fatalf("pre-existing user lost during migration: %v", err)
	}
	if gotUsername != "precious" {
		t.Errorf("user 42 username = %q, want %q", gotUsername, "precious")
	}

	// 2. Pre-existing config row is untouched
	var configData string
	if err := db.QueryRow(`SELECT data FROM config WHERE id = 1`).Scan(&configData); err != nil {
		t.Fatalf("config row lost: %v", err)
	}
	if !contains(configData, "Precious") {
		t.Errorf("config data changed shape during migration: %q", configData)
	}

	// 3. Pre-existing app_settings value is untouched
	var rateLimit string
	if err := db.QueryRow(`SELECT value FROM app_settings WHERE key = 'auth.login_rate_limit_per_min'`).Scan(&rateLimit); err != nil {
		t.Fatalf("app_setting lost: %v", err)
	}
	if rateLimit != "99" {
		t.Errorf("rate-limit setting changed: got %q want %q", rateLimit, "99")
	}

	// 4. The v2.0+ tables that the old DB didn't have are now present
	for _, table := range []string{"user_detectors", "scans", "scan_results", "sessions"} {
		var name string
		err := db.QueryRow(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&name)
		if err != nil {
			t.Errorf("expected table %q to be created by migrations, but it's missing: %v", table, err)
		}
	}

	// 5. The v2.0+ user_detectors.favicon_hashes column exists (addColumnIfMissing)
	var hasFaviconHashes bool
	rows, err := db.Query(`PRAGMA table_info(user_detectors)`)
	if err != nil {
		t.Fatalf("PRAGMA: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			cid     int
			name    string
			ctype   string
			notnull int
			dflt    sql.NullString
			pk      int
		)
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			t.Fatalf("scan PRAGMA row: %v", err)
		}
		if name == "favicon_hashes" {
			hasFaviconHashes = true
		}
	}
	if !hasFaviconHashes {
		t.Error("user_detectors.favicon_hashes column missing after migration")
	}
}

// TestMigrationSafety_DoubleInit confirms re-running Initialize on a
// freshly-migrated DB is a no-op (idempotent — already covered by
// TestInitializeIdempotent, but kept here as a co-located guard so
// the migration-safety surface is in one file).
func TestMigrationSafety_DoubleInit(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "double.db")

	db1, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("first init: %v", err)
	}
	db1.Close()

	db2, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("second init: %v", err)
	}
	defer db2.Close()

	// Quick sanity check that data wasn't duplicated
	var n int
	if err := db2.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		t.Fatalf("count users: %v", err)
	}
	if n != 1 {
		t.Errorf("expected 1 admin user, got %d", n)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
