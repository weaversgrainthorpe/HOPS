package api

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// M6 folder shapes (spec §3a.5, §3a.8): an unknown shape or tabPosition is
// refused on PUT, transfer and import with a clear message, nothing stored;
// Discovery promote creates Flat folders; Homer, Dashy and Heimdall imports
// come out Rounded.

// badShapeCases mutate one folder: each must be refused naming the field.
var badShapeCases = []struct {
	name, field string
	set         func(f map[string]interface{})
}{
	{"retired folder-tab", "shape", func(f map[string]interface{}) { f["shape"] = "folder-tab" }},
	{"unknown shape", "shape", func(f map[string]interface{}) { f["shape"] = "star" }},
	{"markup as shape", "shape", func(f map[string]interface{}) { f["shape"] = "<svg onload=alert(1)>" }},
	{"US spelling", "tabPosition", func(f map[string]interface{}) { f["shape"] = "folder-flat"; f["tabPosition"] = "center" }},
	{"number tabPosition", "tabPosition", func(f map[string]interface{}) { f["tabPosition"] = 1 }},
}

func firstFolder(d map[string]interface{}) map[string]interface{} {
	for _, k := range rootOf(d)["children"].([]interface{}) {
		if m := k.(map[string]interface{}); m["kind"] == "folder" {
			return m
		}
	}
	return nil
}

func TestPut_RefusesUnknownShapeOrTabPosition(t *testing.T) {
	for _, tc := range badShapeCases {
		t.Run(tc.name, func(t *testing.T) {
			router, db := setupTestRouter(t)
			c := newClient(t, router)
			seed(t, db)
			d := v3Body(t, c, "d1")
			tc.set(firstFolder(d))
			before := storedRaw(db)
			code, resp := v3Put(c, "d1", d, 1)
			if code != 400 {
				t.Fatalf("code %d %v, want 400", code, resp)
			}
			if msg := apiErrorText(resp); !strings.Contains(msg, tc.field) {
				t.Errorf("message %q does not name %s", msg, tc.field)
			}
			if storedRaw(db) != before {
				t.Error("a refused save changed the stored document")
			}
		})
	}
	// Every listed shape and tab position saves.
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	rev := 1
	for _, s := range configdoc.FolderShapes {
		for _, p := range configdoc.FolderTabPositions {
			d := v3Body(t, c, "d1")
			f := firstFolder(d)
			f["shape"], f["tabPosition"] = s, p
			if code, resp := v3Put(c, "d1", d, rev); code != 200 {
				t.Fatalf("shape %s tabPosition %s: %d %v", s, p, code, resp)
			}
			rev++
		}
	}
}

// apiErrorText is the error text of a 400 body (error or detail).
func apiErrorText(resp map[string]interface{}) string {
	s, _ := resp["error"].(string)
	d, _ := resp["detail"].(string)
	return s + " " + d
}

func TestImport_RefusesUnknownShapeOrTabPosition(t *testing.T) {
	for _, tc := range badShapeCases {
		t.Run(tc.name, func(t *testing.T) {
			router, db := setupTestRouter(t)
			c := newClient(t, router)
			seed(t, db)
			var env map[string]interface{}
			if err := json.Unmarshal(c.export(""), &env); err != nil {
				t.Fatal(err)
			}
			cfg := env["config"].(map[string]interface{})
			tc.set(firstFolder(dashOf(cfg)))
			before := storedRaw(db)
			code, resp := c.importFile(v3ExportOf(t, cfg))
			if code != 400 {
				t.Fatalf("code %d %v, want 400", code, resp)
			}
			if msg := apiErrorText(resp); !strings.Contains(msg, tc.field) {
				t.Errorf("message %q does not name %s", msg, tc.field)
			}
			if storedRaw(db) != before {
				t.Error("a refused import changed the stored document")
			}
		})
	}
}

// A folder carrying a bad shape (stored before this check existed) is not
// carried onto another dashboard by a transfer: refused, nothing stored.
func TestTransfer_RefusesUnknownShapeOrTabPosition(t *testing.T) {
	for _, tc := range badShapeCases {
		t.Run(tc.name, func(t *testing.T) {
			router, db := setupTestRouter(t)
			c := newClient(t, router)
			seed(t, db)
			addD2(t, db)
			doc := storedDoc(t, db)
			g := findNode(storedDashboards(doc)["d1"], "g1")[0]
			tc.set(g)
			if err := configdoc.Save(db, doc); err != nil {
				t.Fatal(err)
			}
			before := storedRaw(db)
			code, resp := c.do("POST", "/api/dashboards/transfer", transferBody(map[string]interface{}{
				"nodeIds": []string{"g1"}, "target": map[string]interface{}{"tabId": "d2-t1"}}))
			if code != 400 {
				t.Fatalf("code %d %v, want 400", code, resp)
			}
			if msg := apiErrorText(resp); !strings.Contains(msg, tc.field) {
				t.Errorf("message %q does not name %s", msg, tc.field)
			}
			if storedRaw(db) != before {
				t.Error("a refused transfer changed the stored document")
			}
		})
	}
}

// §3a.5: a folder Discovery promote creates is Flat.
func TestPromote_CreatesFlatFolder(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	scanID, rid := seedScan(t, db)
	if code, resp := c.do("POST", "/api/discovery/scans/"+scanID+"/promote", promoteBody(rid)); code != 200 {
		t.Fatalf("promote: %d %v", code, resp)
	}
	n := 0
	for _, k := range storedDash(t, db, "d1")["tabs"].([]any)[0].(configdoc.Obj)["root"].(configdoc.Obj)["children"].([]any) {
		f := k.(configdoc.Obj)
		if f["kind"] != "folder" || f["id"] == "g1" {
			continue
		}
		n++
		if f["shape"] != "folder-flat" {
			t.Errorf("promoted folder %v shape %v, want folder-flat", f["name"], f["shape"])
		}
	}
	if n == 0 {
		t.Fatal("promote created no folder")
	}
}

// §3a.5: Homer, Dashy and Heimdall imports are converted folders: Rounded.
func TestImport_OtherDashboardsAreRounded(t *testing.T) {
	sources := map[string][]byte{
		"Homer":    []byte("title: H\nservices:\n  - name: Media\n    items:\n      - name: Plex\n        url: https://plex\n"),
		"Dashy":    []byte("pageInfo:\n  title: D\nsections:\n  - name: Tools\n    items:\n      - title: Grafana\n        url: https://grafana\n"),
		"Heimdall": []byte(`[{"title":"Plex","url":"http://plex"}]`),
	}
	for name, data := range sources {
		t.Run(name, func(t *testing.T) {
			router, db := setupTestRouter(t)
			c := newClient(t, router)
			if code, resp := c.importFile(data); code != 200 {
				t.Fatalf("import: %d %v", code, resp)
			}
			ds := dashList(storedDoc(t, db))
			n := 0
			configdoc.Walk(configdoc.Obj{"dashboards": []any{ds[len(ds)-1]}}, func(_, _ configdoc.Obj, _ []configdoc.Obj, f configdoc.Obj) bool {
				if f["kind"] == "folder" {
					n++
					if f["shape"] != "rounded" {
						t.Errorf("folder %v shape %v, want rounded", f["name"], f["shape"])
					}
				}
				return true
			})
			if n == 0 {
				t.Fatal("no folders imported")
			}
		})
	}
}
