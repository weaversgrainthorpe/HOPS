package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/settings"
	"gopkg.in/yaml.v3"
)

const unreadableMsg = "Existing configuration could not be read — import refused so nothing is overwritten"

// legacyDetect is a deliberately frozen, verbatim copy of the v2.2.1
// converters.DetectFormat branches for YAML and JSON-object detection. It
// stands in for an older HOPS install receiving a v3 export.
func legacyDetect(data []byte) (string, error) {
	var yamlMap map[string]interface{}
	if err := yaml.Unmarshal(data, &yamlMap); err == nil {
		if _, hasServices := yamlMap["services"]; hasServices {
			return "homer", nil
		}
		if _, hasSections := yamlMap["sections"]; hasSections {
			return "dashy", nil
		}
	}
	var jsonMap map[string]interface{}
	if err := json.Unmarshal(data, &jsonMap); err == nil {
		if _, hasDashboards := jsonMap["dashboards"]; hasDashboards {
			return "hops", nil
		}
	}
	var jsonArray []map[string]interface{}
	if err := json.Unmarshal(data, &jsonArray); err == nil {
		if len(jsonArray) > 0 {
			first := jsonArray[0]
			if _, hasTitle := first["title"]; hasTitle {
				if _, hasURL := first["url"]; hasURL {
					return "heimdall", nil
				}
			}
		}
	}
	return "", fmt.Errorf("unknown dashboard format")
}

func (c *apiClient) raw(method, path string, body []byte, contentType string) (int, []byte) {
	c.t.Helper()
	req := authedRequest(method, path, bytes.NewReader(body), c.token, c.csrf)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	w := httptest.NewRecorder()
	c.h.ServeHTTP(w, req)
	return w.Code, w.Body.Bytes()
}

func (c *apiClient) importFile(data []byte) (int, map[string]interface{}) {
	c.t.Helper()
	return c.importFileWith(data, nil)
}

func (c *apiClient) importFileWith(data []byte, fields map[string]string) (int, map[string]interface{}) {
	c.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		mw.WriteField(k, v)
	}
	fw, _ := mw.CreateFormFile("file", "import.dat")
	fw.Write(data)
	mw.Close()
	code, body := c.raw("POST", "/api/config/import", buf.Bytes(), mw.FormDataContentType())
	var out map[string]interface{}
	_ = json.Unmarshal(body, &out)
	return code, out
}

func (c *apiClient) export(query string) []byte {
	c.t.Helper()
	code, body := c.raw("GET", "/api/config/export"+query, nil, "")
	if code != 200 {
		c.t.Fatalf("export%s: %d %s", query, code, body)
	}
	return body
}

func storedDoc(t *testing.T, db *sql.DB) configdoc.Obj {
	t.Helper()
	doc, err := configdoc.Load(db)
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

func dashList(doc configdoc.Obj) []configdoc.Obj {
	var out []configdoc.Obj
	l, _ := doc["dashboards"].([]any)
	for _, d := range l {
		out = append(out, d.(configdoc.Obj))
	}
	return out
}

// assertUniqueIDs fails on any duplicate id across dashboards, tabs, folders
// and tiles, and runs the structural verifier.
func assertUniqueIDs(t *testing.T, doc configdoc.Obj) {
	t.Helper()
	seen := map[string]bool{}
	add := func(v any) {
		id, _ := v.(string)
		if id == "" || seen[id] {
			t.Errorf("empty or duplicate id %q", id)
		}
		seen[id] = true
	}
	for _, d := range dashList(doc) {
		add(d["id"])
		for _, tb := range d["tabs"].([]any) {
			add(tb.(configdoc.Obj)["id"])
		}
	}
	configdoc.Walk(doc, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		add(n["id"])
		return true
	})
	if err := configdoc.VerifyIDs(doc); err != nil {
		t.Errorf("Verify: %v", err)
	}
}

func counts(d configdoc.Obj) (tabs, folders, tiles int) {
	tabs = len(d["tabs"].([]any))
	configdoc.Walk(configdoc.Obj{"dashboards": []any{d}}, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		if n["kind"] == "folder" {
			folders++
		} else if n["kind"] == "tile" {
			tiles++
		}
		return true
	})
	return
}

func TestExportEnvelope_RejectedByV2Detector(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	for _, q := range []string{"", "?format=yaml", "?dashboardId=d1", "?dashboardId=d1&format=yaml"} {
		data := c.export(q)
		got, err := legacyDetect(data)
		if err == nil && got == "hops" {
			t.Errorf("export%s is accepted by the v2.2.1 detector as %q", q, got)
		}
	}
}

func TestExportEnvelope_Shape(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)

	var full map[string]interface{}
	if err := json.Unmarshal(c.export(""), &full); err != nil {
		t.Fatal(err)
	}
	if full["format"] != "hops-export" || full["schemaVersion"] != float64(3) ||
		full["exportType"] != "full" || full["exportedAt"] == nil {
		t.Errorf("full envelope: %v", full)
	}
	cfg, _ := full["config"].(map[string]interface{})
	if cfg == nil || !configdoc.IsV3(cfg) {
		t.Errorf("config is not a v3 doc: %v", cfg)
	}

	var one map[string]interface{}
	if err := json.Unmarshal(c.export("?dashboardId=d1"), &one); err != nil {
		t.Fatal(err)
	}
	if one["exportType"] != "single-dashboard" {
		t.Errorf("single envelope: %v", one)
	}
	ds := one["config"].(map[string]interface{})["dashboards"].([]interface{})
	if len(ds) != 1 || ds[0].(map[string]interface{})["id"] != "d1" {
		t.Errorf("single config dashboards: %v", ds)
	}

	code, _ := c.raw("GET", "/api/config/export?dashboardId=nope", nil, "")
	if code != 404 {
		t.Errorf("unknown dashboard: %d", code)
	}
}

