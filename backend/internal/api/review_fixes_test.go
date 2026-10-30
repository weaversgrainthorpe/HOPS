package api

import (
	"fmt"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/discovery"
)

// legacyDashWithID is legacyDash for dashboard id, with child ids derived from
// it so several dashboards never share a tab/group/entry id.
func legacyDashWithID(id, name string) map[string]interface{} {
	return map[string]interface{}{
		"id": id, "name": name, "path": "/" + id, "order": 0,
		"tabs": []interface{}{map[string]interface{}{
			"id": id + "-t1", "name": "Tab", "order": 0,
			"groups": []interface{}{map[string]interface{}{
				"id": id + "-g1", "name": "Group", "order": 0,
				"entries": []interface{}{map[string]interface{}{
					"id": id + "-e1", "name": "Example", "url": "https://example.com", "order": 0,
				}},
			}},
		}},
	}
}

func backupCount(t *testing.T, c *apiClient) int {
	t.Helper()
	code, resp := c.do("GET", "/api/backups", nil)
	if code != 200 {
		t.Fatalf("list backups: %d %v", code, resp)
	}
	l, _ := resp["backups"].([]interface{})
	return len(l)
}

// --- I1: a dashboard deleted elsewhere must not silently come back ---------

func TestDashboardDeletedElsewhereIsNotResurrected(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db)
	stale := v3Body(t, c, "d2") // browser A: holds d2 at revision 1

	// Browser B deletes d2.
	if code, r := c.do("DELETE", "/api/dashboards/d2?revision=1", nil); code != 200 {
		t.Fatalf("B delete: %d %v", code, r)
	}
	before := storedRaw(db)

	// A saves its stale copy of d2: refused, never brought back.
	stale["name"] = "Renamed by A"
	code, resp := v3Put(c, "d2", stale, 1)
	if code != 404 {
		t.Fatalf("stale resurrect: %d %v", code, resp)
	}
	if storedRaw(db) != before {
		t.Fatal("rejected save changed the stored doc")
	}
	for _, d := range dashList(storedDoc(t, db)) {
		if d["id"] == "d2" {
			t.Fatal("d2 resurrected")
		}
	}

	// A genuinely new dashboard is still created.
	code, resp = c.do("POST", "/api/dashboards", map[string]interface{}{"name": "Third", "path": "/d3"})
	if code != 200 || resp["revision"] != float64(1) {
		t.Fatalf("new dashboard: %d %v", code, resp)
	}
}

// --- I2: rejected saves take no pre-update backup ---------------------------

func TestRejectedSavesTakeNoBackup(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	n := backupCount(t, c)

	rejects := []struct {
		name, method, path string
		body               interface{}
		want               int
	}{
		{"stale dashboard", "PUT", "/api/dashboards/d1", map[string]interface{}{"schema": 3, "dashboard": v3Body(t, c, "d1"), "revision": 99, "layoutVersion": configdoc.LayoutVersion}, 409},
		{"unknown dashboard", "PUT", "/api/dashboards/nope", map[string]interface{}{"schema": 3, "dashboard": map[string]interface{}{"id": "nope"}, "revision": 1, "layoutVersion": configdoc.LayoutVersion}, 404},
		{"legacy shape", "PUT", "/api/dashboards/d1", map[string]interface{}{"dashboard": legacyDash("X"), "revision": 1}, 400},
		{"path taken", "POST", "/api/dashboards", map[string]interface{}{"name": "Dup", "path": "/d1"}, 409},
		{"bad order", "PUT", "/api/dashboards/order", map[string]interface{}{"order": []string{"nope"}}, 400},
		{"stale delete", "DELETE", "/api/dashboards/d1?revision=99", nil, 409},
	}
	for _, rc := range rejects {
		if code, resp := c.do(rc.method, rc.path, rc.body); code != rc.want {
			t.Fatalf("%s: got %d %v, want %d", rc.name, code, resp, rc.want)
		}
		if got := backupCount(t, c); got != n {
			t.Fatalf("%s: rejected save took a backup (%d -> %d)", rc.name, n, got)
		}
	}

	// An accepted save still takes its backup before writing.
	if code, resp := v3Put(c, "d1", v3Body(t, c, "d1"), 1); code != 200 {
		t.Fatalf("accepted save: %d %v", code, resp)
	}
	if got := backupCount(t, c); got != n+1 {
		t.Fatalf("accepted save: backups %d -> %d, want +1", n, got)
	}
}

