package database

import (
	"database/sql"
	"testing"
	"testing/fstest"
)

// newSchemaDB opens an in-memory SQLite database with just the schema +
// idempotent seeds run, but skips the auto-import of dashboard icons from the
// embedded filesystem so tests can inject their own fs.FS.
func newSchemaDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("sql.Open failed: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if _, err := db.Exec("PRAGMA foreign_keys=ON"); err != nil {
		t.Fatalf("enable foreign keys: %v", err)
	}
	if err := runMigrations(db); err != nil {
		t.Fatalf("runMigrations failed: %v", err)
	}
	return db
}

// --- formatDisplayName tests ---

func TestFormatDisplayName(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"home-assistant", "Home Assistant"},
		{"plex", "Plex"},
		{"nginx_proxy_manager", "Nginx Proxy Manager"},
		{"jellyfin-media-server", "Jellyfin Media Server"},
		{"PROXMOX", "Proxmox"},
		{"", ""},
		{"a", "A"},
	}

	for _, tt := range tests {
		got := formatDisplayName(tt.input)
		if got != tt.expected {
			t.Errorf("formatDisplayName(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

// --- categorizeIcon tests ---

func TestCategorizeIconSpecificApp(t *testing.T) {
	// SpecificApps maps known apps directly
	tests := []struct {
		icon     string
		expected string
	}{
		{"docker", "containers"},
		{"plex", "media"},
		{"vaultwarden", "security"},
		{"proxmox", "virtualization"},
		{"grafana", "monitoring"},
		{"nextcloud", "storage"},
	}

	for _, tt := range tests {
		got := categorizeIcon(tt.icon)
		if got != tt.expected {
			t.Errorf("categorizeIcon(%q) = %q, want %q", tt.icon, got, tt.expected)
		}
	}
}

func TestCategorizeIconKeywordMatch(t *testing.T) {
	// Icons matching category keywords (not in SpecificApps)
	got := categorizeIcon("sonarr")
	if got != "media" {
		t.Errorf("categorizeIcon(%q) = %q, want %q", "sonarr", got, "media")
	}
}

func TestCategorizeIconUnknownDefaultsToDevelopment(t *testing.T) {
	got := categorizeIcon("some-completely-unknown-icon-xyz")
	if got != "development" {
		t.Errorf("categorizeIcon unknown should default to 'development', got %q", got)
	}
}

func TestCategorizeIconCaseInsensitive(t *testing.T) {
	got := categorizeIcon("DOCKER")
	if got != "containers" {
		t.Errorf("categorizeIcon should be case-insensitive, got %q for DOCKER", got)
	}
}

// --- ImportDashboardIcons tests ---

func TestImportDashboardIconsEmptyFilesystem(t *testing.T) {
	db := newSchemaDB(t)

	// Empty fs — should be a no-op, not an error
	if err := ImportDashboardIcons(db, fstest.MapFS{}); err != nil {
		t.Errorf("ImportDashboardIcons should not fail on empty filesystem: %v", err)
	}

	var count int
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM icons WHERE image_url LIKE '/api/icons/dashboard/%'",
	).Scan(&count); err != nil {
		t.Fatalf("count failed: %v", err)
	}
	if count != 0 {
		t.Errorf("expected 0 icons imported from empty fs, got %d", count)
	}
}

func TestImportDashboardIcons(t *testing.T) {
	db := newSchemaDB(t)

	// Sample icons - mix of known categories and a generic one. Variants
	// (-dark/-light) are skipped by the importer.
	iconsFS := fstest.MapFS{
		"docker.svg":          {Data: []byte("<svg></svg>")},
		"plex.svg":            {Data: []byte("<svg></svg>")},
		"home-assistant.svg":  {Data: []byte("<svg></svg>")},
		"unknown-app-xyz.svg": {Data: []byte("<svg></svg>")},
		"docker-dark.svg":     {Data: []byte("<svg></svg>")}, // variant - skipped
		"plex-light.svg":      {Data: []byte("<svg></svg>")}, // variant - skipped
	}

	if err := ImportDashboardIcons(db, iconsFS); err != nil {
		t.Fatalf("ImportDashboardIcons failed: %v", err)
	}

	var count int
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM icons WHERE image_url LIKE '/api/icons/dashboard/%'",
	).Scan(&count); err != nil {
		t.Fatalf("failed to count icons: %v", err)
	}

	if count != 4 {
		t.Errorf("expected 4 icons imported (variants skipped), got %d", count)
	}

	// Verify a known icon was categorized correctly
	var category string
	if err := db.QueryRow(
		"SELECT category_id FROM icons WHERE id = 'docker'",
	).Scan(&category); err != nil {
		t.Fatalf("docker icon not found: %v", err)
	}
	if category != "containers" {
		t.Errorf("expected docker categorized as 'containers', got %q", category)
	}

	// Verify display name formatting
	var displayName string
	if err := db.QueryRow(
		"SELECT name FROM icons WHERE id = 'home-assistant'",
	).Scan(&displayName); err != nil {
		t.Fatalf("home-assistant icon not found: %v", err)
	}
	if displayName != "Home Assistant" {
		t.Errorf("expected display name 'Home Assistant', got %q", displayName)
	}
}

func TestImportDashboardIconsIdempotent(t *testing.T) {
	db := newSchemaDB(t)

	iconsFS := fstest.MapFS{
		"docker.svg": {Data: []byte("<svg></svg>")},
	}

	if err := ImportDashboardIcons(db, iconsFS); err != nil {
		t.Fatalf("first ImportDashboardIcons failed: %v", err)
	}

	var count1 int
	db.QueryRow("SELECT COUNT(*) FROM icons WHERE image_url LIKE '/api/icons/dashboard/%'").Scan(&count1)

	// Second call should be a no-op since icons already exist
	if err := ImportDashboardIcons(db, iconsFS); err != nil {
		t.Fatalf("second ImportDashboardIcons failed: %v", err)
	}

	var count2 int
	db.QueryRow("SELECT COUNT(*) FROM icons WHERE image_url LIKE '/api/icons/dashboard/%'").Scan(&count2)

	if count1 != count2 {
		t.Errorf("expected idempotent import, count went from %d to %d", count1, count2)
	}
}
