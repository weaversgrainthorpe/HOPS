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
// statusChecksEnabled override (nil = inherit), returning the stored JSON. A
// tile built with no statusCheck has none in the stored v3 document either
// (so it inherits), undoing the v2 conversion's Off pin, and a tile built on is
// stored explicitly on (the conversion would make it inherit).
func statusDoc(t *testing.T, dashes []map[string]interface{}, overrides map[string]interface{}) string {
	t.Helper()
	list := make([]any, len(dashes))
	unset, on := map[string]bool{}, map[string]bool{}
	for i, d := range dashes {
		list[i] = d
		for _, tb := range d["tabs"].([]interface{}) {
			for _, g := range tb.(map[string]interface{})["groups"].([]interface{}) {
				for _, e := range g.(map[string]interface{})["entries"].([]interface{}) {
					em := e.(map[string]interface{})
					if em["statusCheck"] == nil {
						unset[em["id"].(string)] = true
					} else if sc, _ := em["statusCheck"].(map[string]interface{}); sc["enabled"] == true {
						on[em["id"].(string)] = true
					}
				}
			}
		}
	}
	doc, err := configdoc.MigrateV2(configdoc.Obj{"dashboards": list})
	if err != nil {
		t.Fatal(err)
	}
	configdoc.Walk(doc, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		id, _ := n["id"].(string)
		if n["kind"] != "tile" {
			return true
		}
		if unset[id] {
			delete(n, "statusCheck")
		} else if on[id] {
			n["statusCheck"].(configdoc.Obj)["enabled"] = true // the conversion makes a ticked tile inherit
		}
		return true
	})
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

const layeredNoticeID = "layered-status-checks-v4"

func layeredStatusFixture(t *testing.T) string {
	on := map[string]interface{}{"type": "http", "enabled": true}
	inherit := map[string]interface{}{"type": "http", "enabled": nil}
	return statusDoc(t, []map[string]interface{}{
		statusDash("da", "Alpha", on, ""),     // off + tile on: listed
		statusDash("db", "Beta", inherit, ""), // off + tile inherits: not listed
		statusDash("df", "Zeta", nil, ""),     // on + tile with no setting (inherits): not listed
		statusDash("dc", "Gamma", on, ""),     // on + tile on: not listed
		statusDash("dd", "Delta", on, "note"), // off + note tile ticked: notes are never checked
		statusDash("de", "Epsilon", on, ""),   // off + tile on: listed
	}, map[string]interface{}{"da": false, "db": false, "df": true, "dc": true, "dd": false, "de": false})
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

	link, _ := ns[0]["link"].(map[string]interface{})
	if link["href"] != "/settings/dashboards/status-overrides" || link["label"] != "Review status check overrides" {
		t.Errorf("link = %v, want the status-overrides page", ns[0]["link"])
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
		"df-e": {"unknown", "dashboard", "df"},  // tile with no setting under dashboard on: inherits, no result yet
	} {
		got := get(id)
		if fmt.Sprint(got["status"]) != want[0] || got["source"] != want[1] || got["sourceId"] != want[2] {
			t.Errorf("%s: %v, want status=%s source=%s sourceId=%s", id, got, want[0], want[1], want[2])
		}
	}
}

// inheritTileCheck sets tile id's statusCheck.enabled to null (explicit
// inherit) in the stored document, so its checks follow the dashboard. A tile
// with no setting does the same; this just makes it explicit.
func inheritTileCheck(t *testing.T, db *sql.DB, id string) {
	t.Helper()
	doc, err := configdoc.Load(db)
	if err != nil {
		t.Fatal(err)
	}
	_, tile, ok := configdoc.FindTile(doc, id)
	if !ok {
		t.Fatalf("tile %s not found", id)
	}
	tile["statusCheck"] = configdoc.Obj{"type": "http", "enabled": nil}
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
}

