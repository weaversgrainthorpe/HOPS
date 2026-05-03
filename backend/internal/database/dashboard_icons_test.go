package database

import (
	"os"
	"path/filepath"
	"testing"
)

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

func TestImportDashboardIconsMissingDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")
	db, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("Initialize failed: %v", err)
	}
	defer db.Close()

	// dataDir doesn't have icons/dashboard-icons subdir — should be a no-op
	err = ImportDashboardIcons(db, tmpDir)
	if err != nil {
		t.Errorf("ImportDashboardIcons should not fail when directory missing: %v", err)
	}
}

func TestImportDashboardIcons(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	// Create the dashboard-icons directory with sample SVG files
	iconsDir := filepath.Join(tmpDir, "icons", "dashboard-icons")
	if err := os.MkdirAll(iconsDir, 0755); err != nil {
		t.Fatalf("failed to create icons dir: %v", err)
	}

	// Sample icons - mix of known categories and a generic one
	sampleIcons := []string{
		"docker.svg",
		"plex.svg",
		"home-assistant.svg",
		"unknown-app-xyz.svg",
		"docker-dark.svg",  // should be skipped (variant)
		"plex-light.svg",   // should be skipped (variant)
	}

	for _, name := range sampleIcons {
		path := filepath.Join(iconsDir, name)
		if err := os.WriteFile(path, []byte("<svg></svg>"), 0644); err != nil {
			t.Fatalf("failed to write %s: %v", name, err)
		}
	}

	db, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("Initialize failed: %v", err)
	}
	defer db.Close()

	// Initialize already calls ImportDashboardIcons via dataDir derived from dbPath.
	// Since dbPath is in tmpDir, the icons should have been imported.
	// Verify count = 4 (variants skipped)
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
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	iconsDir := filepath.Join(tmpDir, "icons", "dashboard-icons")
	if err := os.MkdirAll(iconsDir, 0755); err != nil {
		t.Fatalf("failed to create icons dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(iconsDir, "docker.svg"), []byte("<svg></svg>"), 0644); err != nil {
		t.Fatalf("failed to write icon: %v", err)
	}

	db, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("first Initialize failed: %v", err)
	}

	var count1 int
	db.QueryRow("SELECT COUNT(*) FROM icons WHERE image_url LIKE '/api/icons/dashboard/%'").Scan(&count1)

	// Re-import should be a no-op since icons already exist
	if err := ImportDashboardIcons(db, tmpDir); err != nil {
		t.Fatalf("second ImportDashboardIcons failed: %v", err)
	}

	var count2 int
	db.QueryRow("SELECT COUNT(*) FROM icons WHERE image_url LIKE '/api/icons/dashboard/%'").Scan(&count2)
	db.Close()

	if count1 != count2 {
		t.Errorf("expected idempotent import, count went from %d to %d", count1, count2)
	}
}
