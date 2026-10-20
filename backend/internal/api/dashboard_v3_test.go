package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// v3Body returns the stored dashboard id as a plain JSON-decoded map (a deep
// copy), ready to edit and send as a v3 PUT.
func v3Body(t *testing.T, c *apiClient, id string) map[string]interface{} {
	t.Helper()
	v := getView(t, c)
	for _, d := range v["dashboards"].([]interface{}) {
		if dm := d.(map[string]interface{}); dm["id"] == id {
			b, _ := json.Marshal(dm)
			var out map[string]interface{}
			_ = json.Unmarshal(b, &out)
			return out
		}
	}
	t.Fatalf("dashboard %s not in GET /api/config", id)
	return nil
}

func v3Put(c *apiClient, id string, d map[string]interface{}, rev interface{}) (int, map[string]interface{}) {
	return c.do("PUT", "/api/dashboards/"+id, map[string]interface{}{"schema": 3, "dashboard": d, "revision": rev})
}

func tileJSON(id string, x, y int) map[string]interface{} {
	return map[string]interface{}{"id": id, "kind": "tile", "name": id, "url": "http://x",
		"placement": map[string]interface{}{"x": x, "y": y, "w": 1, "h": 1}}
}

func rootOf(d map[string]interface{}) map[string]interface{} {
	return d["tabs"].([]interface{})[0].(map[string]interface{})["root"].(map[string]interface{})
}

func TestV3Put_RoundTripKeepsSettingsAndBumpsRevision(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	// Give d1 a stored setting via the settings endpoint.
	if code, r := c.do("PUT", "/api/dashboards/d1/settings", map[string]interface{}{
		"overrides": map[string]interface{}{"statusChecksEnabled": false}, "revision": 1}); code != 200 {
		t.Fatalf("settings: %d %v", code, r)
	}
	d := v3Body(t, c, "d1")
	d["name"] = "Renamed"
	kids := rootOf(d)["children"].([]interface{})
	rootOf(d)["children"] = append(kids, tileJSON("tile-new", 5, 5))
	d["settings"] = map[string]interface{}{"statusChecksEnabled": true} // must be ignored
	n := backupCount(t, c)
	code, resp := v3Put(c, "d1", d, 2)
	if code != 200 || resp["revision"] != float64(3) {
		t.Fatalf("put: %d %v", code, resp)
	}
	if lay, _ := resp["layout"].(map[string]interface{}); lay == nil || lay["schemaVersion"] != float64(3) || layoutDashName(resp, "d1") != "Renamed" {
		t.Fatalf("response lacks the fresh layout: %v", resp)
	}
	if backupCount(t, c) != n+1 {
		t.Fatal("accepted save took no backup")
	}
	got := storedDashboards(storedDoc(t, db))["d1"]
	if got["name"] != "Renamed" || got["revision"] != float64(3) {
		t.Fatalf("stored: %v", got)
	}
	if s := got["settings"].(configdoc.Obj); s["statusChecksEnabled"] != false {
		t.Fatalf("body settings leaked / stored settings lost: %v", s)
	}
	if len(rootOf(map[string]interface{}{"tabs": got["tabs"]})["children"].([]interface{})) != len(kids)+1 {
		t.Fatal("tile not stored")
	}
}

