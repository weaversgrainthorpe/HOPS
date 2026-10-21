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
	seed(t, db)
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
// before the check existed) still serves GET /api/config: every dashboard is
// served as stored, the unplaced tile included (the renderer shows it as a
// visible placeholder, never silently drops it).
func TestGetConfig_UnplacedNodeIsServedNot500(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
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
	if len(dashes) != 2 || dashes[0].(map[string]interface{})["id"] != "d1" || dashes[1].(map[string]interface{})["id"] != "pz" {
		t.Fatalf("dashboards = %v, want d1 and pz", dashes)
	}
	b, _ := json.Marshal(dashes[1])
	if !strings.Contains(string(b), `"pz-a"`) {
		t.Fatalf("pz served without its unplaced tile: %s", b)
	}
	// Saving it as-is is refused visibly, naming the node.
	code, resp := c.do("PUT", "/api/dashboards/pz", map[string]interface{}{"schema": 3, "dashboard": dashes[1], "revision": 1, "gridUnit": 2})
	if msg := fmt.Sprint(resp["error"]); code != 400 || !strings.Contains(msg, "pz-a") || !strings.Contains(msg, "placement") {
		t.Fatalf("save of unplaced tile: %d %v", code, resp)
	}
}
