package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Every create path validated, a built-in Uploads
// category, no stale or silent leftovers.

func TestUploadsCategoryIsSeededBuiltIn(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	var name string
	var preset bool
	if err := db.QueryRow(`SELECT name, is_preset FROM icon_categories WHERE id = 'uploads'`).Scan(&name, &preset); err != nil {
		t.Fatalf("uploads category: %v", err)
	}
	if name != "Uploads" || !preset {
		t.Fatalf("uploads category: %q preset=%v", name, preset)
	}
	if code, _ := c.do("PUT", "/api/icon-categories/uploads", map[string]any{"name": "Mine"}); code != http.StatusBadRequest {
		t.Errorf("rename Uploads: %d", code)
	}
	if code, _ := c.do("DELETE", "/api/icon-categories/uploads", nil); code != http.StatusBadRequest {
		t.Errorf("delete Uploads: %d", code)
	}
}

func TestCreateIconIsValidated(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seedIconRows(t, db)
	ok := map[string]any{"id": "new-icon", "name": "New", "icon": "", "categoryId": "mine", "imageUrl": "/icons/ok-1.png"}
	with := func(k string, v any) map[string]any {
		m := map[string]any{}
		for kk, vv := range ok {
			m[kk] = vv
		}
		m[k] = v
		return m
	}
	for _, tc := range []struct {
		name string
		body map[string]any
		want int
	}{
		{"empty name", with("name", "  "), 400},
		{"long name", with("name", strings.Repeat("n", 101)), 400},
		{"unknown category", with("categoryId", "nope"), 400},
		{"traversal url", with("imageUrl", "/icons/../hops.db"), 400},
		{"nested url", with("imageUrl", "/icons/a/b.png"), 400},
		{"external url", with("imageUrl", "https://evil.example/x.png"), 400},
		{"script url", with("imageUrl", "javascript:alert(1)"), 400},
		{"hidden file", with("imageUrl", "/icons/.x.png"), 400},
		{"bad icon name", map[string]any{"id": "x2", "name": "X", "icon": "<b>x</b>", "categoryId": "mine"}, 400},
		{"bad colour", map[string]any{"id": "x3", "name": "X", "icon": "mdi:home", "categoryId": "mine", "color": "red;background:url(x)"}, 400},
		{"id with slash", with("id", "a/b"), 400},
		{"reserved id", with("id", "usage"), 400},
	} {
		if code, b := c.do("POST", "/api/icons", tc.body); code != tc.want {
			t.Errorf("%s: %d %v, want %d", tc.name, code, b, tc.want)
		}
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM icons WHERE is_preset = 0`).Scan(&n)
	if n != 3 {
		t.Fatalf("refused creates stored rows: %d", n)
	}
	if code, b := c.do("POST", "/api/icons", ok); code != 200 {
		t.Fatalf("valid create: %d %v", code, b)
	}
	if code, b := c.do("POST", "/api/icons", map[string]any{"id": "iconify", "name": "Iconify", "icon": "simple-icons:proxmox", "categoryId": "mine", "color": "#FF5733"}); code != 200 {
		t.Fatalf("valid iconify create: %d %v", code, b)
	}
	if code, _ := c.do("POST", "/api/icons", ok); code != http.StatusConflict {
		t.Errorf("duplicate id: %d, want 409", code)
	}
	var name string
	db.QueryRow(`SELECT name FROM icons WHERE id = 'new-icon'`).Scan(&name)
	if name != "New" {
		t.Errorf("stored name %q", name)
	}
}

func TestUpdateIconRefusesBuiltInAndBadValues(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seedIconRows(t, db)
	if code, _ := c.do("PUT", "/api/icons/preset1", map[string]any{"name": "Mine now"}); code != http.StatusBadRequest {
		t.Errorf("built-in: %d", code)
	}
	var name string
	db.QueryRow(`SELECT name FROM icons WHERE id = 'preset1'`).Scan(&name)
	if name != "Docker" {
		t.Fatalf("built-in renamed to %q", name)
	}
	for _, body := range []map[string]any{{"icon": "not an icon"}, {"color": "url(x)"}, {"color": "#12"}} {
		if code, _ := c.do("PUT", "/api/icons/ia", body); code != http.StatusBadRequest {
			t.Errorf("%v: %d", body, code)
		}
	}
	if code, b := c.do("PUT", "/api/icons/ia", map[string]any{"color": "#abc", "icon": "mdi:server"}); code != 200 {
		t.Fatalf("valid: %d %v", code, b)
	}
	if code, _ := c.do("PUT", "/api/icons/ia", map[string]any{"color": ""}); code != 200 {
		t.Errorf("clearing the colour: %d", code)
	}
}

func uploadedID(t *testing.T, w *httptest.ResponseRecorder) (string, string) {
	t.Helper()
	if w.Code != 200 {
		t.Fatalf("upload: %d %s", w.Code, w.Body.String())
	}
	var r map[string]any
	json.Unmarshal(w.Body.Bytes(), &r)
	return r["id"].(string), r["url"].(string)
}

func served(t *testing.T, h http.Handler, path string) int {
	t.Helper()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	return w.Code
}

func TestDeleteKeepsAFileAnotherIconShares(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seedIconRows(t, db)
	id, url := uploadedID(t, uploadIconForm(t, c, "shared.png", pngBytes(t), map[string]string{"categoryId": "mine"}))
	if _, err := db.Exec(`INSERT INTO icons (id, name, icon, category_id, image_url, is_preset) VALUES ('twin','Twin','','mine',?,0)`, url); err != nil {
		t.Fatal(err)
	}
	if code, b := c.do("DELETE", "/api/icons/"+id, nil); code != 200 {
		t.Fatalf("delete first: %d %v", code, b)
	}
	if got := served(t, router, url); got != 200 {
		t.Fatalf("shared file removed while another icon uses it: %d", got)
	}
	if code, b := c.do("DELETE", "/api/icons/twin", nil); code != 200 {
		t.Fatalf("delete twin: %d %v", code, b)
	}
	if got := served(t, router, url); got != http.StatusNotFound {
		t.Fatalf("last user deleted, file kept: %d", got)
	}
}

func TestDeleteWithOddStoredImageURLNeverTouchesOtherFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "keep.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, router, db := setupTestRouterInDir(t, dir)
	c := newClient(t, router)
	seedIconRows(t, db)
	if _, err := db.Exec(`INSERT INTO icons (id, name, icon, category_id, image_url, is_preset) VALUES ('odd','Odd','','mine','/icons/../keep.txt',0)`); err != nil {
		t.Fatal(err)
	}
	if code, b := c.do("DELETE", "/api/icons/odd", nil); code != 200 {
		t.Fatalf("delete: %d %v", code, b)
	}
	if _, err := os.Stat(filepath.Join(dir, "keep.txt")); err != nil {
		t.Fatalf("a file outside the icons folder was removed: %v", err)
	}
}

func TestUploadInsertFailureRemovesTheFile(t *testing.T) {
	dir := t.TempDir()
	_, router, db := setupTestRouterInDir(t, dir)
	c := newClient(t, router)
	seedIconRows(t, db)
	if _, err := db.Exec(`CREATE TRIGGER icons_fail BEFORE INSERT ON icons BEGIN SELECT RAISE(FAIL, 'boom'); END`); err != nil {
		t.Fatal(err)
	}
	w := uploadIconForm(t, c, "x.png", pngBytes(t), map[string]string{"categoryId": "mine"})
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("upload with failing insert: %d %s", w.Code, w.Body.String())
	}
	entries, _ := os.ReadDir(filepath.Join(dir, "icons"))
	if len(entries) != 0 {
		t.Fatalf("file left behind after the failed save: %v", entries)
	}
}

func TestCategoryDeleteMoveToMissingCategory(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seedIconRows(t, db)
	code, b := c.do("DELETE", "/api/icon-categories/mine?moveTo=gone", nil)
	if code != http.StatusBadRequest {
		t.Fatalf("moveTo missing: %d %v", code, b)
	}
	if msg, _ := b["error"].(string); !strings.Contains(msg, "doesn't exist") {
		t.Errorf("message: %q", msg)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM icons WHERE category_id = 'mine'`).Scan(&n)
	if n != 2 {
		t.Fatalf("icons moved/lost: %d", n)
	}
}