func TestExportImport_MigrationFailed503(t *testing.T) {
	router, db := setupTestRouterWithMigration(t, &configdoc.MigrationResult{Failed: true, Detail: "boom"})
	c := newClient(t, router)
	var before string
	db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&before)

	code, _ := c.raw("GET", "/api/config/export", nil, "")
	if code != 503 {
		t.Errorf("export: %d", code)
	}
	code, resp := c.importFile([]byte(`{"dashboards":[]}`))
	if code != 503 || resp["error"] != "migration_failed" {
		t.Errorf("import: %d %v", code, resp)
	}
	var after string
	db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&after)
	if before != after {
		t.Error("config row changed")
	}
}

func TestImport_V3RoundTrip(t *testing.T) {
	for _, q := range []string{"", "?format=yaml"} {
		t.Run("q"+q, func(t *testing.T) {
			router, db := setupTestRouter(t)
			c := newClient(t, router)
			seed(t, db)
			// Give d1 non-default settings and a bumped revision.
			code, resp := c.do("PUT", "/api/dashboards/d1/settings", map[string]interface{}{
				"overrides": map[string]interface{}{"statusChecksEnabled": false}, "revision": 1})
			if code != 200 {
				t.Fatalf("settings: %d %v", code, resp)
			}
			before := len(dashList(storedDoc(t, db)))

			code, resp = c.importFile(c.export(q))
			if code != 200 {
				t.Fatalf("import: %d %v", code, resp)
			}
			doc := storedDoc(t, db)
			ds := dashList(doc)
			if len(ds) != before*2 {
				t.Fatalf("dashboards %d, want %d", len(ds), before*2)
			}
			imp := ds[len(ds)-1]
			if imp["path"] != "/d1-1" {
				t.Errorf("path %v", imp["path"])
			}
			if imp["revision"] != float64(1) {
				t.Errorf("revision %v, want 1", imp["revision"])
			}
			if s, _ := imp["settings"].(map[string]interface{}); s["statusChecksEnabled"] != false {
				t.Errorf("settings not kept: %v", imp["settings"])
			}
			if !strings.Contains(resp["message"].(string), "First") {
				t.Errorf("message lacks dashboard name: %v", resp["message"])
			}
			assertUniqueIDs(t, doc)

			// Re-import twice more: still unique, paths keep incrementing.
			for i := 0; i < 2; i++ {
				if code, resp = c.importFile(c.export(q)); code != 200 {
					t.Fatalf("re-import: %d %v", code, resp)
				}
			}
			doc = storedDoc(t, db)
			assertUniqueIDs(t, doc)
			paths := map[string]bool{}
			for _, d := range dashList(doc) {
				p := d["path"].(string)
				if paths[p] {
					t.Errorf("duplicate path %s", p)
				}
				paths[p] = true
			}
		})
	}
}

func TestImport_V2ExportBecomesFolders(t *testing.T) {
	cases := []struct {
		file                 string
		tabs, folders, tiles int
	}{
		{"real_sample.json", 2, 13, 24},
		{"real_weavers.json", 3, 9, 40},
	}
	for _, tc := range cases {
		t.Run(tc.file, func(t *testing.T) {
			data, err := os.ReadFile("../configdoc/testdata/" + tc.file)
			if err != nil {
				t.Fatal(err)
			}
			router, db := setupTestRouter(t)
			c := newClient(t, router)
			before := len(dashList(storedDoc(t, db)))
			code, resp := c.importFile(data)
			if code != 200 {
				t.Fatalf("import: %d %v", code, resp)
			}
			doc := storedDoc(t, db)
			ds := dashList(doc)
			if len(ds) != before+1 {
				t.Fatalf("dashboards %d, want %d", len(ds), before+1)
			}
			d := ds[len(ds)-1]
			tabs, folders, tiles := counts(d)
			if tabs != tc.tabs || folders != tc.folders || tiles != tc.tiles {
				t.Errorf("got %d/%d/%d want %d/%d/%d", tabs, folders, tiles, tc.tabs, tc.folders, tc.tiles)
			}
			if d["revision"] != float64(1) {
				t.Errorf("revision %v", d["revision"])
			}
			assertUniqueIDs(t, doc)
			// Importing the same file again must stay unique.
			if code, resp = c.importFile(data); code != 200 {
				t.Fatalf("re-import: %d %v", code, resp)
			}
			assertUniqueIDs(t, storedDoc(t, db))
		})
	}
}

