package api

import (
	"database/sql"
	"encoding/json"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

const v3OnlyDetail = "This dashboard uses v3 layout features and is view-only until the new editor arrives"

// addShowcase stores a v3-only dashboard s1 (a free tab with a tile at its
// root) after the existing ones, directly in the stored document.
func addShowcase(t *testing.T, db *sql.DB) {
	t.Helper()
	doc := storedDoc(t, db)
	var s1 configdoc.Obj
	if err := json.Unmarshal([]byte(`{
		"id": "s1", "name": "Showcase", "path": "/showcase", "revision": 3,
		"settings": {"statusChecksEnabled": null}, "defaultLayout": "free",
		"tabs": [{"id": "s1-t1", "name": "Free", "layout": "free", "designWidth": 1280,
			"root": {"columns": 12, "children": [
				{"id": "s1-e1", "kind": "tile", "name": "Big", "url": "http://big", "placement": {"x": 3, "y": 5, "w": 30, "h": 20, "z": 2}},
				{"id": "s1-f1", "kind": "folder", "name": "Outer", "layout": "inherit", "display": "expanded", "shape": "rounded", "showTitle": true,
				 "placement": {"x": 40, "y": 0, "w": 20, "h": 20},
				 "content": {"columns": 2, "children": [
					{"id": "s1-f2", "kind": "folder", "name": "Inner", "placement": {"x": 0, "y": 0, "w": 1, "h": 1},
					 "content": {"columns": 1, "children": []}}]}}]}}]}`), &s1); err != nil {
		t.Fatal(err)
	}
	doc["dashboards"] = append(doc["dashboards"].([]any), s1)
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
}

func storedDashJSON(t *testing.T, db *sql.DB, id string) string {
	t.Helper()
	b, err := json.Marshal(storedDash(t, db, id))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func wantV3Only409(t *testing.T, what string, code int, resp map[string]interface{}) {
	t.Helper()
	if code != 409 || resp["error"] != "v3_only" || resp["dashboardId"] != "s1" || resp["detail"] != v3OnlyDetail {
		t.Fatalf("%s: %d %v, want 409 v3_only for s1", what, code, resp)
	}
}

func TestGetConfig_ServesLayoutAndV3Only(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	addShowcase(t, db)

	v := getView(t, c)
	layout, _ := v["layout"].(map[string]interface{})
	if layout == nil || layout["schemaVersion"] != float64(3) {
		t.Fatalf("layout = %v", v["layout"])
	}
	if n := len(layout["dashboards"].([]interface{})); n != 2 {
		t.Fatalf("layout holds %d dashboards, want 2", n)
	}
	only, _ := v["v3OnlyDashboards"].([]interface{})
	if len(only) != 1 {
		t.Fatalf("v3OnlyDashboards = %v", v["v3OnlyDashboards"])
	}
	o := only[0].(map[string]interface{})
	if o["id"] != "s1" || o["name"] != "Showcase" || o["path"] != "/showcase" || o["reason"] == "" || o["reason"] == nil {
		t.Fatalf("v3OnlyDashboards[0] = %v", o)
	}
	revs := v["dashboardRevisions"].(map[string]interface{})
	if _, has := revs["s1"]; has || revs["d1"] != float64(1) {
		t.Fatalf("dashboardRevisions = %v", revs)
	}
	for _, d := range v["dashboards"].([]interface{}) {
		if d.(map[string]interface{})["id"] == "s1" {
			t.Fatal("v3-only dashboard in the legacy view")
		}
	}

	// No v3-only dashboards: an empty list, not null.
	router2, _ := setupTestRouter(t)
	c2 := newClient(t, router2)
	seed(t, c2)
	if l, ok := getView(t, c2)["v3OnlyDashboards"].([]interface{}); !ok || len(l) != 0 {
		t.Fatalf("v3OnlyDashboards without any = %v", getView(t, c2)["v3OnlyDashboards"])
	}
}

func TestPutConfig_CarriesV3OnlyDashboardsUntouched(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	addShowcase(t, db)
	before := storedDashJSON(t, db, "s1")

	v := getView(t, c)
	v["dashboards"].([]interface{})[0].(map[string]interface{})["name"] = "Edited"
	if _, has := v["layout"]; !has {
		t.Fatal("GET has no layout")
	}
	code, resp := c.do("PUT", "/api/config", v) // layout and v3OnlyDashboards still in it
	if code != 200 {
		t.Fatalf("PUT: %d %v", code, resp)
	}
	if got := storedDashJSON(t, db, "s1"); got != before {
		t.Fatalf("v3-only dashboard changed:\n%s\n%s", before, got)
	}
	if storedDash(t, db, "d1")["name"] != "Edited" {
		t.Fatal("edit to d1 lost")
	}
	doc := storedDoc(t, db)
	for _, k := range []string{"layout", "v3OnlyDashboards", "dashboardRevisions"} {
		if _, has := doc[k]; has {
			t.Fatalf("%s stored in the document", k)
		}
	}
	ids := []string{}
	for _, d := range dashList(doc) {
		ids = append(ids, d["id"].(string))
	}
	if strings.Join(ids, ",") != "d1,s1" {
		t.Fatalf("stored order = %v", ids)
	}
	if r := storedDash(t, db, "s1")["revision"]; r != float64(3) {
		t.Fatalf("s1 revision changed: %v", r)
	}

	// Deleting the editable dashboard through the legacy view leaves s1 alone.
	v = getView(t, c)
	v["dashboards"] = []interface{}{}
	if code, resp := c.do("PUT", "/api/config", v); code != 200 {
		t.Fatalf("delete d1: %d %v", code, resp)
	}
	if got := storedDashJSON(t, db, "s1"); got != before {
		t.Fatalf("v3-only dashboard changed by a legacy delete:\n%s\n%s", before, got)
	}
}

// Ruling 2: a legacy edit + save round trip keeps a dashboard editable.
func TestLegacyEditRoundTripStaysEditable(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	v := getView(t, c)
	d := v["dashboards"].([]interface{})[0].(map[string]interface{})
	e := d["tabs"].([]interface{})[0].(map[string]interface{})["groups"].([]interface{})[0].(map[string]interface{})["entries"].([]interface{})[0].(map[string]interface{})
	e["name"] = "Renamed tile"
	if code, resp := c.do("PUT", "/api/config", v); code != 200 {
		t.Fatalf("PUT: %d %v", code, resp)
	}
	v = getView(t, c)
	if l := v["v3OnlyDashboards"].([]interface{}); len(l) != 0 {
		t.Fatalf("became view-only: %v", l)
	}
	if ok, reason := configdoc.LegacyEditable(storedDash(t, db, "d1")); !ok {
		t.Fatalf("stored d1 not editable: %s", reason)
	}
}

func TestPutConfig_V3OnlyInBody409(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	addShowcase(t, db)
	n := backupCount(t, c)
	before := storedRaw(db)

	v := getView(t, c)
	v["dashboards"] = append(v["dashboards"].([]interface{}), legacyDashWithID("s1", "Hijack"))
	code, resp := c.do("PUT", "/api/config", v)
	wantV3Only409(t, "PUT /api/config", code, resp)
	if storedRaw(db) != before {
		t.Fatal("rejected save changed the stored doc")
	}
	if backupCount(t, c) != n {
		t.Fatal("rejected save took a backup")
	}
}

func TestPutDashboard_V3Only409(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	addShowcase(t, db)
	before := storedRaw(db)
	code, resp := c.do("PUT", "/api/dashboards/s1", map[string]interface{}{
		"dashboard": legacyDashWithID("s1", "Hijack"), "revision": 3})
	wantV3Only409(t, "PUT /api/dashboards/s1", code, resp)
	if storedRaw(db) != before {
		t.Fatal("rejected save changed the stored doc")
	}
}

func TestPromote_IntoV3Only409(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	addShowcase(t, db)
	before := storedRaw(db)
	s1 := storedDashJSON(t, db, "s1")
	scanID, rid := seedScan(t, db)

	body := promoteBody(rid)
	body["target"] = map[string]interface{}{"dashboardId": "s1", "tabId": "s1-t1"}
	code, resp := c.do("POST", "/api/discovery/scans/"+scanID+"/promote", body)
	wantV3Only409(t, "promote into s1", code, resp)
	if storedRaw(db) != before {
		t.Fatal("rejected promote changed the stored doc")
	}

	// Promoting into the editable dashboard carries s1 over untouched.
	code, resp = c.do("POST", "/api/discovery/scans/"+scanID+"/promote", promoteBody(rid))
	if code != 200 {
		t.Fatalf("promote into d1: %d %v", code, resp)
	}
	if got := storedDashJSON(t, db, "s1"); got != s1 {
		t.Fatalf("promote changed the v3-only dashboard:\n%s\n%s", s1, got)
	}
}

func TestDeleteDashboard(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	addD2(t, c)
	addShowcase(t, db)
	n := backupCount(t, c)
	before := storedRaw(db)

	rejects := []struct {
		name, path string
		want       int
	}{
		{"stale", "/api/dashboards/d2?revision=7", 409},
		{"unknown", "/api/dashboards/nope?revision=1", 404},
		{"missing revision", "/api/dashboards/d2", 400},
		{"bad revision", "/api/dashboards/d2?revision=abc", 400},
	}
	for _, rc := range rejects {
		code, resp := c.do("DELETE", rc.path, nil)
		if code != rc.want {
			t.Fatalf("%s: %d %v, want %d", rc.name, code, resp, rc.want)
		}
		if rc.want == 409 && (resp["error"] != "conflict" || resp["dashboardId"] != "d2" || resp["currentRevision"] != float64(1)) {
			t.Fatalf("%s: %v", rc.name, resp)
		}
		if backupCount(t, c) != n {
			t.Fatalf("%s: rejected delete took a backup", rc.name)
		}
	}
	if storedRaw(db) != before {
		t.Fatal("rejected deletes changed the stored doc")
	}

	code, resp := c.do("DELETE", "/api/dashboards/d2?revision=1", nil)
	if code != 200 || resp["status"] != "ok" {
		t.Fatalf("delete d2: %d %v", code, resp)
	}
	if backupCount(t, c) != n+1 {
		t.Fatal("accepted delete took no pre-update backup")
	}
	// Works for a v3-only dashboard too.
	if code, resp := c.do("DELETE", "/api/dashboards/s1?revision=3", nil); code != 200 {
		t.Fatalf("delete s1: %d %v", code, resp)
	}
	ids := []string{}
	for _, d := range dashList(storedDoc(t, db)) {
		ids = append(ids, d["id"].(string))
	}
	if strings.Join(ids, ",") != "d1" {
		t.Fatalf("stored dashboards = %v", ids)
	}
	if code, _ := c.do("DELETE", "/api/dashboards/d2?revision=1", nil); code != 404 {
		t.Fatalf("second delete: %d, want 404", code)
	}
}

func TestDeleteDashboard_MigrationFailed503(t *testing.T) {
	router, _ := setupTestRouterWithMigration(t, &configdoc.MigrationResult{Failed: true, Detail: "boom"})
	c := newClient(t, router)
	code, resp := c.do("DELETE", "/api/dashboards/d1?revision=1", nil)
	if code != 503 || resp["error"] != "migration_failed" {
		t.Fatalf("%d %v", code, resp)
	}
}

func TestDeleteDashboard_RequiresAuth(t *testing.T) {
	router, _ := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	anon := &apiClient{t: t, h: router}
	if code, _ := anon.do("DELETE", "/api/dashboards/d1?revision=1", nil); code != 401 && code != 403 {
		t.Fatalf("anonymous delete: %d", code)
	}
}

func wantPathTaken(t *testing.T, what string, code int, resp map[string]interface{}, id, path string) {
	t.Helper()
	if code != 409 || resp["error"] != "path_taken" || resp["dashboardId"] != id || resp["path"] != path ||
		resp["detail"] != "Path "+path+" is already used by the view-only dashboard Showcase" {
		t.Fatalf("%s: %d %v, want 409 path_taken for %s %s", what, code, resp, id, path)
	}
}

func TestPutConfig_PathOfV3OnlyIs409(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	addShowcase(t, db)
	before := storedRaw(db)
	n := backupCount(t, c)

	// A new dashboard taking the path, with or without the leading slash.
	for _, p := range []string{"/showcase", "showcase"} {
		v := getView(t, c)
		nd := legacyDashWithID("d2", "Second")
		nd["path"] = p
		v["dashboards"] = append(v["dashboards"].([]interface{}), nd)
		code, resp := c.do("PUT", "/api/config", v)
		wantPathTaken(t, "new dashboard "+p, code, resp, "d2", p)
	}
	// An existing dashboard renamed onto it, via both legacy writers.
	v := getView(t, c)
	v["dashboards"].([]interface{})[0].(map[string]interface{})["path"] = "/showcase"
	code, resp := c.do("PUT", "/api/config", v)
	wantPathTaken(t, "renamed d1", code, resp, "d1", "/showcase")
	d1 := legacyDash("First")
	d1["path"] = "/showcase"
	code, resp = c.do("PUT", "/api/dashboards/d1", map[string]interface{}{"dashboard": d1, "revision": 1})
	wantPathTaken(t, "PUT /api/dashboards/d1", code, resp, "d1", "/showcase")

	if storedRaw(db) != before {
		t.Fatal("rejected saves changed the stored doc")
	}
	if backupCount(t, c) != n {
		t.Fatal("rejected saves took a backup")
	}
}

func TestPromote_NewDashboardAvoidsV3OnlyPath(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	addShowcase(t, db)
	scanID, rid := seedScan(t, db)
	body := promoteBody(rid)
	body["target"] = map[string]interface{}{
		"newDashboard": map[string]interface{}{"name": "Showcase", "path": "/showcase"},
		"newTab":       map[string]interface{}{"name": "Found"},
	}
	code, resp := c.do("POST", "/api/discovery/scans/"+scanID+"/promote", body)
	if code != 200 {
		t.Fatalf("promote: %d %v", code, resp)
	}
	if resp["dashboardPath"] != "/showcase-2" {
		t.Fatalf("dashboardPath = %v, want /showcase-2", resp["dashboardPath"])
	}
	paths := map[string]int{}
	for _, d := range dashList(storedDoc(t, db)) {
		paths[d["path"].(string)]++
	}
	if paths["/showcase"] != 1 || paths["/showcase-2"] != 1 {
		t.Fatalf("stored paths = %v", paths)
	}
}

// The server-side import already renames any path clash against every stored
// dashboard (v3-only included) and reports the renamed dashboard by label.
func TestImport_PathOfV3OnlyIsRenamed(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	addShowcase(t, db)
	s1 := storedDash(t, db, "s1")
	settings := map[string]interface{}{}
	for _, k := range settingJSONKeys() {
		settings[k] = nil
	}
	s1["settings"] = settings
	code, resp := c.importFile(v3ExportOf(t, map[string]interface{}{"dashboards": []interface{}{s1}}))
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	if msg, _ := resp["message"].(string); !strings.Contains(msg, "Showcase (Imported)") {
		t.Fatalf("message does not report the rename: %q", msg)
	}
	doc := storedDoc(t, db)
	paths := map[string]int{}
	for _, d := range dashList(doc) {
		paths[d["path"].(string)]++
	}
	if paths["/showcase"] != 1 || paths["/showcase-1"] != 1 {
		t.Fatalf("stored paths = %v", paths)
	}
	assertUniqueIDs(t, doc)

	// The same path without its leading slash routes to the same dashboard,
	// so it is renamed too.
	s1["path"] = "showcase"
	if code, resp = c.importFile(v3ExportOf(t, map[string]interface{}{"dashboards": []interface{}{s1}})); code != 200 {
		t.Fatalf("second import: %d %v", code, resp)
	}
	for _, d := range dashList(storedDoc(t, db)) {
		if d["path"] == "showcase" {
			t.Fatalf("import kept a path that duplicates /showcase: %v", d["id"])
		}
	}
}

// A client whose stale view still listed a now v3-only dashboard, and dropped
// it, is refused rather than having the drop silently ignored.
func TestPutConfig_V3OnlySeenButAbsent409(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	addShowcase(t, db)
	before := storedRaw(db)
	v := getView(t, c)
	v["dashboardRevisions"].(map[string]interface{})["s1"] = 3
	code, resp := c.do("PUT", "/api/config", v)
	wantV3Only409(t, "seen-but-absent s1", code, resp)
	if storedRaw(db) != before {
		t.Fatal("rejected save changed the stored doc")
	}
}

// The UI replaces dashboardRevisions with the PUT response's revisions, so
// they must never name a v3-only dashboard; two saves in a row succeed.
func TestPutConfig_ResponseRevisionsOmitV3Only(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	addShowcase(t, db)
	v := getView(t, c)
	code, resp := c.do("PUT", "/api/config", v)
	if code != 200 {
		t.Fatalf("first save: %d %v", code, resp)
	}
	revs := resp["revisions"].(map[string]interface{})
	if _, has := revs["s1"]; has {
		t.Fatalf("revisions name the v3-only dashboard: %v", revs)
	}
	v["dashboardRevisions"] = revs
	v["dashboards"].([]interface{})[0].(map[string]interface{})["name"] = "Again"
	if code, resp := c.do("PUT", "/api/config", v); code != 200 {
		t.Fatalf("second save: %d %v", code, resp)
	}
}
