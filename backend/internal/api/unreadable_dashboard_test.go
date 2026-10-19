package api

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// unplacedDash is a group-style v3 dashboard (folder at the tab root, so no
// explicit v3 feature) whose only tile has no placement: the reviewer's I3
// probe.
const unplacedDash = `{"id": "pz", "name": "Probe", "path": "/pz", "revision": 1,
	"settings": {"statusChecksEnabled": null, "statusCheckIntervalMinutes": null, "statusCheckTimeoutSeconds": null,
	             "editIdleTimeoutMinutes": null, "animatedFolderBackgrounds": null, "defaultLayout": null},
	"defaultLayout": "grid",
	"tabs": [{"id": "pz-t", "name": "T", "root": {"columns": 12, "children": [
		{"id": "pz-f", "kind": "folder", "name": "F", "placement": {"x": 0, "y": 0, "w": 4, "h": 2},
		 "content": {"columns": 4, "children": [{"id": "pz-a", "kind": "tile", "name": "A", "url": "http://a"}]}}]}}]}`

// Ruling 24: importing it is a 400 naming the node, and nothing is written.
func TestImport_V3NodeWithoutPlacementIs400(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	var d map[string]interface{}
	if err := json.Unmarshal([]byte(unplacedDash), &d); err != nil {
		t.Fatal(err)
	}
	var before string
	db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&before)
	code, resp := c.importFile(v3ExportOf(t, map[string]interface{}{"dashboards": []interface{}{d}}))
	msg := fmt.Sprint(resp["error"])
	if code != 400 || !strings.Contains(msg, "pz-a") || !strings.Contains(msg, "placement") {
		t.Fatalf("got %d %v, want 400 naming pz-a's placement", code, resp)
	}
	var after string
	db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&after)
	if before != after {
		t.Error("config row changed")
	}
	if code, v := c.do("GET", "/api/config", nil); code != 200 {
		t.Fatalf("GET /api/config after refused import: %d %v", code, v)
	}
}

// Ruling 24: a stored document already holding such a dashboard (written
// before the check existed) still serves GET /api/config: the dashboard is
// listed as view-only with the reason, and every other dashboard is served.
func TestGetConfig_UnreadableDashboardIsV3OnlyNot500(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	doc := storedDoc(t, db)
	var d configdoc.Obj
	if err := json.Unmarshal([]byte(unplacedDash), &d); err != nil {
		t.Fatal(err)
	}
	doc["dashboards"] = append(doc["dashboards"].([]any), d)
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}

	code, v := c.do("GET", "/api/config", nil)
	if code != 200 {
		t.Fatalf("GET /api/config = %d %v, want 200", code, v)
	}
	dashes, _ := v["dashboards"].([]interface{})
	if len(dashes) != 1 || dashes[0].(map[string]interface{})["id"] != "d1" {
		t.Fatalf("legacy dashboards = %v, want only d1", dashes)
	}
	only, _ := v["v3OnlyDashboards"].([]interface{})
	if len(only) != 1 {
		t.Fatalf("v3OnlyDashboards = %v", v["v3OnlyDashboards"])
	}
	o := only[0].(map[string]interface{})
	reason := fmt.Sprint(o["reason"])
	if o["id"] != "pz" || !strings.Contains(reason, "cannot be read") || !strings.Contains(reason, "pz-a") {
		t.Fatalf("v3OnlyDashboards[0] = %v, want pz with an unreadable reason naming pz-a", o)
	}
	layout, _ := v["layout"].(map[string]interface{})
	if n := len(layout["dashboards"].([]interface{})); n != 2 {
		t.Fatalf("layout holds %d dashboards, want 2", n)
	}
}