func TestImport_Homer(t *testing.T) {
	homer := []byte(`title: My Homer
services:
  - name: Media
    items:
      - name: Plex
        url: https://plex.example
      - name: Sonarr
        url: https://sonarr.example
  - name: Tools
    items:
      - name: Grafana
        url: https://grafana.example
`)
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	before := len(dashList(storedDoc(t, db)))
	for i := 1; i <= 2; i++ {
		code, resp := c.importFile(homer)
		if code != 200 {
			t.Fatalf("import %d: %d %v", i, code, resp)
		}
		if !strings.Contains(resp["message"].(string), "My Homer") {
			t.Errorf("message: %v", resp["message"])
		}
	}
	doc := storedDoc(t, db)
	ds := dashList(doc)
	if len(ds) != before+2 {
		t.Fatalf("dashboards %d", len(ds))
	}
	tabs, folders, tiles := counts(ds[len(ds)-1])
	if tabs != 1 || folders != 2 || tiles != 3 {
		t.Errorf("counts %d/%d/%d", tabs, folders, tiles)
	}
	assertUniqueIDs(t, doc)
}

func TestImport_RefusesWhenStoredConfigUnreadable(t *testing.T) {
	stored := map[string]string{
		"garbage":    "this is {{ not json",
		"not v3":     `{"dashboards":[]}`,
		"v3 but bad": `{"schemaVersion":3,"dashboards":`,
	}
	for name, content := range stored {
		t.Run(name, func(t *testing.T) {
			router, db := setupTestRouter(t)
			c := newClient(t, router)
			if _, err := db.Exec("UPDATE config SET data = ? WHERE id = 1", content); err != nil {
				t.Fatal(err)
			}
			homer := []byte("title: X\nservices:\n  - name: A\n    items:\n      - name: B\n        url: https://b.example\n")
			code, resp := c.importFile(homer)
			if code != 500 || resp["error"] != unreadableMsg {
				t.Fatalf("got %d %v", code, resp)
			}
			var after string
			db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&after)
			if after != content {
				t.Errorf("row changed: %q", after)
			}
			// Export refuses too, visibly.
			code, body := c.raw("GET", "/api/config/export", nil, "")
			var eb map[string]interface{}
			_ = json.Unmarshal(body, &eb)
			if code != 500 || !strings.HasPrefix(fmt.Sprint(eb["error"]), "Stored configuration could not be read, so nothing was exported: ") {
				t.Errorf("export: %d %s", code, body)
			}
		})
	}
}

func TestImport_VerifyFailureIs400AndWritesNothing(t *testing.T) {
	// Two entries share an id inside one v2 dashboard.
	bad := []byte(`{"dashboards":[{"id":"x","name":"X","path":"/x","order":0,"tabs":[{"id":"t","name":"T","order":0,
	  "groups":[{"id":"g","name":"G","order":0,"entries":[
	  {"id":"e","name":"A","url":"https://a","order":0},{"id":"e","name":"B","url":"https://b","order":1}]}]}]}]}`)
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	var before string
	db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&before)
	code, resp := c.importFile(bad)
	if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "duplicate id") {
		t.Fatalf("got %d %v", code, resp)
	}
	var after string
	db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&after)
	if before != after {
		t.Error("config row changed")
	}
}

