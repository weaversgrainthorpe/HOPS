package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
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

// seed replaces the stored dashboards with d1 (revision 1): legacyDash
// migrated to v3, written straight to the stored document.
func seed(t *testing.T, db *sql.DB) {
	t.Helper()
	doc, err := configdoc.MigrateV2(configdoc.Obj{"dashboards": []any{legacyDash("First")}})
	if err != nil {
		t.Fatal(err)
	}
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
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

func TestGetConfig_ReturnsV3Dashboards(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	v := getView(t, c)
	if v["schemaVersion"] != float64(3) {
		t.Fatalf("schemaVersion = %v", v["schemaVersion"])
	}
	d := v["dashboards"].([]interface{})[0].(map[string]interface{})
	if d["revision"] != float64(1) {
		t.Fatalf("revision missing: %v", d)
	}
	kids := rootOf(d)["children"].([]interface{})
	if len(kids) != 1 {
		t.Fatalf("root children: %v", kids)
	}
	f := kids[0].(map[string]interface{})
	tiles := f["content"].(map[string]interface{})["children"].([]interface{})
	if f["kind"] != "folder" || f["id"] != "g1" || len(tiles) != 1 || tiles[0].(map[string]interface{})["id"] != "e1" {
		t.Fatalf("folder/tile missing: %v", f)
	}
}

func TestGetConfig_MigrationFailed503(t *testing.T) {
	router, _ := setupTestRouterWithMigration(t, &configdoc.MigrationResult{Failed: true, Detail: "boom"})
	c := newClient(t, router)
	for _, tc := range []struct{ m, p string }{
		{"GET", "/api/config"}, {"POST", "/api/dashboards"}, {"PUT", "/api/dashboards/order"},
		{"GET", "/api/dashboards/d1/settings"}, {"PUT", "/api/dashboards/d1/settings"}, {"PUT", "/api/dashboards/d1"},
	} {
		code, resp := c.do(tc.m, tc.p, map[string]interface{}{"dashboards": []interface{}{}})
		if code != 503 || resp["error"] != "migration_failed" || resp["detail"] != "boom" ||
			resp["backupHint"] != "Admin → Backups holds the automatic pre-v3-migration and startup backups" {
			t.Fatalf("%s %s: %d %v", tc.m, tc.p, code, resp)
		}
	}
}

func TestPutDashboard_MigrationFailedLeavesRowUntouched(t *testing.T) {
	router, db := setupTestRouterWithMigration(t, &configdoc.MigrationResult{Failed: true, Detail: "boom"})
	var before string
	db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&before)
	c := newClient(t, router)
	code, _ := v3Put(c, "d1", map[string]interface{}{"id": "d1", "name": "X", "path": "/d1", "tabs": []interface{}{}}, 1)
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
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	d := v3Body(t, c, "d1")
	d["name"] = "Renamed"
	code, resp := v3Put(c, "d1", d, 1)
	if code != 200 || resp["revision"] != float64(2) {
		t.Fatalf("%d %v", code, resp)
	}
	got := getView(t, c)["dashboards"].([]interface{})[0].(map[string]interface{})
	if got["name"] != "Renamed" || got["revision"] != float64(2) {
		t.Fatalf("not saved: %v", got)
	}
	code, resp = v3Put(c, "nope", map[string]interface{}{"id": "nope"}, 1)
	if code != 404 {
		t.Fatalf("unknown dashboard: %d %v", code, resp)
	}
}

func TestPutDashboard_StaleRevisionConflicts(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	first := v3Body(t, c, "d1")
	first["name"] = "First save"
	if code, r := v3Put(c, "d1", first, 1); code != 200 {
		t.Fatalf("%d %v", code, r)
	}
	second := v3Body(t, c, "d1")
	second["name"] = "Second save"
	code, resp := v3Put(c, "d1", second, 1)
	if code != 409 || resp["error"] != "conflict" || resp["dashboardId"] != "d1" || resp["currentRevision"] != float64(2) {
		t.Fatalf("%d %v", code, resp)
	}
	// Absent and non-numeric revisions conflict too (Ruling 12).
	for _, rev := range []interface{}{nil, "2"} {
		if code, resp = v3Put(c, "d1", second, rev); code != 409 {
			t.Fatalf("revision %v: want 409, got %d %v", rev, code, resp)
		}
	}
	got := getView(t, c)["dashboards"].([]interface{})[0].(map[string]interface{})
	if got["name"] != "First save" || got["revision"] != float64(2) {
		t.Fatalf("stored doc changed by conflicting save: %v", got)
	}
}

func TestDashboardSettings_RoundTripAndValidation(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)

	code, resp := c.do("GET", "/api/dashboards/d1/settings", nil)
	ov := resp["overrides"].(map[string]interface{})
	eff := resp["effective"].(map[string]interface{})
	if code != 200 || len(ov) != 5 || len(eff) != 5 || resp["revision"] != float64(1) {
		t.Fatalf("%d %v", code, resp)
	}
	if _, has := eff["defaultLayout"]; has { // Ruling 4: free layout and its setting are gone
		t.Fatalf("effective still serves defaultLayout: %v", eff)
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

func TestUnreadableStoredConfigIs500(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	db.Exec(`UPDATE config SET data = '{"dashboards":[]}' WHERE id = 1`) // v2 doc: not v3
	for _, tc := range []struct {
		m, p string
		body interface{}
	}{
		{"GET", "/api/config", nil},
		{"PUT", "/api/dashboards/d1", map[string]interface{}{"schema": 3, "dashboard": map[string]interface{}{"id": "d1"}, "revision": 1, "layoutVersion": configdoc.LayoutVersion}},
	} {
		code, resp := c.do(tc.m, tc.p, tc.body)
		if code != 500 || resp["error"] == nil {
			t.Fatalf("%s %s: %d %v", tc.m, tc.p, code, resp)
		}
	}
	var after string
	db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&after)
	if after != `{"dashboards":[]}` {
		t.Fatalf("row overwritten: %s", after)
	}
}

