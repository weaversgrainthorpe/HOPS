package configdoc

import (
	"errors"
	"math"
	"strings"
	"testing"
)

func migrated(t *testing.T, v2 Obj) Obj {
	t.Helper()
	doc, err := MigrateV2(v2)
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

// realV2 wraps a real export's dashboards the way TestMigrateV2_RealExports does.
func realV2(t *testing.T, file string) Obj {
	t.Helper()
	return Obj{"dashboards": loadJSON(t, file)["dashboards"]}
}

func wantProblem(t *testing.T, err error, parts ...string) {
	t.Helper()
	var ve *VerifyError
	if !errors.As(err, &ve) {
		t.Fatalf("err = %v, want *VerifyError", err)
	}
	joined := strings.Join(ve.Problems, "\n")
	for _, p := range parts {
		if !strings.Contains(joined, p) {
			t.Errorf("problems %q do not mention %q", joined, p)
		}
	}
}

func TestVerify_AcceptsMigration(t *testing.T) {
	inputs := map[string]Obj{
		"v2_basic":     loadJSON(t, "testdata/v2_basic.json"),
		"v2_messy":     loadJSON(t, "testdata/v2_messy.json"),
		"real_sample":  realV2(t, "testdata/real_sample.json"),
		"real_weavers": realV2(t, "testdata/real_weavers.json"),
	}
	for name, v2 := range inputs {
		if err := Verify(v2, migrated(t, v2)); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestVerify_DetectsMissingTile(t *testing.T) {
	v2 := loadJSON(t, "testdata/v2_basic.json")
	doc := migrated(t, v2)
	_, _, path, _ := findNode(doc, "e2")
	content := path[len(path)-1]["content"].(Obj)
	var kept []any
	for _, c := range content["children"].([]any) {
		if c.(Obj)["id"] != "e2" {
			kept = append(kept, c)
		}
	}
	content["children"] = kept
	wantProblem(t, Verify(v2, doc), "e2")
}

func TestVerify_DetectsChangedValue(t *testing.T) {
	v2 := loadJSON(t, "testdata/v2_basic.json")
	doc := migrated(t, v2)
	_, tile, _ := FindTile(doc, "e1")
	tile["url"] = "http://evil"
	wantProblem(t, Verify(v2, doc), "e1", "url")
}

func TestVerify_DetectsDroppedKey(t *testing.T) {
	v2 := loadJSON(t, "testdata/v2_basic.json")
	v2d := list(t, v2, "dashboards")[0]
	entry := list(t, list(t, v2d, "tabs")[0], "groups")[0]["entries"].([]any)[0].(Obj)
	entry["iconBgColor"] = "#fff"
	doc := migrated(t, v2)
	_, tile, _ := FindTile(doc, "e1")
	delete(tile, "iconBgColor")
	wantProblem(t, Verify(v2, doc), "e1", "iconBgColor")
}

func TestVerify_DuplicateIDAcrossDashboards(t *testing.T) {
	entry := func() Obj { return Obj{"id": "e1", "name": "x"} }
	grp := func(id string) Obj { return Obj{"id": id, "entries": []any{entry()}} }
	dash := func(id, tid, gid string) Obj {
		return Obj{"id": id, "tabs": []any{Obj{"id": tid, "groups": []any{grp(gid)}}}}
	}
	v2 := Obj{"dashboards": []any{dash("d1", "t1", "g1"), dash("d2", "t2", "g2")}}
	// Build the v3 doc without MigrateV2's renaming so it keeps the duplicate.
	var v3d []any
	for _, d := range list(t, v2, "dashboards") {
		nd, err := ConvertDashboardV2(d)
		if err != nil {
			t.Fatal(err)
		}
		v3d = append(v3d, nd)
	}
	wantProblem(t, Verify(v2, Obj{"schemaVersion": 3, "dashboards": v3d}),
		`duplicate id "e1"`, `dashboard "d1"`, `dashboard "d2"`)
}

func TestVerify_ReportsMalformedV3(t *testing.T) {
	v2 := loadJSON(t, "testdata/v2_basic.json")
	doc := migrated(t, v2)
	tab := list(t, list(t, doc, "dashboards")[0], "tabs")[0]
	tab["root"].(Obj)["children"] = "oops"
	wantProblem(t, Verify(v2, doc), "t1", "children")

	doc = migrated(t, v2)
	tab = list(t, list(t, doc, "dashboards")[0], "tabs")[0]
	tab["root"].(Obj)["children"] = append(tab["root"].(Obj)["children"].([]any), 5)
	wantProblem(t, Verify(v2, doc), "t1")
}

func TestVerify_NotV3AndCap(t *testing.T) {
	v2 := loadJSON(t, "testdata/v2_basic.json")
	wantProblem(t, Verify(v2, v2), "schemaVersion")

	var entries []any
	for i := 0; i < 30; i++ {
		entries = append(entries, Obj{"id": "e" + string(rune('A'+i)), "name": "n"})
	}
	big := Obj{"dashboards": []any{Obj{"id": "d", "tabs": []any{Obj{"id": "t", "groups": []any{Obj{"id": "g", "entries": entries}}}}}}}
	doc := migrated(t, big)
	Walk(doc, func(_, _ Obj, _ []Obj, n Obj) bool {
		if n["kind"] == "tile" {
			n["name"] = "changed"
		}
		return true
	})
	var ve *VerifyError
	if !errors.As(Verify(big, doc), &ve) || len(ve.Problems) != 20 {
		t.Fatalf("want exactly 20 capped problems, got %v", ve)
	}
}

// findNode returns dash, tab, ancestor-folder path and node for an id.
func findNode(doc Obj, id string) (Obj, Obj, []Obj, Obj) {
	var d, tb, nn Obj
	var p []Obj
	Walk(doc, func(dash, tab Obj, path []Obj, n Obj) bool {
		if n["id"] == id {
			d, tb, p, nn = dash, tab, path, n
			return false
		}
		return true
	})
	return d, tb, p, nn
}

func TestVerify_RequiresOwnedDashboardKeys(t *testing.T) {
	v2 := loadJSON(t, "testdata/v2_basic.json")
	for key, bad := range map[string]any{"revision": 0, "settings": "x", "defaultLayout": 3} {
		doc := migrated(t, v2)
		list(t, doc, "dashboards")[0][key] = bad
		wantProblem(t, Verify(v2, doc), "d1", key)
	}
	doc := migrated(t, v2)
	delete(list(t, doc, "dashboards")[0]["settings"].(Obj), "statusChecksEnabled")
	wantProblem(t, Verify(v2, doc), "d1", "statusChecksEnabled")
}

func TestVerifyIDs(t *testing.T) {
	good := Obj{"schemaVersion": 3, "dashboards": []any{Obj{"id": "d", "tabs": []any{Obj{"id": "t", "root": Obj{"columns": 24.0, "children": []any{
		Obj{"id": "f", "kind": "folder", "size": "medium", "contentSize": "small", "placement": Obj{"x": 0, "y": 0, "w": 4, "h": 2},
			"content": Obj{"children": []any{Obj{"id": "e", "kind": "tile"}}}},
	}}}}}}}
	if err := VerifyIDs(good); err != nil {
		t.Fatalf("good doc: %v", err)
	}
	bad := Obj{"schemaVersion": 3, "dashboards": []any{Obj{"id": "d", "tabs": []any{Obj{"id": "d", "root": Obj{"children": []any{}}}}}}}
	var ve *VerifyError
	if err := VerifyIDs(bad); !errors.As(err, &ve) {
		t.Fatalf("duplicate id not reported: %v", err)
	}
}

// The v3 tree holds any mix of tiles and folders at any depth (spec); only
// an unknown kind or a malformed node is a problem.
func TestVerifyIDs_AcceptsAnyDepth(t *testing.T) {
	doc := migrated(t, loadJSON(t, "testdata/v2_basic.json"))
	doc["dashboards"] = append(doc["dashboards"].([]any), showcaseDash(t, "s1"))
	_, _, _, g1 := findNode(doc, "g1")
	content := g1["content"].(Obj)
	content["children"] = append(content["children"].([]any), Obj{
		"id": "nf", "kind": "folder", "size": "large", "contentSize": "small",
		"content": Obj{"children": []any{
			Obj{"id": "nf-e1", "kind": "tile", "size": "large"},
		}}})
	if err := VerifyIDs(doc); err != nil {
		t.Fatalf("nested folder / root tile rejected: %v", err)
	}
	// Ids stay unique at depth, and unknown kinds / bad content are reported.
	_, _, _, nf := findNode(doc, "nf")
	inner := nf["content"].(Obj)
	inner["children"] = append(inner["children"].([]any),
		Obj{"id": "e1", "kind": "tile"},
		Obj{"id": "w1", "kind": "widget"},
		Obj{"id": "nf2", "kind": "folder", "size": "medium", "contentSize": "medium", "content": "oops"})
	wantProblem(t, VerifyIDs(doc), `duplicate id "e1"`, `"w1": kind is "widget"`, `"nf2": content is string`)
}

// Every tab-level node needs a finite numeric placement {x,y,w,h} (Ruling 24),
// so no writer or import can store a node the renderer cannot place.
func TestVerifyIDs_RequiresPlacement(t *testing.T) {
	cases := map[string]func(n Obj){
		"missing":    func(n Obj) { delete(n, "placement") },
		"not object": func(n Obj) { n["placement"] = "top" },
		"x string":   func(n Obj) { n["placement"].(Obj)["x"] = "left" },
		"w missing":  func(n Obj) { delete(n["placement"].(Obj), "w") },
		"h null":     func(n Obj) { n["placement"].(Obj)["h"] = nil },
		"y infinite": func(n Obj) { n["placement"].(Obj)["y"] = math.Inf(1) },
		"x NaN":      func(n Obj) { n["placement"].(Obj)["x"] = math.NaN() },
		"y bool":     func(n Obj) { n["placement"].(Obj)["y"] = true },
	}
	for name, mutate := range cases {
		for _, id := range []string{"g1", "rt"} { // a tab-level folder and tile
			doc := migrated(t, loadJSON(t, "testdata/v2_basic.json"))
			root := tabN(doc, 1)["root"].(Obj)
			root["children"] = append(root["children"].([]any),
				Obj{"id": "rt", "kind": "tile", "placement": Obj{"x": 20, "y": 0, "w": 2, "h": 2}})
			if err := VerifyIDs(doc); err != nil {
				t.Fatalf("baseline: %v", err)
			}
			_, _, _, n := findNode(doc, id)
			mutate(n)
			err := VerifyIDs(doc)
			if err == nil {
				t.Errorf("%s on %s: accepted", name, id)
				continue
			}
			wantProblem(t, err, `"`+id+`"`, "placement")
		}
	}
}

// v3Dash builds a minimal valid v3 dashboard with the given root children.
func v3Dash(children []any) Obj {
	return Obj{
		"id": "d", "name": "D", "path": "/d", "revision": 1,
		"settings": nullSettings(),
		"tabs":     []any{Obj{"id": "t", "name": "T", "root": Obj{"columns": RootColumns, "children": children}}},
	}
}

func nullSettings() Obj {
	s := Obj{}
	for _, k := range settingsKeys {
		s[k] = nil
	}
	return s
}

func tileNode(id string) Obj { return tileAt(id, 0) }

// tileAt is a Small tab-level tile in cell i (row-major on the 24-column grid).
func tileAt(id string, i int) Obj {
	return Obj{"id": id, "kind": "tile", "name": id, "size": "small",
		"placement": Obj{"x": i % RootColumns, "y": i / RootColumns, "w": 1, "h": 1}}
}

func TestVerifyDashboard_Bounds(t *testing.T) {
	if err := VerifyDashboard(v3Dash([]any{tileNode("a")})); err != nil {
		t.Fatalf("valid dashboard: %v", err)
	}
	many := func(n int) []any {
		out := make([]any, n)
		for i := range out {
			out[i] = tileAt("n"+itoa(i), i)
		}
		return out
	}
	if err := VerifyDashboard(v3Dash(many(MaxDashboardNodes))); err != nil {
		t.Fatalf("5000 nodes should pass: %v", err)
	}
	wantProblem(t, VerifyDashboard(v3Dash(many(MaxDashboardNodes+1))), "5000")

	nest := func(depth int) []any { // a chain of `depth` folders, innermost holds one tile
		node := tileNode("leaf")
		delete(node, "placement")
		for i := depth - 1; i >= 1; i-- {
			node = Obj{"id": "f" + itoa(i), "kind": "folder", "name": "f", "display": "expanded",
				"size": "medium", "contentSize": "medium", "content": Obj{"children": []any{node}}}
		}
		node["placement"] = Obj{"x": 0, "y": 0, "w": 1, "h": 1}
		return []any{node}
	}
	if err := VerifyDashboard(v3Dash(nest(MaxNestingDepth))); err != nil {
		t.Fatalf("depth 12 should pass: %v", err)
	}
	wantProblem(t, VerifyDashboard(v3Dash(nest(MaxNestingDepth+1))), "12")
}

func TestVerifyDashboard_StructureAndPlacement(t *testing.T) {
	bad := tileNode("a")
	delete(bad, "placement")
	wantProblem(t, VerifyDashboard(v3Dash([]any{bad})), "placement")
	wantProblem(t, VerifyDashboard(v3Dash([]any{tileAt("a", 0), tileAt("a", 1)})), "duplicate id")
	d := v3Dash(nil)
	d["path"] = ""
	wantProblem(t, VerifyDashboard(d), "path")
	d = v3Dash(nil)
	delete(d, "settings")
	wantProblem(t, VerifyDashboard(d), "settings")
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b []byte
	for ; i > 0; i /= 10 {
		b = append([]byte{byte('0' + i%10)}, b...)
	}
	return string(b)
}

// showcaseDash is a Showcase-style dashboard: a grid tab with a tile at its root.
func showcaseDash(t *testing.T, id string) Obj {
	t.Helper()
	d := Obj{
		"id": id, "name": "Showcase " + id, "path": "/" + id, "revision": 4,
		"settings": Obj{"statusChecksEnabled": nil},
		"tabs": []any{Obj{
			"id": id + "-t1", "name": "Grid",
			"root": Obj{"columns": RootColumns, "children": []any{
				Obj{"id": id + "-e1", "kind": "tile", "name": "X", "size": "large", "placement": Obj{"x": 3, "y": 5, "w": 4, "h": 4, "z": 1}},
			}},
		}},
	}
	return norm(t, d).(Obj)
}

// The converter writes the M4 background form; Verify checks it exactly
// (the picture kept, inherit iff perTabBackgrounds was off, no legacy keys).
func TestVerify_BackgroundFinalForm(t *testing.T) {
	cases := map[string]struct {
		file   string
		mutate func(doc Obj)
		want   string
	}{
		"inactive tab left active": {"testdata/v2_messy.json", func(d Obj) {
			delete(tabN(d, 1)["background"].(Obj), "inherit")
		}, "inherit"},
		"picture changed": {"testdata/v2_messy.json", func(d Obj) {
			tabN(d, 1)["background"].(Obj)["value"] = "other"
		}, "value"},
		"active tab made inherit": {"testdata/v2_basic.json", func(d Obj) {
			tabN(d, 0)["background"].(Obj)["inherit"] = true
		}, "inherit"},
		"mirror written": {"testdata/v2_basic.json", func(d Obj) {
			tabN(d, 0)["backgroundEnabled"] = true
		}, "backgroundEnabled"},
		"switch kept": {"testdata/v2_basic.json", func(d Obj) {
			dash0(d)["perTabBackgrounds"] = true
		}, "perTabBackgrounds"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			v2 := loadJSON(t, tc.file)
			doc := migrated(t, v2)
			if err := Verify(v2, doc); err != nil {
				t.Fatalf("clean conversion rejected: %v", err)
			}
			tc.mutate(doc)
			err := Verify(v2, doc)
			if err == nil {
				t.Fatal("Verify = nil, want a problem")
			}
			wantProblem(t, err, tc.want)
		})
	}
}