// v3ExportOf wraps a v3 config in an export envelope.
func v3ExportOf(t *testing.T, cfg map[string]interface{}) []byte {
	t.Helper()
	b, err := json.Marshal(map[string]interface{}{
		"format": "hops-export", "schemaVersion": 3, "exportType": "full", "config": cfg})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestImport_AssetFailureIsSurfaced(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	var env map[string]interface{}
	json.Unmarshal(c.export(""), &env)
	cfg := env["config"].(map[string]interface{})
	cfg["assets"] = map[string]interface{}{
		"/icons/broken.png": map[string]interface{}{"contentType": "image/png", "data": "!!!not base64!!!"},
		"/icons/empty.png":  map[string]interface{}{"contentType": "image/png"},
	}
	before := len(dashList(storedDoc(t, db)))
	code, resp := c.importFile(v3ExportOf(t, cfg))
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	if len(dashList(storedDoc(t, db))) != before*2 {
		t.Error("dashboards were not imported")
	}
	failed, _ := resp["assetsFailed"].([]interface{})
	msg, _ := resp["message"].(string)
	if len(failed) != 2 || !strings.Contains(msg, "could not be restored") || !strings.Contains(msg, "broken.png") {
		t.Errorf("failure not surfaced: failed=%v message=%q", failed, msg)
	}
}

func TestImport_IconMatchingFailureIsSurfaced(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	if _, err := db.Exec("DROP TABLE icons"); err != nil {
		t.Skipf("cannot break icons table: %v", err)
	}
	homer := []byte("title: X\nservices:\n  - name: A\n    items:\n      - name: B\n        url: https://b.example\n")
	code, resp := c.importFileWith(homer, map[string]string{"autoMatchIcons": "true"})
	if code != 200 || !strings.Contains(fmt.Sprint(resp["message"]), "Icon auto-matching skipped") {
		t.Fatalf("got %d %v", code, resp)
	}
	// Structured too, so the UI can show a warning state without parsing text.
	if e, _ := resp["iconMatchError"].(string); e == "" {
		t.Fatalf("iconMatchError missing: %v", resp)
	}
}

func TestImport_V3ShapeChecks(t *testing.T) {
	good := func() map[string]interface{} {
		router, db := setupTestRouter(t)
		c := newClient(t, router)
		seed(t, db)
		var env map[string]interface{}
		json.Unmarshal(c.export(""), &env)
		return env["config"].(map[string]interface{})
	}
	cases := map[string]func(cfg map[string]interface{}){
		"empty path":       func(c map[string]interface{}) { dashOf(c)["path"] = "" },
		"no settings":      func(c map[string]interface{}) { delete(dashOf(c), "settings") },
		"partial settings": func(c map[string]interface{}) { dashOf(c)["settings"] = map[string]interface{}{} },
		"free-layout key":  func(c map[string]interface{}) { dashOf(c)["defaultLayout"] = "free" },
		"placed folder child": func(c map[string]interface{}) {
			f := dashOf(c)["tabs"].([]interface{})[0].(map[string]interface{})["root"].(map[string]interface{})["children"].([]interface{})[0].(map[string]interface{})
			tile := f["content"].(map[string]interface{})["children"].([]interface{})[0].(map[string]interface{})
			tile["placement"] = map[string]interface{}{"x": 0, "y": 0, "w": 2, "h": 2}
		},
		"custom tile span": func(c map[string]interface{}) {
			root := dashOf(c)["tabs"].([]interface{})[0].(map[string]interface{})["root"].(map[string]interface{})
			root["children"] = append(root["children"].([]interface{}), map[string]interface{}{"id": "cx", "kind": "tile", "name": "C",
				"placement": map[string]interface{}{"x": 0, "y": 10, "w": 3, "h": 3}})
		},
		"background opacity 2": func(c map[string]interface{}) {
			dashOf(c)["background"] = map[string]interface{}{"type": "color", "value": "#000", "opacity": 2}
		},
		"duplicate ids inside dashboard": func(c map[string]interface{}) {
			tab := dashOf(c)["tabs"].([]interface{})[0].(map[string]interface{})
			tab["id"] = dashOf(c)["id"]
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			router, db := setupTestRouter(t)
			c := newClient(t, router)
			seed(t, db)
			cfg := good()
			mutate(cfg)
			var before string
			db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&before)
			code, resp := c.importFile(v3ExportOf(t, cfg))
			if code != 400 {
				t.Fatalf("got %d %v", code, resp)
			}
			var after string
			db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&after)
			if before != after {
				t.Error("config row changed")
			}
		})
	}
}

// Spec Part A: only a v2 conversion pins status checks. A hops-v3 import is
// stored as it is, so a tile with no setting keeps none (and so inherits).
func TestHopsV3ImportNotPinned(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	var env map[string]interface{}
	if err := json.Unmarshal(c.export(""), &env); err != nil {
		t.Fatal(err)
	}
	cfg := env["config"].(map[string]interface{})
	stripped := 0
	configdoc.Walk(cfg, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		if n["kind"] == "tile" {
			delete(n, "statusCheck")
			stripped++
		}
		return true
	})
	if stripped == 0 {
		t.Fatal("seeded export has no tiles")
	}
	if code, resp := c.importFile(v3ExportOf(t, cfg)); code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	ds := dashList(storedDoc(t, db))
	seen := 0
	configdoc.Walk(configdoc.Obj{"dashboards": []any{ds[len(ds)-1]}}, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		if n["kind"] == "tile" {
			seen++
			if sc, has := n["statusCheck"]; has {
				t.Errorf("tile %v: stored statusCheck %v, want none", n["id"], sc)
			}
		}
		return true
	})
	if seen != stripped {
		t.Errorf("imported %d tiles, want %d", seen, stripped)
	}
}

func dashOf(cfg map[string]interface{}) map[string]interface{} {
	return cfg["dashboards"].([]interface{})[0].(map[string]interface{})
}

// The seeded default and the Heimdall converter both emit tab "main" and
// group "services"; importing Heimdall twice on top of the seeded default
// must still leave every id unique (makeIDsUnique covers converter output).
func TestImport_HeimdallTwiceOverSeededDefault(t *testing.T) {
	heimdall := []byte(`[{"title":"Plex","url":"http://plex.lan:32400"},{"title":"Sonarr","url":"http://sonarr.lan:8989"}]`)
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	before := storedDoc(t, db)
	if ds := dashList(before); len(ds) != 1 || ds[0]["id"] != "sample" {
		t.Fatalf("expected the seeded default dashboard, got %v", ds)
	}
	for i := 1; i <= 2; i++ {
		if code, resp := c.importFile(heimdall); code != 200 {
			t.Fatalf("import %d: %d %v", i, code, resp)
		}
	}
	doc := storedDoc(t, db)
	ds := dashList(doc)
	if len(ds) != 3 {
		t.Fatalf("dashboards = %d, want 3", len(ds))
	}
	for _, d := range ds[1:] {
		if tabs, _, tiles := counts(d); tabs != 1 || tiles != 2 {
			t.Errorf("dashboard %v: tabs=%d tiles=%d", d["id"], tabs, tiles)
		}
	}
	assertUniqueIDs(t, doc)
}

