package api

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// A v2 tile whose size HOPS does not recognise ("custom", a
// number, …) becomes Medium. It never blocks start-up or an import, and it is
// never silent: a one-time notice lists the tiles until dismissed.

// unknownSizeV2 is the v2_basic fixture with e1 "custom" and e4 numeric.
func unknownSizeV2(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile("../configdoc/testdata/v2_basic.json")
	if err != nil {
		t.Fatal(err)
	}
	var v2 map[string]any
	if err := json.Unmarshal(b, &v2); err != nil {
		t.Fatal(err)
	}
	d := v2["dashboards"].([]any)[0].(map[string]any)
	d["path"] = "/home"
	tabs := d["tabs"].([]any)
	groups := tabs[0].(map[string]any)["groups"].([]any)
	groups[0].(map[string]any)["entries"].([]any)[0].(map[string]any)["size"] = "custom"
	groups[1].(map[string]any)["entries"].([]any)[0].(map[string]any)["size"] = 3
	out, _ := json.Marshal(v2)
	return out
}

// sizeNotice returns the tile-size notice in GET /api/config, or nil.
func sizeNotice(t *testing.T, c *apiClient) map[string]interface{} {
	t.Helper()
	list, _ := getView(t, c)["notices"].([]interface{})
	for _, n := range list {
		m := n.(map[string]interface{})
		if strings.HasPrefix(m["id"].(string), "tile-sizes-medium") {
			return m
		}
	}
	return nil
}

func assertSizeNoticeText(t *testing.T, text string) {
	t.Helper()
	for _, want := range []string{`"A"`, `"D"`, `"custom"`, `3`, "Medium", `"Home"`} {
		if !strings.Contains(text, want) {
			t.Errorf("notice %q does not mention %s", text, want)
		}
	}
}

func TestStartup_UnknownTileSizeIsMediumWithNotice(t *testing.T) {
	router, db := setupTestRouterSeeded(t, string(unknownSizeV2(t)))
	c := newClient(t, router)
	doc := storedDoc(t, db)
	for _, id := range []string{"e1", "e4"} {
		if _, tile, ok := configdoc.FindTile(doc, id); !ok || tile["size"] != "medium" {
			t.Errorf("%s = %v, want size medium", id, tile)
		}
	}
	n := sizeNotice(t, c)
	if n == nil {
		t.Fatal("no tile-size notice after the migration")
	}
	assertSizeNoticeText(t, n["text"].(string))

	// One-time: dismissed, it is gone.
	if code, resp := c.do("POST", "/api/notices/"+n["id"].(string)+"/dismiss", nil); code != 200 {
		t.Fatalf("dismiss: %d %v", code, resp)
	}
	if again := sizeNotice(t, c); again != nil {
		t.Fatalf("notice still shown after dismissal: %v", again)
	}
}

func TestImport_UnknownTileSizeIsMediumWithNotice(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	code, resp := c.importFile(unknownSizeV2(t))
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	msg, _ := resp["message"].(string)
	if !strings.Contains(msg, "Medium") || !strings.Contains(msg, `"custom"`) {
		t.Errorf("import message %q does not report the normalised sizes", msg)
	}
	ds := dashList(storedDoc(t, db))
	imp := ds[len(ds)-1]
	assertCurrentDashboard(t, imp)
	for _, name := range []string{"A", "D"} {
		found := false
		configdoc.Walk(configdoc.Obj{"dashboards": []any{imp}}, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
			if n["name"] == name {
				found = n["size"] == "medium"
			}
			return true
		})
		if !found {
			t.Errorf("imported tile %s is not Medium", name)
		}
	}
	n := sizeNotice(t, c)
	if n == nil {
		t.Fatal("no tile-size notice after the import")
	}
	assertSizeNoticeText(t, n["text"].(string))
}
