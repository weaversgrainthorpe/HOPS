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

func TestPutConfig_DashboardDeletedElsewhereConflicts(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	addD2(t, c)
	stale := getView(t, c) // browser A: holds d1 and d2

	// Browser B deletes d2.
	b := getView(t, c)
	b["dashboards"] = b["dashboards"].([]interface{})[:1]
	if code, r := c.do("PUT", "/api/config", b); code != 200 {
		t.Fatalf("B delete: %d %v", code, r)
	}
	before := storedRaw(db)

	// A renames d1 from its stale view, which still carries d2 (with revision).
	stale["dashboards"].([]interface{})[0].(map[string]interface{})["name"] = "Renamed by A"
	code, resp := c.do("PUT", "/api/config", stale)
	if code != 409 || resp["error"] != "conflict" || resp["dashboardId"] != "d2" || resp["deleted"] != true {
		t.Fatalf("stale resurrect (revision): %d %v", code, resp)
	}
	// Without a revision on the dashboard, but listed in dashboardRevisions.
	delete(stale["dashboards"].([]interface{})[1].(map[string]interface{}), "revision")
	code, resp = c.do("PUT", "/api/config", stale)
	if code != 409 || resp["dashboardId"] != "d2" || resp["deleted"] != true {
		t.Fatalf("stale resurrect (map): %d %v", code, resp)
	}
	if storedRaw(db) != before {
		t.Fatal("rejected save changed the stored doc")
	}

	// A genuinely new dashboard (no revision, not in the map) is still created.
	v := getView(t, c)
	v["dashboards"] = append(v["dashboards"].([]interface{}), legacyDashWithID("d3", "Third"))
	code, resp = c.do("PUT", "/api/config", v)
	if code != 200 || resp["revisions"].(map[string]interface{})["d3"] != float64(1) {
		t.Fatalf("new dashboard: %d %v", code, resp)
	}
}

// --- I2: rejected saves take no pre-update backup ---------------------------

func TestRejectedSavesTakeNoBackup(t *testing.T) {
	router, _ := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	n := backupCount(t, c)

	rejects := []struct {
		name, method, path string
		body               interface{}
		want               int
	}{
		{"stale dashboard", "PUT", "/api/dashboards/d1", map[string]interface{}{"dashboard": legacyDash("X"), "revision": 99}, 409},
		{"unknown dashboard", "PUT", "/api/dashboards/nope", map[string]interface{}{"dashboard": map[string]interface{}{"id": "nope"}, "revision": 1}, 404},
		{"stale config", "PUT", "/api/config", map[string]interface{}{"dashboards": []interface{}{legacyDash("X")}}, 409},
		{"duplicate ids", "PUT", "/api/config", map[string]interface{}{
			"dashboards": []interface{}{legacyDash("A"), legacyDash("B")}, "dashboardRevisions": map[string]interface{}{"d1": 1}}, 400},
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
	if code, resp := c.do("PUT", "/api/dashboards/d1", map[string]interface{}{"dashboard": legacyDash("Y"), "revision": 1}); code != 200 {
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
	seed(t, c)
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
	seed(t, c)
	addD2(t, c)
	before := storedRaw(db)

	// PUT /api/config: d2's tab reuses d1's tab id.
	v := getView(t, c)
	v["dashboards"].([]interface{})[1].(map[string]interface{})["tabs"].([]interface{})[0].(map[string]interface{})["id"] = "t1"
	code, resp := c.do("PUT", "/api/config", v)
	if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "t1") {
		t.Fatalf("config dup: %d %v", code, resp)
	}
	// PUT /api/config: an id-less dashboard.
	v = getView(t, c)
	nd := legacyDashWithID("d3", "NoID")
	delete(nd, "id")
	v["dashboards"] = append(v["dashboards"].([]interface{}), nd)
	if code, resp = c.do("PUT", "/api/config", v); code != 400 {
		t.Fatalf("config id-less: %d %v", code, resp)
	}
	// PUT /api/dashboards/d1: a group reuses d2's group id.
	d := legacyDash("Dup")
	d["tabs"].([]interface{})[0].(map[string]interface{})["groups"].([]interface{})[0].(map[string]interface{})["id"] = "d2-g1"
	code, resp = c.do("PUT", "/api/dashboards/d1", map[string]interface{}{"dashboard": d, "revision": 1})
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
	d2 := storedDashboards(doc)["d2"]
	d2["tabs"].([]interface{})[0].(configdoc.Obj)["id"] = "t1"
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