func TestImport_V3Showcase(t *testing.T) {
	data, err := os.ReadFile("../configdoc/testdata/v3_showcase_export.json")
	if err != nil {
		t.Fatal(err)
	}
	// Written natively in the current form (layoutVersion 2): no conversion runs on import.
	var env map[string]any
	if err := json.Unmarshal(data, &env); err != nil {
		t.Fatal(err)
	}
	if err := configdoc.CheckLayoutVersion(env["config"].(map[string]any)); err != nil {
		t.Fatalf("the Showcase fixture is not at this build's layout version: %v", err)
	}
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	code, resp := c.importFile(data)
	if code != 200 {
		t.Fatalf("import showcase: %d %v", code, resp)
	}
	doc := storedDoc(t, db)
	assertUniqueIDs(t, doc)
	dash := storedDash(t, db, "sc-dash")
	// Served (and editable) like every other dashboard.
	if err := configdoc.VerifyDashboard(dash); err != nil {
		t.Errorf("imported Showcase does not verify: %v", err)
	}
	found := false
	for _, d := range getView(t, c)["dashboards"].([]interface{}) {
		if d.(map[string]interface{})["id"] == "sc-dash" {
			found = true
		}
	}
	if !found {
		t.Error("sc-dash not served by GET /api/config")
	}

	// Structure later tasks rely on.
	tabs := dash["tabs"].([]any)
	wantTabs := []string{"sc-tab-grid", "sc-tab-sizes", "sc-tab-folders", "sc-tab-shapes"}
	if len(tabs) != len(wantTabs) {
		t.Fatalf("%d tabs, want %d", len(tabs), len(wantTabs))
	}
	for i, id := range wantTabs {
		if tabs[i].(configdoc.Obj)["id"] != id {
			t.Errorf("tab %d id = %v, want %s", i, tabs[i].(configdoc.Obj)["id"], id)
		}
	}
	assertM5Dashboard(t, dash)

	// Depth 3 under the Grid tab, iframe tile inside the collapsed level-3 folder.
	byID := map[string]configdoc.Obj{}
	configdoc.Walk(configdoc.Obj{"dashboards": []any{dash}}, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		byID[n["id"].(string)] = n
		return true
	})
	childIDs := func(f configdoc.Obj) []string {
		var out []string
		for _, ch := range f["content"].(configdoc.Obj)["children"].([]any) {
			out = append(out, ch.(configdoc.Obj)["id"].(string))
		}
		return out
	}
	l1, l2, l3 := byID["sc-f-l1"], byID["sc-f-l2"], byID["sc-f-l3"]
	if l1 == nil || l2 == nil || l3 == nil {
		t.Fatal("missing nested folders sc-f-l1/l2/l3")
	}
	// Every folder in the chain holds visible tiles AND exactly one subfolder,
	// so each level's content is obvious at a glance.
	for _, f := range []configdoc.Obj{l1, l2, l3} {
		tiles, folders := 0, 0
		for _, id := range childIDs(f) {
			if byID[id]["kind"] == "folder" {
				folders++
			} else {
				tiles++
			}
		}
		if tiles < 1 || folders != 1 {
			t.Errorf("%v: %d tile children, %d folder children; want >=1 and exactly 1", f["id"], tiles, folders)
		}
	}
	l4 := byID["sc-f-l4"]
	if l4 == nil || l4["display"] != "collapsed" || len(childIDs(l4)) != 2 {
		t.Errorf("sc-f-l4 should be a collapsed folder with 2 tiles: %v", l4)
	}
	// M6 cases (Shapes tab): an open folder in every look, all three tab
	// positions, looks nested 2 deep, and a Small minimised folder in a tab look.
	shapesTab := tabs[3].(configdoc.Obj)["root"].(configdoc.Obj)["children"].([]any)
	looksOpen, positions := map[string]bool{}, map[string]bool{}
	for _, ch := range shapesTab {
		n := ch.(configdoc.Obj)
		if n["kind"] != "folder" {
			continue
		}
		if n["display"] == "expanded" {
			looksOpen[n["shape"].(string)] = true
		}
		if pos, ok := n["tabPosition"].(string); ok && n["shape"] != "rounded" {
			positions[pos] = true
		}
	}
	for _, s := range configdoc.FolderShapes {
		if !looksOpen[s] {
			t.Errorf("Shapes tab: no open folder in the %q look", s)
		}
	}
	for _, p := range configdoc.FolderTabPositions {
		if !positions[p] {
			t.Errorf("Shapes tab: no tab-shape folder with its tab at %q", p)
		}
	}
	shNest, shA, shB := byID["sc-sh-nest"], byID["sc-sh-nest-a"], byID["sc-sh-nest-b"]
	if shNest == nil || shA == nil || shB == nil || !contains(childIDs(shNest), "sc-sh-nest-a") || !contains(childIDs(shA), "sc-sh-nest-b") {
		t.Fatal("sc-sh-nest > sc-sh-nest-a > sc-sh-nest-b is not 2 deep")
	}
	if shNest["shape"] == shA["shape"] || shA["shape"] == shB["shape"] || shNest["shape"] == "rounded" || shA["shape"] == "rounded" || shB["shape"] == "rounded" {
		t.Errorf("nested looks should be three different tab looks: %v > %v > %v", shNest["shape"], shA["shape"], shB["shape"])
	}
	if f := byID["sc-sh-min-s"]; f == nil || f["display"] != "collapsed" || f["size"] != "small" || f["shape"] == "rounded" || len(childIDs(f)) == 0 {
		t.Errorf("sc-sh-min-s should be a minimised Small folder in a tab look, with items: %v", f)
	}

	if l3["display"] != "collapsed" {
		t.Errorf("l3 display = %v", l3["display"])
	}
	iframeID := ""
	for _, id := range childIDs(l3) {
		if byID[id]["openMode"] == "iframe" {
			iframeID = id
		}
	}
	if iframeID == "" {
		t.Error("no iframe tile under the collapsed level-3 folder")
	}

	// M5 cases: overfull folders (more items than one page of their box
	// holds, at any width: the box is in cells, and so are the items),
	// sub-folders 2+ deep with differing contents sizes, Small- and
	// Large-contents folders, a minimised folder of each own size, and every
	// tab-level tile at exactly its size's span.
	for id, want := range map[string]int{"sc-f-small": 30, "sc-f-many": 20} {
		if f := byID[id]; f == nil || len(childIDs(f)) != want || f["display"] != "expanded" {
			t.Errorf("%s should be an open folder with %d items: %v", id, want, f)
		}
	}
	if f := byID["sc-f-small"]; f["contentSize"] != "small" {
		t.Errorf("sc-f-small contentSize = %v, want small", f["contentSize"])
	}
	if f := byID["sc-f-large"]; f == nil || f["contentSize"] != "large" {
		t.Errorf("sc-f-large should have Large contents: %v", f)
	}
	nestA, nestB := byID["sc-f-nest-a"], byID["sc-f-nest-b"]
	if nestA == nil || nestB == nil || nestA["contentSize"] != "small" || nestB["contentSize"] != "large" {
		t.Fatalf("sc-f-nest-a (small) > sc-f-nest-b (large) missing: %v / %v", nestA, nestB)
	}
	if !contains(childIDs(byID["sc-f-nest"]), "sc-f-nest-a") || !contains(childIDs(nestA), "sc-f-nest-b") {
		t.Error("sc-f-nest > sc-f-nest-a > sc-f-nest-b is not 2 deep")
	}
	for id, size := range map[string]string{"sc-f-min-s": "small", "sc-f-min-m": "medium", "sc-f-min-l": "large"} {
		if f := byID[id]; f == nil || f["display"] != "collapsed" || f["size"] != size || len(childIDs(f)) == 0 {
			t.Errorf("%s should be a minimised %s folder with items: %v", id, size, f)
		}
	}
	spans := map[string]float64{"small": 1, "medium": 2, "large": 4}
	sizesSeen := map[string]bool{}
	for _, tb := range tabs {
		for _, ch := range tb.(configdoc.Obj)["root"].(configdoc.Obj)["children"].([]any) {
			n := ch.(configdoc.Obj)
			p := n["placement"].(configdoc.Obj)
			if n["kind"] == "tile" {
				sz, _ := n["size"].(string)
				sizesSeen[sz] = true
				if p["w"] != spans[sz] || p["h"] != spans[sz] {
					t.Errorf("tab tile %v (%s) is %vx%v", n["id"], sz, p["w"], p["h"])
				}
				continue
			}
			// An open folder box is never below its minimum (Ruling 7): one item
			// at its largest contents size, the bar, padding and the page bar.
			// THE table: configdoc.FolderMinCellsOf (Ruling 9).
			mw, mh := configdoc.FolderMinCellsOf(n)
			if p["w"].(float64) < float64(mw) || p["h"].(float64) < float64(mh) {
				t.Errorf("folder %v box %vx%v is below its minimum %dx%d", n["id"], p["w"], p["h"], mw, mh)
			}
		}
	}
	if !sizesSeen["small"] || !sizesSeen["medium"] || !sizesSeen["large"] {
		t.Errorf("tab tiles of every size: saw %v", sizesSeen)
	}

	// Layered backgrounds (M4): every shape verifies, the M4 update is a no-op
	// on them, and only bundled preset pictures are used.
	if bg, _ := dash["background"].(configdoc.Obj); bg == nil || bg["type"] != "image" {
		t.Errorf("dashboard background = %v, want an image", dash["background"])
	}
	if bg, _ := tabs[1].(configdoc.Obj)["background"].(configdoc.Obj); bg == nil || bg["opacity"] != 0.6 {
		t.Errorf("Sizes tab background = %v, want opacity 0.6", tabs[1].(configdoc.Obj)["background"])
	}
	slide, _ := byID["sc-f-slide"]["background"].(configdoc.Obj)
	if slide == nil || slide["type"] != "slideshow" || len(slide["images"].([]any)) != 2 {
		t.Errorf("sc-f-slide background = %v, want a 2-image slideshow", byID["sc-f-slide"]["background"])
	}
	if bg, _ := byID["sc-f-see"]["background"].(configdoc.Obj); bg == nil || bg["opacity"] != float64(0) {
		t.Errorf("sc-f-see background = %v, want opacity 0", byID["sc-f-see"]["background"])
	}
	for id, n := range byID {
		bg, _ := n["background"].(configdoc.Obj)
		if bg == nil {
			continue
		}
		pics := []string{}
		if v, _ := bg["value"].(string); v != "" && bg["type"] != "color" {
			pics = append(pics, v)
		}
		imgs, _ := bg["images"].([]any)
		for _, im := range imgs {
			pics = append(pics, im.(string))
		}
		for _, pic := range pics {
			if !strings.HasPrefix(pic, "/presets/") {
				t.Errorf("%s: background picture %q is not a bundled preset", id, pic)
				continue
			}
			if _, err := os.Stat("../assets/presets/" + strings.TrimPrefix(pic, "/presets/")); err != nil {
				t.Errorf("%s: preset %q does not exist: %v", id, pic, err)
			}
		}
	}

	// Layered status checks: a folder with checks off still checks its tile
	// that is explicitly on; a tile with no setting inherits.
	scSvc, err := settings.New(db)
	if err != nil {
		t.Fatal(err)
	}
	gridTab := tabs[0].(configdoc.Obj)
	offFolder := byID["sc-f-off"]
	if offFolder == nil || offFolder["statusChecksEnabled"] != false {
		t.Fatalf("sc-f-off should be a folder with statusChecksEnabled false: %v", offFolder)
	}
	on, src, by := configdoc.EffectiveStatusChecks(scSvc, dash, gridTab, []configdoc.Obj{offFolder}, byID["sc-off-on"])
	if !on || src != configdoc.SourceTile || by != "sc-off-on" {
		t.Errorf("sc-off-on resolves to %v/%s/%s, want true/tile/sc-off-on", on, src, by)
	}
	on, src, _ = configdoc.EffectiveStatusChecks(scSvc, dash, gridTab, []configdoc.Obj{offFolder}, byID["sc-off-plain"])
	if on || src != configdoc.SourceFolder {
		t.Errorf("sc-off-plain resolves to %v/%s, want false/folder (a tile with no setting inherits its folder)", on, src)
	}
	// Tiles with no statusCheck inherit; with nothing above them set, that is the global.
	for _, id := range []string{"sc-r1", "sc-r2", "sc-r3", "sc-l1-t1"} {
		on, src, _ := configdoc.EffectiveStatusChecks(scSvc, dash, gridTab, nil, byID[id])
		if !on || src != configdoc.SourceGlobal {
			t.Errorf("%s resolves to %v/%s, want true/global", id, on, src)
		}
	}

	// Every icon is in the offline bundle.
	bundle, err := os.ReadFile("../../../frontend/src/lib/icons/offline-bundle.ts")
	if err != nil {
		t.Fatal(err)
	}
	for id, n := range byID {
		icon, _ := n["icon"].(string)
		if icon == "" {
			continue
		}
		name := strings.TrimPrefix(icon, "mdi:")
		if name == icon || !strings.Contains(string(bundle), `"`+name+`":{"width"`) {
			t.Errorf("%s: icon %q is not in the offline bundle", id, icon)
		}
	}
}

