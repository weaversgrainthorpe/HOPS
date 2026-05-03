package database

import (
	"database/sql"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

// --- Initialize / schema tests ---

func TestInitialize(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("Initialize failed: %v", err)
	}
	defer db.Close()

	// Verify all expected tables exist
	expectedTables := []string{"users", "sessions", "config", "status_cache", "icon_categories", "icons"}
	for _, table := range expectedTables {
		var name string
		err := db.QueryRow(
			"SELECT name FROM sqlite_master WHERE type='table' AND name=?",
			table,
		).Scan(&name)
		if err != nil {
			t.Errorf("expected table %q to exist: %v", table, err)
		}
	}
}

func TestInitializeCreatesDefaultAdminUser(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("Initialize failed: %v", err)
	}
	defer db.Close()

	var username string
	err = db.QueryRow("SELECT username FROM users WHERE id = 1").Scan(&username)
	if err != nil {
		t.Fatalf("expected default admin user: %v", err)
	}
	if username != "admin" {
		t.Errorf("expected username 'admin', got %q", username)
	}
}

func TestInitializeCreatesDefaultConfig(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("Initialize failed: %v", err)
	}
	defer db.Close()

	var configData string
	err = db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&configData)
	if err != nil {
		t.Fatalf("expected default config: %v", err)
	}

	// Verify it's valid JSON with a dashboards key
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(configData), &parsed); err != nil {
		t.Fatalf("default config is not valid JSON: %v", err)
	}
	if _, ok := parsed["dashboards"]; !ok {
		t.Error("default config missing 'dashboards' key")
	}
}

func TestInitializeForeignKeysEnabled(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("Initialize failed: %v", err)
	}
	defer db.Close()

	// Verify PRAGMA foreign_keys is ON
	var enabled int
	if err := db.QueryRow("PRAGMA foreign_keys").Scan(&enabled); err != nil {
		t.Fatalf("failed to query foreign_keys pragma: %v", err)
	}
	if enabled != 1 {
		t.Error("expected foreign_keys=ON")
	}
}

func TestInitializeCreatesIndexes(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("Initialize failed: %v", err)
	}
	defer db.Close()

	// Verify expected indexes exist
	expectedIndexes := []string{
		"idx_icons_category",
		"idx_icons_preset",
		"idx_sessions_expires_at",
		"idx_sessions_user_id",
	}
	for _, idx := range expectedIndexes {
		var name string
		err := db.QueryRow(
			"SELECT name FROM sqlite_master WHERE type='index' AND name=?",
			idx,
		).Scan(&name)
		if err != nil {
			t.Errorf("expected index %q to exist: %v", idx, err)
		}
	}
}

func TestInitializeIdempotent(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	// First init
	db1, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("first Initialize failed: %v", err)
	}
	db1.Close()

	// Second init on same file should succeed without duplicating data
	db2, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("second Initialize failed: %v", err)
	}
	defer db2.Close()

	var userCount int
	if err := db2.QueryRow("SELECT COUNT(*) FROM users").Scan(&userCount); err != nil {
		t.Fatalf("failed to count users: %v", err)
	}
	if userCount != 1 {
		t.Errorf("expected exactly 1 user after second init, got %d", userCount)
	}

	var configCount int
	if err := db2.QueryRow("SELECT COUNT(*) FROM config").Scan(&configCount); err != nil {
		t.Fatalf("failed to count config rows: %v", err)
	}
	if configCount != 1 {
		t.Errorf("expected exactly 1 config row, got %d", configCount)
	}
}

func TestSessionCascadeDelete(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("Initialize failed: %v", err)
	}
	defer db.Close()

	// Insert a session for the default admin user
	_, err = db.Exec(
		"INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))",
		"test-session", 1,
	)
	if err != nil {
		t.Fatalf("failed to insert session: %v", err)
	}

	// Delete the user
	if _, err := db.Exec("DELETE FROM users WHERE id = 1"); err != nil {
		t.Fatalf("failed to delete user: %v", err)
	}

	// Verify session was cascade-deleted
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM sessions WHERE id = 'test-session'").Scan(&count); err != nil {
		t.Fatalf("failed to count sessions: %v", err)
	}
	if count != 0 {
		t.Errorf("expected session to be cascade-deleted, found %d remaining", count)
	}
}

