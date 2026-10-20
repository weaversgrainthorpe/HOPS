package api

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/discovery"
)

// M3 Task 11: the legacy (v2-shaped) view and editor are retired. Everything
// reads and writes the v3 document.

// GET /api/config is the v3 document: exactly schemaVersion and dashboards
// (plus migrationNotices / notices when there are any), with no groups/entries anywhere
// and none of the retired view-only keys.
func TestGetConfig_IsTheV3Document(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addShowcase(t, db)
	v := getView(t, c)
	for k := range v {
		if k != "schemaVersion" && k != "dashboards" {
			t.Errorf("unexpected top-level key %q in GET /api/config", k)
		}
	}
	if v["schemaVersion"] != float64(3) {
		t.Fatalf("schemaVersion = %v", v["schemaVersion"])
	}
	b, _ := json.Marshal(v)
	for _, bad := range []string{`"groups"`, `"entries"`, "v3OnlyDashboards", "dashboardRevisions", `"layout":{`} {
		if strings.Contains(string(b), bad) {
			t.Errorf("GET /api/config contains %s", bad)
		}
	}
	ids := map[string]bool{}
	for _, d := range v["dashboards"].([]interface{}) {
		ids[d.(map[string]interface{})["id"].(string)] = true
	}
	if !ids["d1"] || !ids["s1"] {
		t.Fatalf("every dashboard (Showcase included) is served: %v", ids)
	}
	// Exactly the stored dashboards (nothing added or left out), apart from
	// the computed read-only `display` block (Ruling 9), which every served
	// dashboard carries.
	stored, _ := json.Marshal(storedDoc(t, db)["dashboards"])
	for _, d := range v["dashboards"].([]interface{}) {
		dm := d.(map[string]interface{})
		if _, ok := dm["display"].(map[string]interface{}); !ok {
			t.Fatalf("dashboard %v lacks display", dm["id"])
		}
		delete(dm, "display")
	}
	served, _ := json.Marshal(v["dashboards"])
	var a, bb interface{}
	_ = json.Unmarshal(stored, &a)
	_ = json.Unmarshal(served, &bb)
	sa, _ := json.Marshal(a)
	sb, _ := json.Marshal(bb)
	if string(sa) != string(sb) {
		t.Fatalf("served dashboards differ from stored:\n%s\n%s", sa, sb)
	}
}

// The stored document's other top-level keys (old v2 theme/settings) are not
// dashboard content and are never served.
func TestGetConfig_ServesOnlyDashboardContent(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	doc := storedDoc(t, db)
	doc["theme"] = configdoc.Obj{"mode": "dark", "customCss": "secret"}
	doc["settings"] = configdoc.Obj{"internal": "x"}
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
	v := getView(t, c)
	if _, has := v["theme"]; has {
		t.Fatal("theme served")
	}
	if _, has := v["settings"]; has {
		t.Fatal("top-level settings served")
	}
}

// The whole-config PUT is gone: import and restore have their own endpoints.
func TestPutConfig_Gone(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	before := storedRaw(db)
	code, _ := c.do("PUT", "/api/config", map[string]interface{}{"dashboards": []interface{}{}})
	if code != 405 {
		t.Fatalf("PUT /api/config = %d, want 405", code)
	}
	if storedRaw(db) != before {
		t.Fatal("stored doc changed")
	}
}

// A dashboard PUT without schema 3 (the old legacy shape) is refused visibly.
func TestPutDashboard_LegacyShapeRefused(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	before := storedRaw(db)
	code, resp := c.do("PUT", "/api/dashboards/d1", map[string]interface{}{"dashboard": legacyDash("X"), "revision": 1})
	if code != 400 || !strings.Contains(resp["error"].(string), "schema 3") {
		t.Fatalf("legacy PUT: %d %v", code, resp)
	}
	if storedRaw(db) != before {
		t.Fatal("stored doc changed")
	}
}

// The Showcase (previously "view-only") saves through the v3 PUT.
func TestShowcase_IsEditable(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addShowcase(t, db)
	d := v3Body(t, c, "s1")
	d["name"] = "Showcase edited"
	code, resp := v3Put(c, "s1", d, 3)
	if code != 200 || resp["revision"] != float64(4) {
		t.Fatalf("v3 PUT on the Showcase: %d %v", code, resp)
	}
	if storedDash(t, db, "s1")["name"] != "Showcase edited" {
		t.Fatal("not stored")
	}
}

