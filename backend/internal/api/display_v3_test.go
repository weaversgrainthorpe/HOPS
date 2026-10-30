package api

import (
	"encoding/json"
	"testing"
)

// displayOf returns dashboard id's read-only `display` block from a view.
func displayOf(t *testing.T, view map[string]interface{}, id string) map[string]interface{} {
	t.Helper()
	for _, d := range view["dashboards"].([]interface{}) {
		if dm := d.(map[string]interface{}); dm["id"] == id {
			disp, ok := dm["display"].(map[string]interface{})
			if !ok {
				t.Fatalf("dashboard %s has no display block: %v", id, dm["display"])
			}
			return disp
		}
	}
	t.Fatalf("dashboard %s not in view", id)
	return nil
}

// GET /api/config carries each dashboard's effective
// animatedFolderBackgrounds (read-only, computed), and a save never stores it.
func TestGetConfig_DisplayAnimatedFolderBackgrounds(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)

	// Inherit: the global default (true).
	if got := displayOf(t, getView(t, c), "d1")["animatedFolderBackgrounds"]; got != true {
		t.Fatalf("inherit: animatedFolderBackgrounds = %v, want true", got)
	}

	// Override off.
	if code, r := c.do("PUT", "/api/dashboards/d1/settings", map[string]interface{}{
		"overrides": map[string]interface{}{"animatedFolderBackgrounds": false}, "revision": 1}); code != 200 {
		t.Fatalf("settings: %d %v", code, r)
	}
	if got := displayOf(t, getView(t, c), "d1")["animatedFolderBackgrounds"]; got != false {
		t.Fatalf("override off: animatedFolderBackgrounds = %v, want false", got)
	}

	// Echo the GET body (display included, and a forged value) back as a save.
	d := v3Body(t, c, "d1")
	d["display"] = map[string]interface{}{"animatedFolderBackgrounds": true}
	code, resp := v3Put(c, "d1", d, 2)
	if code != 200 {
		t.Fatalf("put: %d %v", code, resp)
	}
	if _, has := storedDashboards(storedDoc(t, db))["d1"]["display"]; has {
		t.Fatal("display was stored")
	}
	// The write response's layout carries display too (computed, not echoed).
	lay, _ := resp["layout"].(map[string]interface{})
	if lay == nil {
		t.Fatalf("no layout in response: %v", resp)
	}
	if got := displayOf(t, lay, "d1")["animatedFolderBackgrounds"]; got != false {
		t.Fatalf("layout display = %v, want false (computed, not the forged echo)", got)
	}

	// Override on.
	if code, r := c.do("PUT", "/api/dashboards/d1/settings", map[string]interface{}{
		"overrides": map[string]interface{}{"animatedFolderBackgrounds": true}, "revision": 3}); code != 200 {
		t.Fatalf("settings on: %d %v", code, r)
	}
	if got := displayOf(t, getView(t, c), "d1")["animatedFolderBackgrounds"]; got != true {
		t.Fatalf("override on: animatedFolderBackgrounds = %v, want true", got)
	}
}

// A hops-v3 import that carries the computed `display`
// block (or any other transient key) stores none of them.
func TestImport_DropsDisplay(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	var env map[string]interface{}
	if err := json.Unmarshal(c.export(""), &env); err != nil {
		t.Fatal(err)
	}
	for _, d := range env["config"].(map[string]interface{})["dashboards"].([]interface{}) {
		dm := d.(map[string]interface{})
		dm["display"] = map[string]interface{}{"animatedFolderBackgrounds": true}
		dm["migrationNotices"] = []interface{}{"x"}
		dm["notices"] = []interface{}{map[string]interface{}{"id": "x", "text": "y"}}
	}
	b, _ := json.Marshal(env)
	if code, resp := c.importFile(b); code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	if !transientDashboardKeys["notices"] {
		t.Error("notices is not a transient key")
	}
	for id, d := range storedDashboards(storedDoc(t, db)) {
		for k := range transientDashboardKeys {
			if _, has := d[k]; has {
				t.Errorf("dashboard %s stored transient key %q", id, k)
			}
		}
	}
}

// Each dashboard's display block carries the global "Animations"
// setting (display.animations), so the editor can read it; a Settings save
// changes it for every dashboard. It has no per-dashboard override.
func TestGetConfig_DisplayAnimationsFollowsTheGlobalSetting(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	if got := displayOf(t, getView(t, c), "d1")["animations"]; got != "on" {
		t.Fatalf("default: animations = %v, want on", got)
	}
	// On / Off / Always, carried as the setting's own value.
	for _, v := range []string{"off", "always", "on"} {
		if w := putSetting(t, router, c.token, c.csrf, "display.animations", v); w.Code != 200 {
			t.Fatalf("put setting %s: %d %s", v, w.Code, w.Body.String())
		}
		if got := displayOf(t, getView(t, c), "d1")["animations"]; got != v {
			t.Fatalf("after setting %s: animations = %v", v, got)
		}
	}
}