func TestV3Put_Rejections(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	n := backupCount(t, c)
	before := storedRaw(db)
	base := func() map[string]interface{} { return v3Body(t, c, "d1") }
	many := func(count int) map[string]interface{} {
		d := base()
		kids := make([]interface{}, count)
		for i := range kids {
			kids[i] = tileJSON(fmt.Sprintf("m%d", i), 0, i)
		}
		rootOf(d)["children"] = kids
		return d
	}
	deep := func(depth int) map[string]interface{} {
		d := base()
		var node interface{} = tileJSON("leaf", 0, 0)
		for i := depth - 1; i >= 1; i-- {
			node = map[string]interface{}{"id": fmt.Sprintf("f%d", i), "kind": "folder", "name": "f", "display": "expanded",
				"placement": map[string]interface{}{"x": 0, "y": 0, "w": 1, "h": 1},
				"content":   map[string]interface{}{"columns": 1, "children": []interface{}{node}}}
		}
		rootOf(d)["children"] = []interface{}{node}
		return d
	}
	noPlacement := base()
	delete(rootOf(noPlacement)["children"].([]interface{})[0].(map[string]interface{}), "placement")
	badPath := base()
	badPath["path"] = "/a\\b"
	otherID := base()
	otherID["id"] = "zzz"
	cases := []struct {
		name string
		d    map[string]interface{}
		rev  interface{}
		url  string
		code int
		msg  string
	}{
		{"stale", base(), 7, "d1", 409, "conflict"},
		{"missing revision", base(), nil, "d1", 409, "conflict"},
		{"unknown", base(), 1, "nope", 404, ""},
		{"id mismatch", otherID, 1, "d1", 400, "does not match"},
		{"5001 nodes", many(5001), 1, "d1", 400, "5000"},
		{"depth 13", deep(13), 1, "d1", 400, "12"},
		{"no placement", noPlacement, 1, "d1", 400, "placement"},
		{"unsafe path", badPath, 1, "d1", 400, "path"},
	}
	for _, tc := range cases {
		code, resp := v3Put(c, tc.url, tc.d, tc.rev)
		if tc.url == "nope" {
			tc.d["id"] = "nope"
			code, resp = v3Put(c, "nope", tc.d, tc.rev)
		}
		if code != tc.code || !strings.Contains(fmt.Sprint(resp), tc.msg) {
			t.Errorf("%s: %d %v", tc.name, code, resp)
		}
	}
	if storedRaw(db) != before {
		t.Fatal("a rejected save changed the document")
	}
	if backupCount(t, c) != n {
		t.Fatal("a rejected save took a backup")
	}
	// An accepted 5000-node save passes the limit.
	if code, resp := v3Put(c, "d1", many(5000), 1); code != 200 {
		t.Fatalf("5000 nodes: %d %.200v", code, resp)
	}
}

func TestV3Put_DuplicateIDAcrossDashboards400(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db)
	d2 := v3Body(t, c, "d2")
	d2["path"] = "/d2"
	kids := rootOf(d2)["children"].([]interface{})
	rootOf(d2)["children"] = append(kids, tileJSON("e1", 6, 6)) // e1 belongs to d1
	before := storedRaw(db)
	code, resp := v3Put(c, "d2", d2, 1)
	if code != 400 || !strings.Contains(fmt.Sprint(resp), "duplicate id") {
		t.Fatalf("%d %v", code, resp)
	}
	if storedRaw(db) != before {
		t.Fatal("document changed")
	}
}

func TestV3Put_PathClash409AndSamePathOK(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db)
	d2 := v3Body(t, c, "d2")
	d2["path"] = "d1" // normalises onto /d1
	code, resp := v3Put(c, "d2", d2, 1)
	if code != 409 || resp["error"] != "path_taken" || resp["dashboardId"] != "d1" || resp["path"] != "d1" {
		t.Fatalf("v3 put clash: %d %v", code, resp)
	}
	d2["path"] = "/d2"
	if code, resp := v3Put(c, "d2", d2, 1); code != 200 {
		t.Fatalf("own path: %d %v", code, resp)
	}
}

