package api

import (
	"encoding/json"
	"strings"
	"testing"
)

// Paths that WHATWG URL parsing could turn into an off-origin URL, or that
// are invisible/ambiguous, are refused on every write that sets one.
var badDashboardPaths = []string{
	`\evil.test`, `/a\b`, "\t/evil.test", "\n//evil.test", "/x\r", "/x\x00", "/x\x7f",
	" /x", "/x ", "/x ",
}

func TestDashboardPathProblem(t *testing.T) {
	for _, p := range badDashboardPaths {
		if dashboardPathProblem(p) == "" {
			t.Errorf("%q accepted", p)
		}
	}
	for _, p := range []string{"/home", "home", "/my dash", "/café", "/a%2Fb", "//x"} {
		if why := dashboardPathProblem(p); why != "" {
			t.Errorf("%q refused: %s", p, why)
		}
	}
}

func TestNormPath_StripsEveryLeadingSlash(t *testing.T) {
	for in, want := range map[string]string{"x": "/x", "/x": "/x", "//x": "/x", "///x/y": "/x/y", "": "/"} {
		if got := normPath(in); got != want {
			t.Errorf("normPath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPutConfig_RejectsUnsafePath(t *testing.T) {
	for _, p := range badDashboardPaths {
		router, _ := setupTestRouter(t)
		c := newClient(t, router)
		seed(t, c)
		view := getView(t, c)
		d := legacyDash("Bad Dash")
		d["path"] = p
		d["revision"] = float64(1)
		code, resp := c.do("PUT", "/api/config", map[string]interface{}{
			"dashboards": []interface{}{d}, "dashboardRevisions": view["dashboardRevisions"]})
		if code != 400 || !strings.Contains(resp["error"].(string), "Bad Dash") {
			t.Errorf("%q: %d %v", p, code, resp)
		}
		if got := getView(t, c)["dashboards"].([]interface{})[0].(map[string]interface{})["path"]; got != "/d1" {
			t.Errorf("%q: stored path changed to %v", p, got)
		}
	}
}

func TestPutDashboard_RejectsUnsafePath(t *testing.T) {
	router, _ := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	for _, p := range badDashboardPaths {
		d := legacyDash("Bad Dash")
		d["path"] = p
		code, resp := c.do("PUT", "/api/dashboards/d1", map[string]interface{}{"dashboard": d, "revision": 1})
		if code != 400 || !strings.Contains(resp["error"].(string), "Bad Dash") {
			t.Errorf("%q: %d %v", p, code, resp)
		}
	}
	// A safe path still saves.
	d := legacyDash("Fine")
	d["path"] = "/my dash"
	if code, resp := c.do("PUT", "/api/dashboards/d1", map[string]interface{}{"dashboard": d, "revision": 1}); code != 200 {
		t.Fatalf("safe path: %d %v", code, resp)
	}
}

func TestImport_RejectsUnsafePath(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	before := len(dashList(storedDoc(t, db)))
	for _, p := range []string{`\evil.test`, "\n//evil.test", " /x"} {
		var env map[string]interface{}
		if err := json.Unmarshal(c.export(""), &env); err != nil {
			t.Fatal(err)
		}
		cfg := env["config"].(map[string]interface{})
		ds := cfg["dashboards"].([]interface{})
		d := ds[len(ds)-1].(map[string]interface{})
		d["path"] = p
		d["name"] = "Bad Import"
		code, resp := c.importFile(v3ExportOf(t, cfg))
		if code != 400 || !strings.Contains(resp["error"].(string), "Bad Import") {
			t.Errorf("%q: %d %v", p, code, resp)
		}
	}
	if after := len(dashList(storedDoc(t, db))); after != before {
		t.Fatalf("import wrote dashboards: %d -> %d", before, after)
	}
}

func TestPromoteNewDashboard_RejectsUnsafePath(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	scanID, rid := seedScan(t, db)
	for _, p := range []string{`\evil.test`, "/x\n", " /x"} {
		body := map[string]interface{}{
			"target": map[string]interface{}{
				"newDashboard": map[string]interface{}{"name": "Promo", "path": p},
				"newTab":       map[string]interface{}{"name": "T"},
			},
			"resultIds": []string{rid},
		}
		code, resp := c.do("POST", "/api/discovery/scans/"+scanID+"/promote", body)
		if code != 400 || !strings.Contains(resp["error"].(string), "Promo") {
			t.Errorf("%q: %d %v", p, code, resp)
		}
	}
}
