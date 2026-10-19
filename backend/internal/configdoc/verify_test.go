package configdoc

import (
	"errors"
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
	good := Obj{"schemaVersion": 3, "dashboards": []any{Obj{"id": "d", "tabs": []any{Obj{"id": "t", "root": Obj{"children": []any{
		Obj{"id": "f", "kind": "folder", "content": Obj{"children": []any{Obj{"id": "e", "kind": "tile"}}}},
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