func TestCreateDashboard(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	n := backupCount(t, c)
	code, resp := c.do("POST", "/api/dashboards", map[string]interface{}{"name": "Fresh", "path": "/fresh"})
	if code != 200 || resp["revision"] != float64(1) || resp["id"] == nil || resp["id"] == "" {
		t.Fatalf("create: %d %v", code, resp)
	}
	if backupCount(t, c) != n+1 {
		t.Fatal("create took no backup")
	}
	id := resp["id"].(string)
	d := storedDashboards(storedDoc(t, db))[id]
	if d == nil || d["name"] != "Fresh" || d["path"] != "/fresh" || d["defaultLayout"] != "grid" {
		t.Fatalf("stored: %v", d)
	}
	tabs := d["tabs"].([]any)
	tab := tabs[0].(configdoc.Obj)
	if len(tabs) != 1 || tab["name"] != "Home" || tab["layout"] != "inherit" {
		t.Fatalf("tabs: %v", tabs)
	}
	for _, v := range d["settings"].(configdoc.Obj) {
		if v != nil {
			t.Fatalf("settings not all-null: %v", d["settings"])
		}
	}
	// GET shows it.
	found := false
	for _, dd := range getView(t, c)["dashboards"].([]interface{}) {
		if dd.(map[string]interface{})["id"] == id {
			found = true
		}
	}
	if !found {
		t.Fatal("GET does not show the created dashboard")
	}
	// Clash (also after normalisation) -> 409 path_taken; nothing added, no backup.
	n = backupCount(t, c)
	for _, p := range []string{"/fresh", "fresh", "//d1"} {
		code, resp = c.do("POST", "/api/dashboards", map[string]interface{}{"name": "Dup", "path": p})
		if code != 409 || resp["error"] != "path_taken" || resp["dashboardId"] == "" || resp["dashboardId"] == nil ||
			storedDashboards(storedDoc(t, db))[resp["dashboardId"].(string)] == nil {
			t.Fatalf("clash %q: %d %v", p, code, resp)
		}
	}
	for _, bad := range []map[string]interface{}{
		{"name": "X", "path": "/a\\b"}, {"name": "X", "path": ""}, {"name": "", "path": "/ok"},
		{"name": strings.Repeat("n", 300), "path": "/ok"}, {"name": "X", "path": " /pad"},
	} {
		if code, resp = c.do("POST", "/api/dashboards", bad); code != 400 {
			t.Fatalf("bad create %v: %d %v", bad, code, resp)
		}
	}
	if backupCount(t, c) != n {
		t.Fatal("rejected creates took a backup")
	}
}

func TestOrderDashboards(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db)
	revBefore := storedDashboards(storedDoc(t, db))["d1"]["revision"]
	for _, bad := range [][]string{{"d1"}, {"d1", "d1"}, {"d1", "d2", "ghost"}, {"d2", "d2"}, {}} {
		if code, resp := c.do("PUT", "/api/dashboards/order", map[string]interface{}{"order": bad}); code != 400 {
			t.Fatalf("order %v: %d %v", bad, code, resp)
		}
	}
	code, resp := c.do("PUT", "/api/dashboards/order", map[string]interface{}{"order": []string{"d2", "d1"}})
	if code != 200 || resp["layout"] == nil {
		t.Fatalf("order: %d %v", code, resp)
	}
	s := storedDashboards(storedDoc(t, db))
	if s["d2"]["order"] != float64(0) || s["d1"]["order"] != float64(1) {
		t.Fatalf("orders: d1=%v d2=%v", s["d1"]["order"], s["d2"]["order"])
	}
	if s["d1"]["revision"] != revBefore {
		t.Fatal("order bumped a content revision")
	}
}

func transferBody(m map[string]interface{}) map[string]interface{} {
	b := map[string]interface{}{"mode": "copy", "sourceId": "d1", "sourceRevision": 1,
		"nodeIds": []string{"e1"}, "targetId": "d2", "targetRevision": 1,
		"target": map[string]interface{}{"tabId": "t2"}}
	for k, v := range m {
		b[k] = v
	}
	return b
}

