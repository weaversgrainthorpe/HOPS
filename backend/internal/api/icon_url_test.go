package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// A tile's, folder's or tab's iconUrl is one of the forms HOPS writes (an
// uploaded icon, a packaged icon, a preset), an http(s) image address or a
// data:image; anything else is refused on import and save, naming the item.

func TestIconURLProblem(t *testing.T) {
	good := []string{
		"",
		"/icons/0123456789abcdef.png",
		"/icons/my_icon-2.svg",
		"/api/icons/dashboard/proxmox.svg",
		"/api/icons/dashboard/home-assistant.svg",
		"/presets/forest.jpg",
		"https://example.com/icon.png",
		"http://192.168.1.10:8080/favicon.ico",
		"HTTPS://Example.com/x.png?v=2",
		"data:image/png;base64,iVBORw0KGgo=",
		"data:image/svg+xml;utf8,<svg/>",
	}
	for _, u := range good {
		if why := iconURLProblem(u); why != "" {
			t.Errorf("iconURLProblem(%q) = %q, want accepted", u, why)
		}
	}
	bad := []string{
		"/icons/../../../x.png",
		"/icons/a/../b.png",
		"/icons/sub/x.png",
		"/api/icons/../config",
		"/api/icons/dashboard/../../x.svg",
		"/presets/../x.jpg",
		"/backgrounds/x.jpg",
		"/settings",
		"icons/x.png",
		"x.png",
		"//tracker.example/p.gif",
		"javascript:alert(1)",
		"data:text/html,<b>x</b>",
		"file:///etc/passwd",
		"ftp://example.com/x.png",
		"mdi:home",
		"http://",
		"https:///x.png",
		"http://example.com/../x.png",
	}
	for _, u := range bad {
		if why := iconURLProblem(u); why == "" {
			t.Errorf("iconURLProblem(%q) accepted, want refused", u)
		}
	}
}

// Every iconUrl in the model fixtures (v2 and v3, real data) is accepted.
func TestIconURLProblem_FixturesAccepted(t *testing.T) {
	files, _ := filepath.Glob("../configdoc/testdata/*.json")
	if len(files) == 0 {
		t.Fatal("no fixtures found")
	}
	seen := 0
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var v any
		if json.Unmarshal(b, &v) != nil {
			continue
		}
		var walk func(any)
		walk = func(x any) {
			switch o := x.(type) {
			case map[string]any:
				if u, ok := o["iconUrl"].(string); ok {
					seen++
					if why := iconURLProblem(u); why != "" {
						t.Errorf("%s: iconUrl %q refused: %s", filepath.Base(f), u, why)
					}
				}
				for _, c := range o {
					walk(c)
				}
			case []any:
				for _, c := range o {
					walk(c)
				}
			}
		}
		walk(v)
	}
	if seen == 0 {
		t.Error("no iconUrl found in the fixtures")
	}
}

// The real-data fixtures import unchanged through the real import handler.
func TestImport_FixturesWithIconURLsImport(t *testing.T) {
	for _, f := range []string{"v2_basic.json", "v2_messy.json", "v2_dup_ids.json", "real_sample.json", "real_weavers.json", "v3_showcase_export.json"} {
		t.Run(f, func(t *testing.T) {
			b, err := os.ReadFile("../configdoc/testdata/" + f)
			if err != nil {
				t.Fatal(err)
			}
			router, _ := setupTestRouter(t)
			if code, resp := newClient(t, router).importFile(b); code != 200 {
				t.Fatalf("import %s: %d %v", f, code, resp)
			}
		})
	}
	t.Run("v3_full_fields.json", func(t *testing.T) {
		b, err := os.ReadFile("../configdoc/testdata/v3_full_fields.json")
		if err != nil {
			t.Fatal(err)
		}
		var cfg map[string]any
		if err := json.Unmarshal(b, &cfg); err != nil {
			t.Fatal(err)
		}
		cfg["layoutVersion"] = configdoc.LayoutVersion
		router, _ := setupTestRouter(t)
		if code, resp := newClient(t, router).importFile(v3ExportOf(t, cfg)); code != 200 {
			t.Fatalf("import: %d %v", code, resp)
		}
	})
}

func TestImport_UnsafeIconURLRefused(t *testing.T) {
	t.Run("v3", func(t *testing.T) {
		router, db := setupTestRouter(t)
		c := newClient(t, router)
		seed(t, db)
		var env map[string]any
		if err := json.Unmarshal(c.export(""), &env); err != nil {
			t.Fatal(err)
		}
		cfg := env["config"].(map[string]any)
		tile := textNode(configdoc.Obj(cfg), 0, "tile")
		tile["iconUrl"] = "/icons/../../../x.png"
		importRefusedWith(t, c, db, v3ExportOf(t, cfg), "Import refused", `"First"`, `tile "`+tile["name"].(string)+`"`, "icon")
	})
	t.Run("v2", func(t *testing.T) {
		router, db := setupTestRouter(t)
		c := newClient(t, router)
		d := v2Dash("a", "Alpha", "/alpha")
		g := d["tabs"].([]interface{})[0].(map[string]interface{})["groups"].([]interface{})[0].(map[string]interface{})
		g["entries"].([]interface{})[0].(map[string]interface{})["iconUrl"] = "//tracker.example/p.gif"
		importRefusedWith(t, c, db, v2File(d), "Import refused", `"Alpha"`, `tile "Checked"`, "icon")
	})
}

func TestSave_UnsafeIconURL(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	d := v3Body(t, c, "d1")
	folder, tile := seededFolderAndTile(d)
	tile["iconUrl"] = "javascript:alert(1)"
	code, resp := v3Put(c, "d1", d, 1)
	msg, _ := resp["error"].(string)
	if code != 400 || !strings.Contains(msg, "icon") || !strings.Contains(msg, `"`+tile["name"].(string)+`"`) {
		t.Fatalf("save with a javascript: icon: %d %v, want 400 naming the tile", code, resp)
	}
	tile["iconUrl"] = "/icons/ok.png"
	folder["iconUrl"] = "https://example.com/f.png"
	if code, resp := v3Put(c, "d1", d, 1); code != 200 {
		t.Fatalf("save with good icons: %d %v", code, resp)
	}
}

// Stored before the check: still saves while unchanged.
func TestSave_UnsafeIconURLKeptWhileUnchanged(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	doc := storedDoc(t, db)
	textNode(doc, 0, "tile")["iconUrl"] = "icons/old-relative.png"
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
	d := v3Body(t, c, "d1")
	folder, _ := seededFolderAndTile(d)
	folder["name"] = "Renamed"
	if code, resp := v3Put(c, "d1", d, 1); code != 200 {
		t.Fatalf("save keeping a stored icon address: %d %v", code, resp)
	}
}