// The retired per-tab background switches (M4) are not part of the current
// form: an export carrying them is refused visibly, never imported with an
// inactive tab picture shown as active.
func TestImport_LegacyTabBackgroundSwitchRefused(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	for _, k := range []string{"perTabBackgrounds", "backgroundEnabled"} {
		var env map[string]interface{}
		json.Unmarshal(c.export(""), &env)
		cfg := env["config"].(map[string]interface{})
		d := dashOf(cfg)
		tab := d["tabs"].([]interface{})[0].(map[string]interface{})
		tab["background"] = map[string]interface{}{"type": "image", "value": "/x.jpg", "fit": "cover"}
		if k == "perTabBackgrounds" {
			d[k] = false
		} else {
			tab[k] = false
		}
		before := storedRaw(db)
		code, resp := c.importFile(v3ExportOf(t, cfg))
		if code != 400 || !strings.Contains(resp["error"].(string), k) {
			t.Errorf("%s: import %d %v, want 400 naming it", k, code, resp)
		}
		if storedRaw(db) != before {
			t.Errorf("%s: config row changed", k)
		}
	}
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}


// A synthetic v2 export: ids and path collide with the built-in sample, one
// asset has an unrecognised path. Every rename and the unrestored image must be
// in the result, and converted folders carry only v3 keys.
func TestImport_ReportsRenamesAndUnrestoredImages(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	stored := dashList(storedDoc(t, db))
	if len(stored) == 0 {
		t.Fatal("expected a built-in dashboard")
	}
	path, _ := stored[0]["path"].(string)
	id, _ := stored[0]["id"].(string)
	// The tab reuses the built-in Sample's first tab id, so internal ids collide.
	tabID, _ := stored[0]["tabs"].([]interface{})[0].(map[string]interface{})["id"].(string)
	v2 := map[string]interface{}{
		"dashboards": []interface{}{map[string]interface{}{
			"id": id, "name": "Synthetic", "path": path,
			"tabs": []interface{}{map[string]interface{}{
				"id": tabID, "name": "Main", "order": 0,
				"groups": []interface{}{
					map[string]interface{}{"id": "grp1", "name": "G", "width": "half", "collapsed": true, "displayStyle": "folder",
						"entries": []interface{}{map[string]interface{}{"id": "ent1", "name": "A", "url": "http://a.invalid"}}},
					map[string]interface{}{"id": "grp2", "name": "H", "width": "third",
						"entries": []interface{}{}},
				},
			}},
		}},
		"assets": map[string]interface{}{
			"/weird/x.png": map[string]interface{}{"contentType": "image/png", "data": "AAAA"},
		},
	}
	b, _ := json.Marshal(v2)
	code, resp := c.importFile(b)
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	msg, _ := resp["message"].(string)
	renamed, _ := resp["renamed"].([]interface{})
	var sawMove, sawIDs bool
	for _, r := range renamed {
		s, _ := r.(string)
		if strings.Contains(s, "moved to") && strings.Contains(s, "already taken") {
			sawMove = true
		}
		if strings.Contains(s, "internal id(s) were renamed") {
			sawIDs = true
		}
	}
	if !sawMove || !sawIDs || !strings.Contains(msg, "internal id(s) were renamed") || !strings.Contains(msg, "already taken") {
		t.Errorf("renames not reported: renamed=%v message=%q", renamed, msg)
	}
	failed, _ := resp["assetsFailed"].([]interface{})
	if len(failed) != 1 || !strings.Contains(msg, "could not be restored") || !strings.Contains(msg, "/weird/x.png") || !strings.Contains(msg, "not an icon or background") {
		t.Errorf("unrestored image not reported: failed=%v message=%q", failed, msg)
	}
	ds := dashList(storedDoc(t, db))
	n := 0
	configdoc.Walk(configdoc.Obj{"dashboards": []any{ds[len(ds)-1]}}, func(_, _ configdoc.Obj, _ []configdoc.Obj, nd configdoc.Obj) bool {
		if nd["kind"] == "folder" {
			n++
			for _, k := range []string{"collapsed", "displayStyle", "width"} {
				if _, has := nd[k]; has {
					t.Errorf("folder %v still has v2 key %q", nd["id"], k)
				}
			}
			if nd["display"] == nil {
				t.Errorf("folder %v has no display", nd["id"])
			}
		}
		return true
	})
	if n != 2 {
		t.Errorf("folders %d, want 2", n)
	}
}

