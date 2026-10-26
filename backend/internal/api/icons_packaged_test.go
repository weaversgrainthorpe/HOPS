package api

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/assets"
	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// Settings › Icons › Packaged icons: the server's counts of what ships with
// HOPS (read from the embedded files and the database, never guessed) and
// "where used" for packaged icons (a Dashboard Icons image or an Iconify name).

type packagedResp struct {
	FetchedAt      string `json:"fetchedAt"`
	DashboardIcons struct {
		Count int      `json:"count"`
		Names []string `json:"names"`
	} `json:"dashboardIcons"`
	DashboardRows int `json:"dashboardRows"`
	PresetRows    int `json:"presetRows"`
}

func shippedDashboardSVGs(t *testing.T) []string {
	t.Helper()
	entries, err := fs.ReadDir(assets.DashboardIcons, "dashboard-icons")
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".svg") {
			out = append(out, strings.TrimSuffix(e.Name(), ".svg"))
		}
	}
	return out
}

func TestPackagedIconsCountsAreReal(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	// The test database skips the Dashboard Icons import: one row stands in for it.
	if _, err := db.Exec(`INSERT INTO icons (id, name, icon, category_id, image_url, is_preset) VALUES ('plex','Plex','','media','/api/icons/dashboard/plex.svg',1)`); err != nil {
		t.Fatal(err)
	}
	w := c.rawReq("GET", "/api/icons/packaged", nil, "")
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control %q", cc)
	}
	var p packagedResp
	if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	if p.FetchedAt == "" {
		t.Error("fetchedAt missing")
	}
	shipped := shippedDashboardSVGs(t)
	// The real number shipped (about 2,300 SVGs, light/dark variants included).
	if len(shipped) < 2000 {
		t.Fatalf("only %d Dashboard Icons SVGs embedded", len(shipped))
	}
	if p.DashboardIcons.Count != len(shipped) || len(p.DashboardIcons.Names) != len(shipped) {
		t.Fatalf("dashboard icons: count %d, names %d, shipped %d", p.DashboardIcons.Count, len(p.DashboardIcons.Names), len(shipped))
	}
	var plex bool
	for _, n := range p.DashboardIcons.Names {
		if n == "plex" {
			plex = true
		}
		if strings.Contains(n, "/") || strings.HasSuffix(n, ".svg") {
			t.Fatalf("name %q is not a bare name", n)
		}
	}
	if !plex {
		t.Error("plex missing from the Dashboard Icons names")
	}
	var presets, dashRows int
	db.QueryRow(`SELECT COUNT(*) FROM icons WHERE is_preset = 1 AND (image_url IS NULL OR image_url = '')`).Scan(&presets)
	db.QueryRow(`SELECT COUNT(*) FROM icons WHERE is_preset = 1 AND image_url LIKE '/api/icons/dashboard/%'`).Scan(&dashRows)
	if presets < 100 || p.PresetRows != presets {
		t.Errorf("preset rows: got %d, database has %d", p.PresetRows, presets)
	}
	if dashRows != 1 || p.DashboardRows != dashRows {
		t.Errorf("dashboard rows: got %d, database has %d", p.DashboardRows, dashRows)
	}
}

func TestPackagedIconsRequireAdminAndGET(t *testing.T) {
	router, _ := setupTestRouter(t)
	req := httptest.NewRequest("GET", "/api/icons/packaged", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d", w.Code)
	}
	c := newClient(t, router)
	if w := c.rawReq("POST", "/api/icons/packaged", nil, ""); w.Code != http.StatusMethodNotAllowed && w.Code != http.StatusForbidden {
		t.Fatalf("POST: %d", w.Code)
	}
}

type packagedUsageResp struct {
	Icons    map[string][]map[string]any `json:"icons"`
	Packaged *struct {
		Images map[string][]map[string]any `json:"images"`
		Names  map[string][]map[string]any `json:"names"`
	} `json:"packaged"`
}

func TestIconUsageCoversPackagedIcons(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seedIconRows(t, db)
	node := func(id, name string, kv ...string) map[string]any {
		n := map[string]any{"id": id, "kind": "tile", "name": name, "url": "http://x", "size": "small",
			"placement": map[string]any{"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}}
		for i := 0; i+1 < len(kv); i += 2 {
			n[kv[i]] = kv[i+1]
		}
		return n
	}
	doc := configdoc.Obj{
		"schemaVersion": 3.0,
		"layoutVersion": float64(configdoc.LayoutVersion),
		"dashboards": []any{
			map[string]any{"id": "d1", "name": "Home", "path": "/home", "revision": 1.0, "icon": "mdi:home", "tabs": []any{
				map[string]any{"id": "tab1", "name": "Main", "icon": "mdi:server", "root": map[string]any{"columns": 24.0,
					"children": []any{
						node("t1", "Plex", "iconUrl", "/api/icons/dashboard/plex.svg"),
						node("t2", "Plex 2", "iconUrl", "/api/icons/dashboard/plex.svg"),
						node("t3", "Server", "icon", "mdi:server"),
						// The image wins: its Iconify name is not shown, so not "used".
						node("t4", "Both", "icon", "mdi:shield", "iconUrl", "/icons/a.png"),
					}}},
			}},
		},
	}
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
	w := c.rawReq("GET", "/api/icons/usage", nil, "")
	if w.Code != 200 {
		t.Fatalf("status %d", w.Code)
	}
	var u packagedUsageResp
	if err := json.Unmarshal(w.Body.Bytes(), &u); err != nil {
		t.Fatal(err)
	}
	if u.Packaged == nil || u.Packaged.Images == nil || u.Packaged.Names == nil {
		t.Fatalf("packaged usage missing: %s", w.Body.String())
	}
	if got := u.Packaged.Images["/api/icons/dashboard/plex.svg"]; len(got) != 2 || got[0]["dashboard"] != "Home" || got[0]["kind"] != "tile" {
		t.Errorf("plex usage: %v", got)
	}
	if _, ok := u.Packaged.Images["/icons/a.png"]; ok {
		t.Error("uploaded images are not packaged")
	}
	srv := u.Packaged.Names["mdi:server"]
	kinds := map[string]int{}
	for _, x := range srv {
		kinds[x["kind"].(string)]++
	}
	if kinds["tile"] != 1 || kinds["tab"] != 1 || len(srv) != 2 {
		t.Errorf("mdi:server usage: %v", srv)
	}
	if got := u.Packaged.Names["mdi:home"]; len(got) != 1 || got[0]["kind"] != "dashboard" {
		t.Errorf("mdi:home usage: %v", got)
	}
	if _, ok := u.Packaged.Names["mdi:shield"]; ok {
		t.Error("an Iconify name hidden by an image is not counted as used")
	}
	// The uploads map is unchanged.
	if got := u.Icons["ia"]; len(got) != 1 {
		t.Errorf("uploads usage of ia: %v", got)
	}
}
