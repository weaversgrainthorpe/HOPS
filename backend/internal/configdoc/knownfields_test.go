package configdoc

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"
)

var updateKnownFields = flag.Bool("update-known-fields", false, "rewrite testdata/known_fields.json from the Go lists")

const knownFieldsFile = "testdata/known_fields.json"

func unknownPaths(fs []UnknownField) []string {
	out := make([]string, len(fs))
	for i, f := range fs {
		out[i] = f.Path
	}
	sort.Strings(out)
	return out
}

// The v2 converter's output carries no field HOPS does not know, except the
// ones the v2 fixtures carry on purpose (to prove the converter keeps what it
// does not know): those, and only those, are named.
func TestUnknownFields_V2ThroughTheConverter(t *testing.T) {
	cases := map[string]map[string][]string{
		"testdata/v2_basic.json": {"d1": {
			"futureKey", "slug",
			"tabs[0].root.children[0].content.children[2].custom",
			"tabs[0].root.children[0].extra",
		}},
		"testdata/v2_messy.json": {
			"d1": {"tabs[0].tabExtra", "tabs[2].root.children[2].content.children[0].x-extra", "weird"},
			"d2": nil, "d3": nil,
		},
		"testdata/real_sample.json": nil, // every dashboard: none
	}
	for file, want := range cases {
		doc, _, _, err := MigrateV2Full(loadJSON(t, file))
		if err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		dashes := list(t, doc, "dashboards")
		if len(dashes) == 0 {
			t.Fatalf("%s: no dashboards", file)
		}
		for _, d := range dashes {
			id, _ := d["id"].(string)
			got := fmt.Sprint(unknownPaths(UnknownFields(d)))
			w := append([]string(nil), want[id]...)
			sort.Strings(w)
			if got != fmt.Sprint(w) {
				t.Errorf("%s dashboard %s: unknown fields %s, want %v", file, id, got, w)
			}
		}
	}
}

// A dashboard using every field HOPS has (every level, every 3.1 field) is
// valid and has no unknown field; and every listed field is used by it, so
// the lists hold nothing the fixture does not show is real.
func TestUnknownFields_FullDashboardHasNone(t *testing.T) {
	doc := loadJSON(t, "testdata/v3_full_fields.json")
	d := list(t, doc, "dashboards")[0]
	if err := VerifyImportedDashboard(d); err != nil {
		t.Fatalf("the full fixture must be a valid dashboard: %v", err)
	}
	if fs := UnknownFields(d); len(fs) != 0 {
		t.Fatalf("unknown fields in the full fixture: %v", unknownPaths(fs))
	}
	seen := map[string]map[string]bool{}
	mark := func(level string, o Obj) {
		if seen[level] == nil {
			seen[level] = map[string]bool{}
		}
		for k := range o {
			seen[level][k] = true
		}
	}
	mark("dashboard", d)
	for _, k := range []string{"settings", "header", "theme", "background"} {
		mark(k, d[k].(Obj))
	}
	for _, x := range d["tabs"].([]any) {
		tm := x.(Obj)
		mark("tab", tm)
		mark("container", tm["root"].(Obj))
		if bg, ok := tm["background"].(Obj); ok {
			mark("background", bg)
		}
	}
	Walk(doc, func(_, _ Obj, _ []Obj, n Obj) bool {
		kind := n["kind"].(string)
		mark(kind, n)
		if p, ok := n["placement"].(Obj); ok {
			mark("placement", p)
		}
		if sc, ok := n["statusCheck"].(Obj); ok {
			mark("statusCheck", sc)
		}
		if bg, ok := n["background"].(Obj); ok {
			mark("background", bg)
		}
		if c, ok := n["content"].(Obj); ok {
			mark("container", c)
		}
		return true
	})
	for level, keys := range KnownFields() {
		for _, k := range keys {
			if !seen[level][k] {
				t.Errorf("known %s field %q is not in testdata/v3_full_fields.json: add it there (or drop it from the list)", level, k)
			}
		}
	}

	showcase := loadJSON(t, "testdata/v3_showcase_export.json")["config"].(Obj)
	for _, sd := range list(t, showcase, "dashboards") {
		if fs := UnknownFields(sd); len(fs) != 0 {
			t.Errorf("showcase dashboard %v: unknown fields %v", sd["id"], unknownPaths(fs))
		}
	}
}

