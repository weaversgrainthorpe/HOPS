package configdoc

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

func loadJSON(t *testing.T, path string) Obj {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var o Obj
	if err := json.Unmarshal(b, &o); err != nil {
		t.Fatal(err)
	}
	return o
}

func snapshot(t *testing.T, o Obj) string {
	t.Helper()
	b, err := json.Marshal(o)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// norm normalises a value through JSON so ints and float64s compare equal.
func norm(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func eq(t *testing.T, got, want any, what string) {
	t.Helper()
	if !reflect.DeepEqual(norm(t, got), norm(t, want)) {
		t.Errorf("%s: got %v, want %v", what, snapshot2(got), snapshot2(want))
	}
}

func snapshot2(v any) string { b, _ := json.Marshal(v); return string(b) }

func list(t *testing.T, o Obj, key string) []Obj {
	t.Helper()
	l, ok := o[key].([]any)
	if !ok {
		t.Fatalf("%s is %T, want array", key, o[key])
	}
	out := make([]Obj, len(l))
	for i, x := range l {
		out[i] = x.(Obj)
	}
	return out
}

func children(t *testing.T, container Obj) []Obj { return list(t, container, "children") }

// withoutKeys returns a shallow copy of o minus the given keys.
func withoutKeys(o Obj, keys ...string) Obj {
	out := Obj{}
	for k, v := range o {
		out[k] = v
	}
	for _, k := range keys {
		delete(out, k)
	}
	return out
}

// assertKeysPreserved checks every key of orig (minus skip) appears in got with
// an equal value.
func assertKeysPreserved(t *testing.T, orig, got Obj, what string, skip ...string) {
	t.Helper()
	for k, v := range withoutKeys(orig, skip...) {
		gv, ok := got[k]
		if !ok {
			t.Errorf("%s: key %q lost", what, k)
			continue
		}
		if s, isStr := v.(string); isStr && (k == "url" || k == AwayURLKey) {
			v = strings.TrimSpace(s) // the conversion trims tile addresses
		}
		if sc, isObj := v.(Obj); isObj && k == "statusCheck" && got["type"] != "note" {
			v = withEnabled(sc, sc["enabled"] == true) // pinStatusCheck: only a ticked tile is On
		}
		eq(t, gv, v, what+"."+k)
	}
}

// withEnabled is a copy of sc with enabled set to en.
func withEnabled(sc Obj, en any) Obj {
	out := Obj{}
	for k, v := range sc {
		out[k] = v
	}
	out["enabled"] = en
	return out
}

func TestPackRowMajor(t *testing.T) {
	ws := []int{12, 6, 6, 4, 4, 4, 6}
	hs := []int{2, 3, 2, 2, 2, 2, 2}
	sizes := make([][2]int, len(ws))
	for i := range ws {
		sizes[i] = [2]int{ws[i], hs[i]}
	}
	got := packRowMajor(sizes, 12)
	want := [][4]int{{0, 0, 12, 2}, {0, 2, 6, 3}, {6, 2, 6, 2}, {0, 5, 4, 2}, {4, 5, 4, 2}, {8, 5, 4, 2}, {0, 7, 6, 2}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestMigrateV2_Basic(t *testing.T) {
	v2 := loadJSON(t, "testdata/v2_basic.json")
	before := snapshot(t, v2)
	doc, err := MigrateV2(v2)
	if err != nil {
		t.Fatal(err)
	}
	if after := snapshot(t, v2); after != before {
		t.Fatal("MigrateV2 mutated its input")
	}
	if !IsV3(doc) {
		t.Fatal("not v3")
	}
	eq(t, doc["schemaVersion"], 3, "schemaVersion")
	eq(t, doc["theme"], v2["theme"], "theme")
	eq(t, doc["settings"], v2["settings"], "settings")

	v2d := list(t, v2, "dashboards")[0]
	dashes := list(t, doc, "dashboards")
	if len(dashes) != 1 {
		t.Fatalf("dashboards = %d", len(dashes))
	}
	d := dashes[0]
	assertKeysPreserved(t, v2d, d, "dashboard", "tabs", "perTabBackgrounds")
	if _, has := d["perTabBackgrounds"]; has {
		t.Error("converter kept perTabBackgrounds; the converter writes the final background form")
	}
	eq(t, d["revision"], 1, "revision")
	if _, has := d["defaultLayout"]; has {
		t.Error("defaultLayout written; every tab is a grid tab")
	}
	settings := d["settings"].(Obj)
	if len(settings) != len(settingsKeys) {
		t.Errorf("settings has %d keys", len(settings))
	}
	for _, k := range settingsKeys {
		v, ok := settings[k]
		if !ok || v != nil {
			t.Errorf("settings.%s = %v (present=%v), want nil", k, v, ok)
		}
	}

	tabs := list(t, d, "tabs")
	v2tabs := list(t, v2d, "tabs")
	if len(tabs) != 2 {
		t.Fatalf("tabs = %d", len(tabs))
	}
	for i, tab := range tabs {
		assertKeysPreserved(t, v2tabs[i], tab, "tab", "groups")
		if _, has := tab["groups"]; has {
			t.Error("tab still has groups")
		}
		if _, has := tab["layout"]; has {
			t.Error("tab.layout written; every tab is a grid tab")
		}
		root := tab["root"].(Obj)
		eq(t, root["columns"], 24, "root.columns")
	}
	// perTabBackgrounds was on: the tab background stays active, unchanged.
	for i, tab := range tabs {
		if _, has := tab["backgroundEnabled"]; has {
			t.Errorf("tab %d got backgroundEnabled; the converter writes the final background form", i)
		}
	}
	eq(t, tabs[0]["background"], v2tabs[0]["background"], "active tab background")

	// Tab 1 folders.
	folders := children(t, tabs[0]["root"].(Obj))
	v2groups := list(t, v2tabs[0], "groups")
	if len(folders) != 3 {
		t.Fatalf("folders = %d", len(folders))
	}
	wantPl := []Obj{
		// Finer grid: 2×2 tiles, a 2-cell title row, 24 columns.
		// Counted at the reference cell (77 px), all on page 1, so no page bar.
		{"x": 0, "y": 0, "w": 24, "h": 4}, // 3 entries, 11 a row: 1 tile row (2) + chrome (2: bar, tab allowance, padding)
		{"x": 0, "y": 4, "w": 12, "h": 4},
		{"x": 12, "y": 4, "w": 12, "h": 4},
	}
	for i, f := range folders {
		assertKeysPreserved(t, v2groups[i], f, "folder", "entries", "width", "collapsed", "displayStyle")
		for _, k := range []string{"width", "collapsed", "displayStyle"} {
			if _, has := f[k]; has {
				t.Errorf("folder kept v2 key %q", k)
			}
		}
		eq(t, f["kind"], "folder", "kind")
		if _, has := f["layout"]; has {
			t.Error("folder.layout written (folders always flow)")
		}
		eq(t, f["size"], "medium", "folder.size")
		eq(t, f["contentSize"], "medium", "folder.contentSize")
		eq(t, f["display"], "expanded", "display")
		eq(t, f["shape"], "rounded", "shape")
		eq(t, f["showTitle"], true, "showTitle")
		eq(t, f["placement"], wantPl[i], "placement")
	}
	for _, f := range folders {
		if _, has := f["content"].(Obj)["columns"]; has {
			t.Errorf("folder %v content has columns (contents flow)", f["id"])
		}
	}

	tiles := children(t, folders[0]["content"].(Obj))
	v2entries := list(t, v2groups[0], "entries")
	if len(tiles) != 3 {
		t.Fatalf("tiles = %d", len(tiles))
	}
	for i, tile := range tiles {
		assertKeysPreserved(t, v2entries[i], tile, "tile")
		eq(t, tile["kind"], "tile", "tile.kind")
		if _, has := tile["placement"]; has {
			t.Errorf("folder child %v has a placement (an ordered list)", tile["id"])
		}
	}
	// array order, not `order`, drives display: ids e1,e2,e3 despite order 2,1,0.
	for i, id := range []string{"e1", "e2", "e3"} {
		eq(t, tiles[i]["id"], id, "tile id")
	}
	if n := len(children(t, folders[2]["content"].(Obj))); n != 0 {
		t.Errorf("empty group produced %d tiles", n)
	}

	// Tab 2: collapsed folder-style third with 5 entries.
	f := children(t, tabs[1]["root"].(Obj))[0]
	eq(t, f["display"], "collapsed", "display")
	eq(t, f["shape"], "folder-flat", "shape")                               // v2 folder style is Flat
	eq(t, f["placement"], Obj{"x": 0, "y": 0, "w": 8, "h": 6}, "placement") // 3 a row (padding takes a column): 2 tile rows ×2, +2 chrome at the reference cell
	var order []string
	for _, tile := range children(t, f["content"].(Obj)) {
		order = append(order, tile["id"].(string))
		if _, has := tile["placement"]; has {
			t.Errorf("folder child %v has a placement", tile["id"])
		}
	}
	eq(t, order, []string{"e5", "e6", "e7", "e8", "e9"}, "child order")
}

func TestMigrateV2_MessyInput(t *testing.T) {
	v2 := loadJSON(t, "testdata/v2_messy.json")
	before := snapshot(t, v2)
	doc, err := MigrateV2(v2)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot(t, v2) != before {
		t.Fatal("input mutated")
	}
	eq(t, doc["unknownTop"], v2["unknownTop"], "unknownTop")
	dashes := list(t, doc, "dashboards")
	if len(dashes) != 3 {
		t.Fatalf("dashboards = %d", len(dashes))
	}
	d := dashes[0]
	// Pre-existing v3 keys are overwritten; a v2 defaultLayout is dropped.
	eq(t, d["revision"], 1, "revision")
	if _, has := d["defaultLayout"]; has {
		t.Error("defaultLayout kept")
	}
	if len(d["settings"].(Obj)) != len(settingsKeys) {
		t.Errorf("settings not replaced: %v", d["settings"])
	}
	if v, ok := d["weird"]; !ok || v != nil {
		t.Error("null-valued extra key lost")
	}
	// Missing / null tabs -> empty list present.
	for _, i := range []int{1, 2} {
		if tabs := list(t, dashes[i], "tabs"); len(tabs) != 0 {
			t.Errorf("dashboard %d tabs = %d", i, len(tabs))
		}
	}
	tabs := list(t, d, "tabs")
	for _, i := range []int{0, 1} {
		if n := len(children(t, tabs[i]["root"].(Obj))); n != 0 {
			t.Errorf("tab %d has %d folders", i, n)
		}
	}
	eq(t, tabs[0]["tabExtra"], "x", "tabExtra")
	// Background present, perTabBackgrounds missing (off) -> the inherit form
	// keeping the picture; no backgroundEnabled anywhere.
	eq(t, tabs[1]["background"], Obj{"type": "image", "value": "u", "inherit": true}, "inactive tab background")
	for i, tab := range tabs {
		if _, has := tab["backgroundEnabled"]; has {
			t.Errorf("tab %d got backgroundEnabled", i)
		}
	}

	fs := children(t, tabs[2]["root"].(Obj))
	if len(fs) != 4 {
		t.Fatalf("folders = %d", len(fs))
	}
	eq(t, fs[0]["order"], 9, "order carried verbatim")
	eq(t, fs[0]["placement"], Obj{"x": 0, "y": 0, "w": 24, "h": 4}, "NoWidth placement") // null entries
	if n := len(children(t, fs[0]["content"].(Obj))); n != 0 {
		t.Errorf("null entries -> %d tiles", n)
	}
	// Unknown width falls back to 12 tiles per row (24 columns); non-bool collapsed is not collapsed.
	eq(t, fs[1]["placement"], Obj{"x": 0, "y": 4, "w": 24, "h": 4}, "bad width placement")
	eq(t, fs[1]["display"], "expanded", "display")
	eq(t, fs[1]["shape"], "rounded", "shape")
	if _, has := fs[1]["collapsed"]; has {
		t.Error("v2 collapsed key kept on the folder")
	}
	eq(t, fs[2]["placement"], Obj{"x": 0, "y": 8, "w": 8, "h": 4}, "third placement")
	eq(t, fs[3]["placement"], Obj{"x": 8, "y": 8, "w": 12, "h": 4}, "half placement")

	tile := children(t, fs[2]["content"].(Obj))[0]
	eq(t, tile["x-extra"], []any{1, Obj{"y": nil}}, "tile extras")
	eq(t, tile["name"], "", "empty name")
	// Array order wins over `order`.
	t2 := children(t, fs[3]["content"].(Obj))
	eq(t, t2[0]["id"], "e2", "first tile")
	eq(t, t2[1]["id"], "e3", "second tile")
}

func TestMigrateV2_BadShapes(t *testing.T) {
	cases := map[string]Obj{
		"dashboards string": {"dashboards": "x"},
		"dashboard string":  {"dashboards": []any{"x"}},
		"tabs object":       {"dashboards": []any{Obj{"tabs": Obj{}}}},
		"group string":      {"dashboards": []any{Obj{"tabs": []any{Obj{"groups": []any{"x"}}}}}},
		"entry string":      {"dashboards": []any{Obj{"tabs": []any{Obj{"groups": []any{Obj{"entries": []any{1}}}}}}}},
	}
	for name, in := range cases {
		if _, err := MigrateV2(in); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

func TestConvertDashboardV2_DoesNotMutate(t *testing.T) {
	v2 := list(t, loadJSON(t, "testdata/v2_basic.json"), "dashboards")[0]
	before := snapshot(t, v2)
	if _, err := ConvertDashboardV2(v2); err != nil {
		t.Fatal(err)
	}
	if snapshot(t, v2) != before {
		t.Fatal("mutated")
	}
}

func TestWalkAndFindTile(t *testing.T) {
	doc, err := MigrateV2(loadJSON(t, "testdata/v2_basic.json"))
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	var depths []int
	Walk(doc, func(d, tab Obj, path []Obj, n Obj) bool {
		ids = append(ids, n["id"].(string))
		depths = append(depths, len(path))
		return true
	})
	wantIDs := []string{"g1", "e1", "e2", "e3", "g2", "e4", "g3", "g4", "e5", "e6", "e7", "e8", "e9"}
	if !reflect.DeepEqual(ids, wantIDs) {
		t.Errorf("order = %v", ids)
	}
	if depths[0] != 0 || depths[1] != 1 {
		t.Errorf("depths = %v", depths)
	}

	var seen int
	Walk(doc, func(_, _ Obj, _ []Obj, n Obj) bool {
		seen++
		return n["id"] != "e2"
	})
	if seen != 3 {
		t.Errorf("walk did not stop: seen %d", seen)
	}

	d, tile, ok := FindTile(doc, "e8")
	if !ok || tile["name"] != "H" || d["id"] != "d1" {
		t.Errorf("FindTile = %v %v %v", d["id"], tile, ok)
	}
	if _, _, ok := FindTile(doc, "g1"); ok {
		t.Error("FindTile matched a folder")
	}
	if _, _, ok := FindTile(doc, "nope"); ok {
		t.Error("FindTile matched missing id")
	}
}

func TestMigrateV2_RealExports(t *testing.T) {
	cases := []struct {
		file                          string
		dashes, tabs, groups, entries int
	}{
		{"testdata/real_sample.json", 1, 2, 13, 24},
		{"testdata/real_weavers.json", 1, 3, 9, 40},
	}
	for _, c := range cases {
		t.Run(c.file, func(t *testing.T) {
			env := loadJSON(t, c.file)
			v2 := Obj{"dashboards": env["dashboards"]}
			doc, err := MigrateV2(v2)
			if err != nil {
				t.Fatal(err)
			}
			eq(t, doc["schemaVersion"], 3, "schemaVersion")

			var nd, nt, nf, nl int
			for _, d := range list(t, doc, "dashboards") {
				nd++
				for _, tab := range list(t, d, "tabs") {
					nt++
					_ = tab
				}
			}
			Walk(doc, func(_, _ Obj, _ []Obj, n Obj) bool {
				if n["kind"] == "folder" {
					nf++
				} else {
					nl++
				}
				return true
			})
			if nd != c.dashes || nt != c.tabs || nf != c.groups || nl != c.entries {
				t.Errorf("counts d/t/f/l = %d/%d/%d/%d, want %d/%d/%d/%d", nd, nt, nf, nl, c.dashes, c.tabs, c.groups, c.entries)
			}

			// Every v2 entry survives unchanged on its tile.
			found := 0
			for _, d := range list(t, v2, "dashboards") {
				for _, tab := range list(t, d, "tabs") {
					for _, g := range list(t, tab, "groups") {
						es, _ := g["entries"].([]any)
						for _, e := range es {
							entry := e.(Obj)
							_, tile, ok := FindTile(doc, entry["id"].(string))
							if !ok {
								t.Errorf("entry %v not found", entry["id"])
								continue
							}
							assertKeysPreserved(t, entry, tile, "entry "+entry["id"].(string))
							found++
						}
					}
				}
			}
			if found != c.entries {
				t.Errorf("verified %d entries, want %d", found, c.entries)
			}
		})
	}
}

// Upgrades from v2 keep v2's behaviour: v2.2.1 checked a tile only when its
// own statusCheck.enabled was true. The conversion pins a ticked tile On and
// every other v2 tile Off (keeping its other statusCheck fields).
func TestConvertPinsV2StatusChecks(t *testing.T) {
	var v2 Obj
	if err := json.Unmarshal([]byte(`{"dashboards": [{"id": "d1", "name": "Home", "path": "/home", "tabs": [
		{"id": "t1", "name": "Main", "groups": [{"id": "g1", "name": "G", "entries": [
			{"id": "none", "name": "None", "url": "http://a"},
			{"id": "off", "name": "Off", "url": "http://b", "statusCheck": {"type": "http", "enabled": false, "interval": 60}},
			{"id": "on", "name": "On", "url": "http://c", "statusCheck": {"type": "http", "enabled": true, "interval": 60}},
			{"id": "inh", "name": "Inherit", "url": "http://d", "statusCheck": {"enabled": null}},
			{"id": "nul", "name": "Null", "url": "http://e", "statusCheck": null},
			{"id": "yes", "name": "Yes", "url": "http://f", "statusCheck": {"type": "http", "enabled": "yes"}},
			{"id": "note", "name": "Note", "type": "note", "content": "hi"},
			{"id": "noteon", "name": "Note on", "type": "note", "content": "hi", "statusCheck": {"enabled": true}},
			{"id": "notebad", "name": "Note bad", "type": "note", "content": "hi", "statusCheck": {"enabled": "yes"}}
		]}]}]}]}`), &v2); err != nil {
		t.Fatal(err)
	}
	v3, renames, sizes, err := MigrateV2Full(v2)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"none": Obj{"enabled": false},
		"off":  Obj{"type": "http", "enabled": false, "interval": 60},
		// Ticked in v2: On. The dashboard and global gates are left Enabled, so
		// it is checked exactly as v2 checked it.
		"on": Obj{"type": "http", "enabled": true, "interval": 60},
		// An explicit null is not ticked: Off.
		"inh": Obj{"enabled": false},
		// statusCheck null is no setting, so it is pinned like an absent one.
		"nul": Obj{"enabled": false},
		// A non-bool enabled was not true, so v2 never checked it: Off, type kept.
		"yes": Obj{"type": "http", "enabled": false},
		// Notes are never checked, so they are left exactly as they were.
		"note":    nil,
		"noteon":  Obj{"enabled": true},
		"notebad": Obj{"enabled": "yes"},
	}
	seen := 0
	Walk(v3, func(_, _ Obj, _ []Obj, n Obj) bool {
		if n["kind"] == "tile" {
			seen++
			id := n["id"].(string)
			if _, has := n["statusCheck"]; !has && want[id] != nil {
				t.Errorf("tile %s has no statusCheck, want %v", id, want[id])
			} else if has && want[id] == nil {
				t.Errorf("tile %s gained statusCheck %v, want none", id, n["statusCheck"])
			}
			eq(t, n["statusCheck"], want[id], "tile "+id+" statusCheck")
		}
		return true
	})
	if seen != len(want) {
		t.Fatalf("saw %d tiles, want %d", seen, len(want))
	}
	if err := VerifyMigrationFull(v2, v3, renames, sizes); err != nil {
		t.Fatalf("verify rejects the pinned conversion: %v", err)
	}
}