func TestTransfer(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db) // d2 has tab t2 (legacyDashWithID)
	tabID := func() string {
		return v3Body(t, c, "d2")["tabs"].([]interface{})[0].(map[string]interface{})["id"].(string)
	}()
	target := map[string]interface{}{"tabId": tabID}

	// Copy: new ids, both... only the target bumps; source untouched.
	code, resp := c.do("POST", "/api/dashboards/transfer", transferBody(map[string]interface{}{"target": target}))
	if code != 200 || resp["sourceRevision"] != float64(1) || resp["targetRevision"] != float64(2) || resp["layout"] == nil {
		t.Fatalf("copy: %d %.300v", code, resp)
	}
	doc := storedDoc(t, db)
	if err := configdoc.VerifyIDs(doc); err != nil {
		t.Fatal(err)
	}
	var copies []configdoc.Obj
	configdoc.Walk(doc, func(d, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		if d["id"] == "d2" && n["kind"] == "tile" && n["name"] == "Example" {
			copies = append(copies, n)
		}
		return true
	})
	found := false
	for _, n := range copies {
		id := n["id"].(string)
		if id != "e1" && strings.HasPrefix(id, "tile-") && len(id) == len("tile-")+36 {
			found = true
		}
	}
	if !found {
		t.Fatalf("no uuid-id copy in d2: %v", copies)
	}
	if storedDashboards(doc)["d1"]["revision"] != float64(1) {
		t.Fatal("copy bumped the source")
	}
	if storedRaw(db) == "" || len(findNode(storedDashboards(doc)["d1"], "e1")) == 0 {
		t.Fatal("copy removed the original")
	}

	// Move with a stale target revision: 409, neither changed, no backup.
	before := storedRaw(db)
	n := backupCount(t, c)
	code, resp = c.do("POST", "/api/dashboards/transfer", transferBody(map[string]interface{}{
		"mode": "move", "target": target, "targetRevision": 1})) // target is now 2
	if code != 409 {
		t.Fatalf("stale move: %d %v", code, resp)
	}
	if storedRaw(db) != before || backupCount(t, c) != n {
		t.Fatal("stale move wrote or took a backup")
	}

	// Move with good revisions: removed from source, both bumped, id kept.
	code, resp = c.do("POST", "/api/dashboards/transfer", transferBody(map[string]interface{}{
		"mode": "move", "target": target, "targetRevision": 2}))
	if code != 200 || resp["sourceRevision"] != float64(2) || resp["targetRevision"] != float64(3) {
		t.Fatalf("move: %d %v", code, resp)
	}
	s := storedDashboards(storedDoc(t, db))
	if len(findNode(s["d1"], "e1")) != 0 || len(findNode(s["d2"], "e1")) == 0 {
		t.Fatal("move did not relocate e1")
	}

	// Rejections (current revisions: d1 is at 2, d2 at 3).
	cur := map[string]interface{}{"sourceRevision": 2, "targetRevision": 3}
	for name, b := range map[string]map[string]interface{}{
		"same dashboard": transferBody(merge(cur, map[string]interface{}{"targetId": "d1", "target": target})),
		"bad mode":       transferBody(merge(cur, map[string]interface{}{"mode": "teleport", "target": target})),
		"no nodes":       transferBody(merge(cur, map[string]interface{}{"nodeIds": []string{}, "target": target})),
		"unknown node":   transferBody(merge(cur, map[string]interface{}{"nodeIds": []string{"ghost"}, "target": target})),
		"unknown tab":    transferBody(merge(cur, map[string]interface{}{"target": map[string]interface{}{"tabId": "ghost"}})),
		"unknown folder": transferBody(merge(cur, map[string]interface{}{"target": map[string]interface{}{"tabId": tabID, "folderId": "ghost"}})),
		"dup node ids":   transferBody(merge(cur, map[string]interface{}{"nodeIds": []string{"e1", "e1"}, "target": target})),
	} {
		if code, resp := c.do("POST", "/api/dashboards/transfer", b); code != 400 {
			t.Errorf("%s: %d %v, want 400", name, code, resp)
		}
	}
	if code, _ := c.do("POST", "/api/dashboards/transfer", transferBody(merge(cur, map[string]interface{}{"targetId": "ghost", "target": target}))); code != 404 {
		t.Errorf("unknown target dashboard: %d", code)
	}
}