// The sample configs of the other dashboards (converters/testdata) import end to end, and what
// couldn't be carried over is returned for the dialog (found in the rc1 trials).
func TestImport_OtherDashboardSamples(t *testing.T) {
	cases := map[string]string{
		"homer-upstream.yml":   "Font Awesome",
		"homer-homelab.yml":    "Font Awesome",
		"dashy-upstream.yml":   "widgets",
		"dashy-homelab.yml":    "new tab",
		"heimdall-export.json": "first tag",
	}
	for f, want := range cases {
		data, err := os.ReadFile("../converters/testdata/" + f)
		if err != nil {
			t.Fatal(err)
		}
		router, db := setupTestRouter(t)
		c := newClient(t, router)
		code, resp := c.importFile(data)
		if code != 200 {
			t.Fatalf("%s: %d %v", f, code, resp)
		}
		notes, _ := resp["notCarried"].([]interface{})
		joined := fmt.Sprint(notes)
		if !strings.Contains(joined, want) {
			t.Errorf("%s: notCarried lacks %q: %s", f, want, joined)
		}
		if !strings.Contains(resp["message"].(string), "couldn't be carried over") {
			t.Errorf("%s: message doesn't mention it: %v", f, resp["message"])
		}
		ds := dashList(storedDoc(t, db))
		if _, folders, tiles := counts(ds[len(ds)-1]); folders == 0 || tiles == 0 {
			t.Errorf("%s: imported %d folders, %d tiles", f, folders, tiles)
		}
		assertUniqueIDs(t, storedDoc(t, db))
	}
}

