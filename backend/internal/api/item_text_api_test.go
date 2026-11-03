package api

import (
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// A tile's textColor and a folder's description go through the REAL export and
// import handlers unchanged, and a save with a textColor HOPS doesn't know is
// refused with a 400 naming the field.

func textNode(doc configdoc.Obj, dashIdx int, kind string) configdoc.Obj {
	var out configdoc.Obj
	d := dashList(doc)[dashIdx]
	configdoc.Walk(configdoc.Obj{"dashboards": []any{d}}, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		if out == nil && n["kind"] == kind {
			out = n
		}
		return true
	})
	return out
}

func TestExportImport_KeepsTextColourAndFolderDescription(t *testing.T) {
	for _, q := range []string{"", "?format=yaml"} {
		t.Run("q"+q, func(t *testing.T) {
			router, db := setupTestRouter(t)
			c := newClient(t, router)
			seed(t, db)
			doc := storedDoc(t, db)
			textNode(doc, 0, "folder")["description"] = "Films and TV"
			textNode(doc, 0, "folder")["textColor"] = "light"
			textNode(doc, 0, "tile")["textColor"] = "dark"
			if err := configdoc.Save(db, doc); err != nil {
				t.Fatal(err)
			}
			if code, resp := c.importFile(c.export(q)); code != 200 {
				t.Fatalf("import: %d %v", code, resp)
			}
			after := storedDoc(t, db)
			ds := dashList(after)
			if len(ds) != 2 {
				t.Fatalf("dashboards %d, want 2 (the original and the import)", len(ds))
			}
			f, tile := textNode(after, 1, "folder"), textNode(after, 1, "tile")
			if f["description"] != "Films and TV" || f["textColor"] != "light" {
				t.Errorf("imported folder lost its fields: %v", f)
			}
			if tile["textColor"] != "dark" {
				t.Errorf("imported tile textColor = %v, want dark", tile["textColor"])
			}
		})
	}
}

func TestSave_RefusesUnknownTextColour(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	d := v3Body(t, c, "d1")
	kids := d["tabs"].([]interface{})[0].(map[string]interface{})["root"].(map[string]interface{})["children"].([]interface{})
	folder := kids[0].(map[string]interface{})
	folder["content"].(map[string]interface{})["children"].([]interface{})[0].(map[string]interface{})["textColor"] = "white"
	code, resp := c.do("PUT", "/api/dashboards/d1", map[string]interface{}{"schema": 3, "dashboard": d, "revision": 1, "layoutVersion": configdoc.LayoutVersion})
	if code != 400 {
		t.Fatalf("save with textColor white: %d %v, want 400", code, resp)
	}
	if msg, _ := resp["error"].(string); !strings.Contains(msg, "textColor") {
		t.Errorf("refusal does not name textColor: %v", resp)
	}
}
