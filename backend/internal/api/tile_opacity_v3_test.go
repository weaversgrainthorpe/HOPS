package api

import (
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// A tile's opacity, textOpacity and iconOpacity survive a dashboard
// save, export (JSON and YAML) and import unchanged; out-of-range values are kept (the
// renderer clamps them) and never make a document be refused.
func TestTileOpacityFields_SaveExportImportRoundTrip(t *testing.T) {
	cases := []map[string]any{
		{"opacity": 0.2, "textOpacity": 0.5, "iconOpacity": 0.75},
		{"opacity": 2.0, "textOpacity": -1.0, "iconOpacity": 7.0},
	}
	for _, want := range cases {
		for _, q := range []string{"", "?format=yaml"} {
			t.Run("q"+q, func(t *testing.T) {
				router, db := setupTestRouter(t)
				c := newClient(t, router)
				seed(t, db)
				d := v3Body(t, c, "d1")
				var tile map[string]any
				configdoc.Walk(configdoc.Obj{"dashboards": []any{d}}, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
					if n["kind"] == "tile" {
						tile = n
						return false
					}
					return true
				})
				if tile == nil {
					t.Fatal("seeded dashboard has no tile")
				}
				for k, v := range want {
					tile[k] = v
				}
				if code, resp := v3Put(c, "d1", d, 1); code != 200 {
					t.Fatalf("save: %d %v", code, resp)
				}
				check := func(what string, dash configdoc.Obj) {
					t.Helper()
					found := false
					configdoc.Walk(configdoc.Obj{"dashboards": []any{dash}}, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
						if n["kind"] != "tile" {
							return true
						}
						found = true
						for k, v := range want {
							got, ok := n[k].(float64)
							if !ok {
								if i, isInt := n[k].(int); isInt {
									got, ok = float64(i), true
								}
							}
							if !ok || got != v.(float64) {
								t.Errorf("%s: tile %s = %#v, want %v", what, k, n[k], v)
							}
						}
						return false
					})
					if !found {
						t.Errorf("%s: no tile", what)
					}
				}
				ds := dashList(storedDoc(t, db))
				check("stored after save", ds[0])

				if code, resp := c.importFile(c.export(q)); code != 200 {
					t.Fatalf("import: %d %v", code, resp)
				}
				ds = dashList(storedDoc(t, db))
				if len(ds) != 2 {
					t.Fatalf("dashboards %d, want 2", len(ds))
				}
				check("imported copy", ds[1])
			})
		}
	}
}

// A folder's minimisedIcon survives save, export (JSON and YAML) and import,
// on a tab-level folder and on a folder nested inside it.
func TestFolderMinimisedIcon_SaveExportImportRoundTrip(t *testing.T) {
	for _, q := range []string{"", "?format=yaml"} {
		t.Run("q"+q, func(t *testing.T) {
			router, db := setupTestRouter(t)
			c := newClient(t, router)
			seed(t, db)
			d := v3Body(t, c, "d1")
			var top configdoc.Obj
			configdoc.Walk(configdoc.Obj{"dashboards": []any{d}}, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
				if n["kind"] == "folder" && top == nil {
					top = n
				}
				return top == nil
			})
			if top == nil {
				t.Fatal("seeded dashboard has no folder")
			}
			content, _ := top["content"].(map[string]any)
			if content == nil {
				t.Fatalf("seeded folder has no content object: %#v", top["content"])
			}
			children, _ := content["children"].([]any)
			content["children"] = append(children, map[string]any{
				"id": "nested-minicon", "kind": "folder", "name": "Nested", "display": "expanded",
				"size": "medium", "contentSize": "medium", "minimisedIcon": "own",
				"content": map[string]any{"children": []any{}},
			})
			top["minimisedIcon"] = "own"
			if code, resp := v3Put(c, "d1", d, 1); code != 200 {
				t.Fatalf("save: %d %v", code, resp)
			}
			// An import gives every folder a new id, so count them: both the
			// tab-level folder and the nested one must still say "own".
			check := func(what string, dash configdoc.Obj) {
				t.Helper()
				own, folders := 0, 0
				configdoc.Walk(configdoc.Obj{"dashboards": []any{dash}}, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
					if n["kind"] == "folder" {
						folders++
						if n["minimisedIcon"] == "own" {
							own++
						}
					}
					return true
				})
				if own != 2 {
					t.Errorf("%s: %d of %d folders kept minimisedIcon \"own\", want 2 (tab-level and nested)", what, own, folders)
				}
			}
			ds := dashList(storedDoc(t, db))
			check("stored after save", ds[0])
			if code, resp := c.importFile(c.export(q)); code != 200 {
				t.Fatalf("import: %d %v", code, resp)
			}
			ds = dashList(storedDoc(t, db))
			if len(ds) != 2 {
				t.Fatalf("dashboards %d, want 2", len(ds))
			}
			check("imported copy", ds[1])
		})
	}
}
