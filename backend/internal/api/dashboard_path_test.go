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

func TestCreateDashboard_RejectsUnsafePath(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	before := storedRaw(db)
	for _, p := range badDashboardPaths {
		code, resp := c.do("POST", "/api/dashboards", map[string]interface{}{"name": "Bad Dash", "path": p})
		if code != 400 || !strings.Contains(resp["error"].(string), "path") {
			t.Errorf("%q: %d %v", p, code, resp)
		}
	}
	if storedRaw(db) != before {
		t.Fatal("rejected creates changed the stored doc")
	}
}

func TestPutDashboard_RejectsUnsafePath(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	for _, p := range badDashboardPaths {
		d := v3Body(t, c, "d1")
		d["name"] = "Bad Dash"
		d["path"] = p
		code, resp := v3Put(c, "d1", d, 1)
		if code != 400 || !strings.Contains(resp["error"].(string), "Bad Dash") {
			t.Errorf("%q: %d %v", p, code, resp)
		}
	}
	if got := getView(t, c)["dashboards"].([]interface{})[0].(map[string]interface{})["path"]; got != "/d1" {
		t.Errorf("stored path changed to %v", got)
	}
	// A safe path still saves.
	d := v3Body(t, c, "d1")
	d["name"] = "Fine"
	d["path"] = "/my dash"
	if code, resp := v3Put(c, "d1", d, 1); code != 200 {
		t.Fatalf("safe path: %d %v", code, resp)
	}
}

func TestImport_RejectsUnsafePath(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
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
	seed(t, db)
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

// A dashboard path whose first segment is one of HOPS's own pages or server routes would be
// unreachable (the page or route wins), so it is refused, case-insensitively.
func TestDashboardPathProblem_ReservedSegments(t *testing.T) {
	for _, p := range []string{"/add", "add", "/Settings", "/settings/x", "/admin", "/api", "/icons", "/backgrounds", "/presets", "/_app/x"} {
		if why := dashboardPathProblem(p); !strings.Contains(why, "reserved") {
			t.Errorf("%q: got %q, want a reserved-path refusal", p, why)
		}
	}
	for _, p := range []string{"/added", "/my-settings", "/apiary", "/home/add"} {
		if why := dashboardPathProblem(p); why != "" {
			t.Errorf("%q refused: %s", p, why)
		}
	}
}

func TestEnsureUniqueDashboardPath_AvoidsReserved(t *testing.T) {
	if got := ensureUniqueDashboardPath(nil, slugifyDashboardPath("Settings")); got != "/settings-2" {
		t.Errorf("promote of a dashboard named Settings got path %q, want /settings-2", got)
	}
}
