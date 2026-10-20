package configdoc

import (
	"encoding/json"
	"strings"
	"testing"
)

// legacyDoc is a v3 document as the M1–M3 build stored it: the dashboard's
// perTabBackgrounds switch and each background tab's backgroundEnabled mirror.
func legacyDoc(t *testing.T, perTab bool) Obj {
	t.Helper()
	raw := `{"schemaVersion":3,"theme":"dark","dashboards":[{
		"id":"d1","name":"Home","path":"/home","revision":4,"defaultLayout":"grid",
		"settings":{"statusChecksEnabled":null,"statusCheckInterval":null,"statusCheckTimeout":null,
			"editIdleTimeout":null,"animatedFolderBackgrounds":null,"defaultLayout":null},
		"background":{"type":"slideshow","images":["/a.jpg","/b.jpg"],"interval":30,"overlayOpacity":0.4},
		"perTabBackgrounds":` + map[bool]string{true: "true", false: "false"}[perTab] + `,
		"tabs":[
			{"id":"t1","name":"Main","layout":"inherit","color":"#123",
			 "background":{"type":"image","value":"/x.jpg","fit":"cover","overlayBlur":3},
			 "backgroundEnabled":` + map[bool]string{true: "true", false: "false"}[perTab] + `,
			 "root":{"columns":12,"children":[]}},
			{"id":"t2","name":"Other","layout":"inherit","root":{"columns":12,"children":[]}}
		]}]}`
	var doc Obj
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		t.Fatal(err)
	}
	return doc
}

func dash0(doc Obj) Obj       { return doc["dashboards"].([]any)[0].(Obj) }
func tabN(doc Obj, i int) Obj { return dash0(doc)["tabs"].([]any)[i].(Obj) }

func assertNoLegacyKeys(t *testing.T, doc Obj) {
	t.Helper()
	for _, d := range doc["dashboards"].([]any) {
		dm := d.(Obj)
		if _, has := dm["perTabBackgrounds"]; has {
			t.Errorf("dashboard %v still has perTabBackgrounds", dm["id"])
		}
		for _, tb := range dm["tabs"].([]any) {
			if _, has := tb.(Obj)["backgroundEnabled"]; has {
				t.Errorf("tab %v still has backgroundEnabled", tb.(Obj)["id"])
			}
		}
	}
}

// Review Focus 1: nothing is lost moving to the new background form.
func TestUpdateBackgroundsV4_KeepsInactiveTabPicturesAsInherit(t *testing.T) {
	before := legacyDoc(t, false)
	snap := snapshot2(before)
	out, changed, err := UpdateBackgroundsV4(before)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("changed = false, want true")
	}
	if snapshot2(before) != snap {
		t.Fatal("UpdateBackgroundsV4 mutated its input")
	}
	want := `{"fit":"cover","inherit":true,"overlayBlur":3,"type":"image","value":"/x.jpg"}`
	if got := snapshot2(tabN(out, 0)["background"]); got != want {
		t.Errorf("tab background = %s, want %s", got, want)
	}
	if _, has := tabN(out, 1)["background"]; has {
		t.Error("tab without a background gained one")
	}
	// The dashboard's own background is untouched.
	if snapshot2(dash0(out)["background"]) != snapshot2(dash0(before)["background"]) {
		t.Error("dashboard background changed")
	}
	assertNoLegacyKeys(t, out)
	if err := VerifyBackgroundsV4(before, out); err != nil {
		t.Fatalf("VerifyBackgroundsV4: %v", err)
	}
}

func TestUpdateBackgroundsV4_ActiveTabBackgroundUnchanged(t *testing.T) {
	before := legacyDoc(t, true)
	out, changed, err := UpdateBackgroundsV4(before)
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	if got, want := snapshot2(tabN(out, 0)["background"]), snapshot2(tabN(before, 0)["background"]); got != want {
		t.Errorf("active tab background = %s, want unchanged %s", got, want)
	}
	assertNoLegacyKeys(t, out)
	if err := VerifyBackgroundsV4(before, out); err != nil {
		t.Fatalf("VerifyBackgroundsV4: %v", err)
	}
}

