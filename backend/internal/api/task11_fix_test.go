package api

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/discovery"
)

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

// M5: a promote creates one Medium folder per category on the tab, at the
// first free cells, holding its tiles in result order with no placements; a
// repeat promote appends to the same folder (it pages, so it never grows or
// warns) and nothing else on the tab moves.
func TestPromote_RepeatAppendsToCategoryFolder(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	scanID, rid := seedScan(t, db)
	st := discovery.NewStore(db)
	insertResults(t, st, scanID, "result-0010", "result-0011", "result-0012", "result-0013")
	promote := func(ids ...string) {
		code, resp := c.do("POST", "/api/discovery/scans/"+scanID+"/promote", map[string]interface{}{
			"target": map[string]interface{}{"dashboardId": "d1", "tabId": "t1"}, "resultIds": ids})
		if code != 200 {
			t.Fatalf("promote: %d %v", code, resp)
		}
		if w, has := resp["warning"]; has {
			t.Fatalf("unexpected warning: %v", w)
		}
	}
	g1Before := findOne(storedDash(t, db, "d1"), "g1")["placement"]
	promote(rid)
	d := storedDash(t, db, "d1")
	assertM5Dashboard(t, d)
	var folder configdoc.Obj
	for _, k := range d["tabs"].([]any)[0].(configdoc.Obj)["root"].(configdoc.Obj)["children"].([]any) {
		if m := k.(configdoc.Obj); m["name"] == "Other" {
			folder = m
		}
	}
	if folder == nil {
		t.Fatal("no Other folder")
	}
	if folder["size"] != "medium" || folder["contentSize"] != "medium" {
		t.Errorf("folder size/contentSize = %v/%v, want medium/medium", folder["size"], folder["contentSize"])
	}
	if _, _, w, h, _ := rect(folder["placement"]); w != 9 || h != 4 {
		t.Errorf("new folder placement %v, want 9×4 (four Medium tiles and the padding wide; one row + bar, tab allowance and padding at the reference cell, M6 §13)", folder["placement"])
	}
	promote("result-0010", "result-0011", "result-0012", "result-0013")
	d = storedDash(t, db, "d1")
	assertM5Dashboard(t, d)
	f := findOne(d, folder["id"].(string))
	var names []string
	for _, k := range contentKids(f) {
		names = append(names, k.(configdoc.Obj)["name"].(string))
	}
	if strings.Join(names, ",") != "Thing,More result-0010,More result-0011,More result-0012,More result-0013" {
		t.Errorf("folder children = %v, want the first promote then the repeat, in order", names)
	}
	if jsonStr(f["placement"]) != jsonStr(folder["placement"]) {
		t.Errorf("folder box changed on a repeat promote: %v → %v", folder["placement"], f["placement"])
	}
	if jsonStr(findOne(d, "g1")["placement"]) != jsonStr(g1Before) {
		t.Error("a neighbour moved")
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

func jsonStr(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