// findNode lists the nodes with id in dashboard d.
func findNode(d configdoc.Obj, id string) []configdoc.Obj {
	var out []configdoc.Obj
	configdoc.Walk(configdoc.Obj{"dashboards": []any{d}}, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		if n["id"] == id {
			out = append(out, n)
		}
		return true
	})
	return out
}

func TestTransfer_CopyFolderGetsFreshIDsForDescendants(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db)
	// Put a folder with a tile into d1 via a v3 save.
	d := v3Body(t, c, "d1")
	rootOf(d)["children"] = append(rootOf(d)["children"].([]interface{}), map[string]interface{}{
		"id": "fold1", "kind": "folder", "name": "F", "display": "expanded",
		"placement": map[string]interface{}{"x": 0, "y": 9, "w": 2, "h": 2},
		"content":   map[string]interface{}{"columns": 2, "children": []interface{}{tileJSON("inner1", 0, 0)}}})
	if code, r := v3Put(c, "d1", d, 1); code != 200 {
		t.Fatalf("%d %v", code, r)
	}
	tabID := v3Body(t, c, "d2")["tabs"].([]interface{})[0].(map[string]interface{})["id"]
	code, resp := c.do("POST", "/api/dashboards/transfer", transferBody(map[string]interface{}{
		"sourceRevision": 2, "nodeIds": []string{"fold1"}, "target": map[string]interface{}{"tabId": tabID}}))
	if code != 200 {
		t.Fatalf("%d %v", code, resp)
	}
	doc := storedDoc(t, db)
	if err := configdoc.VerifyIDs(doc); err != nil {
		t.Fatal(err)
	}
	if len(findNode(storedDashboards(doc)["d2"], "fold1")) != 0 || len(findNode(storedDashboards(doc)["d2"], "inner1")) != 0 {
		t.Fatal("copy reused ids")
	}
	folders := 0
	configdoc.Walk(configdoc.Obj{"dashboards": []any{storedDashboards(doc)["d2"]}}, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		if n["kind"] == "folder" && strings.HasPrefix(n["id"].(string), "folder-") {
			folders++
		}
		return true
	})
	if folders != 1 {
		t.Fatalf("folder copies: %d", folders)
	}
}

// Route classification: every new route is protected (auth + CSRF) and the
// literal segments order/transfer are not mistaken for dashboard ids.
func TestV3Routes_AuthCSRFAndDispatch(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	routes := []struct{ method, path, body string }{
		{"PUT", "/api/dashboards/d1", `{"schema":3,"dashboard":{},"revision":1}`},
		{"POST", "/api/dashboards", `{"name":"a","path":"/a"}`},
		{"PUT", "/api/dashboards/order", `{"order":["d1"]}`},
		{"POST", "/api/dashboards/transfer", `{}`},
	}
	for _, rt := range routes {
		// No auth at all -> 401.
		req := httptest.NewRequest(rt.method, rt.path, strings.NewReader(rt.body))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without auth: %d", rt.method, rt.path, w.Code)
		}
		// Auth but no CSRF -> 403.
		req = httptest.NewRequest(rt.method, rt.path, strings.NewReader(rt.body))
		req.Header.Set("Authorization", "Bearer "+c.token)
		w = httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusForbidden {
			t.Errorf("%s %s without CSRF: %d", rt.method, rt.path, w.Code)
		}
	}
	// order/transfer reach their own handlers, not the {id} handler.
	code, resp := c.do("PUT", "/api/dashboards/order", map[string]interface{}{"order": []string{}})
	if code != 400 || strings.Contains(fmt.Sprint(resp), "Dashboard not found") {
		t.Errorf("order dispatched as id: %d %v", code, resp)
	}
	if code, _ := c.do("GET", "/api/dashboards/order", nil); code != 405 {
		t.Errorf("GET order: %d", code)
	}
	if code, _ := c.do("PUT", "/api/dashboards/transfer", nil); code != 405 {
		t.Errorf("PUT transfer: %d", code)
	}
	if code, _ := c.do("DELETE", "/api/dashboards/order?revision=1", nil); code != 405 {
		t.Errorf("DELETE order: %d", code)
	}
	if code, _ := c.do("GET", "/api/dashboards", nil); code != 405 {
		t.Errorf("GET /api/dashboards: %d", code)
	}
}

