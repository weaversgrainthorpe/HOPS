package configdoc

import (
	"strings"
	"testing"
)

// M5 (spec §2a): the release converters write the one-folder-model form
// directly, and one layoutVersion marks it. There is no v3→v3 update.

// m5Dash is a minimal valid M5 dashboard: one 24-column grid tab holding the
// given tab-level children.
func m5Dash(children ...any) Obj {
	return Obj{
		"id": "d", "name": "D", "path": "/d", "revision": 1,
		"settings": nullSettings(),
		"tabs":     []any{Obj{"id": "t", "name": "T", "root": Obj{"columns": RootColumns, "children": children}}},
	}
}

func m5Tile(id, size string, x, y int) Obj {
	var sz any
	if size != "" {
		sz = size
	}
	s, _ := SizeSpan(sz)
	n := Obj{"id": id, "kind": "tile", "name": id, "placement": Obj{"x": x, "y": y, "w": s, "h": s}}
	if size != "" {
		n["size"] = size
	}
	return n
}

func m5Folder(id string, x, y, w, h int, kids ...any) Obj {
	return Obj{"id": id, "kind": "folder", "name": id, "display": "expanded",
		"size": "medium", "contentSize": "medium",
		"placement": Obj{"x": x, "y": y, "w": w, "h": h},
		"content":   Obj{"children": kids}}
}

// inner is a folder child: no placement.
func inner(n Obj) Obj {
	delete(n, "placement")
	return n
}

func TestSizeSpan(t *testing.T) {
	for in, want := range map[any]int{"small": 1, "medium": 2, "large": 4, nil: 2, "": 2} {
		if got, ok := SizeSpan(in); !ok || got != want {
			t.Errorf("SizeSpan(%v) = %d,%v want %d", in, got, ok, want)
		}
	}
	for _, bad := range []any{"custom", "huge", 3.0, "Medium"} {
		if _, ok := SizeSpan(bad); ok {
			t.Errorf("SizeSpan(%v) accepted", bad)
		}
	}
}

func TestLayoutVersionCheck(t *testing.T) {
	if err := CheckLayoutVersion(Obj{LayoutVersionKey: 1.0}); err != nil {
		t.Errorf("current version refused: %v", err)
	}
	if err := CheckLayoutVersion(Obj{LayoutVersionKey: 1}); err != nil {
		t.Errorf("current version (int) refused: %v", err)
	}
	for name, doc := range map[string]Obj{
		"missing":                   {},
		"older":                     {LayoutVersionKey: 0.0},
		"newer":                     {LayoutVersionKey: 2.0},
		"string":                    {LayoutVersionKey: "1"},
		"gridUnit only (pre-M5 v3)": {"gridUnit": 2.0},
	} {
		err := CheckLayoutVersion(doc)
		if err == nil {
			t.Errorf("%s: accepted", name)
			continue
		}
		if !strings.Contains(err.Error(), "layout version 1") {
			t.Errorf("%s: %v does not name the current version", name, err)
		}
	}
	if err := CheckLayoutVersion(Obj{LayoutVersionKey: 2.0}); !strings.Contains(err.Error(), "2") {
		t.Errorf("newer: %v does not name the export's version", err)
	}
}

// Review Focus 2: every v2 fixture converts to the M5 form and verifies.
func TestMigrateV2_WritesM5Form(t *testing.T) {
	inputs := map[string]Obj{
		"v2_basic":     loadJSON(t, "testdata/v2_basic.json"),
		"v2_messy":     loadJSON(t, "testdata/v2_messy.json"),
		"v2_dup_ids":   loadJSON(t, "testdata/v2_dup_ids.json"),
		"real_sample":  realV2(t, "testdata/real_sample.json"),
		"real_weavers": realV2(t, "testdata/real_weavers.json"),
	}
	for name, v2 := range inputs {
		t.Run(name, func(t *testing.T) {
			doc, renames, err := MigrateV2Renaming(v2)
			if err != nil {
				t.Fatal(err)
			}
			if err := VerifyMigration(v2, doc, renames); err != nil {
				t.Fatal(err)
			}
			eq(t, doc[LayoutVersionKey], LayoutVersion, "layoutVersion")
			if _, has := doc["gridUnit"]; has {
				t.Error("gridUnit written; layoutVersion replaces it")
			}
			for _, d := range list(t, doc, "dashboards") {
				for _, k := range []string{"defaultLayout", "layout", "designWidth"} {
					if _, has := d[k]; has {
						t.Errorf("dashboard %v has %q", d["id"], k)
					}
				}
				for _, tab := range list(t, d, "tabs") {
					for _, k := range []string{"layout", "designWidth"} {
						if _, has := tab[k]; has {
							t.Errorf("tab %v has %q", tab["id"], k)
						}
					}
					eq(t, tab["root"].(Obj)["columns"], RootColumns, "root columns")
				}
			}
			Walk(doc, func(_, _ Obj, path []Obj, n Obj) bool {
				_, placed := n["placement"]
				if len(path) > 0 && placed {
					t.Errorf("folder child %v has a placement", n["id"])
				}
				if len(path) == 0 && !placed {
					t.Errorf("tab-level %v has no placement", n["id"])
				}
				if n["kind"] == "folder" {
					eq(t, n["size"], "medium", "folder size")
					eq(t, n["contentSize"], "medium", "folder contentSize")
					if _, has := n["layout"]; has {
						t.Errorf("folder %v has layout", n["id"])
					}
					if _, has := n["content"].(Obj)["columns"]; has {
						t.Errorf("folder %v content has columns", n["id"])
					}
				}
				return true
			})
		})
	}
}

