package assets

import (
	"io/fs"
	"testing"
)

// HOPS ships its own logo as a packaged icon, so a tile can link to another HOPS.
func TestDashboardIconsIncludeHops(t *testing.T) {
	data, err := fs.ReadFile(DashboardIcons, "dashboard-icons/hops.svg")
	if err != nil {
		t.Fatalf("hops.svg missing from the packaged icons: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("hops.svg is empty")
	}
}
