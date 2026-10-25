package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// Settings › Icons: where each uploaded icon is used, deleting an icon in use,
// category management with reassignment, and the admin-only boundary.

// iconDoc stores a v3 layout that uses /icons/a.png on a tile on two
// dashboards, a folder and a tab, and /icons/b.png on one nested tile.
func iconDoc(t *testing.T, db *sql.DB) {
	t.Helper()
	tile := func(id, name, iconURL string, x int) map[string]any {
		n := map[string]any{"id": id, "kind": "tile", "name": name, "url": "http://x", "size": "small",
			"placement": map[string]any{"x": float64(x), "y": 0.0, "w": 1.0, "h": 1.0}}
		if iconURL != "" {
			n["iconUrl"] = iconURL
		}
		return n
	}
	nested := tile("t-nested", "Nested <b>tile</b>", "/icons/b.png", 0)
	delete(nested, "placement")
	folder := map[string]any{"id": "f1", "kind": "folder", "name": "Media folder", "iconUrl": "/icons/a.png",
		"display": "expanded", "placement": map[string]any{"x": 4.0, "y": 0.0, "w": 4.0, "h": 4.0},
		"content": map[string]any{"children": []any{nested}}}
	doc := configdoc.Obj{
		"schemaVersion": 3.0,
		"layoutVersion": float64(configdoc.LayoutVersion),
		"dashboards": []any{
			map[string]any{"id": "d1", "name": "Home", "path": "/home", "revision": 1.0, "tabs": []any{
				map[string]any{"id": "tab1", "name": "Main", "iconUrl": "/icons/a.png", "root": map[string]any{"columns": 24.0,
					"children": []any{tile("t1", "Plex", "/icons/a.png", 0), tile("t2", "Jellyfin", "/icons/a.png", 1), folder}}},
			}},
			map[string]any{"id": "d2", "name": "Media", "path": "/media", "revision": 1.0, "tabs": []any{
				map[string]any{"id": "tab2", "name": "Tab", "root": map[string]any{"columns": 24.0,
					"children": []any{tile("t3", "Emby", "/icons/a.png", 0), tile("t4", "Other", "", 1)}}},
			}},
		},
	}
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
}