func adminNoticeTexts(t *testing.T, c *apiClient) []string {
	t.Helper()
	code, v := c.do("GET", "/api/config", nil)
	if code != 200 {
		t.Fatalf("config: %d", code)
	}
	var out []string
	ns, _ := v["notices"].([]any)
	for _, n := range ns {
		out = append(out, n.(map[string]any)["text"].(string))
	}
	return out
}

func TestStartupSweepsDeletingLeftovers(t *testing.T) {
	dir := t.TempDir()
	icons := filepath.Join(dir, "icons")
	os.MkdirAll(icons, 0o755)
	os.WriteFile(filepath.Join(icons, "old.png.deleting"), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(icons, "live.png"), []byte("x"), 0o644)
	_, router, _ := setupTestRouterInDir(t, dir)
	if _, err := os.Stat(filepath.Join(icons, "old.png.deleting")); !os.IsNotExist(err) {
		t.Fatalf("leftover not swept: %v", err)
	}
	if _, err := os.Stat(filepath.Join(icons, "live.png")); err != nil {
		t.Fatalf("a live icon was swept: %v", err)
	}
	c := newClient(t, router)
	for _, txt := range adminNoticeTexts(t, c) {
		if strings.Contains(txt, "icon file") {
			t.Errorf("unexpected notice after a clean sweep: %q", txt)
		}
	}
}

func TestLeftoverThatCannotBeRemovedIsAVisibleNotice(t *testing.T) {
	dir := t.TempDir()
	icons := filepath.Join(dir, "icons")
	// A directory named like a leftover, with content: os.Remove fails on it.
	stuck := filepath.Join(icons, "stuck.png.deleting")
	os.MkdirAll(filepath.Join(stuck, "inner"), 0o755)
	r, router, _ := setupTestRouterInDir(t, dir)
	c := newClient(t, router)
	texts := adminNoticeTexts(t, c)
	found := false
	for _, txt := range texts {
		if strings.Contains(txt, "stuck.png.deleting") && strings.Contains(txt, "couldn't remove") {
			found = true
		}
	}
	if !found {
		t.Fatalf("no notice for the stuck leftover: %v", texts)
	}
	// Anonymous viewers never see server paths.
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", "/api/config", nil))
	if strings.Contains(w.Body.String(), "stuck.png.deleting") {
		t.Fatal("leftover notice served to an anonymous viewer")
	}
	// Fixed by hand: the notice goes.
	os.RemoveAll(stuck)
	for _, txt := range adminNoticeTexts(t, c) {
		if strings.Contains(txt, "stuck.png.deleting") {
			t.Fatalf("notice stayed after the file went: %q", txt)
		}
	}
	_ = r
}
