package api

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// v2StatusOffNoticeOf returns the v2-status-checks-off notice in the view, or nil.
func v2StatusOffNoticeOf(t *testing.T, c *apiClient) map[string]interface{} {
	t.Helper()
	for _, n := range noticesOf(t, getView(t, c)) {
		if n["id"] == configdoc.NoticeV2StatusOff {
			return n
		}
	}
	return nil
}

// v2StatusDoc is a stored v2 document: Alpha has one tile not ticked and one
// ticked, Beta one tile not ticked, and Gamma only a ticked tile.
func v2StatusDoc(t *testing.T) string {
	t.Helper()
	on := map[string]interface{}{"type": "http", "enabled": true}
	alpha := statusDash("da", "Alpha", nil, "")
	group := alpha["tabs"].([]interface{})[0].(map[string]interface{})["groups"].([]interface{})[0].(map[string]interface{})
	group["entries"] = append(group["entries"].([]interface{}), map[string]interface{}{
		"id": "da-on", "name": "On", "url": "https://example.com/on", "order": 1, "statusCheck": on,
	})
	b, err := json.Marshal(map[string]interface{}{"dashboards": []interface{}{
		alpha,
		statusDash("db", "Beta", map[string]interface{}{"type": "http", "enabled": false}, ""),
		statusDash("dc", "Gamma", on, ""),
		statusDash("dn", "Notes", nil, "note"), // a note is never pinned, never counted
	}})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// The startup v2 conversion sets unticked tiles Off; the notice says so,
// names the dashboards still holding such tiles, links to the overrides
// page, and stays dismissed across a restart.
func TestNotices_V2StatusOffAfterStartupConversion(t *testing.T) {
	router, db := setupTestRouterSeeded(t, v2StatusDoc(t))
	c := newClient(t, router)
	n := v2StatusOffNoticeOf(t, c)
	if n == nil {
		t.Fatalf("no %s notice after a v2 conversion that set tiles Off", configdoc.NoticeV2StatusOff)
	}
	text := n["text"].(string)
	if !strings.Contains(text, "2 tiles are still set to Off on their own, in: Alpha, Beta.") {
		t.Errorf("text = %q, want the count and dashboards Alpha, Beta", text)
	}
	link, _ := n["link"].(map[string]interface{})
	if link["href"] != "/settings/dashboards/status-overrides" {
		t.Errorf("link = %v, want the overrides page", n["link"])
	}
	var armed int
	if err := db.QueryRow(`SELECT COUNT(*) FROM armed_notices WHERE id = ?`, configdoc.NoticeV2StatusOff).Scan(&armed); err != nil || armed != 1 {
		t.Fatalf("armed_notices row: %d, %v", armed, err)
	}

	if code, resp := c.do("POST", "/api/notices/"+configdoc.NoticeV2StatusOff+"/dismiss", nil); code != 200 {
		t.Fatalf("dismiss: %d %v", code, resp)
	}
	if v2StatusOffNoticeOf(t, c) != nil {
		t.Error("notice still shown after dismissal")
	}
	if v2StatusOffNoticeOf(t, newClient(t, restartRouter(t, db))) != nil {
		t.Error("dismissal did not survive a restart")
	}
}

// Once no tile is set Off on its own, the notice goes without being dismissed.
func TestNotices_V2StatusOffGoesWhenNoTileIsOff(t *testing.T) {
	router, db := setupTestRouterSeeded(t, v2StatusDoc(t))
	doc, err := configdoc.Load(db)
	if err != nil {
		t.Fatal(err)
	}
	configdoc.Walk(doc, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		if n["kind"] == "tile" && n["id"] == "da-e" {
			delete(n, "statusCheck")
		}
		return true
	})
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
	c := newClient(t, router)
	n := v2StatusOffNoticeOf(t, c)
	if n == nil || !strings.Contains(n["text"].(string), "1 tile is still set to Off on its own, in: Beta.") {
		t.Fatalf("after restoring Alpha's tile: %v", n)
	}
	_, tile, _ := configdoc.FindTile(doc, "db-e")
	tile["statusCheck"] = nil
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
	if n := v2StatusOffNoticeOf(t, c); n != nil {
		t.Errorf("notice still shown with no tile set Off: %v", n)
	}
}

// A v2 document whose tiles were all ticked sets nothing Off: no notice, and
// nothing armed.
func TestNotices_V2StatusOffNotArmedWhenNothingPinned(t *testing.T) {
	on := map[string]interface{}{"type": "http", "enabled": true}
	b, _ := json.Marshal(map[string]interface{}{"dashboards": []interface{}{statusDash("dc", "Gamma", on, "")}})
	router, db := setupTestRouterSeeded(t, string(b))
	if n := v2StatusOffNoticeOf(t, newClient(t, router)); n != nil {
		t.Errorf("notice with nothing set Off: %v", n)
	}
	var armed int
	if err := db.QueryRow(`SELECT COUNT(*) FROM armed_notices`).Scan(&armed); err != nil || armed != 0 {
		t.Errorf("armed_notices rows: %d, %v", armed, err)
	}
}

// Tiles the user sets Off on a v3 install are not the conversion's doing:
// without a v2 conversion there is no notice.
func TestNotices_V2StatusOffNeedsAConversion(t *testing.T) {
	router, db := setupTestRouter(t)
	doc, err := configdoc.Load(db)
	if err != nil {
		t.Fatal(err)
	}
	set := false
	configdoc.Walk(doc, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		if n["kind"] == "tile" && configdoc.IsCheckableTile(n) {
			n["statusCheck"] = configdoc.Obj{"enabled": false}
			set = true
			return false
		}
		return true
	})
	if !set {
		t.Fatal("fixture: no checkable tile in the fresh install")
	}
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
	if n := v2StatusOffNoticeOf(t, newClient(t, router)); n != nil {
		t.Errorf("notice on a v3 install with a tile set Off by the user: %v", n)
	}
}

// A v2 import that sets tiles Off arms the notice again, even after an
// earlier one was dismissed, and the arming is stored.
func TestNotices_V2StatusOffArmedByV2Import(t *testing.T) {
	router, db := setupTestRouter(t)
	if _, err := db.Exec(`INSERT INTO dismissed_notices (id) VALUES (?)`, configdoc.NoticeV2StatusOff); err != nil {
		t.Fatal(err)
	}
	router = restartRouter(t, db)
	c := newClient(t, router)
	b, _ := json.Marshal(map[string]interface{}{"dashboards": []interface{}{statusDash("dx", "Imported", nil, "")}})
	if code, resp := c.importFile(b); code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	n := v2StatusOffNoticeOf(t, c)
	if n == nil || !strings.Contains(n["text"].(string), "1 tile is still set to Off on its own, in: Imported.") {
		t.Fatalf("after a v2 import: %v", n)
	}
	var dismissed int
	if err := db.QueryRow(`SELECT COUNT(*) FROM dismissed_notices WHERE id = ?`, configdoc.NoticeV2StatusOff).Scan(&dismissed); err != nil || dismissed != 0 {
		t.Errorf("earlier dismissal not cleared: %d, %v", dismissed, err)
	}
	if v2StatusOffNoticeOf(t, newClient(t, restartRouter(t, db))) == nil {
		t.Error("armed notice lost on restart")
	}
}