// An unknown key at each level is named with its path and in words.
func TestUnknownFields_EachLevelIsNamed(t *testing.T) {
	doc := loadJSON(t, "testdata/v3_full_fields.json")
	d := list(t, doc, "dashboards")[0]
	tab := d["tabs"].([]any)[0].(Obj)
	root := tab["root"].(Obj)
	tile := root["children"].([]any)[0].(Obj)
	folder := root["children"].([]any)[1].(Obj)
	inner := folder["content"].(Obj)["children"].([]any)[1].(Obj)
	deep := inner["content"].(Obj)["children"].([]any)[0].(Obj)
	cases := []struct {
		o           Obj
		path, where string
	}{
		{d, "zz", "zz"},
		{d["settings"].(Obj), "settings.zz", "settings.zz"},
		{d["header"].(Obj), "header.zz", "header.zz"},
		{d["theme"].(Obj), "theme.zz", "theme.zz"},
		{d["background"].(Obj), "background.zz", "background.zz"},
		{tab, "tabs[0].zz", `tab "Home" › zz`},
		{tab["background"].(Obj), "tabs[0].background.zz", `tab "Home" › background.zz`},
		{root, "tabs[0].root.zz", `tab "Home" › zz`},
		{tile, "tabs[0].root.children[0].zz", `tab "Home" › tile "Plex" › zz`},
		{tile["placement"].(Obj), "tabs[0].root.children[0].placement.zz", `tab "Home" › tile "Plex" › placement.zz`},
		{tile["statusCheck"].(Obj), "tabs[0].root.children[0].statusCheck.zz", `tab "Home" › tile "Plex" › statusCheck.zz`},
		{folder, "tabs[0].root.children[1].zz", `tab "Home" › folder "Apps" › zz`},
		{folder["background"].(Obj), "tabs[0].root.children[1].background.zz", `tab "Home" › folder "Apps" › background.zz`},
		{folder["content"].(Obj), "tabs[0].root.children[1].content.zz", `tab "Home" › folder "Apps" › zz`},
		{inner, "tabs[0].root.children[1].content.children[1].zz", `tab "Home" › folder "Apps" › folder "Inner" › zz`},
		{deep, "tabs[0].root.children[1].content.children[1].content.children[0].zz", `tab "Home" › folder "Apps" › folder "Inner" › tile "SSH box" › zz`},
		{deep["statusCheck"].(Obj), "tabs[0].root.children[1].content.children[1].content.children[0].statusCheck.zz", `tab "Home" › folder "Apps" › folder "Inner" › tile "SSH box" › statusCheck.zz`},
	}
	for _, c := range cases {
		c.o["zz"] = 1
		fs := UnknownFields(d)
		delete(c.o, "zz")
		if len(fs) != 1 || fs[0].Path != c.path || fs[0].Where != c.where {
			t.Errorf("injected at %s: got %+v, want %s / %s", c.path, fs, c.path, c.where)
		}
	}
	// An unnamed item is "Untitled"; several unknowns come in document order.
	tile["name"] = ""
	tile["b"], tile["a"] = 1, 1
	d["top"] = 1
	got := UnknownFields(d)
	want := []string{"top", "tabs[0].root.children[0].a", "tabs[0].root.children[0].b"}
	if len(got) != 3 || got[0].Path != want[0] || got[1].Path != want[1] || got[2].Path != want[2] {
		t.Fatalf("order: %+v, want %v", got, want)
	}
	if got[1].Where != `tab "Home" › tile "Untitled" › a` {
		t.Errorf("unnamed tile: %q", got[1].Where)
	}
}

// testdata/known_fields.json is the Go lists, for the frontend's check that
// every field the editor writes is one the server knows. Regenerate with
// go test ./internal/configdoc -run TestKnownFieldsFile -update-known-fields
func TestKnownFieldsFile(t *testing.T) {
	want, err := json.MarshalIndent(KnownFields(), "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	want = append(want, '\n')
	if *updateKnownFields {
		if err := os.WriteFile(knownFieldsFile, want, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got, err := os.ReadFile(knownFieldsFile)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatalf("%s is out of date with knownfields.go; regenerate it:\n  go test ./internal/configdoc -run TestKnownFieldsFile -update-known-fields\nwant:\n%s", knownFieldsFile, strings.TrimSpace(string(want)))
	}
}
