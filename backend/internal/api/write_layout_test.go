package api

import (
	"encoding/json"
	"reflect"
	"testing"
)

func sameAsStored(t *testing.T, what string, resp map[string]interface{}, c *apiClient) {
	t.Helper()
	view := getView(t, c)
	b1, _ := json.Marshal(resp["layout"])
	b2, _ := json.Marshal(view["layout"])
	var a, b interface{}
	_ = json.Unmarshal(b1, &a)
	_ = json.Unmarshal(b2, &b)
	if resp["layout"] == nil || !reflect.DeepEqual(a, b) {
		t.Fatalf("%s: response layout differs from stored layout\nresp: %s\nstored: %s", what, b1, b2)
	}
	if _, ok := resp["v3OnlyDashboards"].([]interface{}); !ok {
		t.Fatalf("%s: v3OnlyDashboards missing/null: %v", what, resp["v3OnlyDashboards"])
	}
}

func TestWriteResponsesCarryFreshLayout(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)

	// PUT /api/config (seed performs one).
	view := getView(t, c)
	code, resp := c.do("PUT", "/api/config", map[string]interface{}{
		"dashboards": []interface{}{legacyDash("First")}, "dashboardRevisions": view["dashboardRevisions"]})
	if code != 200 {
		t.Fatalf("put config: %d %v", code, resp)
	}
	sameAsStored(t, "PUT /api/config", resp, c)
	if resp["revisions"] == nil {
		t.Fatal("PUT /api/config lost revisions")
	}

	// PUT /api/dashboards/{id}
	code, resp = c.do("PUT", "/api/dashboards/d1", map[string]interface{}{"dashboard": legacyDash("Renamed"), "revision": 1})
	if code != 200 || resp["revision"] != float64(2) {
		t.Fatalf("put dashboard: %d %v", code, resp)
	}
	sameAsStored(t, "PUT /api/dashboards/{id}", resp, c)
	if layoutDashName(resp, "d1") != "Renamed" {
		t.Fatalf("response layout is stale: %v", layoutDashName(resp, "d1"))
	}

	// PUT settings
	code, resp = c.do("PUT", "/api/dashboards/d1/settings", map[string]interface{}{
		"overrides": map[string]interface{}{"statusChecksEnabled": false}, "revision": 2})
	if code != 200 || resp["revision"] != float64(3) {
		t.Fatalf("settings: %d %v", code, resp)
	}
	sameAsStored(t, "PUT settings", resp, c)

	// Import
	code, resp = c.importFile(c.export(""))
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	sameAsStored(t, "import", resp, c)

	// Promote
	scanID, rid := seedScan(t, db)
	code, resp = c.do("POST", "/api/discovery/scans/"+scanID+"/promote", promoteBody(rid))
	if code != 200 {
		t.Fatalf("promote: %d %v", code, resp)
	}
	sameAsStored(t, "promote", resp, c)

	// DELETE
	code, resp = c.do("DELETE", "/api/dashboards/d1?revision=4", nil)
	if code != 200 {
		t.Fatalf("delete: %d %v", code, resp)
	}
	sameAsStored(t, "DELETE", resp, c)
	if layoutDashName(resp, "d1") != "" {
		t.Fatal("deleted dashboard still in response layout")
	}
}

func layoutDashName(resp map[string]interface{}, id string) string {
	lay, _ := resp["layout"].(map[string]interface{})
	ds, _ := lay["dashboards"].([]interface{})
	for _, d := range ds {
		m := d.(map[string]interface{})
		if m["id"] == id {
			n, _ := m["name"].(string)
			return n
		}
	}
	return ""
}