// An imported dashboard nested deeper than a save allows is refused at
// import, naming the limit, rather than accepted and then unsaveable.
func TestImport_TooDeepIsRefusedAtImport(t *testing.T) {
	router, _ := setupTestRouter(t)
	c := newClient(t, router)
	leaf := map[string]interface{}{"kind": "tile", "id": "deep-tile", "name": "Deep", "url": "https://deep.example", "size": "medium"}
	node := leaf
	for i := configdoc.MaxNestingDepth; i >= 1; i-- {
		node = map[string]interface{}{"kind": "folder", "id": fmt.Sprintf("deep-f%d", i), "name": "F", "size": "medium",
			"contentSize": "medium", "display": "expanded", "shape": "rounded", "showTitle": true,
			"content": map[string]interface{}{"children": []interface{}{node}}}
	}
	node["placement"] = map[string]interface{}{"x": 0, "y": 0, "w": 8, "h": 8}
	cfg := map[string]interface{}{
		"schemaVersion": configdoc.SchemaVersion, configdoc.LayoutVersionKey: configdoc.LayoutVersion,
		"dashboards": []interface{}{map[string]interface{}{
			"id": "deep", "name": "Deep", "path": "/deep",
			"tabs": []interface{}{map[string]interface{}{"id": "deep-t", "name": "T",
				"root": map[string]interface{}{"columns": configdoc.RootColumns, "children": []interface{}{node}}}},
		}},
	}
	code, resp := c.importFile(v3ExportOf(t, cfg))
	if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "nested deeper than 12 levels") {
		t.Fatalf("import of a %d-deep dashboard: %d %v", configdoc.MaxNestingDepth+1, code, resp)
	}
}
