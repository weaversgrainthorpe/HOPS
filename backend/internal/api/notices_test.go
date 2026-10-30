package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
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
// statusChecksEnabled gate (nil = Enabled), returning the stored JSON. As in
// the conversion, a ticked tile is On and every other tile Off.
func statusDoc(t *testing.T, dashes []map[string]interface{}, gates map[string]interface{}) string {
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
		if v, ok := gates[id]; ok {
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
	cfg := &config.Config{DataDir: t.TempDir()}
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

const uploadNoticeID = "upload-defaults-moved-v3"

// oldUploadDefaults are upload limits still at the defaults an older build
// seeded, which the settings service moves to the new defaults at startup and
// reports as a one-time notice.
func oldUploadDefaults() map[string]string {
	return map[string]string{
		settings.KeyUploadMaxBytesBackground: fmt.Sprint(50 * settings.MB),
		settings.KeyUploadMaxBytesIcon:       fmt.Sprint(8 * settings.MB),
	}
}

// statusFixture: Alpha is Disabled with its tile On; Beta is Enabled with its
// tile Off; Gamma is Enabled with its tile On; Zeta is Enabled and its tile has
// no setting (Off).
func statusFixture(t *testing.T) string {
	on := map[string]interface{}{"type": "http", "enabled": true}
	off := map[string]interface{}{"type": "http", "enabled": false}
	return statusDoc(t, []map[string]interface{}{
		statusDash("da", "Alpha", on, ""),
		statusDash("db", "Beta", off, ""),
		statusDash("dc", "Gamma", on, ""),
		statusDash("df", "Zeta", nil, ""),
	}, map[string]interface{}{"da": false})
}

// noticeRouter is a router over statusFixture whose upload limits sit at the
// old defaults, so the one-time upload notice is shown.
func noticeRouter(t *testing.T) (http.Handler, *sql.DB) {
	t.Helper()
	return setupTestRouterWithSettingsRows(t, statusFixture(t), nil, oldUploadDefaults())
}

func TestNotices_DismissPersists(t *testing.T) {
	router, db := noticeRouter(t)
	c := newClient(t, router)

	ns := noticesOf(t, getView(t, c))
	if len(ns) != 1 || ns[0]["id"] != uploadNoticeID {
		t.Fatalf("notices = %v, want the one upload-defaults notice", ns)
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

	code, resp := c.do("POST", "/api/notices/"+uploadNoticeID+"/dismiss", nil)
	if code != 200 {
		t.Fatalf("dismiss: %d %v", code, resp)
	}
	if ns := noticesOf(t, getView(t, c)); len(ns) != 0 {
		t.Errorf("after dismiss: %v", ns)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM dismissed_notices WHERE id = ?`, uploadNoticeID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("dismissal not stored: n=%d err=%v", n, err)
	}
	// Dismissing again is harmless.
	if code, resp := c.do("POST", "/api/notices/"+uploadNoticeID+"/dismiss", nil); code != 200 {
		t.Errorf("second dismiss: %d %v", code, resp)
	}

	// After a restart it stays gone.
	c2 := newClient(t, restartRouter(t, db))
	if ns := noticesOf(t, getView(t, c2)); len(ns) != 0 {
		t.Errorf("after restart: %v", ns)
	}
}

// Status checks raise no notice, whatever the gates and tiles say: the
// model needs no announcement and a blocked tile is reported on the settings
// page instead.
func TestNotices_NoStatusCheckNotice(t *testing.T) {
	router, _ := setupTestRouterSeeded(t, statusFixture(t))
	c := newClient(t, router)
	if ns := noticesOf(t, getView(t, c)); len(ns) != 0 {
		t.Errorf("notices = %v, want none", ns)
	}
}

func TestNotices_DismissRejectsUnknownAndMalformedIDs(t *testing.T) {
	router, _ := noticeRouter(t)
	c := newClient(t, router)
	for path, want := range map[string]int{
		"/api/notices/no-such-notice/dismiss":                  404,
		"/api/notices/layered-status-checks-v4/dismiss":        404,
		"/api/notices/v2-status-checks-off/dismiss":            404,
		"/api/notices/" + strings.Repeat("a", 65) + "/dismiss": 400,
		"/api/notices/Bad_ID/dismiss":                          400,
		"/api/notices/" + uploadNoticeID:                       404,
		"/api/notices/" + uploadNoticeID + "/dismiss/x":        404,
	} {
		if code, resp := c.do("POST", path, nil); code != want {
			t.Errorf("POST %s: %d %v, want %d", path, code, resp, want)
		}
	}
	if code, _ := c.do("GET", "/api/notices/"+uploadNoticeID+"/dismiss", nil); code != 405 {
		t.Errorf("GET dismiss: %d, want 405", code)
	}
	// Nothing was dismissed by the rejected requests.
	if ns := noticesOf(t, getView(t, c)); len(ns) != 1 {
		t.Errorf("notices = %v", ns)
	}
}

// Route classification: the dismiss route needs a session and a CSRF token.
func TestNotices_DismissNeedsAuthAndCSRF(t *testing.T) {
	router, _ := noticeRouter(t)
	c := newClient(t, router)
	path := "/api/notices/" + uploadNoticeID + "/dismiss"
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

// GET /api/status/{id} resolves with the same gate rule as the checker and
// says which level decided: the tile itself, or the outermost Disabled gate.
func TestGetStatus_GateSource(t *testing.T) {
	router, db := setupTestRouterSeeded(t, statusFixture(t))
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
		"da-e": {"disabled", "dashboard", "da"}, // tile On under a Disabled dashboard: blocked, the cached result is not shown
		"db-e": {"disabled", "tile", "db-e"},    // tile Off
		"dc-e": {"unknown", "tile", "dc-e"},     // tile On under an Enabled dashboard, no result yet
		"df-e": {"disabled", "tile", "df-e"},    // tile with no setting is Off
	} {
		got := get(id)
		if fmt.Sprint(got["status"]) != want[0] || got["source"] != want[1] || got["sourceId"] != want[2] {
			t.Errorf("%s: %v, want status=%s source=%s sourceId=%s", id, got, want[0], want[1], want[2])
		}
	}
}

// setTileCheck sets tile id's statusCheck.enabled in the stored document.
func setTileCheck(t *testing.T, db *sql.DB, id string, on bool) {
	t.Helper()
	doc, err := configdoc.Load(db)
	if err != nil {
		t.Fatal(err)
	}
	_, tile, ok := configdoc.FindTile(doc, id)
	if !ok {
		t.Fatalf("tile %s not found", id)
	}
	tile["statusCheck"] = configdoc.Obj{"type": "http", "enabled": on}
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
}

// If dismissed_notices can't be read at startup, notices are shown (never
// silently hidden) and the read is retried on each GET until it works.
func TestNotices_DismissedReadFailureShowsThenRetries(t *testing.T) {
	_, db := noticeRouter(t)
	if _, err := db.Exec(`DROP TABLE dismissed_notices`); err != nil {
		t.Fatal(err)
	}
	buf := captureSlog(t)
	router := restartRouter(t, db) // restartRouter does not re-run the schema migrations
	c := newClient(t, router)
	if ns := noticesOf(t, getView(t, c)); len(ns) != 1 {
		t.Fatalf("with dismissals unreadable: %v, want the notice shown", ns)
	}
	if !strings.Contains(buf.String(), "level=ERROR") {
		t.Errorf("unreadable dismissals not logged: %q", buf.String())
	}
	if _, err := db.Exec(`CREATE TABLE dismissed_notices (id TEXT PRIMARY KEY, dismissed_at DATETIME DEFAULT CURRENT_TIMESTAMP)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO dismissed_notices (id) VALUES (?)`, uploadNoticeID); err != nil {
		t.Fatal(err)
	}
	if ns := noticesOf(t, getView(t, c)); len(ns) != 0 {
		t.Errorf("after the read recovers the dismissal must apply: %v", ns)
	}
}

// captureSlog routes the default logger into a buffer for the test.
func captureSlog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

// GET /api/status names a wrong-typed stored value: the tile is off with
// source "invalid" and the offending level's id.
func TestGetStatus_InvalidValueIsSurfaced(t *testing.T) {
	router, db := setupTestRouterSeeded(t, statusFixture(t))
	doc, err := configdoc.Load(db)
	if err != nil {
		t.Fatal(err)
	}
	dash, _, _ := configdoc.FindTile(doc, "dc-e")
	tab := dash["tabs"].([]any)[0].(configdoc.Obj)
	folder := tab["root"].(configdoc.Obj)["children"].([]any)[0].(configdoc.Obj)
	folder["statusChecksEnabled"] = "yes"
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/api/status/dc-e", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	var got map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if w.Code != 200 || got["status"] != "disabled" || got["source"] != "invalid" || got["sourceId"] != folder["id"] {
		t.Errorf("got %d %v, want disabled/invalid/%v", w.Code, got, folder["id"])
	}
}

// No notice points at a page: the backup, upload-defaults and tile-size
// notices carry no link.
func TestNotices_NoneHasALink(t *testing.T) {
	router, _ := noticeRouter(t)
	c := newClient(t, router)

	// A real sticky backup notice next to the upload one: a refused restore.
	_, bm, name := backupsOf(t, c)
	bm.SetFailureHooks(failReason("pre-restore"))
	if code, resp := c.do("POST", "/api/backups/"+name, nil); code != http.StatusInternalServerError {
		t.Fatalf("restore: %d %v", code, resp)
	}
	ns := noticesOf(t, getView(t, c))
	backups := 0
	for _, n := range ns {
		id, _ := n["id"].(string)
		if _, has := n["link"]; has {
			t.Errorf("notice %q has a link: %v", id, n)
		}
		if strings.HasPrefix(id, "backup-") {
			backups++
		}
	}
	if len(ns) != 2 || backups != 1 {
		t.Fatalf("want the upload and one backup notice, got %v", ns)
	}

	var sz sizeNoteState
	sz.add("Tile A")
	if n, ok := sz.notice(); !ok || n.Link != nil {
		t.Errorf("tile-size notice: ok=%v link=%v", ok, n.Link)
	}
}