// Folder children are an ordered list in v2 entry order; v2 `order` is carried
// but never re-sorts them. Each folder keeps its tab placement.
func TestMigrateV2_FolderChildrenInEntryOrder(t *testing.T) {
	v2 := loadJSON(t, "testdata/v2_basic.json")
	doc := migrated(t, v2)
	tabs := list(t, list(t, doc, "dashboards")[0], "tabs")
	folders := children(t, tabs[0]["root"].(Obj))
	var ids []string
	for _, c := range children(t, folders[0]["content"].(Obj)) {
		ids = append(ids, c["id"].(string))
	}
	eq(t, ids, []string{"e1", "e2", "e3"}, "child order")
	eq(t, folders[0]["placement"], Obj{"x": 0, "y": 0, "w": 24, "h": 4}, "folder placement")
	eq(t, folders[1]["placement"], Obj{"x": 0, "y": 4, "w": 12, "h": 4}, "folder placement")
	f := children(t, tabs[1]["root"].(Obj))[0]
	eq(t, f["display"], "collapsed", "display")
	eq(t, f["placement"], Obj{"x": 0, "y": 0, "w": 8, "h": 6}, "collapsed folder placement")
	if n := len(children(t, f["content"].(Obj))); n != 5 {
		t.Errorf("children = %d, want 5", n)
	}
}

// The real Weavers export (13-image slideshow) still converts and verifies.
func TestMigrateV2_RealWeaversSlideshowKept(t *testing.T) {
	v2 := realV2(t, "testdata/real_weavers.json")
	v3, renames, err := MigrateV2Renaming(v2)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyMigration(v2, v3, renames); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, d := range v3["dashboards"].([]any) {
		if bg, ok := d.(Obj)["background"].(Obj); ok {
			if imgs, ok := bg["images"].([]any); ok && len(imgs) == 13 {
				found = true
			}
		}
	}
	if !found {
		t.Error("no dashboard kept a 13-image slideshow")
	}
}

func TestVerifyMigration_RequiresLayoutVersion(t *testing.T) {
	v2 := loadJSON(t, "testdata/v2_basic.json")
	v3 := migrated(t, v2)
	delete(v3, LayoutVersionKey)
	wantProblem(t, Verify(v2, v3), LayoutVersionKey)
	v3[LayoutVersionKey] = 2
	wantProblem(t, Verify(v2, v3), LayoutVersionKey)
}

