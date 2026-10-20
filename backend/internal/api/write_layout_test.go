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
	b2, _ := json.Marshal(view)
	var a, b interface{}
	_ = json.Unmarshal(b1, &a)
	_ = json.Unmarshal(b2, &b)
	if resp["layout"] == nil || !reflect.DeepEqual(a, b) {
		t.Fatalf("%s: response layout differs from stored layout\nresp: %s\nstored: %s", what, b1, b2)
	}
}

func TestWriteResponsesCarryFreshLayout(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)

	seed(t, db)

	// POST /api/dashboards
	code, resp := c.do("POST", "/api/dashboards", map[string]interface{}{"name": "Created", "path": "/created"})
	if code != 200 {
		t.Fatalf("create: %d %v", code, resp)
	}
	sameAsStored(t, "POST /api/dashboards", resp, c)
	created := resp["id"].(string)

	// PUT /api/dashboards/order
	code, resp = c.do("PUT", "/api/dashboards/order", map[string]interface{}{"order": []string{created, "d1"}})
	if code != 200 {
		t.Fatalf("order: %d %v", code, resp)
	}
	sameAsStored(t, "PUT /api/dashboards/order", resp, c)

	// PUT /api/dashboards/{id}
	d := v3Body(t, c, "d1")
	d["name"] = "Renamed"
	code, resp = v3Put(c, "d1", d, 1)
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
