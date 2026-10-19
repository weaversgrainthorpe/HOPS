package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

type apiClient struct {
	t           *testing.T
	h           http.Handler
	token, csrf string
}

func newClient(t *testing.T, h http.Handler) *apiClient {
	tok, csrf := loginTestUserWithCSRF(t, h)
	return &apiClient{t, h, tok, csrf}
}

func (c *apiClient) do(method, path string, body interface{}) (int, map[string]interface{}) {
	c.t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req := authedRequest(method, path, rdr, c.token, c.csrf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	c.h.ServeHTTP(w, req)
	var out map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

func legacyDash(name string) map[string]interface{} {
	return map[string]interface{}{
		"id": "d1", "name": name, "path": "/d1", "order": 0,
		"tabs": []interface{}{map[string]interface{}{
			"id": "t1", "name": "Tab", "order": 0,
			"groups": []interface{}{map[string]interface{}{
				"id": "g1", "name": "Group", "order": 0,
				"entries": []interface{}{map[string]interface{}{
					"id": "e1", "name": "Example", "url": "https://example.com", "order": 0,
				}},
			}},
		}},
	}
}

// seed creates dashboard d1 (revision 1) through the legacy PUT.
func seed(t *testing.T, c *apiClient) {
	t.Helper()
	code, resp := c.do("PUT", "/api/config", map[string]interface{}{"dashboards": []interface{}{legacyDash("First")}})
	if code != 200 {
		t.Fatalf("seed: %d %v", code, resp)
	}
	if resp["revisions"].(map[string]interface{})["d1"] != float64(1) {
		t.Fatalf("seed revisions: %v", resp)
	}
}

func getView(t *testing.T, c *apiClient) map[string]interface{} {
	t.Helper()
	code, v := c.do("GET", "/api/config", nil)
	if code != 200 {
		t.Fatalf("GET config: %d %v", code, v)
	}
	return v
}

func TestGetConfig_ReturnsLegacyView(t *testing.T) {
	router, _ := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	v := getView(t, c)
	d := v["dashboards"].([]interface{})[0].(map[string]interface{})
	if d["revision"] != float64(1) {
		t.Fatalf("revision missing: %v", d)
	}
	g := d["tabs"].([]interface{})[0].(map[string]interface{})["groups"].([]interface{})
	if len(g) != 1 || len(g[0].(map[string]interface{})["entries"].([]interface{})) != 1 {
		t.Fatalf("groups/entries missing: %v", d)
	}
	if _, has := v["schemaVersion"]; has {
		t.Fatal("schemaVersion leaked into legacy view")
	}
}

func TestGetConfig_MigrationFailed503(t *testing.T) {
	router, _ := setupTestRouterWithMigration(t, &configdoc.MigrationResult{Failed: true, Detail: "boom"})
	c := newClient(t, router)
	for _, tc := range []struct{ m, p string }{
		{"GET", "/api/config"}, {"PUT", "/api/config"},
		{"GET", "/api/dashboards/d1/settings"}, {"PUT", "/api/dashboards/d1/settings"}, {"PUT", "/api/dashboards/d1"},
	} {
		code, resp := c.do(tc.m, tc.p, map[string]interface{}{"dashboards": []interface{}{}})
		if code != 503 || resp["error"] != "migration_failed" || resp["detail"] != "boom" ||
			resp["backupHint"] != "Admin → Backups holds the automatic startup backup" {
			t.Fatalf("%s %s: %d %v", tc.m, tc.p, code, resp)
		}
	}
}

func TestPutConfig_MigrationFailedLeavesRowUntouched(t *testing.T) {
	router, db := setupTestRouterWithMigration(t, &configdoc.MigrationResult{Failed: true, Detail: "boom"})
	var before string
	db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&before)
	c := newClient(t, router)
	code, _ := c.do("PUT", "/api/config", map[string]interface{}{"dashboards": []interface{}{legacyDash("X")}})
	if code != 503 {
		t.Fatalf("want 503, got %d", code)
	}
	var after string
	db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&after)
	if before != after {
		t.Fatalf("stored row changed:\n%s\n%s", before, after)
	}
}

