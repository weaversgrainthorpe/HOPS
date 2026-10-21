package api

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/discovery"
	"gopkg.in/yaml.v3"
)

// Finer grid (spec §9): an old-form v3 export (no gridUnit marker) is
// converted on import — every grid placement doubled, free untouched — and
// verified against the file; a new-form export carries the marker in
// config.gridUnit and is imported as is.

func TestImport_OldFormShowcaseIsDoubled(t *testing.T) {
	data, err := os.ReadFile("../configdoc/testdata/v3_showcase_export.json")
	if err != nil {
		t.Fatal(err)
	}
	var env map[string]any
	if err := json.Unmarshal(data, &env); err != nil {
		t.Fatal(err)
	}
	cfg := env["config"].(map[string]any)
	if _, has := cfg["gridUnit"]; has {
		t.Fatal("fixture must stay an OLD-form export (no gridUnit)")
	}
	file := dashOf(cfg)

	router, db := setupTestRouter(t)
	c := newClient(t, router)
	code, resp := c.importFile(data)
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	got := storedDash(t, db, "sc-dash")
	// The whole conversion, checked against the file by the same verifier
	// the startup update uses (revision restarts at 1 on import).
	file["revision"] = 1.0
	before := configdoc.Obj{"schemaVersion": 3.0, "dashboards": []any{configdoc.Obj(file)}}
	after := configdoc.Obj{"schemaVersion": 3.0, "gridUnit": 2.0, "dashboards": []any{got}}
	if err := configdoc.VerifyGridV5(before, after); err != nil {
		t.Fatalf("imported Showcase is not the file on the finer grid: %v", err)
	}
	// Spot checks, so a verifier bug cannot hide a wrong result.
	tabs := got["tabs"].([]any)
	if c := tabs[0].(configdoc.Obj)["root"].(configdoc.Obj)["columns"]; c != float64(24) {
		t.Errorf("grid root columns = %v, want 24", c)
	}
	if c := tabs[1].(configdoc.Obj)["root"].(configdoc.Obj)["columns"]; c != float64(160) {
		t.Errorf("free root columns = %v, want 160 (untouched)", c)
	}
	r2 := tabs[0].(configdoc.Obj)["root"].(configdoc.Obj)["children"].([]any)[1].(configdoc.Obj)
	if p, _ := json.Marshal(r2["placement"]); string(p) != `{"h":2,"w":2,"x":2,"y":0}` {
		t.Errorf("sc-r2 placement = %s, want doubled {x:2,y:0,w:2,h:2}", p)
	}
	ft := tabs[1].(configdoc.Obj)["root"].(configdoc.Obj)["children"].([]any)[0].(configdoc.Obj)
	ff := file["tabs"].([]any)[1].(map[string]any)["root"].(map[string]any)["children"].([]any)[0].(map[string]any)
	gp, _ := json.Marshal(ft["placement"])
	wp, _ := json.Marshal(ff["placement"])
	if string(gp) != string(wp) {
		t.Errorf("free tab child placement = %s, want unchanged %s", gp, wp)
	}
}

func TestExport_CarriesGridMarker(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	for _, q := range []string{"", "?dashboardId=d1", "?format=yaml", "?dashboardId=d1&format=yaml"} {
		var env map[string]any
		raw := c.export(q)
		var err error
		if strings.Contains(q, "yaml") {
			err = yaml.Unmarshal(raw, &env)
		} else {
			err = json.Unmarshal(raw, &env)
		}
		if err != nil {
			t.Fatalf("export%s: %v", q, err)
		}
		cfg, _ := env["config"].(map[string]any)
		if g, _ := cfg["gridUnit"].(float64); g != 2 {
			if gi, _ := cfg["gridUnit"].(int); gi != 2 {
				t.Errorf("export%s: config.gridUnit = %v, want 2", q, cfg["gridUnit"])
			}
		}
	}
}

func TestImport_NewFormExportIsNotDoubledAgain(t *testing.T) {
	for _, q := range []string{"", "?dashboardId=d1", "?format=yaml"} {
		t.Run("q"+q, func(t *testing.T) {
			router, db := setupTestRouter(t)
			c := newClient(t, router)
			seed(t, db)
			orig := storedDash(t, db, "d1")
			code, resp := c.importFile(c.export(q))
			if code != 200 {
				t.Fatalf("import: %d %v", code, resp)
			}
			ds := dashList(storedDoc(t, db))
			imp := ds[len(ds)-1]
			want, _ := json.Marshal(orig["tabs"].([]any)[0].(configdoc.Obj)["root"])
			// Ids may be renamed on a re-import; compare placements and columns.
			strip := func(b []byte) string {
				var x any
				json.Unmarshal(b, &x)
				return placementsOnly(x)
			}
			got, _ := json.Marshal(imp["tabs"].([]any)[0].(map[string]any)["root"])
			if strip(got) != strip(want) {
				t.Errorf("re-imported layout = %s, want %s", strip(got), strip(want))
			}
		})
	}
}

