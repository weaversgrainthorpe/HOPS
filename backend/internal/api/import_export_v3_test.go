package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
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
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
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
	router, _ := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)
	for _, q := range []string{"", "?format=yaml", "?dashboardId=d1", "?dashboardId=d1&format=yaml"} {
		data := c.export(q)
		got, err := legacyDetect(data)
		if err == nil && got == "hops" {
			t.Errorf("export%s is accepted by the v2.2.1 detector as %q", q, got)
		}
	}
}

func TestExportEnvelope_Shape(t *testing.T) {
	router, _ := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, c)

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
			seed(t, c)
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
			if code != 500 || !strings.Contains(string(body), "error") {
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

var _ = http.StatusOK