// findNode returns the node with id anywhere in dashboard d.
func findOne(d configdoc.Obj, id string) configdoc.Obj {
	var out configdoc.Obj
	configdoc.Walk(configdoc.Obj{"dashboards": []any{d}}, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		if n["id"] == id {
			out = n
			return false
		}
		return true
	})
	return out
}

func contentKids(f configdoc.Obj) []any {
	c, _ := f["content"].(configdoc.Obj)
	k, _ := c["children"].([]any)
	return k
}

// Promote into an existing folder two levels deep: every tile lands there,
// as a v3 tile with a placement inside that folder's grid, the target's
// revision is bumped, and no other dashboard changes.
func TestPromote_IntoExistingFolderAtDepth2(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addShowcase(t, db)
	s1Before := storedDashJSON(t, db, "s1")
	scanID, rid := seedScan(t, db)
	st := discovery.NewStore(db)
	if err := st.InsertResult(&discovery.Result{
		ID: "result-0002", ScanID: scanID, Host: "10.0.0.6", Port: 80, DetectorID: "x",
		Confidence: "high", Category: "network", SuggestedName: "Other thing",
		SuggestedURL: "http://10.0.0.6", CurateState: discovery.CuratePending,
	}); err != nil {
		t.Fatal(err)
	}
	// d1 has folder g1 at the root; put folder g2 inside it (depth 2).
	doc := storedDoc(t, db)
	g1 := findOne(storedDashboards(doc)["d1"], "g1")
	// g2 is one row tall (too short for any tile); a tile sits right below it.
	g1["content"].(configdoc.Obj)["children"] = append(contentKids(g1), configdoc.Obj{
		"id": "g2", "kind": "folder", "name": "Deep", "display": "expanded", "layout": "inherit",
		"placement": configdoc.Obj{"x": 0, "y": 1, "w": 3, "h": 1},
		"content":   configdoc.Obj{"columns": 3, "children": []any{}},
	}, configdoc.Obj{"id": "below", "kind": "tile", "name": "Below", "url": "http://b",
		"placement": configdoc.Obj{"x": 0, "y": 2, "w": 1, "h": 1}})
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
	n := backupCount(t, c)

	code, resp := c.do("POST", "/api/discovery/scans/"+scanID+"/promote", map[string]interface{}{
		"target":    map[string]interface{}{"dashboardId": "d1", "tabId": "t1", "folderId": "g2"},
		"resultIds": []string{rid, "result-0002"},
	})
	if code != 200 || resp["promoted"] != float64(2) {
		t.Fatalf("promote: %d %v", code, resp)
	}
	if backupCount(t, c) != n+1 {
		t.Fatal("accepted promote took no backup")
	}
	d1 := storedDash(t, db, "d1")
	if d1["revision"] != float64(2) {
		t.Fatalf("d1 revision = %v, want 2", d1["revision"])
	}
	g2 := findOne(d1, "g2")
	kids := contentKids(g2)
	if len(kids) != 2 {
		t.Fatalf("g2 children = %v", kids)
	}
	seen := map[[2]float64]bool{}
	for _, k := range kids {
		tile := k.(configdoc.Obj)
		p, _ := tile["placement"].(configdoc.Obj)
		if tile["kind"] != "tile" || p == nil || p["w"] != float64(1) || p["h"] != float64(1) {
			t.Fatalf("not a 1x1 v3 tile: %v", tile)
		}
		if x := p["x"].(float64); x < 0 || x >= 3 {
			t.Fatalf("tile outside g2's 3 columns: %v", p)
		}
		at := [2]float64{p["x"].(float64), p["y"].(float64)}
		if seen[at] {
			t.Fatalf("two tiles at %v", at)
		}
		seen[at] = true
		if id, _ := tile["id"].(string); !strings.HasPrefix(id, "tile-") {
			t.Fatalf("tile id %q", id)
		}
	}
	// g2 grew to fit its tiles plus its title row; the tile below it moved
	// down by the same amount, and g1 grew to hold it all.
	if _, _, _, h, _ := rect(g2["placement"]); h != 2 {
		t.Fatalf("g2 h = %v, want 2", h)
	}
	if _, y, _, _, _ := rect(findOne(d1, "below")["placement"]); y != 3 {
		t.Fatalf("tile below g2 at y=%v, want 3", y)
	}
	if _, _, _, h, _ := rect(findOne(d1, "g1")["placement"]); h != 5 {
		t.Fatalf("g1 h = %v, want 5 (content bottom 4 + title)", h)
	}
	// No new folders anywhere: tiles went where they were asked to.
	if got := len(rootOf(map[string]interface{}{"tabs": d1["tabs"]})["children"].([]interface{})); got != 1 {
		t.Fatalf("root children = %d, want 1 (no category folders when a folder is picked)", got)
	}
	if storedDashJSON(t, db, "s1") != s1Before {
		t.Fatal("promote changed another dashboard")
	}
	if err := configdoc.VerifyDashboard(d1); err != nil {
		t.Fatalf("stored dashboard does not verify: %v", err)
	}
}

