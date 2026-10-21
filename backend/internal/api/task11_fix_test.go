package api

import (
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/discovery"
)

// makeFree turns dashboard id's first tab into a free tab (design width 1280)
// holding exactly children.
func makeFree(t *testing.T, c *apiClient, id string, rev int, children []interface{}) {
	t.Helper()
	d := v3Body(t, c, id)
	tab := d["tabs"].([]interface{})[0].(map[string]interface{})
	tab["layout"], tab["designWidth"] = "free", 1280
	tab["root"] = map[string]interface{}{"columns": 12, "children": children}
	if code, r := v3Put(c, id, d, rev); code != 200 {
		t.Fatalf("make %s free: %d %v", id, code, r)
	}
}

// Ruling 26a: a transfer into a free tab root uses the tab's design width
// (1280 / 8 = 160 units), not the root's nominal 12 columns.
func TestTransfer_FreeRootUsesDesignWidth(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db)
	makeFree(t, c, "d1", 1, []interface{}{map[string]interface{}{"id": "big", "kind": "tile", "name": "Big", "url": "http://b",
		"placement": map[string]interface{}{"x": 0, "y": 0, "w": 16, "h": 16}}})
	makeFree(t, c, "d2", 1, []interface{}{map[string]interface{}{"id": "blocker", "kind": "tile", "name": "B", "url": "http://b",
		"placement": map[string]interface{}{"x": 0, "y": 0, "w": 12, "h": 12}}})
	code, resp := c.do("POST", "/api/dashboards/transfer", transferBody(map[string]interface{}{
		"mode": "move", "sourceRevision": 2, "targetRevision": 2, "nodeIds": []string{"big"},
		"target": map[string]interface{}{"tabId": "d2-t1"}}))
	if code != 200 {
		t.Fatalf("transfer: %d %v", code, resp)
	}
	p := findNode(storedDashboards(storedDoc(t, db))["d2"], "big")[0]["placement"].(configdoc.Obj)
	if p["w"] != float64(16) || p["h"] != float64(16) || p["x"] != float64(16) || p["y"] != float64(0) {
		t.Fatalf("placement %v, want 16x16 at x=16 (beside the blocker, beyond 12 units)", p)
	}
}


func insertResults(t *testing.T, st *discovery.Store, scanID string, ids ...string) {
	t.Helper()
	for i, id := range ids {
		if err := st.InsertResult(&discovery.Result{
			ID: id, ScanID: scanID, Host: "10.0.1." + string(rune('1'+i)), Port: 80, DetectorID: "x",
			Confidence: "high", Category: discovery.CategoryOther, SuggestedName: "More " + id,
			SuggestedURL: "http://10.0.1.1", CurateState: discovery.CuratePending,
		}); err != nil {
			t.Fatal(err)
		}
	}
}

// Promote into a free tab: the grid-in-free category folder is sized with the
// same rule it was created with (grid rows x side + an 8-unit title, as
// mergeIntoNewFolder), grows on a repeat promote, and never warns. Finer grid
// (spec §9, Ruling 2): side = round(1280/12/8)/2 = 6.5; the folder is 8 cells
// wide (4 Medium tiles) and each tile row is 2 cells — the same units as
// before the finer grid.
func TestPromote_FreeTabRepeatSizesWithoutWarning(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addShowcase(t, db)
	scanID, rid := seedScan(t, db)
	st := discovery.NewStore(db)
	insertResults(t, st, scanID, "result-0010", "result-0011", "result-0012", "result-0013")
	promote := func(ids ...string) map[string]interface{} {
		code, resp := c.do("POST", "/api/discovery/scans/"+scanID+"/promote", map[string]interface{}{
			"target": map[string]interface{}{"dashboardId": "s1", "tabId": "s1-t1"}, "resultIds": ids})
		if code != 200 {
			t.Fatalf("promote: %d %v", code, resp)
		}
		if w, has := resp["warning"]; has {
			t.Fatalf("unexpected warning: %v", w)
		}
		return resp
	}
	promote(rid)
	var folder configdoc.Obj
	for _, k := range rootOf(map[string]interface{}{"tabs": storedDash(t, db, "s1")["tabs"]})["children"].([]interface{}) {
		if m := k.(configdoc.Obj); m["name"] == "Other" {
			folder = m
		}
	}
	if _, _, w, h, _ := rect(folder["placement"]); w != 52 || h != 13+8 {
		t.Fatalf("new folder %v, want w=52 (8 cells of 6.5) h=21 (one 2-cell tile row + 8-unit title)", folder["placement"])
	}
	promote("result-0010", "result-0011", "result-0012", "result-0013")
	f := findOne(storedDash(t, db, "s1"), folder["id"].(string))
	if len(contentKids(f)) != 5 {
		t.Fatalf("folder not reused: %v", contentKids(f))
	}
	if _, _, _, h, _ := rect(f["placement"]); h != 2*13+8 {
		t.Fatalf("folder h = %v, want 34 (two 2-cell tile rows + title)", h)
	}
}

// A free-content folder in a grid tab genuinely can't be sized server-side
// (grid row height depends on the viewport): that still warns, visibly.
func TestPromote_UnsizeableFolderWarns(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	d := v3Body(t, c, "d1")
	g1 := rootOf(d)["children"].([]interface{})[0].(map[string]interface{})
	g1["layout"] = "free"
	g1["content"].(map[string]interface{})["columns"] = 96
	g1["content"].(map[string]interface{})["children"] = []interface{}{}
	if code, r := v3Put(c, "d1", d, 1); code != 200 {
		t.Fatalf("%d %v", code, r)
	}
	scanID, rid := seedScan(t, db)
	code, resp := c.do("POST", "/api/discovery/scans/"+scanID+"/promote", map[string]interface{}{
		"target": map[string]interface{}{"dashboardId": "d1", "tabId": "t1", "folderId": "g1"}, "resultIds": []string{rid}})
	if code != 200 || !strings.Contains(resp["warning"].(string), `Folder "Group" may need resizing`) {
		t.Fatalf("%d %v", code, resp)
	}
}

// New dashboard / tab names are bounded like POST /api/dashboards.
func TestPromote_NameLengthBounded(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	scanID, rid := seedScan(t, db)
	before := storedRaw(db)
	long := strings.Repeat("é", maxDashboardNameRunes+1)
	for _, target := range []map[string]interface{}{
		{"newDashboard": map[string]interface{}{"name": long}, "newTab": map[string]interface{}{"name": "T"}},
		{"dashboardId": "d1", "newTab": map[string]interface{}{"name": long}},
	} {
		code, resp := c.do("POST", "/api/discovery/scans/"+scanID+"/promote", map[string]interface{}{"target": target, "resultIds": []string{rid}})
		if code != 400 || !strings.Contains(resp["error"].(string), "longer than") {
			t.Errorf("%v: %d %v", target, code, resp)
		}
	}
	if storedRaw(db) != before {
		t.Fatal("rejected promotes changed the stored doc")
	}
}
