package configdoc

import (
	"errors"
	"strings"
	"testing"
)

func TestToLegacy_RoundTrip(t *testing.T) {
	v2 := loadJSON(t, "testdata/v2_basic.json")
	view, err := ToLegacy(migrated(t, v2))
	if err != nil {
		t.Fatal(err)
	}
	want, err := deepCopy(v2)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range want["dashboards"].([]any) {
		d.(Obj)["revision"] = 1
		d.(Obj)["settings"] = Obj{
			"statusChecksEnabled": nil, "statusCheckIntervalMinutes": nil, "statusCheckTimeoutSeconds": nil,
			"editIdleTimeoutMinutes": nil, "animatedFolderBackgrounds": nil, "defaultLayout": nil,
		}
	}
	eq(t, view, want, "legacy view")
}

func TestToLegacy_OrdersByPlacement(t *testing.T) {
	doc := migrated(t, loadJSON(t, "testdata/v2_basic.json"))
	_, _, _, g1 := findNode(doc, "g1")
	c := g1["content"].(Obj)["children"].([]any)
	c[0], c[2] = c[2], c[0] // array order now disagrees with placement
	view, err := ToLegacy(doc)
	if err != nil {
		t.Fatal(err)
	}
	g := list(t, list(t, list(t, view, "dashboards")[0], "tabs")[0], "groups")[0]
	es := list(t, g, "entries")
	for i, id := range []string{"e1", "e2", "e3"} {
		if es[i]["id"] != id {
			t.Errorf("entry %d = %v, want %s", i, es[i]["id"], id)
		}
	}
}

func TestToLegacy_RejectsNesting(t *testing.T) {
	doc := migrated(t, loadJSON(t, "testdata/v2_basic.json"))
	_, _, _, g1 := findNode(doc, "g1")
	c := g1["content"].(Obj)["children"].([]any)
	c[0].(Obj)["kind"] = "folder"
	if _, err := ToLegacy(doc); !errors.Is(err, ErrNotLegacyRepresentable) {
		t.Fatalf("err = %v", err)
	}
}

func TestToLegacy_RejectsRootTile(t *testing.T) {
	doc := migrated(t, loadJSON(t, "testdata/v2_basic.json"))
	tab := list(t, list(t, doc, "dashboards")[0], "tabs")[0]
	root := tab["root"].(Obj)
	root["children"].([]any)[0].(Obj)["kind"] = "tile"
	if _, err := ToLegacy(doc); !errors.Is(err, ErrNotLegacyRepresentable) {
		t.Fatalf("err = %v", err)
	}
}

func TestToLegacy_NotV3(t *testing.T) {
	if _, err := ToLegacy(loadJSON(t, "testdata/v2_basic.json")); !errors.Is(err, ErrNotV3) {
		t.Fatalf("err = %v", err)
	}
}

func TestToLegacy_DoesNotMutate(t *testing.T) {
	doc := migrated(t, loadJSON(t, "testdata/v2_basic.json"))
	before := snapshot(t, doc)
	if _, err := ToLegacy(doc); err != nil {
		t.Fatal(err)
	}
	if snapshot(t, doc) != before {
		t.Fatal("ToLegacy mutated its input")
	}
}

func TestFromLegacy_PreservesV3OnlyFields(t *testing.T) {
	v2 := loadJSON(t, "testdata/v2_basic.json")
	prev := migrated(t, v2)
	pd := list(t, prev, "dashboards")[0]
	want := Obj{}
	for _, k := range settingsKeys {
		want[k] = nil
	}
	want["statusChecksEnabled"] = false
	pd["settings"] = want
	pd["revision"] = 7
	pd["defaultLayout"] = "free"
	list(t, pd, "tabs")[0]["layout"] = "free"

	view := v2 // no revision/settings/layout keys
	got, err := FromLegacy(view, prev)
	if err != nil {
		t.Fatal(err)
	}
	if !IsV3(got) {
		t.Fatal("not v3")
	}
	d := list(t, got, "dashboards")[0]
	eq(t, d["settings"], want, "settings")
	eq(t, d["revision"], 7, "revision")
	eq(t, d["defaultLayout"], "free", "defaultLayout")
	tabs := list(t, d, "tabs")
	eq(t, tabs[0]["layout"], "free", "tab 0 layout")
	eq(t, tabs[1]["layout"], "inherit", "tab 1 layout")
	if err := Verify(v2, got); err != nil {
		t.Errorf("result does not verify: %v", err)
	}
}

func TestFromLegacy_NewDashboard(t *testing.T) {
	v2 := loadJSON(t, "testdata/v2_basic.json")
	prev := Obj{"schemaVersion": 3, "dashboards": []any{}}
	got, err := FromLegacy(v2, prev)
	if err != nil {
		t.Fatal(err)
	}
	d := list(t, got, "dashboards")[0]
	eq(t, d["revision"], 1, "revision")
	for _, k := range settingsKeys {
		if v, ok := d["settings"].(Obj)[k]; !ok || v != nil {
			t.Errorf("settings.%s = %v (present=%v), want nil", k, v, ok)
		}
	}
}

func TestFromLegacy_NotV3Prev(t *testing.T) {
	v2 := loadJSON(t, "testdata/v2_basic.json")
	if _, err := FromLegacy(v2, v2); !errors.Is(err, ErrNotV3) {
		t.Fatalf("err = %v", err)
	}
}

func TestToLegacy_FailsLoudlyOnMalformedNodes(t *testing.T) {
	cases := map[string]struct {
		mutate func(doc Obj)
		id     string
	}{
		"root": {func(doc Obj) {
			delete(list(t, list(t, doc, "dashboards")[0], "tabs")[0], "root")
		}, "t1"},
		"content": {func(doc Obj) {
			_, _, _, g := findNode(doc, "g1")
			g["content"] = "oops"
		}, "g1"},
		"placement missing": {func(doc Obj) {
			_, _, _, e := findNode(doc, "e2")
			delete(e, "placement")
		}, "e2"},
		"placement non-numeric": {func(doc Obj) {
			_, _, _, g := findNode(doc, "g2")
			g["placement"].(Obj)["x"] = "left"
		}, "g2"},
	}
	for name, c := range cases {
		doc := migrated(t, loadJSON(t, "testdata/v2_basic.json"))
		c.mutate(doc)
		_, err := ToLegacy(doc)
		if err == nil || !strings.Contains(err.Error(), c.id) {
			t.Errorf("%s: err = %v, want error mentioning %s", name, err, c.id)
		}
	}
}
