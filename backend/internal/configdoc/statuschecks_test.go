package configdoc

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/settings"
)

// statusCase is one row of testdata/status_checks_cases.json, the resolver
// matrix shared with the frontend's resolver test. A null level means
// "inherit" (the key is absent). Built objects carry fixed ids: the
// dashboard "d", the tab "t", folders "f0".."fN" (outermost first) and the
// tile "x"; want.sourceIdx indexes folders when the source is "folder".
type statusCase struct {
	Name              string  `json:"name"`
	Global            bool    `json:"global"`
	DashboardOverride *bool   `json:"dashboardOverride"`
	Tab               *bool   `json:"tab"`
	Folders           []*bool `json:"folders"`
	Tile              *bool   `json:"tile"`
	Want              struct {
		On        bool   `json:"on"`
		Source    string `json:"source"`
		SourceIdx *int   `json:"sourceIdx"`
	} `json:"want"`
}

func loadStatusCases(t *testing.T) []statusCase {
	t.Helper()
	raw, err := os.ReadFile("testdata/status_checks_cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []statusCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("status_checks_cases.json has no cases")
	}
	return cases
}

func TestEffectiveStatusChecks_SharedMatrix(t *testing.T) {
	for _, c := range loadStatusCases(t) {
		t.Run(c.Name, func(t *testing.T) {
			svc := newSvc(t)
			if err := svc.Set(settings.KeyStatusChecksEnabled, strconv.FormatBool(c.Global)); err != nil {
				t.Fatal(err)
			}
			dash := Obj{"id": "d", "settings": Obj{"statusChecksEnabled": nil}}
			if c.DashboardOverride != nil {
				dash["settings"].(Obj)["statusChecksEnabled"] = *c.DashboardOverride
			}
			tab := Obj{"id": "t"}
			if c.Tab != nil {
				tab["statusChecksEnabled"] = *c.Tab
			}
			var chain []Obj
			for i, f := range c.Folders {
				fo := Obj{"id": fmt.Sprintf("f%d", i), "kind": "folder"}
				if f != nil {
					fo["statusChecksEnabled"] = *f
				}
				chain = append(chain, fo)
			}
			tile := Obj{"id": "x", "kind": "tile"}
			if c.Tile != nil {
				tile["statusCheck"] = Obj{"type": "http", "enabled": *c.Tile}
			}

			on, src, id := EffectiveStatusChecks(svc, dash, tab, chain, tile)

			wantID := map[string]string{"global": "", "dashboard": "d", "tab": "t", "tile": "x"}[c.Want.Source]
			if c.Want.Source == "folder" {
				if c.Want.SourceIdx == nil {
					t.Fatal("folder source needs sourceIdx")
				}
				wantID = fmt.Sprintf("f%d", *c.Want.SourceIdx)
			}
			if on != c.Want.On || string(src) != c.Want.Source || id != wantID {
				t.Errorf("got (%v, %q, %q), want (%v, %q, %q)", on, src, id, c.Want.On, c.Want.Source, wantID)
			}
		})
	}
}

// Every form of "not set" inherits: statusCheck missing, null, an object
// without enabled, enabled null; and a nil tab/tile/dashboard.
func TestEffectiveStatusChecks_InheritForms(t *testing.T) {
	svc := newSvc(t)
	dash := Obj{"id": "d", "settings": Obj{"statusChecksEnabled": false}}
	for i, tile := range []Obj{
		{"id": "x"},
		{"id": "x", "statusCheck": nil},
		{"id": "x", "statusCheck": Obj{"type": "http"}},
		{"id": "x", "statusCheck": Obj{"enabled": nil}},
		nil,
	} {
		on, src, id := EffectiveStatusChecks(svc, dash, Obj{"id": "t", "statusChecksEnabled": nil}, []Obj{{"id": "f0"}}, tile)
		if on || src != SourceDashboard || id != "d" {
			t.Errorf("form %d: got (%v, %q, %q), want dashboard off", i, on, src, id)
		}
	}
	on, src, id := EffectiveStatusChecks(svc, nil, nil, nil, nil)
	if !on || src != SourceGlobal || id != "" {
		t.Errorf("all nil: got (%v, %q, %q), want global on", on, src, id)
	}
}