// addD2 appends dashboard d2 (legacyDashWithID migrated to v3, revision 1)
// to the stored document.
func addD2(t *testing.T, db *sql.DB) {
	t.Helper()
	conv, err := configdoc.ConvertDashboardV2(legacyDashWithID("d2", "Second"))
	if err != nil {
		t.Fatal(err)
	}
	doc := storedDoc(t, db)
	doc["dashboards"] = append(doc["dashboards"].([]any), conv)
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
}

func storedRaw(db interface {
	QueryRow(string, ...any) *sql.Row
}) string {
	var s string
	db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&s)
	return s
}

func TestDashboardSettings_MergeAndNullReset(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	c.do("PUT", "/api/dashboards/d1/settings", map[string]interface{}{
		"overrides": map[string]interface{}{"statusCheckIntervalMinutes": 7, "statusCheckTimeoutSeconds": 3}, "revision": 1})
	code, resp := c.do("PUT", "/api/dashboards/d1/settings", map[string]interface{}{
		"overrides": map[string]interface{}{"statusCheckIntervalMinutes": 8}, "revision": 2})
	if code != 200 {
		t.Fatalf("%d %v", code, resp)
	}
	_, resp = c.do("GET", "/api/dashboards/d1/settings", nil)
	ov := resp["overrides"].(map[string]interface{})
	if ov["statusCheckIntervalMinutes"] != float64(8) || ov["statusCheckTimeoutSeconds"] != float64(3) {
		t.Fatalf("partial body reset others: %v", ov)
	}
	c.do("PUT", "/api/dashboards/d1/settings", map[string]interface{}{
		"overrides": map[string]interface{}{"statusCheckTimeoutSeconds": nil}, "revision": 3})
	_, resp = c.do("GET", "/api/dashboards/d1/settings", nil)
	ov = resp["overrides"].(map[string]interface{})
	if ov["statusCheckTimeoutSeconds"] != nil || ov["statusCheckIntervalMinutes"] != float64(8) {
		t.Fatalf("null reset: %v", ov)
	}
}

func TestStoredRevisionUnreadableIs500(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	db.Exec(`UPDATE config SET data = json_remove(data, '$.dashboards[0].revision') WHERE id = 1`)
	for _, tc := range []struct{ m, p string }{
		{"GET", "/api/config"}, {"GET", "/api/dashboards/d1/settings"},
		{"PUT", "/api/dashboards/d1/settings"}, {"PUT", "/api/dashboards/d1"},
	} {
		body := map[string]interface{}{"overrides": map[string]interface{}{}, "revision": 1, "schema": 3, "layoutVersion": configdoc.LayoutVersion,
			"dashboard": map[string]interface{}{"id": "d1", "name": "X", "path": "/d1", "tabs": []interface{}{}}}
		code, resp := c.do(tc.m, tc.p, body)
		if code != 500 || !strings.Contains(fmt.Sprint(resp["error"]), "stored revision unreadable for dashboard d1") {
			t.Fatalf("%s %s: %d %v", tc.m, tc.p, code, resp)
		}
	}
}

func TestGetStatus_DisabledPerDashboard(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	inheritTileCheck(t, db, "e1") // follow the dashboard (a tile with no setting would too)
	if _, err := db.Exec(`INSERT INTO status_cache (entry_id, status) VALUES ('e1','up')`); err != nil {
		t.Fatal(err)
	}
	code, resp := c.do("GET", "/api/status/e1", nil)
	if code != 200 || resp["status"] != "up" || resp["lastChecked"] == nil {
		t.Fatalf("enabled: %d %v", code, resp)
	}
	if code, resp = c.do("PUT", "/api/dashboards/d1/settings", map[string]interface{}{
		"overrides": map[string]interface{}{"statusChecksEnabled": false}, "revision": 1}); code != 200 {
		t.Fatalf("%d %v", code, resp)
	}
	code, resp = c.do("GET", "/api/status/e1", nil)
	if code != 200 || resp["status"] != "disabled" {
		t.Fatalf("disabled: %d %v", code, resp)
	}
}

// Final review Minor 7: the v3 PUT bounds dashboard and tab names exactly as
// create/promote do (runes, not bytes), with a visible 400 and nothing stored.
func TestPutDashboard_BoundsDashboardAndTabNames(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	long := strings.Repeat("é", maxDashboardNameRunes+1)
	ok := strings.Repeat("é", maxDashboardNameRunes)

	d := v3Body(t, c, "d1")
	d["name"] = long
	if code, resp := v3Put(c, "d1", d, 1); code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "Dashboard name is longer than 200 characters") {
		t.Fatalf("long dashboard name: %d %v", code, resp)
	}
	d = v3Body(t, c, "d1")
	d["tabs"].([]interface{})[0].(map[string]interface{})["name"] = long
	if code, resp := v3Put(c, "d1", d, 1); code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "Tab name is longer than 200 characters") {
		t.Fatalf("long tab name: %d %v", code, resp)
	}
	got := getView(t, c)["dashboards"].([]interface{})[0].(map[string]interface{})
	if got["revision"] != float64(1) || got["name"] != "First" {
		t.Fatalf("a refused write changed the stored dashboard: %v", got)
	}

	d = v3Body(t, c, "d1")
	d["name"] = ok
	d["tabs"].([]interface{})[0].(map[string]interface{})["name"] = ok
	if code, resp := v3Put(c, "d1", d, 1); code != 200 {
		t.Fatalf("names at the limit: %d %v", code, resp)
	}
}
