package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/auth"
	"github.com/weaversgrainthorpe/HOPS/internal/config"
	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/discovery"
	"github.com/weaversgrainthorpe/HOPS/internal/settings"
)

// statusDash is a v2 dashboard (ids prefixed by p) with one tile whose
// statusCheck is sc (nil = absent) and whose type is typ ("" = link).
func statusDash(p, name string, sc map[string]interface{}, typ string) map[string]interface{} {
	tile := map[string]interface{}{"id": p + "-e", "name": "Tile", "url": "https://example.com/" + p, "order": 0}
	if sc != nil {
		tile["statusCheck"] = sc
	}
	if typ != "" {
		tile["type"] = typ
	}
	return map[string]interface{}{
		"id": p, "name": name, "path": "/" + p, "order": 0,
		"tabs": []interface{}{map[string]interface{}{
			"id": p + "-t", "name": "Tab", "order": 0,
			"groups": []interface{}{map[string]interface{}{
				"id": p + "-g", "name": "Group", "order": 0,
				"entries": []interface{}{tile},
			}},
		}},
	}
}

// statusDoc migrates the v2 dashboards and applies each dashboard's
// statusChecksEnabled override (nil = inherit), returning the stored JSON.
func statusDoc(t *testing.T, dashes []map[string]interface{}, overrides map[string]interface{}) string {
	t.Helper()
	list := make([]any, len(dashes))
	for i, d := range dashes {
		list[i] = d
	}
	doc, err := configdoc.MigrateV2(configdoc.Obj{"dashboards": list})
	if err != nil {
		t.Fatal(err)
	}
	for id, d := range storedDashboards(doc) {
		if v, ok := overrides[id]; ok {
			d["settings"].(configdoc.Obj)["statusChecksEnabled"] = v
		}
	}
	b, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// restartRouter builds a fresh Router over the same database, as a process
// restart would (the startup migration is a no-op on a v3 document).
func restartRouter(t *testing.T, db *sql.DB) http.Handler {
	t.Helper()
	migration, err := configdoc.MigrateOnStartup(db)
	if err != nil {
		t.Fatal(err)
	}
	svc, err := settings.New(db)
	if err != nil {
		t.Fatal(err)
	}
	store := discovery.NewStore(db)
	cfg := &config.Config{DataDir: t.TempDir(), FrontendDir: t.TempDir()}
	_, h := NewRouter(db, auth.NewService(db), cfg, svc, time.Now(), store, discovery.NewOrchestrator(store, svc), migration)
	return h
}

func noticesOf(t *testing.T, v map[string]interface{}) []map[string]interface{} {
	t.Helper()
	if _, has := v["notices"]; !has {
		return nil // absent when there are none, like migrationNotices
	}
	raw, ok := v["notices"].([]interface{})
	if !ok || len(raw) == 0 {
		t.Fatalf("GET /api/config notices is %#v, want a non-empty list or absent", v["notices"])
	}
	out := make([]map[string]interface{}, len(raw))
	for i, n := range raw {
		out[i] = n.(map[string]interface{})
	}
	return out
}

const layeredNoticeID = "layered-status-checks-v4"

func layeredStatusFixture(t *testing.T) string {
	on := map[string]interface{}{"type": "http", "enabled": true}
	return statusDoc(t, []map[string]interface{}{
		statusDash("da", "Alpha", on, ""),     // off + tile on: listed
		statusDash("db", "Beta", nil, ""),     // off + tile inherits: not listed
		statusDash("dc", "Gamma", on, ""),     // on + tile on: not listed
		statusDash("dd", "Delta", on, "note"), // off + note tile ticked: notes are never checked
		statusDash("de", "Epsilon", on, ""),   // off + tile on: listed
	}, map[string]interface{}{"da": false, "db": false, "dc": true, "dd": false, "de": false})
}

func TestNotices_LayeredStatusChecksListsDashboardsAndDismissPersists(t *testing.T) {
	router, db := setupTestRouterSeeded(t, layeredStatusFixture(t))
	c := newClient(t, router)

	ns := noticesOf(t, getView(t, c))
	if len(ns) != 1 || ns[0]["id"] != layeredNoticeID {
		t.Fatalf("notices = %v, want the one layered-status-checks notice", ns)
	}
	want := "Status checks now follow the most specific setting. These dashboards have tiles switched on while the dashboard is off, so those tiles are now checked: Alpha, Epsilon."
	if ns[0]["text"] != want {
		t.Errorf("text = %q\nwant  %q", ns[0]["text"], want)
	}

	// Anonymous viewers see it too (GET /api/config is public).
	req := httptest.NewRequest("GET", "/api/config", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	var anon map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &anon)
	if len(noticesOf(t, anon)) != 1 {
		t.Errorf("anonymous GET /api/config: notices %v", anon["notices"])
	}

	code, resp := c.do("POST", "/api/notices/"+layeredNoticeID+"/dismiss", nil)
	if code != 200 {
		t.Fatalf("dismiss: %d %v", code, resp)
	}
	if ns := noticesOf(t, getView(t, c)); len(ns) != 0 {
		t.Errorf("after dismiss: %v", ns)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM dismissed_notices WHERE id = ?`, layeredNoticeID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("dismissal not stored: n=%d err=%v", n, err)
	}
	// Dismissing again is harmless.
	if code, resp := c.do("POST", "/api/notices/"+layeredNoticeID+"/dismiss", nil); code != 200 {
		t.Errorf("second dismiss: %d %v", code, resp)
	}

	// After a restart it stays gone, though the condition still holds.
	router2 := restartRouter(t, db)
	c2 := newClient(t, router2)
	if ns := noticesOf(t, getView(t, c2)); len(ns) != 0 {
		t.Errorf("after restart: %v", ns)
	}
}

func TestNotices_AbsentWhenNoTileIsOnUnderAnOffDashboard(t *testing.T) {
	on := map[string]interface{}{"type": "http", "enabled": true}
	stored := statusDoc(t, []map[string]interface{}{
		statusDash("da", "Alpha", on, ""),
		statusDash("db", "Beta", nil, ""),
		statusDash("dd", "Delta", on, "note"),
	}, map[string]interface{}{"da": nil, "db": false, "dd": false})
	router, _ := setupTestRouterSeeded(t, stored)
	c := newClient(t, router)
	if ns := noticesOf(t, getView(t, c)); len(ns) != 0 {
		t.Errorf("notices = %v, want none", ns)
	}
}

// The global switch off makes an inheriting dashboard off too.
func TestNotices_GlobalOffCountsAsDashboardOff(t *testing.T) {
	on := map[string]interface{}{"type": "http", "enabled": true}
	stored := statusDoc(t, []map[string]interface{}{statusDash("da", "Alpha", on, "")}, nil)
	_, db := setupTestRouterSeeded(t, stored)
	svc, err := settings.New(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Set(settings.KeyStatusChecksEnabled, "false"); err != nil {
		t.Fatal(err)
	}
	c := newClient(t, restartRouter(t, db))
	ns := noticesOf(t, getView(t, c))
	if len(ns) != 1 || !strings.HasSuffix(ns[0]["text"].(string), ": Alpha.") {
		t.Errorf("notices = %v", ns)
	}
}

func TestNotices_DismissRejectsUnknownAndMalformedIDs(t *testing.T) {
	router, _ := setupTestRouterSeeded(t, layeredStatusFixture(t))
	c := newClient(t, router)
	for path, want := range map[string]int{
		"/api/notices/no-such-notice/dismiss":                  404,
		"/api/notices/" + strings.Repeat("a", 65) + "/dismiss": 400,
		"/api/notices/Bad_ID/dismiss":                          400,
		"/api/notices/" + layeredNoticeID:                      404,
		"/api/notices/" + layeredNoticeID + "/dismiss/x":       404,
	} {
		if code, resp := c.do("POST", path, nil); code != want {
			t.Errorf("POST %s: %d %v, want %d", path, code, resp, want)
		}
	}
	if code, _ := c.do("GET", "/api/notices/"+layeredNoticeID+"/dismiss", nil); code != 405 {
		t.Errorf("GET dismiss: %d, want 405", code)
	}
	// Nothing was dismissed by the rejected requests.
	if ns := noticesOf(t, getView(t, c)); len(ns) != 1 {
		t.Errorf("notices = %v", ns)
	}
}

// Route classification: the dismiss route needs a session and a CSRF token.
func TestNotices_DismissNeedsAuthAndCSRF(t *testing.T) {
	router, _ := setupTestRouterSeeded(t, layeredStatusFixture(t))
	c := newClient(t, router)
	path := "/api/notices/" + layeredNoticeID + "/dismiss"
	req := httptest.NewRequest("POST", path, nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("without auth: %d", w.Code)
	}
	req = httptest.NewRequest("POST", path, nil)
	req.Header.Set("Authorization", "Bearer "+c.token)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("without CSRF: %d", w.Code)
	}
	if ns := noticesOf(t, getView(t, c)); len(ns) != 1 {
		t.Errorf("a rejected dismiss changed the notices: %v", ns)
	}
}

// GET /api/status/{id} resolves with the same layered rule as the checker
// and says which level decided.
func TestGetStatus_LayeredSource(t *testing.T) {
	router, db := setupTestRouterSeeded(t, layeredStatusFixture(t))
	if _, err := db.Exec(`INSERT INTO status_cache (entry_id, status, response_time) VALUES ('da-e', 'up', 12)`); err != nil {
		t.Fatal(err)
	}
	get := func(id string) map[string]interface{} {
		req := httptest.NewRequest("GET", "/api/status/"+id, nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("status %s: %d %s", id, w.Code, w.Body.String())
		}
		var out map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return out
	}
	for id, want := range map[string][3]string{
		"da-e": {"up", "tile", "da-e"},          // tile on under dashboard off
		"db-e": {"disabled", "dashboard", "db"}, // inherits the off dashboard
		"dc-e": {"unknown", "tile", "dc-e"},     // tile on under dashboard on, no result yet
	} {
		got := get(id)
		if fmt.Sprint(got["status"]) != want[0] || got["source"] != want[1] || got["sourceId"] != want[2] {
			t.Errorf("%s: %v, want status=%s source=%s sourceId=%s", id, got, want[0], want[1], want[2])
		}
	}
}