// A wrong-typed stored value (never written: verify rejects it) is treated as
// inherit and logged at WARN, not silently coerced.
func TestEffectiveStatusChecks_WrongTypeInheritsAndWarns(t *testing.T) {
	buf := captureLogs(t)
	svc := newSvc(t)
	on, src, _ := EffectiveStatusChecks(svc, Obj{"id": "d"}, Obj{"id": "t"},
		[]Obj{{"id": "f0", "statusChecksEnabled": "yes"}}, Obj{"id": "x", "statusCheck": Obj{"enabled": "no"}})
	if !on || src != SourceGlobal {
		t.Errorf("got (%v, %q), want global on", on, src)
	}
	if out := buf.String(); !strings.Contains(out, "level=WARN") {
		t.Errorf("expected WARN log, got %q", out)
	}
}

func TestVerifyDashboard_StatusChecksTriState(t *testing.T) {
	mk := func(tabV, folderV, tileSC any) Obj {
		tile := Obj{"kind": "tile", "id": "x", "placement": Obj{"x": 0, "y": 0, "w": 1, "h": 1}}
		if tileSC != "absent" {
			tile["statusCheck"] = tileSC
		}
		folder := Obj{"kind": "folder", "id": "f", "placement": Obj{"x": 0, "y": 0, "w": 1, "h": 1},
			"content": Obj{"columns": 12, "children": []any{tile}}}
		if folderV != "absent" {
			folder["statusChecksEnabled"] = folderV
		}
		tab := Obj{"id": "t", "root": Obj{"columns": 12, "children": []any{folder}}}
		if tabV != "absent" {
			tab["statusChecksEnabled"] = tabV
		}
		d := validDashboardForStatusTest()
		d["tabs"] = []any{tab}
		return d
	}
	for _, ok := range []Obj{
		mk("absent", "absent", "absent"),
		mk(true, false, Obj{"enabled": true}),
		mk(false, true, Obj{"type": "http"}),
		mk(nil, nil, nil),
		mk("absent", "absent", Obj{"enabled": nil}),
	} {
		if err := VerifyDashboard(ok); err != nil {
			t.Errorf("valid tri-state rejected: %v", err)
		}
	}
	for name, bad := range map[string]Obj{
		"tab yes":         mk("yes", "absent", "absent"),
		"folder 1":        mk("absent", float64(1), "absent"),
		"tile enabled":    mk("absent", "absent", Obj{"enabled": "yes"}),
		"statusCheck str": mk("absent", "absent", "on"),
	} {
		err := VerifyDashboard(bad)
		if err == nil {
			t.Errorf("%s: accepted", name)
			continue
		}
		if !strings.Contains(err.Error(), "true or false") {
			t.Errorf("%s: unclear message %v", name, err)
		}
	}
}

// validDashboardForStatusTest is a minimal dashboard VerifyDashboard accepts
// (tabs filled in by the caller).
func validDashboardForStatusTest() Obj {
	return Obj{
		"id": "d", "name": "D", "path": "/d", "revision": float64(1), "defaultLayout": "grid",
		"settings": Obj{
			"statusChecksEnabled": nil, "statusCheckIntervalMinutes": nil, "statusCheckTimeoutSeconds": nil,
			"editIdleTimeoutMinutes": nil, "animatedFolderBackgrounds": nil, "defaultLayout": nil,
		},
	}
}

func TestFindTileWithAncestors(t *testing.T) {
	tile := Obj{"kind": "tile", "id": "x"}
	inner := Obj{"kind": "folder", "id": "f1", "content": Obj{"children": []any{tile}}}
	outer := Obj{"kind": "folder", "id": "f0", "content": Obj{"children": []any{inner}}}
	tab := Obj{"id": "t", "root": Obj{"children": []any{outer}}}
	dash := Obj{"id": "d", "tabs": []any{tab}}
	doc := Obj{"dashboards": []any{dash}}
	d, tb, fs, tl, ok := FindTileWithAncestors(doc, "x")
	if !ok || d["id"] != "d" || tb["id"] != "t" || tl["id"] != "x" || len(fs) != 2 || fs[0]["id"] != "f0" || fs[1]["id"] != "f1" {
		t.Fatalf("got %v %v %v %v %v", d, tb, fs, tl, ok)
	}
	if _, _, _, _, ok := FindTileWithAncestors(doc, "f1"); ok {
		t.Error("a folder id matched as a tile")
	}
}