func TestIconsCategoryCascadeDelete(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("Initialize failed: %v", err)
	}
	defer db.Close()

	// Insert a custom (non-preset) category and icon
	_, err = db.Exec(
		"INSERT INTO icon_categories (id, name, icon, order_num, is_preset) VALUES (?, ?, ?, ?, 0)",
		"test-cat", "Test", "mdi:test", 999,
	)
	if err != nil {
		t.Fatalf("failed to insert category: %v", err)
	}
	_, err = db.Exec(
		"INSERT INTO icons (id, name, icon, category_id) VALUES (?, ?, ?, ?)",
		"test-icon", "Test Icon", "mdi:test", "test-cat",
	)
	if err != nil {
		t.Fatalf("failed to insert icon: %v", err)
	}

	// Delete the category
	if _, err := db.Exec("DELETE FROM icon_categories WHERE id = 'test-cat'"); err != nil {
		t.Fatalf("failed to delete category: %v", err)
	}

	// Verify icon was cascade-deleted
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM icons WHERE id = 'test-icon'").Scan(&count); err != nil {
		t.Fatalf("failed to count icons: %v", err)
	}
	if count != 0 {
		t.Errorf("expected icon to be cascade-deleted, found %d remaining", count)
	}
}

func TestResetConfig(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("Initialize failed: %v", err)
	}
	defer db.Close()

	// Replace config with custom data
	_, err = db.Exec("UPDATE config SET data = '{\"custom\":true}' WHERE id = 1")
	if err != nil {
		t.Fatalf("failed to update config: %v", err)
	}

	// Reset
	if err := ResetConfig(db); err != nil {
		t.Fatalf("ResetConfig failed: %v", err)
	}

	// Verify config was restored to default
	var configData string
	if err := db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&configData); err != nil {
		t.Fatalf("failed to read config: %v", err)
	}
	if configData == `{"custom":true}` {
		t.Error("expected config to be reset, but custom data remains")
	}
	if !strings.Contains(configData, "dashboards") {
		t.Error("expected reset config to contain 'dashboards' key")
	}
}

func TestDefaultAdminRequiresPasswordChange(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("Initialize failed: %v", err)
	}
	defer db.Close()

	var mustChange int
	if err := db.QueryRow("SELECT must_change_password FROM users WHERE id = 1").Scan(&mustChange); err != nil {
		t.Fatalf("failed to query users: %v", err)
	}
	if mustChange != 1 {
		t.Errorf("expected default admin to have must_change_password=1, got %d", mustChange)
	}
}

func TestAddColumnIfMissing(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	// Open a raw database and create a users table without the column
	rawDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := rawDB.Exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)`); err != nil {
		t.Fatal(err)
	}
	if _, err := rawDB.Exec(`INSERT INTO users (id, username) VALUES (1, 'admin')`); err != nil {
		t.Fatal(err)
	}

	// Run the migration helper
	if err := addColumnIfMissing(rawDB, "users", "must_change_password", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		t.Fatalf("addColumnIfMissing failed: %v", err)
	}

	// Verify the column exists and existing data is preserved
	var mustChange int
	var username string
	if err := rawDB.QueryRow("SELECT username, must_change_password FROM users WHERE id = 1").Scan(&username, &mustChange); err != nil {
		t.Fatalf("failed to query after migration: %v", err)
	}
	if username != "admin" {
		t.Errorf("user data lost: expected admin, got %q", username)
	}
	if mustChange != 0 {
		t.Errorf("expected default value 0, got %d", mustChange)
	}

	// Calling again should be a no-op (idempotent)
	if err := addColumnIfMissing(rawDB, "users", "must_change_password", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		t.Fatalf("second addColumnIfMissing failed: %v", err)
	}

	rawDB.Close()
}

func TestConfigSingleRowConstraint(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("Initialize failed: %v", err)
	}
	defer db.Close()

	// Try to insert a second config row — should fail due to CHECK (id = 1)
	_, err = db.Exec("INSERT INTO config (id, data) VALUES (2, '{}')")
	if err == nil {
		t.Error("expected CHECK constraint to prevent inserting config with id != 1")
	}
}