func TestV3Routes_MigrationFailed503(t *testing.T) {
	router, _ := setupTestRouterWithMigration(t, &configdoc.MigrationResult{Failed: true, Detail: "boom"})
	c := newClient(t, router)
	for _, rt := range []struct{ method, path string }{
		{"POST", "/api/dashboards"}, {"PUT", "/api/dashboards/order"}, {"POST", "/api/dashboards/transfer"},
	} {
		if code, _ := c.do(rt.method, rt.path, map[string]interface{}{}); code != 503 {
			t.Errorf("%s %s: %d", rt.method, rt.path, code)
		}
	}
}

func merge(a, b map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		out[k] = v
	}
	return out
}

// ---- fix round 1 ----

func TestReservedIDs_ImportRenames(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	imp := []byte(`{"dashboards":[{"id":"order","name":"O","path":"/o","order":0,"tabs":[{"id":"t9","name":"T","order":0,
	  "groups":[{"id":"g9","name":"G","order":0,"entries":[{"id":"e9","name":"A","url":"https://a","order":0}]}]}]},
	  {"id":"transfer","name":"T","path":"/t","order":1,"tabs":[]}]}`)
	if code, resp := c.importFile(imp); code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	all := storedDashboards(storedDoc(t, db))
	if all["order"] != nil || all["transfer"] != nil {
		t.Fatalf("reserved ids stored: %v", all)
	}
	names := map[string]bool{}
	for _, d := range all {
		names[fmt.Sprint(d["name"])] = true
	}
	if !names["O"] || !names["T"] {
		t.Fatalf("imported dashboards missing: %v", names)
	}
}

func TestReservedIDs_MigrationRenamesWithNotice(t *testing.T) {
	v2 := `{"dashboards":[{"id":"order","name":"Ord","path":"/ord","order":0,"tabs":[]},
	  {"id":"keep","name":"Keep","path":"/keep","order":1,"tabs":[]}]}`
	router, db := setupTestRouterSeeded(t, v2)
	c := newClient(t, router)
	all := storedDashboards(storedDoc(t, db))
	if all["order"] != nil || all["order-2"] == nil || all["keep"] == nil {
		t.Fatalf("ids after migration: %v", all)
	}
	n := notices(t, getView(t, c))
	if len(n) != 1 || !strings.Contains(n[0], `"order"`) || !strings.Contains(n[0], "reserved") {
		t.Fatalf("notices: %q", n)
	}
	// And the dashboard is reachable for editing.
	if code, resp := c.do("GET", "/api/dashboards/order-2/settings", nil); code != 200 {
		t.Fatalf("%d %v", code, resp)
	}
}

