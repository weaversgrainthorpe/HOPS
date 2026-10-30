package api

import (
	"strings"
	"testing"
)

// At the API: forbidden or oversized targets are 400
// server-side, and a second scan while one holds the slot is 409.
func TestCreateScan_RefusesForbiddenTargetsAndConcurrentScans(t *testing.T) {
	r, router, db := setupTestRouterInDir(t, t.TempDir())
	c := newClient(t, router)
	seed(t, db)
	for _, cidr := range []string{
		"0.0.0.0/0", "10.0.0.0/15", "1.0.0.0-255.255.255.255", "169.254.169.254", "169.253.255.250-169.254.0.5",
		"224.0.0.0/24", "255.255.255.255", "240.0.0.0/24", "100.100.100.0/24", "0xa9fea9fe", "::ffff:169.254.169.254",
	} {
		code, resp := c.do("POST", "/api/discovery/scans", map[string]any{"cidr": cidr, "intensity": "passive"})
		if code != 400 {
			t.Errorf("%s: %d %v, want 400", cidr, code, resp)
		}
	}
	if !r.discoveryOrch.Reserve() {
		t.Fatal("reserve")
	}
	code, resp := c.do("POST", "/api/discovery/scans", map[string]any{"cidr": "172.16.0.0/24", "intensity": "passive"})
	if code != 409 || !strings.Contains(resp["error"].(string), "already running") {
		t.Fatalf("concurrent scan: %d %v, want 409", code, resp)
	}
	r.discoveryOrch.Release()
}
