package api

import (
	"database/sql"
	"encoding/json"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// addShowcase stores the Showcase dashboard s1 (a grid tab with a Large tile
// at its root and a folder holding a sub-folder) after the existing ones,
// directly in the stored document.
func addShowcase(t *testing.T, db *sql.DB) {
	t.Helper()
	doc := storedDoc(t, db)
	var s1 configdoc.Obj
	if err := json.Unmarshal([]byte(`{
		"id": "s1", "name": "Showcase", "path": "/showcase", "revision": 3,
		"settings": {"statusChecksEnabled": null, "statusCheckIntervalMinutes": null, "statusCheckTimeoutSeconds": null,
			"editIdleTimeoutMinutes": null, "animatedFolderBackgrounds": null},
		"tabs": [{"id": "s1-t1", "name": "Grid",
			"root": {"columns": 24, "children": [
				{"id": "s1-e1", "kind": "tile", "name": "Big", "url": "http://big", "size": "large", "placement": {"x": 3, "y": 5, "w": 4, "h": 4, "z": 2}},
				{"id": "s1-f1", "kind": "folder", "name": "Outer", "display": "expanded", "shape": "rounded", "showTitle": true,
				 "size": "medium", "contentSize": "medium",
				 "placement": {"x": 10, "y": 0, "w": 8, "h": 6},
				 "content": {"children": [
					{"id": "s1-f2", "kind": "folder", "name": "Inner", "size": "medium", "contentSize": "small",
					 "content": {"children": []}}]}}]}}]}`), &s1); err != nil {
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

func TestDeleteDashboard(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db)
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
	// Works for the Showcase (nested folders) too.
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
	router, db := setupTestRouter(t)
	seed(t, db)
	anon := &apiClient{t: t, h: router}
	if code, _ := anon.do("DELETE", "/api/dashboards/d1?revision=1", nil); code != 401 && code != 403 {
		t.Fatalf("anonymous delete: %d", code)
	}
}

func TestPromote_NewDashboardAvoidsTakenPath(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
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

// Import renames any path clash against every stored dashboard and reports
// the renamed dashboard by label.
func TestImport_TakenPathIsRenamed(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addShowcase(t, db)
	s1 := storedDash(t, db, "s1")
	settings := map[string]interface{}{}
	for _, k := range settingJSONKeys() {
		settings[k] = nil
	}
	s1["settings"] = settings
	code, resp := c.importFile(v3ExportOf(t, map[string]interface{}{"layoutVersion": 1, "dashboards": []interface{}{s1}}))
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
	if code, resp = c.importFile(v3ExportOf(t, map[string]interface{}{"layoutVersion": 1, "dashboards": []interface{}{s1}})); code != 200 {
		t.Fatalf("second import: %d %v", code, resp)
	}
	for _, d := range dashList(storedDoc(t, db)) {
		if d["path"] == "showcase" {
			t.Fatalf("import kept a path that duplicates /showcase: %v", d["id"])
		}
	}
}