// Pathological container: many small tiles, then big tiles covering the early
// cells last in child order, then a large grid transfer. Must stay fast.
func TestTransfer_PathologicalContainerIsBounded(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db)
	d := v3Body(t, c, "d1")
	kids := []interface{}{}
	for i := 0; i < 2500; i++ { // source: 2500 tiles to transfer
		kids = append(kids, tileJSON(fmt.Sprintf("s%d", i), i%12, i/12))
	}
	rootOf(d)["children"] = kids
	if code, r := v3Put(c, "d1", d, 1); code != 200 {
		t.Fatalf("%d %.200v", code, r)
	}
	d2 := v3Body(t, c, "d2")
	tk := []interface{}{}
	for i := 0; i < 2400; i++ { // full block of cells far down first-fit scans past
		tk = append(tk, tileJSON(fmt.Sprintf("u%d", i), i%12, i/12))
	}
	// huge covering tiles last in child order
	tk = append(tk, map[string]interface{}{"id": "cover", "kind": "tile", "name": "c", "url": "http://c",
		"placement": map[string]interface{}{"x": 0, "y": 0, "w": 12, "h": 1e9}})
	rootOf(d2)["children"] = tk
	if code, r := v3Put(c, "d2", d2, 1); code != 200 {
		t.Fatalf("%d %.200v", code, r)
	}
	ids := make([]string, 2500)
	for i := range ids {
		ids[i] = fmt.Sprintf("s%d", i)
	}
	tabID := v3Body(t, c, "d2")["tabs"].([]interface{})[0].(map[string]interface{})["id"]
	start := time.Now()
	code, resp := c.do("POST", "/api/dashboards/transfer", transferBody(map[string]interface{}{
		"sourceRevision": 2, "targetRevision": 2, "nodeIds": ids, "target": map[string]interface{}{"tabId": tabID}}))
	if code != 200 && code != 400 { // 400 only if the 5000-node bound trips
		t.Fatalf("%d %.200v", code, resp)
	}
	if el := time.Since(start); el > 3*time.Second {
		t.Fatalf("transfer took %v", el)
	}
}

func TestFreeSpace_BudgetFallsBackBelowEverything(t *testing.T) {
	kids := []any{}
	for i := 0; i < 100; i++ {
		kids = append(kids, tileJSON(fmt.Sprintf("k%d", i), i%12, i/12))
	}
	c := configdoc.Obj{"columns": 12, "children": kids}
	fs := newFreeSpace(c, 10) // starved
	bottom := fs.bottom
	cell := fs.place(configdoc.Obj{"w": 1, "h": 1}, "grid")
	if cell["y"].(float64) < bottom {
		t.Fatalf("starved placement overlaps: %v (bottom %v)", cell, bottom)
	}
}

func TestTransfer_GridPlacementClampsSize(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db)
	d := v3Body(t, c, "d1")
	rootOf(d)["children"] = []interface{}{
		map[string]interface{}{"id": "odd1", "kind": "tile", "name": "a", "url": "http://a",
			"placement": map[string]interface{}{"x": 0, "y": 0, "w": 1.7, "h": 0.4}},
		map[string]interface{}{"id": "odd2", "kind": "tile", "name": "b", "url": "http://b",
			"placement": map[string]interface{}{"x": 2, "y": 0, "w": -4, "h": -3, "z": 5}},
		map[string]interface{}{"id": "odd3", "kind": "tile", "name": "c", "url": "http://c",
			"placement": map[string]interface{}{"x": 4, "y": 0, "w": 2, "h": 2.9}},
	}
	if code, r := v3Put(c, "d1", d, 1); code != 200 {
		t.Fatalf("%d %v", code, r)
	}
	tabID := v3Body(t, c, "d2")["tabs"].([]interface{})[0].(map[string]interface{})["id"]
	code, resp := c.do("POST", "/api/dashboards/transfer", transferBody(map[string]interface{}{
		"mode": "move", "sourceRevision": 2, "nodeIds": []string{"odd1", "odd2", "odd3"},
		"target": map[string]interface{}{"tabId": tabID}}))
	if code != 200 {
		t.Fatalf("%d %v", code, resp)
	}
	want := map[string][4]float64{"odd1": {1, 1}, "odd2": {1, 1}, "odd3": {2, 2}}
	for id, wh := range want {
		n := findNode(storedDashboards(storedDoc(t, db))["d2"], id)[0]["placement"].(configdoc.Obj)
		if n["w"] != wh[0] || n["h"] != wh[1] {
			t.Errorf("%s placement %v, want w=%v h=%v", id, n, wh[0], wh[1])
		}
	}
	if z := findNode(storedDashboards(storedDoc(t, db))["d2"], "odd2")[0]["placement"].(configdoc.Obj)["z"]; z != float64(5) {
		t.Errorf("z lost: %v", z)
	}
}