// Ruling 13: the notice reflects the current config on every GET. Turning the
// dashboard on removes it; turning another one off (with a tile switched on)
// brings it back, naming that dashboard.
func TestNotices_FollowTheCurrentConfig(t *testing.T) {
	router, _ := setupTestRouterSeeded(t, layeredStatusFixture(t))
	c := newClient(t, router)
	setOverride := func(id string, v interface{}) {
		t.Helper()
		code, resp := c.do("GET", "/api/dashboards/"+id+"/settings", nil)
		if code != 200 {
			t.Fatalf("get settings %s: %d %v", id, code, resp)
		}
		code, resp = c.do("PUT", "/api/dashboards/"+id+"/settings", map[string]interface{}{
			"overrides": map[string]interface{}{"statusChecksEnabled": v}, "revision": resp["revision"]})
		if code != 200 {
			t.Fatalf("put settings %s: %d %v", id, code, resp)
		}
	}
	setOverride("da", true)
	setOverride("de", true)
	if ns := noticesOf(t, getView(t, c)); len(ns) != 0 {
		t.Fatalf("after turning Alpha and Epsilon on: %v", ns)
	}
	setOverride("dc", false) // Gamma: tile switched on
	ns := noticesOf(t, getView(t, c))
	if len(ns) != 1 || !strings.HasSuffix(ns[0]["text"].(string), "now checked: Gamma.") {
		t.Fatalf("after turning Gamma off: %v", ns)
	}
}

// If dismissed_notices can't be read at startup, notices are shown (never
// silently hidden) and the read is retried on each GET until it works.
func TestNotices_DismissedReadFailureShowsThenRetries(t *testing.T) {
	_, db := setupTestRouterSeeded(t, layeredStatusFixture(t))
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
	if _, err := db.Exec(`INSERT INTO dismissed_notices (id) VALUES (?)`, layeredNoticeID); err != nil {
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
// source "invalid" and the offending level's id (Ruling 13).
func TestGetStatus_InvalidValueIsSurfaced(t *testing.T) {
	router, db := setupTestRouterSeeded(t, layeredStatusFixture(t))
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

// Only the layered-status notice points at a page: the real backup, upload-
// defaults and tile-size notices carry no link.
func TestNotices_OnlyLayeredStatusNoticeHasALink(t *testing.T) {
	router, _ := setupTestRouterSeeded(t, layeredStatusFixture(t))
	c := newClient(t, router)

	// A real sticky backup notice next to the layered one: a refused restore.
	_, bm, name := backupsOf(t, c)
	bm.SetFailureHooks(failReason("pre-restore"))
	if code, resp := c.do("POST", "/api/backups/"+name, nil); code != http.StatusInternalServerError {
		t.Fatalf("restore: %d %v", code, resp)
	}
	ns := noticesOf(t, getView(t, c))
	linked, backups := 0, 0
	for _, n := range ns {
		id, _ := n["id"].(string)
		_, has := n["link"]
		switch {
		case id == layeredNoticeID:
			if !has {
				t.Errorf("layered notice lost its link: %v", n)
			}
			linked++
		case strings.HasPrefix(id, "backup-"):
			backups++
			if has {
				t.Errorf("backup notice has a link: %v", n)
			}
		default:
			if has {
				t.Errorf("notice %q has a link: %v", id, n)
			}
		}
	}
	if linked != 1 || backups != 1 {
		t.Fatalf("want the layered and one backup notice, got %v", ns)
	}

	// The other builders, directly.
	up, ok := uploadDefaultsNotice([]settings.DefaultMove{{Key: settings.KeyUploadMaxBytesIcon, From: settings.MB, To: 2 * settings.MB}})
	if !ok || up.Link != nil {
		t.Errorf("upload-defaults notice: ok=%v link=%v", ok, up.Link)
	}
	var sz sizeNoteState
	sz.add("Tile A")
	if n, ok := sz.notice(); !ok || n.Link != nil {
		t.Errorf("tile-size notice: ok=%v link=%v", ok, n.Link)
	}
}