// With no folder picked, promote creates (or reuses) one folder per category
// in the tab, on any dashboard, including the Showcase.
func TestPromote_FolderPerCategoryOnShowcase(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addShowcase(t, db)
	scanID, rid := seedScan(t, db)
	code, resp := c.do("POST", "/api/discovery/scans/"+scanID+"/promote", map[string]interface{}{
		"target":    map[string]interface{}{"dashboardId": "s1", "tabId": "s1-t1"},
		"resultIds": []string{rid},
	})
	if code != 200 {
		t.Fatalf("promote: %d %v", code, resp)
	}
	s1 := storedDash(t, db, "s1")
	if s1["revision"] != float64(4) {
		t.Fatalf("s1 revision = %v, want 4", s1["revision"])
	}
	root := rootOf(map[string]interface{}{"tabs": s1["tabs"]})
	var folder configdoc.Obj
	for _, k := range root["children"].([]interface{}) {
		if m := k.(configdoc.Obj); m["kind"] == "folder" && m["name"] == "Other" {
			folder = m
		}
	}
	if folder == nil {
		b, _ := json.Marshal(root)
		t.Fatalf("no Other folder: %s", b)
	}
	if len(contentKids(folder)) != 1 {
		t.Fatalf("folder tiles: %v", contentKids(folder))
	}
	// Placed clear of the Showcase's existing items (free tab: no overlap).
	fx, fy, fw, fh, _ := rect(folder["placement"])
	for _, k := range root["children"].([]interface{}) {
		m := k.(configdoc.Obj)
		if m["id"] == folder["id"] {
			continue
		}
		x, y, w, h, _ := rect(m["placement"])
		if fx < x+w && x < fx+fw && fy < y+h && y < fy+fh {
			t.Fatalf("new folder %v overlaps %v", folder["placement"], m["placement"])
		}
	}
	if err := configdoc.VerifyDashboard(s1); err != nil {
		t.Fatalf("stored dashboard does not verify: %v", err)
	}

	// A second promote of another result in the same category reuses the folder.
	st := discovery.NewStore(db)
	if err := st.InsertResult(&discovery.Result{
		ID: "result-0003", ScanID: scanID, Host: "10.0.0.7", Port: 80, DetectorID: "x",
		Confidence: "high", Category: discovery.CategoryOther, SuggestedName: "Third",
		SuggestedURL: "http://10.0.0.7", CurateState: discovery.CuratePending,
	}); err != nil {
		t.Fatal(err)
	}
	code, resp = c.do("POST", "/api/discovery/scans/"+scanID+"/promote", map[string]interface{}{
		"target":    map[string]interface{}{"dashboardId": "s1", "tabId": "s1-t1"},
		"resultIds": []string{"result-0003"},
	})
	if code != 200 {
		t.Fatalf("second promote: %d %v", code, resp)
	}
	again := findOne(storedDash(t, db, "s1"), folder["id"].(string))
	if len(contentKids(again)) != 2 {
		t.Fatalf("folder not reused: %v", contentKids(again))
	}
}