func TestV3Put_ClashChecksOnlyWhenPathChanged(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db)
	// Force a pre-existing clash directly in the store.
	doc := storedDoc(t, db)
	storedDashboards(doc)["d2"]["path"] = "/d1"
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
	d2 := v3Body(t, c, "d2")
	d2["name"] = "Renamed only"
	if code, resp := v3Put(c, "d2", d2, 1); code != 200 {
		t.Fatalf("unchanged clashing path blocked an unrelated save: %d %v", code, resp)
	}
}

func TestV3Put_StripsTransientKeysKeepsOthers(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	d := v3Body(t, c, "d1")
	for _, k := range []string{"schemaVersion", "layout", "migrationNotices"} {
		d[k] = "junk"
	}
	d["customKey"] = "keep me"
	if code, resp := v3Put(c, "d1", d, 1); code != 200 {
		t.Fatalf("%d %v", code, resp)
	}
	got := storedDashboards(storedDoc(t, db))["d1"]
	for _, k := range []string{"schemaVersion", "layout", "migrationNotices"} {
		if _, has := got[k]; has {
			t.Errorf("transient key %s stored", k)
		}
	}
	if got["customKey"] != "keep me" {
		t.Error("ordinary key dropped")
	}
}

func TestV3Put_TabLimit(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	d := v3Body(t, c, "d1")
	tabs := []interface{}{}
	for i := 0; i < 201; i++ {
		tabs = append(tabs, map[string]interface{}{"id": fmt.Sprintf("tab%d", i), "name": "T",
			"root": map[string]interface{}{"columns": 12, "children": []interface{}{}}})
	}
	d["tabs"] = tabs
	code, resp := v3Put(c, "d1", d, 1)
	if code != 400 || !strings.Contains(fmt.Sprint(resp), "200") {
		t.Fatalf("%d %v", code, resp)
	}
	d["tabs"] = tabs[:200]
	if code, resp := v3Put(c, "d1", d, 1); code != 200 {
		t.Fatalf("200 tabs: %d %.200v", code, resp)
	}
}

func TestV3Put_RootPathRefused(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	for _, p := range []string{"/", "//", ""} {
		d := v3Body(t, c, "d1")
		d["path"] = p
		if code, resp := v3Put(c, "d1", d, 1); code != 400 {
			t.Errorf("path %q: %d %v", p, code, resp)
		}
	}
}

func TestV3Routes_OversizedBody413(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	before := storedRaw(db)
	big := strings.Repeat("a", 2<<20) // over the 1 MiB small-body cap
	if code, _ := c.do("POST", "/api/dashboards", map[string]interface{}{"name": big, "path": "/x"}); code != 413 {
		t.Errorf("create: %d", code)
	}
	if code, _ := c.do("PUT", "/api/dashboards/order", map[string]interface{}{"order": []string{big}}); code != 413 {
		t.Errorf("order: %d", code)
	}
	huge := strings.Repeat("a", 17<<20)
	if code, _ := c.do("PUT", "/api/dashboards/d1", map[string]interface{}{"schema": 3, "revision": 1,
		"dashboard": map[string]interface{}{"id": "d1", "pad": huge}}); code != 413 {
		t.Errorf("put: %d", code)
	}
	if code, _ := c.do("POST", "/api/dashboards/transfer", map[string]interface{}{"mode": huge}); code != 413 {
		t.Errorf("transfer: %d", code)
	}
	if storedRaw(db) != before {
		t.Fatal("oversized request changed the document")
	}
}