func TestPutDashboard_BumpsRevision(t *testing.T) {
	router, _ := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	code, resp := c.do("PUT", "/api/dashboards/d1", map[string]interface{}{"dashboard": legacyDash("Renamed"), "revision": 1})
	if code != 200 || resp["revision"] != float64(2) {
		t.Fatalf("%d %v", code, resp)
	}
	d := getView(t, c)["dashboards"].([]interface{})[0].(map[string]interface{})
	if d["name"] != "Renamed" || d["revision"] != float64(2) {
		t.Fatalf("not saved: %v", d)
	}
	code, resp = c.do("PUT", "/api/dashboards/nope", map[string]interface{}{"dashboard": map[string]interface{}{"id": "nope"}, "revision": 1})
	if code != 404 {
		t.Fatalf("unknown dashboard: %d %v", code, resp)
	}
}

func TestPutDashboard_StaleRevisionConflicts(t *testing.T) {
	router, _ := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	if code, r := c.do("PUT", "/api/dashboards/d1", map[string]interface{}{"dashboard": legacyDash("First save"), "revision": 1}); code != 200 {
		t.Fatalf("%d %v", code, r)
	}
	code, resp := c.do("PUT", "/api/dashboards/d1", map[string]interface{}{"dashboard": legacyDash("Second save"), "revision": 1})
	if code != 409 || resp["error"] != "conflict" || resp["dashboardId"] != "d1" || resp["currentRevision"] != float64(2) {
		t.Fatalf("%d %v", code, resp)
	}
	d := getView(t, c)["dashboards"].([]interface{})[0].(map[string]interface{})
	if d["name"] != "First save" || d["revision"] != float64(2) {
		t.Fatalf("stored doc changed by conflicting save: %v", d)
	}
}

func TestPutConfig_StaleOrMissingRevisionConflicts(t *testing.T) {
	router, _ := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	c.do("PUT", "/api/dashboards/d1", map[string]interface{}{"dashboard": legacyDash("Bumped"), "revision": 1})

	stale := legacyDash("Stale")
	stale["revision"] = 1
	code, resp := c.do("PUT", "/api/config", map[string]interface{}{"dashboards": []interface{}{stale}})
	if code != 409 || resp["currentRevision"] != float64(2) {
		t.Fatalf("stale: %d %v", code, resp)
	}
	for _, rev := range []interface{}{nil, "2"} { // Ruling 12: absent / non-numeric
		d := legacyDash("NoRev")
		if rev != nil {
			d["revision"] = rev
		}
		code, resp = c.do("PUT", "/api/config", map[string]interface{}{"dashboards": []interface{}{d}})
		if code != 409 {
			t.Fatalf("revision %v: want 409, got %d %v", rev, code, resp)
		}
	}
	if n := getView(t, c)["dashboards"].([]interface{})[0].(map[string]interface{})["name"]; n != "Bumped" {
		t.Fatalf("stored changed: %v", n)
	}
}

func TestPutConfig_RevisionBumpOnlyWhenChanged(t *testing.T) {
	router, _ := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	same := getView(t, c)
	code, resp := c.do("PUT", "/api/config", same)
	if code != 200 || resp["revisions"].(map[string]interface{})["d1"] != float64(1) {
		t.Fatalf("unchanged resave must keep revision: %d %v", code, resp)
	}
	v := getView(t, c)
	v["dashboards"].([]interface{})[0].(map[string]interface{})["name"] = "Changed"
	code, resp = c.do("PUT", "/api/config", v)
	if code != 200 || resp["revisions"].(map[string]interface{})["d1"] != float64(2) {
		t.Fatalf("changed resave must bump: %d %v", code, resp)
	}
	// A brand-new dashboard gets revision 1.
	v = getView(t, c)
	nd := legacyDash("New")
	nd["id"], nd["path"] = "d2", "/d2"
	v["dashboards"] = append(v["dashboards"].([]interface{}), nd)
	code, resp = c.do("PUT", "/api/config", v)
	if code != 200 || resp["revisions"].(map[string]interface{})["d2"] != float64(1) {
		t.Fatalf("new dashboard: %d %v", code, resp)
	}
}

