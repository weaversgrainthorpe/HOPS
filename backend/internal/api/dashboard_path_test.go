package api

import (
	"os"
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

// Importing a dashboard whose path is a HOPS page renames it to the next free path and says so;
// the same path written directly (PUT) is still refused.
func TestImport_ReservedPathIsRenamedAndReported(t *testing.T) {
	check := func(t *testing.T, resp map[string]interface{}, want string) {
		t.Helper()
		msg, _ := resp["message"].(string)
		if !strings.Contains(msg, "moved to "+want) || !strings.Contains(msg, "is a HOPS page") {
			t.Errorf("message does not report the rename to %s: %q", want, msg)
		}
		if n := pathMoves(resp); n != 1 {
			t.Errorf("renamed = %v", resp["renamed"])
		}
	}
	t.Run("v2 export", func(t *testing.T) {
		data, err := os.ReadFile("../configdoc/testdata/real_sample.json")
		if err != nil {
			t.Fatal(err)
		}
		var cfg map[string]interface{}
		if err := json.Unmarshal(data, &cfg); err != nil {
			t.Fatal(err)
		}
		cfg["dashboards"].([]interface{})[0].(map[string]interface{})["path"] = "/settings"
		data, _ = json.Marshal(cfg)
		router, db := setupTestRouter(t)
		c := newClient(t, router)
		code, resp := c.importFile(data)
		if code != 200 {
			t.Fatalf("import: %d %v", code, resp)
		}
		check(t, resp, "/settings-2")
		ds := dashList(storedDoc(t, db))
		if got := ds[len(ds)-1]["path"]; got != "/settings-2" {
			t.Errorf("stored path %v", got)
		}
		assertUniqueIDs(t, storedDoc(t, db))
	})

	t.Run("HOPS export", func(t *testing.T) {
		router, db := setupTestRouter(t)
		c := newClient(t, router)
		seed(t, db)
		var env map[string]interface{}
		if err := json.Unmarshal(c.export(""), &env); err != nil {
			t.Fatal(err)
		}
		cfg := env["config"].(map[string]interface{})
		ds := cfg["dashboards"].([]interface{})
		d := ds[len(ds)-1].(map[string]interface{})
		d["path"] = "/Admin/x"
		d["name"] = "Admin Board"
		code, resp := c.importFile(v3ExportOf(t, cfg))
		if code != 200 {
			t.Fatalf("import: %d %v", code, resp)
		}
		msg := resp["message"].(string)
		if !strings.Contains(msg, "Dashboard 'Admin Board' moved to /Admin-2/x because /admin is a HOPS page") {
			t.Errorf("message: %q", msg)
		}
		if pathMoves(resp) != 1 {
			t.Errorf("renamed = %v", resp["renamed"])
		}
		assertUniqueIDs(t, storedDoc(t, db))
	})

	// The Homer/Dashy/Heimdall converters write fixed paths (/home, /heimdall), none reserved, so
	// they need no rename; the guard is that they still import and report nothing renamed.
	t.Run("converter (Homer) needs no rename", func(t *testing.T) {
		router, db := setupTestRouter(t)
		c := newClient(t, router)
		homer := []byte("title: Settings\nservices:\n  - name: Media\n    items:\n      - name: Plex\n        url: https://plex.example\n")
		code, resp := c.importFile(homer)
		if code != 200 {
			t.Fatalf("import: %d %v", code, resp)
		}
		for _, d := range dashList(storedDoc(t, db)) {
			if p, _ := d["path"].(string); dashboardPathProblem(p) != "" {
				t.Errorf("stored a reserved path %q", p)
			}
		}
		if pathMoves(resp) != 0 {
			t.Errorf("renamed = %v", resp["renamed"])
		}
	})

	t.Run("direct PUT still refuses", func(t *testing.T) {
		router, db := setupTestRouter(t)
		c := newClient(t, router)
		seed(t, db)
		d := v3Body(t, c, "d1")
		d["path"] = "/settings"
		code, resp := v3Put(c, "d1", d, 1)
		if code != 400 || !strings.Contains(resp["error"].(string), "reserved") {
			t.Errorf("%d %v", code, resp)
		}
	})
}

// pathMoves counts the dashboard path moves in an import result's renamed list
// (it also holds one summary line when internal ids were renamed).
func pathMoves(resp map[string]interface{}) int {
	n := 0
	ren, _ := resp["renamed"].([]interface{})
	for _, r := range ren {
		if s, _ := r.(string); strings.Contains(s, "moved to") {
			n++
		}
	}
	return n
}