func seedIconRows(t *testing.T, db *sql.DB) {
	t.Helper()
	for _, q := range []string{
		`INSERT OR IGNORE INTO icon_categories (id, name, icon, order_num, is_preset) VALUES ('containers','Containers','mdi:docker',0,1)`,
		`INSERT INTO icon_categories (id, name, icon, order_num, is_preset) VALUES ('mine','Mine','mdi:folder',1,0)`,
		`INSERT INTO icon_categories (id, name, icon, order_num, is_preset) VALUES ('other','Other','mdi:folder',2,0)`,
		`INSERT INTO icons (id, name, icon, category_id, image_url, is_preset) VALUES ('ia','Icon A','','mine','/icons/a.png',0)`,
		`INSERT INTO icons (id, name, icon, category_id, image_url, is_preset) VALUES ('ib','Icon B','','mine','/icons/b.png',0)`,
		`INSERT INTO icons (id, name, icon, category_id, image_url, is_preset) VALUES ('ic','Icon C','','containers','/icons/c.png',0)`,
		`INSERT INTO icons (id, name, icon, category_id, image_url, is_preset) VALUES ('preset1','Docker','','containers','/api/icons/dashboard/docker.svg',1)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
}

type usageResp struct {
	FetchedAt string                      `json:"fetchedAt"`
	Icons     map[string][]map[string]any `json:"icons"`
}

func getUsage(t *testing.T, c *apiClient) (int, usageResp) {
	t.Helper()
	w := c.rawReq("GET", "/api/icons/usage", nil, "")
	var out usageResp
	if w.Code == 200 {
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v %s", err, w.Body.String())
		}
	}
	return w.Code, out
}

func TestIconUsageListsEveryPlaceByName(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seedIconRows(t, db)
	iconDoc(t, db)

	code, u := getUsage(t, c)
	if code != 200 {
		t.Fatalf("status %d", code)
	}
	if u.FetchedAt == "" {
		t.Error("fetchedAt missing")
	}
	a := u.Icons["ia"]
	kinds := map[string]int{}
	for _, use := range a {
		kinds[use["kind"].(string)]++
	}
	if kinds["tile"] != 3 || kinds["folder"] != 1 || kinds["tab"] != 1 || len(a) != 5 {
		t.Fatalf("usage of ia: %v", a)
	}
	var sawEmby bool
	for _, use := range a {
		if use["name"] == "Emby" {
			sawEmby = true
			if use["dashboard"] != "Media" || use["dashboardId"] != "d2" || use["tab"] != "Tab" {
				t.Errorf("Emby use: %v", use)
			}
		}
	}
	if !sawEmby {
		t.Error("Emby tile not listed")
	}
	b := u.Icons["ib"]
	if len(b) != 1 || b[0]["name"] != "Nested <b>tile</b>" || b[0]["folder"] != "Media folder" {
		t.Fatalf("usage of ib (nested in a folder): %v", b)
	}
	if got := u.Icons["ic"]; len(got) != 0 {
		t.Errorf("ic is unused: %v", got)
	}
	if _, ok := u.Icons["ic"]; !ok {
		t.Error("an unused uploaded icon is listed with an empty list")
	}
	if _, ok := u.Icons["preset1"]; ok {
		t.Error("built-in icons are not part of the uploads usage")
	}
}

func TestIconUsageUnreadableLayoutIsAnError(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seedIconRows(t, db)
	if _, err := db.Exec(`UPDATE config SET data = '{not json' WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
	if code, _ := getUsage(t, c); code != http.StatusInternalServerError {
		t.Fatalf("unreadable layout: %d, want 500 (never an empty 'unused')", code)
	}
	// A delete cannot check either, so it is refused rather than guessed.
	if code, _ := c.do("DELETE", "/api/icons/ic", nil); code != http.StatusInternalServerError {
		t.Fatalf("delete with unreadable layout: %d", code)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM icons WHERE id='ic'`).Scan(&n)
	if n != 1 {
		t.Fatal("icon deleted although usage could not be checked")
	}
}

func TestDeleteIconInUseIsRefusedWithThePlaces(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seedIconRows(t, db)
	iconDoc(t, db)

	code, body := c.do("DELETE", "/api/icons/ia", nil)
	if code != http.StatusConflict {
		t.Fatalf("delete in use: %d %v", code, body)
	}
	uses, _ := body["usage"].([]any)
	if len(uses) != 5 {
		t.Fatalf("409 lists the places: %v", body)
	}
	if msg, _ := body["error"].(string); !strings.Contains(msg, "in use") {
		t.Errorf("error message: %q", msg)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM icons WHERE id='ia'`).Scan(&n)
	if n != 1 {
		t.Fatal("refused delete removed the icon")
	}

	// Confirmed: force=1 deletes it.
	if code, body := c.do("DELETE", "/api/icons/ia?force=1", nil); code != 200 {
		t.Fatalf("forced delete: %d %v", code, body)
	}
	db.QueryRow(`SELECT COUNT(*) FROM icons WHERE id='ia'`).Scan(&n)
	if n != 0 {
		t.Fatal("forced delete kept the icon")
	}
}

func TestDeleteUnusedIconAndErrors(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seedIconRows(t, db)
	iconDoc(t, db)

	if code, body := c.do("DELETE", "/api/icons/ic", nil); code != 200 {
		t.Fatalf("delete unused: %d %v", code, body)
	}
	if code, _ := c.do("DELETE", "/api/icons/ic", nil); code != http.StatusNotFound {
		t.Errorf("delete missing: %d, want 404", code)
	}
	if code, _ := c.do("DELETE", "/api/icons/preset1", nil); code != http.StatusBadRequest {
		t.Errorf("delete built-in: %d, want 400 (never a silent success)", code)
	}
}

func pngBytes(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	img.Set(1, 1, color.RGBA{255, 0, 0, 255})
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func uploadIconForm(t *testing.T, c *apiClient, filename string, data []byte, fields map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		_ = mw.WriteField(k, v)
	}
	h := make(map[string][]string)
	h["Content-Disposition"] = []string{`form-data; name="file"; filename="` + filename + `"`}
	h["Content-Type"] = []string{"image/png"}
	fw, err := mw.CreatePart(h)
	if err != nil {
		t.Fatal(err)
	}
	fw.Write(data)
	mw.Close()
	return c.rawReq("POST", "/api/icons/upload", buf.Bytes(), mw.FormDataContentType())
}

func TestUploadRegistersTheIconInOneStep(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seedIconRows(t, db)

	w := uploadIconForm(t, c, "my-server.png", pngBytes(t), map[string]string{"name": "My server", "categoryId": "mine"})
	if w.Code != 200 {
		t.Fatalf("upload: %d %s", w.Code, w.Body.String())
	}
	var r map[string]any
	json.Unmarshal(w.Body.Bytes(), &r)
	id, _ := r["id"].(string)
	var name, cat, img string
	var preset bool
	if err := db.QueryRow(`SELECT name, category_id, image_url, is_preset FROM icons WHERE id=?`, id).Scan(&name, &cat, &img, &preset); err != nil {
		t.Fatalf("registered row: %v", err)
	}
	if name != "My server" || cat != "mine" || img != r["url"] || preset {
		t.Errorf("row: %q %q %q %v (resp %v)", name, cat, img, preset, r)
	}
	// The file is served.
	req := httptest.NewRequest("GET", img, nil)
	rw := httptest.NewRecorder()
	router.ServeHTTP(rw, req)
	if rw.Code != 200 {
		t.Fatalf("GET %s: %d", img, rw.Code)
	}

	// Deleting the (unused) icon removes the file too.
	if code, body := c.do("DELETE", "/api/icons/"+id, nil); code != 200 {
		t.Fatalf("delete: %d %v", code, body)
	}
	rw = httptest.NewRecorder()
	router.ServeHTTP(rw, httptest.NewRequest("GET", img, nil))
	if rw.Code != http.StatusNotFound {
		t.Errorf("file still served after delete: %d", rw.Code)
	}
}

func TestUploadRefusesAnUnknownCategoryAndBadName(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seedIconRows(t, db)
	if w := uploadIconForm(t, c, "x.png", pngBytes(t), map[string]string{"categoryId": "nope"}); w.Code != http.StatusBadRequest {
		t.Errorf("unknown category: %d %s", w.Code, w.Body.String())
	}
	if w := uploadIconForm(t, c, "x.png", pngBytes(t), map[string]string{"categoryId": "mine", "name": strings.Repeat("n", 101)}); w.Code != http.StatusBadRequest {
		t.Errorf("long name: %d", w.Code)
	}
	// Name defaults to the file name.
	w := uploadIconForm(t, c, "plex_server.png", pngBytes(t), map[string]string{"categoryId": "mine"})
	if w.Code != 200 {
		t.Fatalf("upload: %d %s", w.Code, w.Body.String())
	}
	var r map[string]any
	json.Unmarshal(w.Body.Bytes(), &r)
	if r["name"] != "plex_server" {
		t.Errorf("default name: %v", r["name"])
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM icons WHERE is_preset=0`).Scan(&n)
	if n != 4 {
		t.Errorf("refused uploads must not register rows: %d user icons", n)
	}
}

func TestUpdateIconRenameAndRecategorise(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seedIconRows(t, db)

	if code, b := c.do("PUT", "/api/icons/ia", map[string]any{"name": "  Renamed  "}); code != 200 {
		t.Fatalf("rename: %d %v", code, b)
	}
	var name, cat, img string
	db.QueryRow(`SELECT name, category_id, image_url FROM icons WHERE id='ia'`).Scan(&name, &cat, &img)
	if name != "Renamed" || cat != "mine" || img != "/icons/a.png" {
		t.Fatalf("after rename: %q %q %q (other fields kept)", name, cat, img)
	}
	if code, b := c.do("PUT", "/api/icons/ia", map[string]any{"categoryId": "other"}); code != 200 {
		t.Fatalf("recategorise: %d %v", code, b)
	}
	db.QueryRow(`SELECT name, category_id FROM icons WHERE id='ia'`).Scan(&name, &cat)
	if name != "Renamed" || cat != "other" {
		t.Fatalf("after recategorise: %q %q", name, cat)
	}
	for _, tc := range []struct {
		body map[string]any
		want int
	}{
		{map[string]any{"name": "   "}, 400},
		{map[string]any{"name": strings.Repeat("x", 101)}, 400},
		{map[string]any{"categoryId": "nope"}, 400},
	} {
		if code, _ := c.do("PUT", "/api/icons/ia", tc.body); code != tc.want {
			t.Errorf("%v: %d, want %d", tc.body, code, tc.want)
		}
	}
	if code, _ := c.do("PUT", "/api/icons/missing", map[string]any{"name": "x"}); code != http.StatusNotFound {
		t.Errorf("missing icon: %d", code)
	}
}

func TestCategoryCreateRenameValidation(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seedIconRows(t, db)

	if code, b := c.do("POST", "/api/icon-categories", map[string]any{"id": "new1", "name": "Fresh", "icon": "mdi:folder", "order": 5}); code != 200 {
		t.Fatalf("create: %d %v", code, b)
	}
	if code, _ := c.do("POST", "/api/icon-categories", map[string]any{"id": "new2", "name": "fresh", "icon": "mdi:folder"}); code != http.StatusConflict {
		t.Errorf("duplicate name: %d, want 409", code)
	}
	if code, _ := c.do("POST", "/api/icon-categories", map[string]any{"id": "new1", "name": "Another", "icon": "mdi:folder"}); code != http.StatusConflict {
		t.Errorf("duplicate id: %d, want 409", code)
	}
	if code, b := c.do("PUT", "/api/icon-categories/new1", map[string]any{"name": "Fresher"}); code != 200 {
		t.Fatalf("rename: %d %v", code, b)
	}
	var name, icon string
	var order int
	db.QueryRow(`SELECT name, icon, order_num FROM icon_categories WHERE id='new1'`).Scan(&name, &icon, &order)
	if name != "Fresher" || icon != "mdi:folder" || order != 5 {
		t.Errorf("after rename: %q %q %d (icon/order kept)", name, icon, order)
	}
	if code, _ := c.do("PUT", "/api/icon-categories/new1", map[string]any{"name": "Mine"}); code != http.StatusConflict {
		t.Errorf("rename to an existing name: %d", code)
	}
	if code, _ := c.do("PUT", "/api/icon-categories/new1", map[string]any{"name": ""}); code != http.StatusBadRequest {
		t.Errorf("empty name: %d", code)
	}
	if code, _ := c.do("PUT", "/api/icon-categories/containers", map[string]any{"name": "Boxes"}); code != http.StatusBadRequest {
		t.Errorf("rename built-in: %d", code)
	}
	if code, _ := c.do("PUT", "/api/icon-categories/missing", map[string]any{"name": "Zed"}); code != http.StatusNotFound {
		t.Errorf("rename missing: %d", code)
	}
}

func TestCategoryDeleteWithReassignment(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seedIconRows(t, db)

	// Non-empty without a destination: refused, nothing changes.
	code, b := c.do("DELETE", "/api/icon-categories/mine", nil)
	if code != http.StatusConflict || b["iconCount"] != float64(2) {
		t.Fatalf("non-empty delete: %d %v", code, b)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM icons WHERE category_id='mine'`).Scan(&n)
	if n != 2 {
		t.Fatal("icons lost")
	}
	for _, bad := range []string{"mine", "nope"} {
		if code, _ := c.do("DELETE", "/api/icon-categories/mine?moveTo="+url.QueryEscape(bad), nil); code != http.StatusBadRequest {
			t.Errorf("moveTo=%s: %d", bad, code)
		}
	}
	// With a destination: icons move, the category goes.
	if code, b := c.do("DELETE", "/api/icon-categories/mine?moveTo=containers", nil); code != 200 || b["moved"] != float64(2) {
		t.Fatalf("delete with moveTo: %d %v", code, b)
	}
	db.QueryRow(`SELECT COUNT(*) FROM icons WHERE id IN ('ia','ib') AND category_id='containers'`).Scan(&n)
	if n != 2 {
		t.Fatalf("icons moved: %d", n)
	}
	db.QueryRow(`SELECT COUNT(*) FROM icon_categories WHERE id='mine'`).Scan(&n)
	if n != 0 {
		t.Fatal("category kept")
	}
	// Empty: plain delete. Built-in: refused. Missing: 404.
	if code, b := c.do("DELETE", "/api/icon-categories/other", nil); code != 200 {
		t.Fatalf("empty delete: %d %v", code, b)
	}
	if code, _ := c.do("DELETE", "/api/icon-categories/containers?moveTo=other", nil); code != http.StatusBadRequest {
		t.Errorf("built-in delete: %d", code)
	}
	if code, _ := c.do("DELETE", "/api/icon-categories/missing", nil); code != http.StatusNotFound {
		t.Errorf("missing delete: %d", code)
	}
}

func TestIconManagementRequiresAuthAndCSRF(t *testing.T) {
	router, db := setupTestRouter(t)
	seedIconRows(t, db)
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/icons/usage"},
		{"PUT", "/api/icons/ia"},
		{"DELETE", "/api/icons/ia"},
		{"POST", "/api/icons/upload"},
		{"POST", "/api/icon-categories"},
		{"PUT", "/api/icon-categories/mine"},
		{"DELETE", "/api/icon-categories/mine"},
	} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, strings.NewReader(`{"name":"x"}`)))
		if w.Code != http.StatusUnauthorized {
			t.Errorf("anonymous %s %s: %d", tc.method, tc.path, w.Code)
		}
	}
	// Signed in but no CSRF header: writes are refused.
	c := newClient(t, router)
	for _, tc := range []struct{ method, path string }{
		{"PUT", "/api/icons/ia"},
		{"DELETE", "/api/icons/ia"},
		{"DELETE", "/api/icon-categories/other"},
		{"PUT", "/api/icon-categories/mine"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(`{"name":"x"}`))
		req.Header.Set("Cookie", "hops_session="+c.token+"; hops_csrf="+c.csrf)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusForbidden {
			t.Errorf("no CSRF %s %s: %d", tc.method, tc.path, w.Code)
		}
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM icons WHERE id='ia' AND name='Icon A'`).Scan(&n)
	if n != 1 {
		t.Fatal("an unauthorised write changed an icon")
	}
	// Usage is GET only.
	if code, _ := c.do("POST", "/api/icons/usage", nil); code != http.StatusMethodNotAllowed {
		t.Errorf("POST usage: %d", code)
	}
}