func TestVerifyDashboard_AcceptsM5Form(t *testing.T) {
	d := m5Dash(
		m5Tile("s", "small", 0, 0),
		m5Tile("m", "medium", 1, 0),
		m5Tile("dflt", "", 3, 0),
		m5Tile("l", "large", 5, 0),
		m5Folder("f", 9, 0, 8, 6,
			inner(m5Tile("a", "large", 0, 0)),
			inner(m5Folder("sub", 0, 0, 0, 0, inner(m5Tile("b", "small", 0, 0))))),
	)
	if err := VerifyDashboard(d); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyDashboard_RefusesNonM5Shapes(t *testing.T) {
	cases := map[string]struct {
		mutate func(d Obj)
		want   string
	}{
		"folder child placed": {func(d Obj) {
			f := rootKids(d)[1].(Obj)
			f["content"].(Obj)["children"] = []any{m5Tile("a", "medium", 0, 0)}
		}, "placement"},
		"free tab":                {func(d Obj) { tabOf(d)["layout"] = "free" }, "layout"},
		"tab designWidth":         {func(d Obj) { tabOf(d)["designWidth"] = 1280 }, "designWidth"},
		"dashboard defaultLayout": {func(d Obj) { d["defaultLayout"] = "grid" }, "defaultLayout"},
		"folder layout":           {func(d Obj) { rootKids(d)[1].(Obj)["layout"] = "grid" }, "layout"},
		"folder columns":          {func(d Obj) { rootKids(d)[1].(Obj)["content"].(Obj)["columns"] = 8 }, "columns"},
		"root not 24":             {func(d Obj) { tabOf(d)["root"].(Obj)["columns"] = 12 }, "columns"},
		"custom tile span": {func(d Obj) {
			rootKids(d)[0].(Obj)["placement"] = Obj{"x": 0, "y": 0, "w": 3, "h": 3}
		}, "span"},
		"span does not match size":   {func(d Obj) { rootKids(d)[0].(Obj)["size"] = "large" }, "span"},
		"unknown tile size":          {func(d Obj) { rootKids(d)[0].(Obj)["size"] = "custom" }, "size"},
		"folder without contentSize": {func(d Obj) { delete(rootKids(d)[1].(Obj), "contentSize") }, "contentSize"},
		"folder bad size":            {func(d Obj) { rootKids(d)[1].(Obj)["size"] = "huge" }, "size"},
		"tab-level overlap": {func(d Obj) {
			rootKids(d)[0].(Obj)["placement"] = Obj{"x": 10, "y": 1, "w": 2, "h": 2}
		}, "overlap"},
		"past the right edge": {func(d Obj) {
			rootKids(d)[0].(Obj)["placement"] = Obj{"x": 23, "y": 0, "w": 2, "h": 2}
		}, "24"},
		"fractional placement": {func(d Obj) {
			rootKids(d)[0].(Obj)["placement"] = Obj{"x": 0.5, "y": 0, "w": 2, "h": 2}
		}, "whole"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			d := m5Dash(m5Tile("m", "medium", 0, 0),
				m5Folder("f", 8, 0, 8, 6, inner(m5Tile("a", "medium", 0, 0))))
			if err := VerifyDashboard(d); err != nil {
				t.Fatalf("base: %v", err)
			}
			tc.mutate(d)
			wantProblem(t, VerifyDashboard(d), tc.want)
		})
	}
}

func tabOf(d Obj) Obj      { return d["tabs"].([]any)[0].(Obj) }
func rootKids(d Obj) []any { return tabOf(d)["root"].(Obj)["children"].([]any) }

// A v3 document whose layoutVersion is not this build's is never served as if
// it were current: start-up reports it visibly and writes nothing (§2a: there
// is no v3→v3 update to bring it forward).
func TestMigrateWithBackup_StaleLayoutVersionFailsVisibly(t *testing.T) {
	for name, doc := range map[string]Obj{
		"pre-M5 (gridUnit)": {"schemaVersion": 3, "gridUnit": 2, "dashboards": []any{}},
		"newer":             {"schemaVersion": 3, LayoutVersionKey: 2, "dashboards": []any{}},
	} {
		t.Run(name, func(t *testing.T) {
			db := newStoreDB(t)
			orig := snapshot2(doc)
			seed(t, db, orig)
			res, backedUp, err := MigrateWithBackup(db, func() error { return nil })
			if err != nil || backedUp {
				t.Fatalf("err=%v backedUp=%v", err, backedUp)
			}
			if !res.Failed || !strings.Contains(res.Detail, "layout version") {
				t.Fatalf("res = %+v, want a visible layout-version failure", res)
			}
			if rawRow(t, db) != orig || archiveCount(t, db) != 0 {
				t.Error("stored config changed")
			}
		})
	}
}

func TestMigrateWithBackup_V2MigratesStraightToM5(t *testing.T) {
	db := newStoreDB(t)
	seed(t, db, v2Bytes(t))
	res, backedUp, err := MigrateWithBackup(db, func() error { return nil })
	if err != nil || !backedUp || !res.Migrated || res.Failed {
		t.Fatalf("res=%+v backedUp=%v err=%v", res, backedUp, err)
	}
	if n := archiveCount(t, db); n != 1 {
		t.Errorf("archive rows = %d, want only the v2 one", n)
	}
	doc, err := Load(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := CheckLayoutVersion(doc); err != nil {
		t.Fatal(err)
	}
	// A second start is a no-op.
	stored := rawRow(t, db)
	res, _, err = MigrateWithBackup(db, func() error { return nil })
	if err != nil || res.Failed || res.Migrated || rawRow(t, db) != stored {
		t.Fatalf("second start: res=%+v err=%v", res, err)
	}
}