// Promote rejections write nothing and take no backup.
func TestPromote_TargetRejections(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addShowcase(t, db)
	scanID, rid := seedScan(t, db)
	before := storedRaw(db)
	n := backupCount(t, c)
	for _, tc := range []struct {
		name   string
		target map[string]interface{}
		code   int
	}{
		{"unknown dashboard", map[string]interface{}{"dashboardId": "nope", "tabId": "t1"}, 400},
		{"unknown tab", map[string]interface{}{"dashboardId": "d1", "tabId": "nope"}, 400},
		{"unknown folder", map[string]interface{}{"dashboardId": "d1", "tabId": "t1", "folderId": "nope"}, 400},
		{"tile as folder", map[string]interface{}{"dashboardId": "d1", "tabId": "t1", "folderId": "e1"}, 400},
		{"folder in a new tab", map[string]interface{}{"dashboardId": "d1", "newTab": map[string]interface{}{"name": "N"}, "folderId": "g1"}, 400},
	} {
		code, resp := c.do("POST", "/api/discovery/scans/"+scanID+"/promote", map[string]interface{}{
			"target": tc.target, "resultIds": []string{rid}})
		if code != tc.code {
			t.Errorf("%s: %d %v, want %d", tc.name, code, resp, tc.code)
		}
	}
	if storedRaw(db) != before {
		t.Fatal("rejected promotes changed the stored doc")
	}
	if backupCount(t, c) != n {
		t.Fatal("rejected promotes took a backup")
	}
	res, err := discovery.NewStore(db).GetResult(scanID, rid)
	if err != nil || res.CurateState == discovery.CuratePromoted {
		t.Fatalf("result marked promoted by a rejected promote: %v %v", res, err)
	}
}

// Promote into a new dashboard + new tab builds a v3 dashboard.
func TestPromote_NewDashboardIsV3(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	scanID, rid := seedScan(t, db)
	code, resp := c.do("POST", "/api/discovery/scans/"+scanID+"/promote", map[string]interface{}{
		"target": map[string]interface{}{
			"newDashboard": map[string]interface{}{"name": "Found"},
			"newTab":       map[string]interface{}{"name": "Services"},
		},
		"resultIds": []string{rid},
	})
	if code != 200 || resp["dashboardPath"] != "/found" {
		t.Fatalf("promote: %d %v", code, resp)
	}
	var nd configdoc.Obj
	for _, d := range dashList(storedDoc(t, db)) {
		if d["path"] == "/found" {
			nd = d
		}
	}
	if nd == nil || nd["revision"] != float64(1) || nd["defaultLayout"] != "grid" {
		t.Fatalf("new dashboard: %v", nd)
	}
	if err := configdoc.VerifyDashboard(nd); err != nil {
		t.Fatalf("new dashboard does not verify: %v", err)
	}
	tab := nd["tabs"].([]any)[0].(configdoc.Obj)
	if tab["name"] != "Services" || tab["root"] == nil {
		t.Fatalf("new tab: %v", tab)
	}
}

// No non-test Go code references the retired legacy machinery.
func TestNoLegacyReferencesInBackend(t *testing.T) {
	banned := []string{"ToLegacy", "FromLegacy", "LegacyCache", "LegacyEditable", "v3Only", "V3Only", "dashboardRevisions", "applyLegacyView", "TabPanel"}
	root := filepath.Join("..", "..")
	fset := token.NewFileSet()
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == "build" || d.Name() == "testdata" || d.Name() == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		f, perr := parser.ParseFile(fset, path, nil, parser.ParseComments)
		if perr != nil {
			return perr
		}
		check := func(s string, pos token.Pos) {
			for _, b := range banned {
				if strings.Contains(s, b) {
					t.Errorf("%s: references %s", fset.Position(pos), b)
				}
			}
		}
		ast.Inspect(f, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.Ident:
				check(x.Name, x.Pos())
			case *ast.BasicLit:
				check(x.Value, x.Pos())
			}
			return true
		})
		for _, cg := range f.Comments {
			check(cg.Text(), cg.Pos())
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// Promote input is bounded (security checklist: request size and count).
func TestPromote_BoundedInput(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	scanID, _ := seedScan(t, db)
	before := storedRaw(db)
	ids := make([]string, configdoc.MaxDashboardNodes+1)
	for i := range ids {
		ids[i] = "r"
	}
	code, resp := c.do("POST", "/api/discovery/scans/"+scanID+"/promote", map[string]interface{}{
		"target": map[string]interface{}{"dashboardId": "d1", "tabId": "t1"}, "resultIds": ids})
	if code != 400 || !strings.Contains(resp["error"].(string), "at most") {
		t.Fatalf("too many results: %d %v", code, resp)
	}
	code, _ = c.do("POST", "/api/discovery/scans/"+scanID+"/promote", map[string]interface{}{
		"target": map[string]interface{}{"dashboardId": "d1", "tabId": "t1", "newTab": map[string]interface{}{"name": strings.Repeat("x", 2<<20)}},
		"resultIds": []string{"r"}})
	if code != 413 {
		t.Fatalf("oversized body: %d, want 413", code)
	}
	if storedRaw(db) != before {
		t.Fatal("rejected promotes changed the stored doc")
	}
}
