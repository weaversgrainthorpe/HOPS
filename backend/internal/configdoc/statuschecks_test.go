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
// matrix shared with the frontend's resolver test; its conventions (null
// levels, the tile forms, the fixed ids d / t / f0..fN / x) are in
// testdata/status_checks_cases.README.md.
type statusCase struct {
	Name              string            `json:"name"`
	Global            bool              `json:"global"`
	DashboardOverride *bool             `json:"dashboardOverride"`
	Tab               json.RawMessage   `json:"tab"`
	Folders           []json.RawMessage `json:"folders"`
	Tile              json.RawMessage   `json:"tile"`
	Want              struct {
		On        bool    `json:"on"`
		Source    string  `json:"source"`
		SourceIdx *int    `json:"sourceIdx"`
		SourceID  *string `json:"sourceId"`
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
			// container sets a tab/folder level: true/false, null = absent
			// (inherit), "invalid" = the wrong-typed value "yes".
			container := func(o Obj, raw json.RawMessage) {
				switch strings.TrimSpace(string(raw)) {
				case "null", "":
				case "true":
					o["statusChecksEnabled"] = true
				case "false":
					o["statusChecksEnabled"] = false
				case `"invalid"`:
					o["statusChecksEnabled"] = "yes"
				default:
					t.Fatalf("unknown level form %s", raw)
				}
			}
			tab := Obj{"id": "t"}
			container(tab, c.Tab)
			var chain []Obj
			for i, f := range c.Folders {
				fo := Obj{"id": fmt.Sprintf("f%d", i), "kind": "folder"}
				container(fo, f)
				chain = append(chain, fo)
			}
			tile := Obj{"id": "x", "kind": "tile"}
			switch strings.TrimSpace(string(c.Tile)) {
			case `"absent"`:
			case `"noEnabled"`:
				tile["statusCheck"] = Obj{"type": "http"}
			case "null", "":
				tile["statusCheck"] = Obj{"type": "http", "enabled": nil}
			case "true":
				tile["statusCheck"] = Obj{"type": "http", "enabled": true}
			case "false":
				tile["statusCheck"] = Obj{"type": "http", "enabled": false}
			case `"invalid"`:
				tile["statusCheck"] = Obj{"type": "http", "enabled": "yes"}
			default:
				t.Fatalf("unknown tile form %s", c.Tile)
			}

			on, src, id := EffectiveStatusChecks(svc, dash, tab, chain, tile)

			wantID := map[string]string{"global": "", "dashboard": "d", "tab": "t", "tile": "x"}[c.Want.Source]
			if c.Want.Source == "folder" {
				if c.Want.SourceIdx == nil {
					t.Fatal("folder source needs sourceIdx")
				}
				wantID = fmt.Sprintf("f%d", *c.Want.SourceIdx)
			}
			if c.Want.SourceID != nil {
				wantID = *c.Want.SourceID
			} else if c.Want.Source == "invalid" {
				t.Fatal("invalid source needs sourceId")
			}
			if on != c.Want.On || string(src) != c.Want.Source || id != wantID {
				t.Errorf("got (%v, %q, %q), want (%v, %q, %q)", on, src, id, c.Want.On, c.Want.Source, wantID)
			}
		})
	}
}

// Ruling 12: only an explicit statusCheck.enabled: null inherits; every
// "unset" form of a tile is off (source tile). A nil tile (no tile level, e.g.
// an id not in the config) inherits.
func TestEffectiveStatusChecks_TileForms(t *testing.T) {
	svc := newSvc(t)
	dash := Obj{"id": "d", "settings": Obj{"statusChecksEnabled": true}}
	for i, tile := range []Obj{
		{"id": "x"},
		{"id": "x", "statusCheck": nil},
		{"id": "x", "statusCheck": Obj{"type": "http"}},
	} {
		on, src, id := EffectiveStatusChecks(svc, dash, Obj{"id": "t"}, []Obj{{"id": "f0", "statusChecksEnabled": true}}, tile)
		if on || src != SourceTile || id != "x" {
			t.Errorf("unset form %d: got (%v, %q, %q), want off/tile", i, on, src, id)
		}
	}
	on, src, id := EffectiveStatusChecks(svc, dash, Obj{"id": "t", "statusChecksEnabled": nil}, []Obj{{"id": "f0"}},
		Obj{"id": "x", "statusCheck": Obj{"enabled": nil}})
	if !on || src != SourceDashboard || id != "d" {
		t.Errorf("explicit null: got (%v, %q, %q), want dashboard on", on, src, id)
	}
	on, src, id = EffectiveStatusChecks(svc, nil, nil, nil, nil)
	if !on || src != SourceGlobal || id != "" {
		t.Errorf("all nil: got (%v, %q, %q), want global on", on, src, id)
	}
}

// A wrong-typed stored value (never written: verify rejects it) makes the
// tile off with source "invalid" naming that level, and the WARN is logged
// once per (tile, level) per process, not on every pass.
func TestEffectiveStatusChecks_InvalidIsOffAndWarnsOnce(t *testing.T) {
	buf := captureLogs(t)
	svc := newSvc(t)
	tile := Obj{"id": "warn-once-x", "statusCheck": Obj{"enabled": true}}
	for i := 0; i < 3; i++ {
		on, src, id := EffectiveStatusChecks(svc, Obj{"id": "d"}, Obj{"id": "t"},
			[]Obj{{"id": "f0", "statusChecksEnabled": "yes"}}, tile)
		if on || src != SourceInvalid || id != "f0" {
			t.Fatalf("got (%v, %q, %q), want off/invalid/f0", on, src, id)
		}
	}
	on, src, id := EffectiveStatusChecks(svc, nil, nil, nil, Obj{"id": "warn-once-y", "statusCheck": "on"})
	if on || src != SourceInvalid || id != "warn-once-y" {
		t.Errorf("tile statusCheck string: got (%v, %q, %q)", on, src, id)
	}
	if n := strings.Count(buf.String(), "level=WARN"); n != 2 {
		t.Errorf("want 2 WARN lines (one per tile/level), got %d: %q", n, buf.String())
	}
}

func TestVerifyDashboard_StatusChecksTriState(t *testing.T) {
	mk := func(tabV, folderV, tileSC any) Obj {
		tile := Obj{"kind": "tile", "id": "x"}
		if tileSC != "absent" {
			tile["statusCheck"] = tileSC
		}
		folder := Obj{"kind": "folder", "id": "f", "size": "medium", "contentSize": "medium",
			"placement": Obj{"x": 0, "y": 0, "w": 1, "h": 1},
			"content":   Obj{"children": []any{tile}}}
		if folderV != "absent" {
			folder["statusChecksEnabled"] = folderV
		}
		tab := Obj{"id": "t", "root": Obj{"columns": RootColumns, "children": []any{folder}}}
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
		if msg := err.Error(); !strings.Contains(msg, "true") || !strings.Contains(msg, "false") {
			t.Errorf("%s: unclear message %v", name, err)
		}
	}
}

// validDashboardForStatusTest is a minimal dashboard VerifyDashboard accepts
// (tabs filled in by the caller).
func validDashboardForStatusTest() Obj {
	return Obj{
		"id": "d", "name": "D", "path": "/d", "revision": float64(1),
		"settings": Obj{
			"statusChecksEnabled": nil, "statusCheckIntervalMinutes": nil, "statusCheckTimeoutSeconds": nil,
			"editIdleTimeoutMinutes": nil, "animatedFolderBackgrounds": nil,
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
