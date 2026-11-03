package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// A tile's or folder's description is capped at maxDescriptionRunes on save
// and import, refused with the item named. A description already stored over
// the cap (from before the cap) is kept while it is unchanged.

// seededFolderAndTile is d1's first folder and the first tile in it, from a
// v3Body copy.
func seededFolderAndTile(d map[string]interface{}) (folder, tile map[string]interface{}) {
	kids := d["tabs"].([]interface{})[0].(map[string]interface{})["root"].(map[string]interface{})["children"].([]interface{})
	folder = kids[0].(map[string]interface{})
	tile = folder["content"].(map[string]interface{})["children"].([]interface{})[0].(map[string]interface{})
	return folder, tile
}

func TestSave_DescriptionCap(t *testing.T) {
	long := strings.Repeat("é", maxDescriptionRunes+1)
	atCap := strings.Repeat("é", maxDescriptionRunes)
	for _, kind := range []string{"tile", "folder"} {
		t.Run(kind, func(t *testing.T) {
			router, db := setupTestRouter(t)
			c := newClient(t, router)
			seed(t, db)
			d := v3Body(t, c, "d1")
			folder, tile := seededFolderAndTile(d)
			item := tile
			if kind == "folder" {
				item = folder
			}
			before := storedRaw(db)
			item["description"] = long
			code, resp := v3Put(c, "d1", d, 1)
			msg, _ := resp["error"].(string)
			if code != 400 || !strings.Contains(msg, fmt.Sprintf("longer than %d characters", maxDescriptionRunes)) ||
				!strings.Contains(msg, fmt.Sprintf("%q", item["name"])) {
				t.Fatalf("save with a %d-character description: %d %v, want 400 naming the %s", maxDescriptionRunes+1, code, resp, kind)
			}
			if storedRaw(db) != before {
				t.Error("refused save changed the stored doc")
			}
			item["description"] = atCap
			if code, resp := v3Put(c, "d1", d, 1); code != 200 {
				t.Fatalf("save at the cap: %d %v", code, resp)
			}
		})
	}
}

// Stored before the cap: still saves while unchanged; a new long one is refused.
func TestSave_DescriptionOverCapKeptWhileUnchanged(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	long := strings.Repeat("x", maxDescriptionRunes+10)
	doc := storedDoc(t, db)
	textNode(doc, 0, "tile")["description"] = long
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
	d := v3Body(t, c, "d1")
	folder, _ := seededFolderAndTile(d)
	folder["name"] = "Renamed"
	if code, resp := v3Put(c, "d1", d, 1); code != 200 {
		t.Fatalf("save keeping a stored long description: %d %v", code, resp)
	}
	folder["description"] = long + "!"
	if code, resp := v3Put(c, "d1", d, 2); code != 400 {
		t.Fatalf("save adding a new long description: %d %v, want 400", code, resp)
	}
}

func TestImport_DescriptionCap(t *testing.T) {
	long := strings.Repeat("x", maxDescriptionRunes+1)
	t.Run("v3", func(t *testing.T) {
		router, db := setupTestRouter(t)
		c := newClient(t, router)
		seed(t, db)
		var env map[string]any
		if err := json.Unmarshal(c.export(""), &env); err != nil {
			t.Fatal(err)
		}
		cfg := env["config"].(map[string]any)
		textNode(configdoc.Obj(cfg), 0, "folder")["description"] = long
		importRefusedWith(t, c, db, v3ExportOf(t, cfg), "Import refused", fmt.Sprintf("longer than %d characters", maxDescriptionRunes))
	})
	t.Run("v2", func(t *testing.T) {
		router, db := setupTestRouter(t)
		c := newClient(t, router)
		d := v2Dash("a", "Alpha", "/alpha")
		g := d["tabs"].([]interface{})[0].(map[string]interface{})["groups"].([]interface{})[0].(map[string]interface{})
		g["entries"].([]interface{})[0].(map[string]interface{})["description"] = long
		importRefusedWith(t, c, db, v2File(d), "Import refused", `"Alpha"`, `"Checked"`, fmt.Sprintf("longer than %d characters", maxDescriptionRunes))
	})
}

// importRefusedWith imports data and wants a 400 naming every want, with the
// stored config unchanged.
func importRefusedWith(t *testing.T, c *apiClient, db *sql.DB, data []byte, wants ...string) {
	t.Helper()
	before := storedRaw(db)
	code, resp := c.importFile(data)
	msg, _ := resp["error"].(string)
	if code != 400 {
		t.Fatalf("import: %d %v, want 400", code, resp)
	}
	for _, w := range wants {
		if !strings.Contains(msg, w) {
			t.Errorf("error %q does not mention %s", msg, w)
		}
	}
	if storedRaw(db) != before {
		t.Error("config row changed")
	}
}