func TestPutConfig_KeepsDashboardSettings(t *testing.T) {
	router, _ := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	code, resp := c.do("PUT", "/api/dashboards/d1/settings", map[string]interface{}{
		"overrides": map[string]interface{}{"statusCheckIntervalMinutes": 7}, "revision": 1})
	if code != 200 || resp["revision"] != float64(2) {
		t.Fatalf("%d %v", code, resp)
	}
	v := getView(t, c)
	d := v["dashboards"].([]interface{})[0].(map[string]interface{})
	delete(d, "settings") // legacy client that doesn't know about settings
	if code, resp := c.do("PUT", "/api/config", v); code != 200 {
		t.Fatalf("%d %v", code, resp)
	}
	code, resp = c.do("GET", "/api/dashboards/d1/settings", nil)
	if code != 200 || resp["overrides"].(map[string]interface{})["statusCheckIntervalMinutes"] != float64(7) {
		t.Fatalf("overrides lost: %d %v", code, resp)
	}
}

func TestDashboardSettings_RoundTripAndValidation(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)

	code, resp := c.do("GET", "/api/dashboards/d1/settings", nil)
	ov := resp["overrides"].(map[string]interface{})
	eff := resp["effective"].(map[string]interface{})
	if code != 200 || len(ov) != 6 || len(eff) != 6 || resp["revision"] != float64(1) {
		t.Fatalf("%d %v", code, resp)
	}
	if _, ok := eff["statusCheckIntervalMinutes"].(float64); !ok {
		t.Fatalf("effective not camelCase numbers: %v", eff)
	}

	code, resp = c.do("PUT", "/api/dashboards/d1/settings", map[string]interface{}{
		"overrides": map[string]interface{}{"statusCheckIntervalMinutes": 9}, "revision": 1})
	if code != 200 || resp["revision"] != float64(2) {
		t.Fatalf("valid save: %d %v", code, resp)
	}
	_, resp = c.do("GET", "/api/dashboards/d1/settings", nil)
	if resp["effective"].(map[string]interface{})["statusCheckIntervalMinutes"] != float64(9) {
		t.Fatalf("effective: %v", resp)
	}

	var before string
	db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&before)
	code, resp = c.do("PUT", "/api/dashboards/d1/settings", map[string]interface{}{
		"overrides": map[string]interface{}{"statusCheckIntervalMinutes": 0}, "revision": 2})
	if code != 400 || resp["error"] == nil {
		t.Fatalf("interval 0: %d %v", code, resp)
	}
	code, resp = c.do("PUT", "/api/dashboards/d1/settings", map[string]interface{}{
		"overrides": map[string]interface{}{"statusCheckIntervalMinutes": 5}, "revision": 1})
	if code != 409 || resp["currentRevision"] != float64(2) {
		t.Fatalf("stale: %d %v", code, resp)
	}
	var after string
	db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&after)
	if before != after {
		t.Fatal("rejected saves modified the stored row")
	}
}

func TestPutConfig_UnreadableStoredConfigIs500(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	db.Exec(`UPDATE config SET data = '{"dashboards":[]}' WHERE id = 1`) // v2 doc: not v3
	for _, m := range []string{"GET", "PUT"} {
		code, resp := c.do(m, "/api/config", map[string]interface{}{"dashboards": []interface{}{}})
		if code != 500 || resp["error"] == nil {
			t.Fatalf("%s: %d %v", m, code, resp)
		}
	}
	var after string
	db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&after)
	if after != `{"dashboards":[]}` {
		t.Fatalf("row overwritten: %s", after)
	}
}