// placementsOnly renders every columns and placement value in x, in order.
func placementsOnly(x any) string {
	var sb strings.Builder
	var walk func(any)
	walk = func(v any) {
		switch o := v.(type) {
		case map[string]any:
			if c, ok := o["columns"]; ok {
				b, _ := json.Marshal(c)
				sb.WriteString("c" + string(b) + ";")
			}
			if p, ok := o["placement"]; ok {
				b, _ := json.Marshal(p)
				sb.WriteString(string(b) + ";")
			}
			for _, k := range []string{"children", "content"} {
				if ch, ok := o[k]; ok {
					walk(ch)
				}
			}
		case []any:
			for _, e := range o {
				walk(e)
			}
		}
	}
	walk(x)
	return sb.String()
}

func TestImport_UnknownGridMarkerRefused(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	var env map[string]any
	json.Unmarshal(c.export(""), &env)
	cfg := env["config"].(map[string]any)
	cfg["gridUnit"] = 3
	var before string
	db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&before)
	code, resp := c.importFile(v3ExportOf(t, cfg))
	if code != 400 || !strings.Contains(resp["error"].(string), "gridUnit") {
		t.Fatalf("import: %d %v, want 400 naming gridUnit", code, resp)
	}
	var after string
	db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&after)
	if before != after {
		t.Error("config row changed")
	}
}

func TestImport_V2ExportWritesFinerGrid(t *testing.T) {
	data, err := os.ReadFile("../configdoc/testdata/real_sample.json")
	if err != nil {
		t.Fatal(err)
	}
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	if code, resp := c.importFile(data); code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	ds := dashList(storedDoc(t, db))
	imp := ds[len(ds)-1]
	root := imp["tabs"].([]any)[0].(map[string]any)["root"].(map[string]any)
	if root["columns"] != float64(24) {
		t.Errorf("root columns = %v, want 24", root["columns"])
	}
	f := root["children"].([]any)[0].(map[string]any)
	tile := f["content"].(map[string]any)["children"].([]any)[0].(map[string]any)
	if p, _ := json.Marshal(tile["placement"]); string(p) != `{"h":2,"w":2,"x":0,"y":0}` {
		t.Errorf("first tile placement = %s, want 2×2", p)
	}
}

func TestNewDashboard_Root24(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	code, resp := c.do("POST", "/api/dashboards", map[string]any{"name": "Fresh", "path": "/fresh"})
	if code != 200 && code != 201 {
		t.Fatalf("create: %d %v", code, resp)
	}
	d := storedDash(t, db, resp["id"].(string))
	if c := d["tabs"].([]any)[0].(configdoc.Obj)["root"].(configdoc.Obj)["columns"]; c != float64(24) {
		t.Errorf("new dashboard root columns = %v, want 24", c)
	}
}

func TestFreeSide_24Columns(t *testing.T) {
	for dw, want := range map[float64]float64{1280: 7, 1920: 10, 320: 2, 0: 7} {
		tab := configdoc.Obj{}
		if dw > 0 {
			tab["designWidth"] = dw
		}
		if got := freeSideOf(tab); got != want {
			t.Errorf("freeSideOf(%v) = %v, want %v", dw, got, want)
		}
	}
	if got := newFreeSpace(configdoc.Obj{"children": []any{}}, 10).cols; got != 24 {
		t.Errorf("newFreeSpace default cols = %v, want 24", got)
	}
}

// Promote into a grid tab places in the new units: a category folder 8 cells
// wide (4 Medium tiles), each tile 2x2, each tile row 2 cells, and a 2-cell
// title row.
func TestPromote_GridTabNewUnits(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	scanID, rid := seedScan(t, db)
	insertResults(t, discovery.NewStore(db), scanID, "result-0010", "result-0011", "result-0012", "result-0013")
	code, resp := c.do("POST", "/api/discovery/scans/"+scanID+"/promote", map[string]any{
		"target":    map[string]any{"dashboardId": "d1", "tabId": "t1"},
		"resultIds": []string{rid, "result-0010", "result-0011", "result-0012", "result-0013"}})
	if code != 200 {
		t.Fatalf("promote: %d %v", code, resp)
	}
	var folder configdoc.Obj
	for _, k := range storedDash(t, db, "d1")["tabs"].([]any)[0].(configdoc.Obj)["root"].(configdoc.Obj)["children"].([]any) {
		if m := k.(configdoc.Obj); m["name"] == "Other" {
			folder = m
		}
	}
	if folder == nil {
		t.Fatal("no Other folder")
	}
	// g1 (from seed) fills the first 4 rows across all 24 columns.
	if p, _ := json.Marshal(folder["placement"]); string(p) != `{"h":6,"w":8,"x":0,"y":4}` {
		t.Errorf("folder placement = %s, want {x:0,y:4,w:8,h:6}", p)
	}
	if cols := folder["content"].(configdoc.Obj)["columns"]; cols != float64(8) {
		t.Errorf("folder columns = %v, want 8", cols)
	}
	want := []string{`{"h":2,"w":2,"x":0,"y":0}`, `{"h":2,"w":2,"x":2,"y":0}`, `{"h":2,"w":2,"x":4,"y":0}`, `{"h":2,"w":2,"x":6,"y":0}`, `{"h":2,"w":2,"x":0,"y":2}`}
	for i, k := range folder["content"].(configdoc.Obj)["children"].([]any) {
		if p, _ := json.Marshal(k.(configdoc.Obj)["placement"]); string(p) != want[i] {
			t.Errorf("tile %d placement = %s, want %s", i, p, want[i])
		}
	}
}
