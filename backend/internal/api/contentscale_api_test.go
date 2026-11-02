package api

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// The dashboard's "Tile content size" (contentScale) saves with the dashboard (its revision moves on,
// so other browsers and the offline copy pick it up), round-trips through export and import, and a
// bad value is refused with a 400 on save and on import.
func TestContentScale_SaveExportImport(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	d1 := func() configdoc.Obj {
		for _, d := range dashList(storedDoc(t, db)) {
			if d["id"] == "d1" {
				return d
			}
		}
		t.Fatal("no d1")
		return nil
	}
	put := func(v any) (int, map[string]interface{}) {
		d := d1()
		rev := d["revision"]
		d["contentScale"] = v
		return c.do("PUT", "/api/dashboards/d1", map[string]interface{}{"schema": 3, "dashboard": d, "revision": rev, "layoutVersion": configdoc.LayoutVersion})
	}
	for _, bad := range []any{130, 102, "110", nil} {
		code, resp := put(bad)
		if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "tile content size") {
			t.Fatalf("contentScale %v: got %d %v", bad, code, resp)
		}
	}
	revBefore := d1()["revision"]
	if code, resp := put(110); code != 200 {
		t.Fatalf("save 110: %d %v", code, resp)
	}
	if got := d1(); got["contentScale"] != float64(110) || got["revision"] == revBefore {
		t.Fatalf("stored %v, revision %v (was %v)", got["contentScale"], got["revision"], revBefore)
	}
	exp := c.export("")
	if !strings.Contains(strings.ReplaceAll(string(exp), " ", ""), `"contentScale":110`) {
		t.Fatalf("export lacks contentScale: %s", exp)
	}
	if code, resp := c.importFile(exp); code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	ds := dashList(storedDoc(t, db))
	if ds[len(ds)-1]["contentScale"] != float64(110) {
		t.Fatalf("imported contentScale %v", ds[len(ds)-1]["contentScale"])
	}
	// A bad value in an import file is refused, and nothing is written.
	var env map[string]interface{}
	if err := json.Unmarshal(exp, &env); err != nil {
		t.Fatal(err)
	}
	cfg := env["config"].(map[string]interface{})
	for _, d := range cfg["dashboards"].([]interface{}) {
		d.(map[string]interface{})["contentScale"] = 150
	}
	bad, _ := json.Marshal(env)
	n := len(dashList(storedDoc(t, db)))
	code, resp := c.importFile(bad)
	if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "tile content size") {
		t.Fatalf("bad import: %d %v", code, resp)
	}
	if len(dashList(storedDoc(t, db))) != n {
		t.Fatal("a refused import wrote dashboards")
	}
}
