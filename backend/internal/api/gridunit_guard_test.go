package api

import (
	"strings"
	"testing"
)

// Ruling 5 (final review Important 1): every request that writes placements
// carries gridUnit: 2, and the server refuses one that does not with a
// visible 409 that leaves the stored document untouched. A browser tab left
// open across the finer-grid update runs the old code, which sends no
// gridUnit, so its 12-column placements can never land in the 24-column
// document.
func TestGridUnitGuard_RefusesPlacementWritesWithoutTheMarker(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db)
	tabID := v3Body(t, c, "d2")["tabs"].([]interface{})[0].(map[string]interface{})["id"].(string)
	target := map[string]interface{}{"tabId": tabID}

	saveBody := func(mut func(d map[string]interface{})) map[string]interface{} {
		d := v3Body(t, c, "d1")
		mut(d)
		return map[string]interface{}{"schema": 3, "dashboard": d, "revision": 1}
	}
	addTile := func(d map[string]interface{}) {
		rootOf(d)["children"] = append(rootOf(d)["children"].([]interface{}), tileJSON("tile-stale", 3, 3))
	}
	rename := func(d map[string]interface{}) { d["name"] = "Stale rename"; d["path"] = "/stale" }
	without := func(b map[string]interface{}) map[string]interface{} { delete(b, "gridUnit"); return b }
	with := func(b map[string]interface{}, v interface{}) map[string]interface{} { b["gridUnit"] = v; return b }

	cases := []struct {
		name, method, path string
		body               map[string]interface{}
	}{
		{"save, no gridUnit", "PUT", "/api/dashboards/d1", without(saveBody(addTile))},
		{"save, gridUnit 1", "PUT", "/api/dashboards/d1", with(saveBody(addTile), 1)},
		{"save, gridUnit \"2\"", "PUT", "/api/dashboards/d1", with(saveBody(addTile), "2")},
		{"save, gridUnit null", "PUT", "/api/dashboards/d1", with(saveBody(addTile), nil)},
		{"rename, no gridUnit", "PUT", "/api/dashboards/d1", without(saveBody(rename))},
		{"rename, gridUnit 4", "PUT", "/api/dashboards/d1", with(saveBody(rename), 4)},
		{"copy, no gridUnit", "POST", "/api/dashboards/transfer", without(transferBody(map[string]interface{}{"target": target}))},
		{"move, no gridUnit", "POST", "/api/dashboards/transfer", without(transferBody(map[string]interface{}{"mode": "move", "target": target}))},
		{"move, gridUnit 1", "POST", "/api/dashboards/transfer", with(transferBody(map[string]interface{}{"mode": "move", "target": target}), 1)},
	}
	before := storedRaw(db)
	backups := backupCount(t, c)
	for _, tc := range cases {
		code, resp := c.do(tc.method, tc.path, tc.body)
		if code != 409 {
			t.Errorf("%s: %d %v, want 409", tc.name, code, resp)
			continue
		}
		if resp["error"] != "grid_unit_mismatch" {
			t.Errorf("%s: error %v, want grid_unit_mismatch", tc.name, resp["error"])
		}
		detail, _ := resp["detail"].(string)
		if !strings.Contains(detail, "Reload") || !strings.Contains(detail, "layout changed") {
			t.Errorf("%s: detail %q does not tell the user to reload because the layout changed", tc.name, detail)
		}
		if storedRaw(db) != before {
			t.Fatalf("%s: a refused write changed the stored document", tc.name)
		}
	}
	if n := backupCount(t, c); n != backups {
		t.Errorf("refused writes took %d backups", n-backups)
	}

	// The same writes carrying gridUnit: 2 go through.
	if code, resp := c.do("PUT", "/api/dashboards/d1", with(saveBody(rename), 2)); code != 200 {
		t.Fatalf("rename with gridUnit 2: %d %v", code, resp)
	}
	if code, resp := c.do("POST", "/api/dashboards/transfer", with(transferBody(map[string]interface{}{
		"sourceRevision": 2, "target": target}), 2.0)); code != 200 {
		t.Fatalf("copy with gridUnit 2: %d %v", code, resp)
	}
}