// --- I3: status reports the tile's resolved check interval ------------------

func TestGetStatus_ReportsResolvedInterval(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	setTileCheck(t, db, "e1", true)
	if _, err := db.Exec(`INSERT INTO status_cache (entry_id, status) VALUES ('e1','up')`); err != nil {
		t.Fatal(err)
	}
	code, resp := c.do("GET", "/api/status/e1", nil)
	if code != 200 || resp["intervalMinutes"] != float64(5) {
		t.Fatalf("global interval: %d %v", code, resp)
	}
	if code, resp = c.do("PUT", "/api/dashboards/d1/settings", map[string]interface{}{
		"overrides": map[string]interface{}{"statusCheckIntervalMinutes": 60}, "revision": 1}); code != 200 {
		t.Fatalf("%d %v", code, resp)
	}
	code, resp = c.do("GET", "/api/status/e1", nil)
	if code != 200 || resp["intervalMinutes"] != float64(60) {
		t.Fatalf("per-dashboard interval: %d %v", code, resp)
	}
}

// --- I5: every stored-doc writer refuses a document with bad ids ------------

func TestWriters_RefuseDuplicateOrMissingIDs(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db)
	before := storedRaw(db)

	// PUT /api/dashboards/d2: d2's tab reuses d1's tab id.
	d2 := v3Body(t, c, "d2")
	d2["tabs"].([]interface{})[0].(map[string]interface{})["id"] = "t1"
	code, resp := v3Put(c, "d2", d2, 1)
	if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "t1") {
		t.Fatalf("tab dup: %d %v", code, resp)
	}
	// PUT /api/dashboards/d1: an id-less tile.
	d := v3Body(t, c, "d1")
	rootOf(d)["children"] = append(rootOf(d)["children"].([]interface{}), map[string]interface{}{
		"kind": "tile", "name": "NoID", "url": "http://x", "placement": map[string]interface{}{"x": 0, "y": 9, "w": 1, "h": 1}})
	if code, resp = v3Put(c, "d1", d, 1); code != 400 {
		t.Fatalf("id-less tile: %d %v", code, resp)
	}
	// PUT /api/dashboards/d1: a folder reuses d2's folder id.
	d = v3Body(t, c, "d1")
	rootOf(d)["children"].([]interface{})[0].(map[string]interface{})["id"] = "d2-g1"
	code, resp = v3Put(c, "d1", d, 1)
	if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "d2-g1") {
		t.Fatalf("dashboard dup: %d %v", code, resp)
	}
	if storedRaw(db) != before {
		t.Fatal("a rejected write changed the stored doc")
	}

	// A stored doc that already holds a duplicate: the settings PUT and
	// promote refuse to write it back.
	doc, err := configdoc.Load(db)
	if err != nil {
		t.Fatal(err)
	}
	sd2 := storedDashboards(doc)["d2"]
	sd2["tabs"].([]interface{})[0].(configdoc.Obj)["id"] = "t1"
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
	before = storedRaw(db)
	code, resp = c.do("PUT", "/api/dashboards/d1/settings", map[string]interface{}{
		"overrides": map[string]interface{}{"statusCheckIntervalMinutes": 9}, "revision": 1})
	if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "t1") {
		t.Fatalf("settings over dup doc: %d %v", code, resp)
	}
	scanID, rid := seedScan(t, db)
	code, resp = c.do("POST", "/api/discovery/scans/"+scanID+"/promote", promoteBody(rid))
	if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "t1") {
		t.Fatalf("promote over dup doc: %d %v", code, resp)
	}
	if storedRaw(db) != before {
		t.Fatal("a rejected write changed the stored doc")
	}
	res, err := discovery.NewStore(db).GetResult(scanID, rid)
	if err != nil || res.CurateState == discovery.CuratePromoted {
		t.Fatalf("result marked promoted despite refusal: %v %v", res, err)
	}
}