// What the renderer showed decides: the M1–M3 frontend read only the
// dashboard's perTabBackgrounds, so a stale tab mirror never wins.
func TestUpdateBackgroundsV4_DashboardSwitchDecides(t *testing.T) {
	on := legacyDoc(t, true)
	tabN(on, 0)["backgroundEnabled"] = false
	out, _, err := UpdateBackgroundsV4(on)
	if err != nil {
		t.Fatal(err)
	}
	if _, has := tabN(out, 0)["background"].(Obj)["inherit"]; has {
		t.Error("tab shown as active (dashboard switch on) became inherit")
	}
	off := legacyDoc(t, false)
	tabN(off, 0)["backgroundEnabled"] = true
	out, _, err = UpdateBackgroundsV4(off)
	if err != nil {
		t.Fatal(err)
	}
	if tabN(out, 0)["background"].(Obj)["inherit"] != true {
		t.Error("tab shown as inactive (dashboard switch off) did not become inherit")
	}
	// A dashboard with only tab mirrors (no switch) showed no tab backgrounds.
	noSwitch := legacyDoc(t, true)
	delete(dash0(noSwitch), "perTabBackgrounds")
	out, changed, err := UpdateBackgroundsV4(noSwitch)
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	if tabN(out, 0)["background"].(Obj)["inherit"] != true {
		t.Error("tab under a dashboard without the switch did not become inherit")
	}
	assertNoLegacyKeys(t, out)
}

func TestUpdateBackgroundsV4_Idempotent(t *testing.T) {
	for _, perTab := range []bool{true, false} {
		first, changed, err := UpdateBackgroundsV4(legacyDoc(t, perTab))
		if err != nil || !changed {
			t.Fatalf("first run: changed=%v err=%v", changed, err)
		}
		second, changed, err := UpdateBackgroundsV4(first)
		if err != nil {
			t.Fatal(err)
		}
		if changed {
			t.Errorf("perTab=%v: second run changed=true", perTab)
		}
		if snapshot2(second) != snapshot2(first) {
			t.Errorf("perTab=%v: second run altered the document", perTab)
		}
	}
	// A document with no legacy keys at all is left alone.
	if _, changed, err := UpdateBackgroundsV4(Obj{"schemaVersion": 3, "dashboards": []any{}}); err != nil || changed {
		t.Errorf("empty doc: changed=%v err=%v", changed, err)
	}
}

func TestUpdateBackgroundsV4_NonObjectInactiveBackgroundIsError(t *testing.T) {
	doc := legacyDoc(t, false)
	tabN(doc, 0)["background"] = "/x.jpg"
	if _, _, err := UpdateBackgroundsV4(doc); err == nil {
		t.Fatal("want an error for a non-object tab background")
	}
}

func TestVerifyBackgroundsV4_DetectsLossOrChange(t *testing.T) {
	cases := map[string]struct {
		perTab bool
		mutate func(after Obj)
		want   string
	}{
		"picture field changed": {false, func(a Obj) { tabN(a, 0)["background"].(Obj)["value"] = "/y.jpg" }, "value"},
		"picture field dropped": {false, func(a Obj) { delete(tabN(a, 0)["background"].(Obj), "fit") }, "fit"},
		"background dropped":    {false, func(a Obj) { delete(tabN(a, 0), "background") }, "background"},
		"inactive left active":  {false, func(a Obj) { delete(tabN(a, 0)["background"].(Obj), "inherit") }, "inherit"},
		"active made inherit":   {true, func(a Obj) { tabN(a, 0)["background"].(Obj)["inherit"] = true }, "inherit"},
		"switch left behind":    {false, func(a Obj) { dash0(a)["perTabBackgrounds"] = false }, "perTabBackgrounds"},
		"mirror left behind":    {false, func(a Obj) { tabN(a, 0)["backgroundEnabled"] = false }, "backgroundEnabled"},
		"dashboard bg changed":  {false, func(a Obj) { dash0(a)["background"].(Obj)["interval"] = 5 }, "background"},
		"other tab key changed": {false, func(a Obj) { tabN(a, 0)["color"] = "#999" }, "color"},
		"tab dropped":           {false, func(a Obj) { dash0(a)["tabs"] = dash0(a)["tabs"].([]any)[:1] }, "t2"},
		"doc key changed":       {false, func(a Obj) { a["theme"] = "light" }, "theme"},
		"bad shape":             {false, func(a Obj) { tabN(a, 1)["background"] = Obj{"type": "image", "opacity": 2.0} }, "opacity"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			before := legacyDoc(t, tc.perTab)
			after, _, err := UpdateBackgroundsV4(before)
			if err != nil {
				t.Fatal(err)
			}
			tc.mutate(after)
			err = VerifyBackgroundsV4(before, after)
			if err == nil {
				t.Fatal("VerifyBackgroundsV4 = nil, want a problem")
			}
			wantProblem(t, err, tc.want)
		})
	}
}

