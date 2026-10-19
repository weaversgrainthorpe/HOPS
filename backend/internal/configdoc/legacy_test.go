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
	c[0].(Obj)["content"] = Obj{"columns": 1, "children": []any{}}
	if _, err := DashboardToLegacy(list(t, doc, "dashboards")[0]); !errors.Is(err, ErrNotLegacyRepresentable) {
		t.Fatalf("err = %v", err)
	}
	// The whole-document view leaves the dashboard out instead of failing.
	view, err := ToLegacy(doc)
	if err != nil {
		t.Fatal(err)
	}
	if n := len(list(t, view, "dashboards")); n != 0 {
		t.Fatalf("view holds %d dashboards, want 0", n)
	}
}

func TestToLegacy_RejectsRootTile(t *testing.T) {
	doc := migrated(t, loadJSON(t, "testdata/v2_basic.json"))
	tab := list(t, list(t, doc, "dashboards")[0], "tabs")[0]
	root := tab["root"].(Obj)
	root["children"].([]any)[0].(Obj)["kind"] = "tile"
	if _, err := DashboardToLegacy(list(t, doc, "dashboards")[0]); !errors.Is(err, ErrNotLegacyRepresentable) {
		t.Fatalf("err = %v", err)
	}
	view, err := ToLegacy(doc)
	if err != nil {
		t.Fatal(err)
	}
	if n := len(list(t, view, "dashboards")); n != 0 {
		t.Fatalf("view holds %d dashboards, want 0", n)
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
	list(t, pd, "tabs")[0]["layout"] = "grid" // "free" would make the dashboard v3-only

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
	eq(t, tabs[0]["layout"], "grid", "tab 0 layout")
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

// An unreadable dashboard (malformed tree or placement) is treated as v3-only
// (Ruling 24): it is left out of the legacy view, LegacyEditable names why,
// and every other dashboard is still served. It never fails the whole view.
func TestToLegacy_TreatsUnreadableAsV3Only(t *testing.T) {
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
	healthy, err := ConvertDashboardV2(Obj{"id": "ok", "name": "OK", "tabs": []any{
		Obj{"id": "ok-t1", "name": "T", "groups": []any{Obj{"id": "ok-g1", "name": "G", "entries": []any{Obj{"id": "ok-e1", "name": "E"}}}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	for name, c := range cases {
		doc := migrated(t, loadJSON(t, "testdata/v2_basic.json"))
		doc["dashboards"] = append(doc["dashboards"].([]any), healthy)
		doc = norm(t, doc).(Obj)
		c.mutate(doc)
		view, err := ToLegacy(doc)
		if err != nil {
			t.Errorf("%s: ToLegacy failed the whole view: %v", name, err)
			continue
		}
		ds := list(t, view, "dashboards")
		if len(ds) != 1 || ds[0]["id"] != "ok" {
			t.Errorf("%s: view dashboards = %v, want only the healthy one", name, snapshot2(view["dashboards"]))
		}
		ok, reason := LegacyEditable(list(t, doc, "dashboards")[0])
		if ok || !strings.Contains(reason, "cannot be read") || !strings.Contains(reason, c.id) {
			t.Errorf("%s: LegacyEditable = %v, %q; want not editable, unreadable, naming %s", name, ok, reason, c.id)
		}
	}
}

// LegacyCache gives the same answers as the uncached functions and computes
// each dashboard's legacy form once, however often it is asked (m1).
func TestLegacyCache_ComputesOncePerDashboard(t *testing.T) {
	doc := migrated(t, loadJSON(t, "testdata/v2_basic.json"))
	doc["dashboards"] = append(doc["dashboards"].([]any), showcaseDash(t, "s1"))
	doc = norm(t, doc).(Obj)
	lc := NewLegacyCache()
	want, err := ToLegacy(doc)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		got, err := lc.ToLegacy(doc)
		if err != nil {
			t.Fatal(err)
		}
		eq(t, got, want, "cached ToLegacy")
		got["dashboards"].([]any)[0].(Obj)["name"] = "mutated" // callers may mutate the view
		for _, d := range list(t, doc, "dashboards") {
			ok1, r1 := LegacyEditable(d)
			ok2, r2 := lc.Editable(d)
			if ok1 != ok2 || r1 != r2 {
				t.Fatalf("cached Editable(%v) = %v %q, want %v %q", d["id"], ok2, r2, ok1, r1)
			}
		}
		if _, err := lc.FromLegacy(want, doc); err != nil {
			t.Fatal(err)
		}
	}
	if n := lc.Computed(); n != 2 {
		t.Fatalf("legacy forms computed %d times, want 2 (one per dashboard)", n)
	}
	// A changed dashboard is a different key: recomputed, never a stale answer.
	_, _, _, e := findNode(doc, "e2")
	delete(e, "placement")
	if ok, _ := lc.Editable(list(t, doc, "dashboards")[0]); ok {
		t.Fatal("changed dashboard answered from the cache as editable")
	}
	if n := lc.Computed(); n != 3 {
		t.Fatalf("computed %d, want 3 after a change", n)
	}
}

// showcaseDash is a v3-only dashboard: a free tab with a tile at its root.
func showcaseDash(t *testing.T, id string) Obj {
	t.Helper()
	d := Obj{
		"id": id, "name": "Showcase " + id, "path": "/" + id, "revision": 4,
		"settings": Obj{"statusChecksEnabled": nil}, "defaultLayout": "grid",
		"tabs": []any{Obj{
			"id": id + "-t1", "name": "Free", "layout": "free", "designWidth": 1280,
			"root": Obj{"columns": 12, "children": []any{
				Obj{"id": id + "-e1", "kind": "tile", "name": "X", "placement": Obj{"x": 3, "y": 5, "w": 30, "h": 20, "z": 1}},
			}},
		}},
	}
	return norm(t, d).(Obj)
}

func TestLegacyEditable(t *testing.T) {
	base := func() Obj { return migrated(t, loadJSON(t, "testdata/v2_basic.json")) }
	dash := func(doc Obj) Obj { return list(t, doc, "dashboards")[0] }

	if ok, reason := LegacyEditable(dash(base())); !ok {
		t.Fatalf("migrated v2_basic not editable: %s", reason)
	}

	cases := map[string]struct {
		mutate func(doc Obj)
		want   string
	}{
		"root tile": {func(doc Obj) {
			root := list(t, dash(doc), "tabs")[0]["root"].(Obj)
			root["children"] = append(root["children"].([]any), Obj{"id": "rt", "kind": "tile", "placement": Obj{"x": 0, "y": 9, "w": 1, "h": 1}})
		}, "rt"},
		"nested folder": {func(doc Obj) {
			_, _, _, g1 := findNode(doc, "g1")
			content := g1["content"].(Obj)
			content["children"] = append(content["children"].([]any), Obj{
				"id": "nf", "kind": "folder", "placement": Obj{"x": 0, "y": 5, "w": 1, "h": 1},
				"content": Obj{"columns": 1, "children": []any{}}})
		}, "nf"},
		"free tab": {func(doc Obj) {
			list(t, dash(doc), "tabs")[1]["layout"] = "free"
		}, "free"},
		"free folder": {func(doc Obj) {
			_, _, _, g4 := findNode(doc, "g4")
			g4["layout"] = "free"
		}, "free"},
		"designWidth": {func(doc Obj) {
			list(t, dash(doc), "tabs")[0]["designWidth"] = 1280
		}, "designWidth"},
		"hand-moved placement": {func(doc Obj) {
			_, _, _, e3 := findNode(doc, "e3")
			e3["placement"].(Obj)["x"] = 7
		}, "placement"},
		"folder columns": {func(doc Obj) {
			_, _, _, g2 := findNode(doc, "g2")
			g2["content"].(Obj)["columns"] = 3
		}, "columns"},
	}
	for name, c := range cases {
		doc := base()
		c.mutate(doc)
		ok, reason := LegacyEditable(dash(doc))
		if ok {
			t.Errorf("%s: editable, want v3-only", name)
			continue
		}
		if !strings.Contains(reason, c.want) {
			t.Errorf("%s: reason %q does not name %q", name, reason, c.want)
		}
	}

	// Array order that disagrees with placement is not a layout change.
	doc := base()
	_, _, _, g1 := findNode(doc, "g1")
	c := g1["content"].(Obj)["children"].([]any)
	c[0], c[2] = c[2], c[0]
	if ok, reason := LegacyEditable(dash(doc)); !ok {
		t.Errorf("reordered array: not editable: %s", reason)
	}
}

// Ruling 2: real dashboards never become view-only by accident.
func TestLegacyEditable_RealFixtures(t *testing.T) {
	docs := map[string]Obj{
		"v2_basic":    migrated(t, loadJSON(t, "testdata/v2_basic.json")),
		"v2_messy":    migrated(t, loadJSON(t, "testdata/v2_messy.json")),
		"v2_dup_ids":  migrated(t, loadJSON(t, "testdata/v2_dup_ids.json")),
		"real_sample": migrated(t, realV2(t, "testdata/real_sample.json")),
		"real_weaver": migrated(t, realV2(t, "testdata/real_weavers.json")),
	}
	for name, doc := range docs {
		dashes := list(t, doc, "dashboards")
		if len(dashes) == 0 {
			t.Fatalf("%s: no dashboards", name)
		}
		for _, d := range dashes {
			if ok, reason := LegacyEditable(d); !ok {
				t.Errorf("%s: dashboard %v not editable: %s", name, d["id"], reason)
			}
		}
		// And after a legacy edit + save round trip.
		view, err := ToLegacy(doc)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if got, want := len(list(t, view, "dashboards")), len(dashes); got != want {
			t.Fatalf("%s: view holds %d dashboards, want %d", name, got, want)
		}
		renamed := false
		for _, d := range list(t, view, "dashboards") {
			for _, tab := range list(t, d, "tabs") {
				for _, g := range list(t, tab, "groups") {
					if es, _ := g["entries"].([]any); len(es) > 0 && !renamed {
						es[0].(Obj)["name"] = "Edited"
						renamed = true
					}
				}
			}
		}
		next, err := FromLegacy(norm(t, view).(Obj), norm(t, doc).(Obj))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		for _, d := range list(t, norm(t, next).(Obj), "dashboards") {
			if ok, reason := LegacyEditable(d); !ok {
				t.Errorf("%s: dashboard %v not editable after round trip: %s", name, d["id"], reason)
			}
		}
	}
}

func TestToLegacy_SkipsV3Only(t *testing.T) {
	doc := migrated(t, loadJSON(t, "testdata/v2_basic.json"))
	doc["dashboards"] = append(doc["dashboards"].([]any), showcaseDash(t, "s1"))
	view, err := ToLegacy(doc)
	if err != nil {
		t.Fatal(err)
	}
	ds := list(t, view, "dashboards")
	if len(ds) != 1 || ds[0]["id"] != "d1" {
		t.Fatalf("view dashboards = %v", snapshot2(view["dashboards"]))
	}
	if _, err := DashboardToLegacy(showcaseDash(t, "s1")); !errors.Is(err, ErrNotLegacyRepresentable) {
		t.Fatalf("direct call: err = %v", err)
	}
}

func TestFromLegacy_CarriesV3OnlyOver(t *testing.T) {
	basic := migrated(t, loadJSON(t, "testdata/v2_basic.json"))
	d2, err := ConvertDashboardV2(Obj{"id": "d2", "name": "Two", "tabs": []any{
		Obj{"id": "d2-t1", "name": "T", "groups": []any{Obj{"id": "d2-g1", "name": "G", "entries": []any{Obj{"id": "d2-e1", "name": "E"}}}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	// prev order: s0, d1, s1, d2
	prev := norm(t, Obj{"schemaVersion": 3, "dashboards": []any{
		showcaseDash(t, "s0"), list(t, basic, "dashboards")[0], showcaseDash(t, "s1"), d2,
	}}).(Obj)
	view, err := ToLegacy(prev)
	if err != nil {
		t.Fatal(err)
	}
	if n := len(list(t, view, "dashboards")); n != 2 {
		t.Fatalf("view holds %d dashboards, want 2", n)
	}
	list(t, view, "dashboards")[0]["name"] = "Edited"
	got, err := FromLegacy(view, prev)
	if err != nil {
		t.Fatal(err)
	}
	ds := list(t, got, "dashboards")
	var ids []string
	for _, d := range ds {
		ids = append(ids, d["id"].(string))
	}
	if strings.Join(ids, ",") != "s0,d1,s1,d2" {
		t.Fatalf("order = %v", ids)
	}
	eq(t, ds[0], list(t, prev, "dashboards")[0], "s0 carried unchanged")
	eq(t, ds[2], list(t, prev, "dashboards")[2], "s1 carried unchanged")
	eq(t, ds[1]["name"], "Edited", "edited dashboard")

	// A view that holds a v3-only dashboard's id is refused, never merged.
	view["dashboards"] = append(view["dashboards"].([]any), Obj{"id": "s1", "name": "Hijack", "tabs": []any{}})
	if _, err := FromLegacy(view, prev); !errors.Is(err, ErrV3OnlyDashboard) {
		t.Fatalf("err = %v, want ErrV3OnlyDashboard", err)
	}
}
