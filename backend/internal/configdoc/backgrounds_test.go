package configdoc

import "testing"

func dash0(doc Obj) Obj       { return doc["dashboards"].([]any)[0].(Obj) }
func tabN(doc Obj, i int) Obj { return dash0(doc)["tabs"].([]any)[i].(Obj) }

// bgDoc is a minimal valid v3 document with bg set at the dashboard, tab and
// folder level in turn.
func bgDoc(level string, bg any) Obj {
	folder := Obj{"kind": "folder", "id": "f1", "name": "F", "display": "expanded",
		"size": "medium", "contentSize": "medium",
		"placement": Obj{"x": 0, "y": 0, "w": 4, "h": 2},
		"content":   Obj{"children": []any{}}}
	tab := Obj{"id": "t1", "name": "T", "root": Obj{"columns": RootColumns, "children": []any{folder}}}
	dash := Obj{"id": "d1", "name": "D", "path": "/d", "revision": 1,
		"settings": nullSettings(), "tabs": []any{tab}}
	switch level {
	case "dashboard":
		dash["background"] = bg
	case "tab":
		tab["background"] = bg
	case "folder":
		folder["background"] = bg
	}
	return Obj{"schemaVersion": 3, "dashboards": []any{dash}}
}

func TestVerifyIDs_BackgroundShape(t *testing.T) {
	many := make([]any, 201)
	for i := range many {
		many[i] = "/p.jpg"
	}
	bad := map[string]struct {
		bg   any
		want string
	}{
		"opacity 2":        {Obj{"type": "image", "value": "/x", "opacity": 2.0}, "opacity"},
		"opacity negative": {Obj{"type": "color", "value": "#000", "opacity": -0.1}, "opacity"},
		"opacity string":   {Obj{"type": "color", "value": "#000", "opacity": "1"}, "opacity"},
		"non-string image": {Obj{"type": "slideshow", "images": []any{"/a", 3.0}}, "images[1]"},
		"images not array": {Obj{"type": "slideshow", "images": "/a"}, "images"},
		"too many images":  {Obj{"type": "slideshow", "images": many}, "200"},
		"unknown type":     {Obj{"type": "video", "value": "/x"}, "type"},
		"no type":          {Obj{"value": "/x"}, "type"},
		"inherit not bool": {Obj{"inherit": "yes", "type": "image"}, "inherit"},
		"inherit bad type": {Obj{"inherit": true, "type": "video"}, "type"},
		"not an object":    {"/x.jpg", "background"},
		"null":             {nil, "background"},
	}
	for _, level := range []string{"dashboard", "tab", "folder"} {
		for name, tc := range bad {
			t.Run(level+"/"+name, func(t *testing.T) {
				err := VerifyIDs(bgDoc(level, tc.bg))
				if err == nil {
					t.Fatal("VerifyIDs = nil, want a problem")
				}
				wantProblem(t, err, tc.want)
			})
		}
		good := map[string]any{
			"image":                Obj{"type": "image", "value": "/x", "opacity": 0.5},
			"colour opacity 0":     Obj{"type": "color", "value": "#000", "opacity": 0.0},
			"slideshow 200":        Obj{"type": "slideshow", "images": many[:200], "opacity": 1},
			"bare inherit":         Obj{"inherit": true},
			"inherit with picture": Obj{"inherit": true, "type": "image", "value": "/x", "fit": "cover"},
			"explicit not inherit": Obj{"inherit": false, "type": "color", "value": "#fff"},
		}
		for name, bg := range good {
			if err := VerifyIDs(bgDoc(level, bg)); err != nil {
				t.Errorf("%s/%s: %v", level, name, err)
			}
		}
		if err := VerifyDashboard(dash0(bgDoc(level, Obj{"type": "image", "opacity": 2.0}))); err == nil {
			t.Errorf("%s: VerifyDashboard accepted opacity 2", level)
		}
	}
}

// Ruling 14: a slideshow's interval and transitionDuration are clamped where they are used (the
// renderer and the picker), never rejected by verification, import or migration — an odd timing
// value must not block prod's v2→v3 migration or an import. The values are kept as stored.
var oddTimings = map[string]any{
	"huge":       1e9,
	"negative":   -5.0,
	"zero":       0.0,
	"tiny":       0.1,
	"string":     "30",
	"null":       nil,
	"bool":       true,
	"object":     Obj{"s": 1.0},
	"fractional": 7.25,
}

func TestBackgroundTiming_NeverRejected_Verify(t *testing.T) {
	for _, level := range []string{"dashboard", "tab", "folder"} {
		for name, val := range oddTimings {
			bg := Obj{"type": "slideshow", "images": []any{"/presets/a.jpg", "/presets/b.jpg"},
				"interval": val, "transitionDuration": val}
			doc := bgDoc(level, bg)
			if err := VerifyIDs(doc); err != nil {
				t.Errorf("%s/%s: VerifyIDs rejected: %v", level, name, err)
			}
			if err := VerifyDashboard(dash0(doc)); err != nil {
				t.Errorf("%s/%s: VerifyDashboard rejected: %v", level, name, err)
			}
			if err := VerifyImportedDashboard(dash0(doc)); err != nil {
				t.Errorf("%s/%s: VerifyImportedDashboard rejected: %v", level, name, err)
			}
		}
	}
}

func TestBackgroundTiming_NeverRejected_V2Migration(t *testing.T) {
	for name, val := range oddTimings {
		t.Run(name, func(t *testing.T) {
			v2 := loadJSON(t, "testdata/v2_basic.json")
			d := v2["dashboards"].([]any)[0].(Obj)
			d["background"] = Obj{"type": "slideshow", "images": []any{"/presets/a.jpg"},
				"interval": val, "transitionDuration": val}
			d["tabs"].([]any)[0].(Obj)["background"] = Obj{"type": "slideshow",
				"images": []any{"/presets/b.jpg"}, "interval": val, "transitionDuration": val}
			doc, renames, err := MigrateV2Renaming(v2)
			if err != nil {
				t.Fatalf("MigrateV2Renaming: %v", err)
			}
			if err := VerifyMigration(v2, doc, renames); err != nil {
				t.Fatalf("VerifyMigration rejected: %v", err)
			}
			bg := dash0(doc)["background"].(Obj)
			if show(bg["interval"]) != show(val) || show(bg["transitionDuration"]) != show(val) {
				t.Errorf("timing changed: got %s/%s, want %s", show(bg["interval"]), show(bg["transitionDuration"]), show(val))
			}
		})
	}
}