// bgDoc is a minimal valid v3 document with bg set at the dashboard, tab and
// folder level in turn.
func bgDoc(level string, bg any) Obj {
	folder := Obj{"kind": "folder", "id": "f1", "name": "F", "display": "expanded",
		"placement": Obj{"x": 0, "y": 0, "w": 4, "h": 2},
		"content":   Obj{"columns": 4, "children": []any{}}}
	tab := Obj{"id": "t1", "name": "T", "root": Obj{"columns": 12, "children": []any{folder}}}
	dash := Obj{"id": "d1", "name": "D", "path": "/d", "revision": 1, "defaultLayout": "grid",
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

// ---- startup ----

func TestMigrateWithBackup_UpdatesBackgroundsOnce(t *testing.T) {
	db := newStoreDB(t)
	orig := snapshot2(legacyDoc(t, false))
	seed(t, db, orig)

	res, backedUp, err := MigrateWithBackup(db, func() error { t.Fatal("v3 doc must not take the pre-migration backup"); return nil })
	if err != nil || backedUp {
		t.Fatalf("err=%v backedUp=%v", err, backedUp)
	}
	if res.Failed || !res.BackgroundsUpdated || res.Migrated {
		t.Fatalf("result = %+v, want BackgroundsUpdated only", res)
	}
	var schema int
	var data, notes string
	if err := db.QueryRow(`SELECT schema, data, notes FROM config_archive`).Scan(&schema, &data, &notes); err != nil {
		t.Fatalf("want one archive row: %v", err)
	}
	if schema != 3 || data != orig || notes != "backgrounds-v4" {
		t.Errorf("archive schema=%d notes=%q data equal=%v", schema, notes, data == orig)
	}
	doc, err := Load(db)
	if err != nil {
		t.Fatal(err)
	}
	assertNoLegacyKeys(t, doc)
	if tabN(doc, 0)["background"].(Obj)["inherit"] != true {
		t.Error("stored tab background is not inherit")
	}

	// Second start: nothing to do — no archive row, no write.
	stored := rawRow(t, db)
	res, _, err = MigrateWithBackup(db, func() error { return nil })
	if err != nil || res.Failed || res.BackgroundsUpdated {
		t.Fatalf("second start: res=%+v err=%v", res, err)
	}
	if archiveCount(t, db) != 1 || rawRow(t, db) != stored {
		t.Error("second start wrote something")
	}
}

func TestMigrateWithBackup_BackgroundUpdateFailureWritesNothing(t *testing.T) {
	db := newStoreDB(t)
	doc := legacyDoc(t, false)
	tabN(doc, 0)["background"].(Obj)["images"] = []any{"/a.jpg", 7}
	orig := snapshot2(doc)
	seed(t, db, orig)

	res, _, err := MigrateWithBackup(db, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if !res.Failed || !strings.Contains(res.Detail, "background") {
		t.Fatalf("result = %+v, want a visible background-update failure", res)
	}
	if res.BackgroundsUpdated {
		t.Error("BackgroundsUpdated set on failure")
	}
	if rawRow(t, db) != orig {
		t.Error("stored config changed on failure")
	}
	if n := archiveCount(t, db); n != 0 {
		t.Errorf("archive rows = %d, want 0", n)
	}
}

func TestMigrateWithBackup_V2MigratesStraightToFinalForm(t *testing.T) {
	db := newStoreDB(t)
	seed(t, db, v2Bytes(t))
	res, backedUp, err := MigrateWithBackup(db, func() error { return nil })
	if err != nil || !backedUp {
		t.Fatalf("err=%v backedUp=%v", err, backedUp)
	}
	if !res.Migrated || res.Failed || res.BackgroundsUpdated {
		t.Fatalf("result = %+v, want Migrated with nothing left to update", res)
	}
	if n := archiveCount(t, db); n != 1 {
		t.Errorf("archive rows = %d, want only the v2 one", n)
	}
	doc, err := Load(db)
	if err != nil {
		t.Fatal(err)
	}
	assertNoLegacyKeys(t, doc)
}
