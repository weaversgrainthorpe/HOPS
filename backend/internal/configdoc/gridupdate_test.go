package configdoc

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"os"
	"strings"
	"testing"
)

// oldGridDoc is a v3 document in the old 12-column form (no gridUnit marker).
// Dashboard d1 (default grid):
//
//	tab t1 (inherit → grid), root 12:
//	  tile a {0,0,1,1}
//	  folder f1 (inherit → grid) {1,0,4,3,z:2}, content 4:
//	    tile b {0,0,1,1}
//	    folder f2 (free) {1,0,2,2}, content 30:
//	      tile c {3,5,13,13}            (free: untouched)
//	      folder f3 (grid) {0,20,26,26}, content 2:   (own placement free: untouched)
//	        tile d {1,1,1,1}           (grid: doubled)
//	tab t2 (free, designWidth 1280), root 160:
//	  tile e {10,10,13,13}
//	  folder g (inherit → free) {30,30,40,40}, content 40: tile h {2,2,13,13}
//	  folder gg (grid) {30,0,52,40}, content (no columns): tile i {0,0,1,1}
//
// Dashboard d2 (default free):
//
//	tab u1 (inherit → free), root 160: tile j {5,5,13,13}
//	tab u2 (grid), root 12: tile k {2,1,2,2}
func oldGridDoc(t *testing.T) Obj {
	t.Helper()
	raw := `{"schemaVersion":3,"theme":"dark","dashboards":[
	{"id":"d1","name":"Home","path":"/home","revision":2,"defaultLayout":"grid",
	 "settings":{"statusChecksEnabled":null,"statusCheckInterval":null,"statusCheckTimeout":null,
		"editIdleTimeout":null,"animatedFolderBackgrounds":null,"defaultLayout":null},
	 "tabs":[
	  {"id":"t1","name":"Main","layout":"inherit","root":{"columns":12,"children":[
		{"id":"a","kind":"tile","name":"A","placement":{"x":0,"y":0,"w":1,"h":1}},
		{"id":"f1","kind":"folder","name":"F1","layout":"inherit","display":"expanded",
		 "placement":{"x":1,"y":0,"w":4,"h":3,"z":2},
		 "content":{"columns":4,"children":[
			{"id":"b","kind":"tile","name":"B","placement":{"x":0,"y":0,"w":1,"h":1}},
			{"id":"f2","kind":"folder","name":"F2","layout":"free","display":"expanded",
			 "placement":{"x":1,"y":0,"w":2,"h":2},
			 "content":{"columns":30,"children":[
				{"id":"c","kind":"tile","name":"C","placement":{"x":3,"y":5,"w":13,"h":13}},
				{"id":"f3","kind":"folder","name":"F3","layout":"grid","display":"expanded",
				 "placement":{"x":0,"y":20,"w":26,"h":26},
				 "content":{"columns":2,"children":[
					{"id":"d","kind":"tile","name":"D","placement":{"x":1,"y":1,"w":1,"h":1}}
				 ]}}
			 ]}}
		 ]}}
	  ]}},
	  {"id":"t2","name":"Free","layout":"free","designWidth":1280,"root":{"columns":160,"children":[
		{"id":"e","kind":"tile","name":"E","placement":{"x":10,"y":10,"w":13,"h":13}},
		{"id":"g","kind":"folder","name":"G","layout":"inherit","display":"expanded",
		 "placement":{"x":30,"y":30,"w":40,"h":40},
		 "content":{"columns":40,"children":[
			{"id":"h","kind":"tile","name":"H","placement":{"x":2,"y":2,"w":13,"h":13}}
		 ]}},
		{"id":"gg","kind":"folder","name":"GG","layout":"grid","display":"expanded",
		 "placement":{"x":30,"y":0,"w":52,"h":40},
		 "content":{"children":[
			{"id":"i","kind":"tile","name":"I","placement":{"x":0,"y":0,"w":1,"h":1}}
		 ]}}
	  ]}}
	 ]},
	{"id":"d2","name":"Other","path":"/other","revision":1,"defaultLayout":"free",
	 "settings":{"statusChecksEnabled":null,"statusCheckInterval":null,"statusCheckTimeout":null,
		"editIdleTimeout":null,"animatedFolderBackgrounds":null,"defaultLayout":null},
	 "tabs":[
	  {"id":"u1","name":"F","layout":"inherit","root":{"columns":160,"children":[
		{"id":"j","kind":"tile","name":"J","placement":{"x":5,"y":5,"w":13,"h":13}}
	  ]}},
	  {"id":"u2","name":"G","layout":"grid","root":{"columns":12,"children":[
		{"id":"k","kind":"tile","name":"K","placement":{"x":2,"y":1,"w":2,"h":2}}
	  ]}}
	 ]}
	]}`
	var doc Obj
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		t.Fatal(err)
	}
	return doc
}

// nodeByID finds a folder or tile anywhere in doc.
func nodeByID(t *testing.T, doc Obj, id string) Obj {
	t.Helper()
	var got Obj
	Walk(doc, func(_, _ Obj, _ []Obj, n Obj) bool {
		if n["id"] == id {
			got = n
			return false
		}
		return true
	})
	if got == nil {
		t.Fatalf("node %q not found", id)
	}
	return got
}

func tabByID(t *testing.T, doc Obj, id string) Obj {
	t.Helper()
	for _, d := range doc["dashboards"].([]any) {
		for _, tb := range d.(Obj)["tabs"].([]any) {
			if tb.(Obj)["id"] == id {
				return tb.(Obj)
			}
		}
	}
	t.Fatalf("tab %q not found", id)
	return nil
}

func placementOf(t *testing.T, doc Obj, id string) string {
	t.Helper()
	return snapshot2(nodeByID(t, doc, id)["placement"])
}

func columnsOf(t *testing.T, doc Obj, folderID string) string {
	t.Helper()
	return snapshot2(nodeByID(t, doc, folderID)["content"].(Obj)["columns"])
}

func updatedGrid(t *testing.T) (before, after Obj) {
	t.Helper()
	before = oldGridDoc(t)
	snap := snapshot2(before)
	out, changed, err := UpdateGridV5(before)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("changed = false, want true")
	}
	if snapshot2(before) != snap {
		t.Fatal("UpdateGridV5 mutated its input")
	}
	return before, out
}

func TestUpdateGridV5_DoublesGridAtEveryDepth(t *testing.T) {
	_, out := updatedGrid(t)
	if out["gridUnit"] != GridUnit && out["gridUnit"] != float64(GridUnit) {
		t.Errorf("gridUnit = %v, want %d", out["gridUnit"], GridUnit)
	}
	if got := snapshot2(tabByID(t, out, "t1")["root"].(Obj)["columns"]); got != "24" {
		t.Errorf("t1 root columns = %s, want 24", got)
	}
	if got := snapshot2(tabByID(t, out, "u2")["root"].(Obj)["columns"]); got != "24" {
		t.Errorf("u2 root columns = %s, want 24", got)
	}
	for id, want := range map[string]string{
		"a":  `{"h":2,"w":2,"x":0,"y":0}`,
		"f1": `{"h":6,"w":8,"x":2,"y":0,"z":2}`, // z is a stacking order, never doubled
		"b":  `{"h":2,"w":2,"x":0,"y":0}`,
		"f2": `{"h":4,"w":4,"x":2,"y":0}`, // a free folder in a grid parent: its placement is grid
		"d":  `{"h":2,"w":2,"x":2,"y":2}`, // grid content of a grid folder inside a free folder
		"k":  `{"h":4,"w":4,"x":4,"y":2}`, // a grid tab overriding a free dashboard default
	} {
		if got := placementOf(t, out, id); got != want {
			t.Errorf("%s placement = %s, want %s", id, got, want)
		}
	}
	if got := columnsOf(t, out, "f1"); got != "8" {
		t.Errorf("f1 columns = %s, want 8", got)
	}
	if got := columnsOf(t, out, "f3"); got != "4" {
		t.Errorf("f3 columns = %s, want 4", got)
	}
}

func TestUpdateGridV5_FreeUntouched(t *testing.T) {
	before, out := updatedGrid(t)
	for _, id := range []string{"c", "f3", "e", "g", "h", "gg", "j"} {
		if got, want := placementOf(t, out, id), placementOf(t, before, id); got != want {
			t.Errorf("free %s placement = %s, want unchanged %s", id, got, want)
		}
	}
	for _, id := range []string{"f2", "g"} {
		if got, want := columnsOf(t, out, id), columnsOf(t, before, id); got != want {
			t.Errorf("free %s columns = %s, want unchanged %s", id, got, want)
		}
	}
	for _, id := range []string{"t2", "u1"} {
		if got := snapshot2(tabByID(t, out, id)["root"].(Obj)["columns"]); got != "160" {
			t.Errorf("free root %s columns = %s, want 160", id, got)
		}
	}
}

func TestUpdateGridV5_GridFolderInFreeTab(t *testing.T) {
	_, out := updatedGrid(t)
	// gg sits in a free tab: its own placement stays in free units (checked
	// above); its grid content is doubled, and its columns — absent, so they
	// fell back to its free width 52 — become an explicit 104.
	if got := placementOf(t, out, "i"); got != `{"h":2,"w":2,"x":0,"y":0}` {
		t.Errorf("i placement = %s", got)
	}
	if got := columnsOf(t, out, "gg"); got != "104" {
		t.Errorf("gg columns = %s, want 104", got)
	}
}

func TestUpdateGridV5_Idempotent(t *testing.T) {
	_, out := updatedGrid(t)
	again, changed, err := UpdateGridV5(out)
	if err != nil {
		t.Fatal(err)
	}
	if changed {
		t.Fatal("second run changed = true; a marked document must never be doubled again")
	}
	if snapshot2(again) != snapshot2(out) {
		t.Fatal("second run altered the document")
	}
}

func TestUpdateGridV5_UnknownMarkerIsError(t *testing.T) {
	for _, bad := range []any{3.0, 1.0, "2", true, nil} {
		doc := oldGridDoc(t)
		doc["gridUnit"] = bad
		if _, _, err := UpdateGridV5(doc); err == nil {
			t.Errorf("gridUnit %v: no error", bad)
		}
	}
}

func TestUpdateGridV5_NoGridContentStillMarked(t *testing.T) {
	doc := Obj{"schemaVersion": 3.0, "dashboards": []any{}}
	out, changed, err := UpdateGridV5(doc)
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v, want the marker stamped", changed, err)
	}
	if err := VerifyGridV5(doc, out); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyGridV5_AcceptsUpdate(t *testing.T) {
	before, out := updatedGrid(t)
	if err := VerifyGridV5(before, out); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyGridV5_CatchesWrongResults(t *testing.T) {
	cases := map[string]struct {
		tamper func(t *testing.T, out Obj)
		want   string
	}{
		"grid placement not doubled": {func(t *testing.T, o Obj) {
			nodeByID(t, o, "b")["placement"].(Obj)["x"] = 1.0
			nodeByID(t, o, "b")["placement"].(Obj)["w"] = 1.0
		}, `"b"`},
		"deep grid placement wrong": {func(t *testing.T, o Obj) { nodeByID(t, o, "d")["placement"].(Obj)["h"] = 3.0 }, `"d"`},
		"free placement changed":    {func(t *testing.T, o Obj) { nodeByID(t, o, "c")["placement"].(Obj)["x"] = 6.0 }, `"c"`},
		"grid folder in free doubled": {func(t *testing.T, o Obj) {
			nodeByID(t, o, "gg")["placement"].(Obj)["w"] = 104.0
		}, `"gg"`},
		"columns not doubled": {func(t *testing.T, o Obj) { nodeByID(t, o, "f1")["content"].(Obj)["columns"] = 4.0 }, "columns"},
		"root columns":        {func(t *testing.T, o Obj) { tabByID(t, o, "t1")["root"].(Obj)["columns"] = 12.0 }, "columns"},
		"free columns changed": {func(t *testing.T, o Obj) {
			tabByID(t, o, "t2")["root"].(Obj)["columns"] = 320.0
		}, "columns"},
		"z doubled":      {func(t *testing.T, o Obj) { nodeByID(t, o, "f1")["placement"].(Obj)["z"] = 4.0 }, `"z"`},
		"marker missing": {func(t *testing.T, o Obj) { delete(o, "gridUnit") }, "gridUnit"},
		"node lost": {func(t *testing.T, o Obj) {
			c := nodeByID(t, o, "f1")["content"].(Obj)
			c["children"] = c["children"].([]any)[1:]
		}, `"b"`},
		"other key changed": {func(t *testing.T, o Obj) { nodeByID(t, o, "a")["name"] = "Z" }, `"name"`},
		"layout changed":    {func(t *testing.T, o Obj) { nodeByID(t, o, "f2")["layout"] = "grid" }, `"layout"`},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			before, out := updatedGrid(t)
			tc.tamper(t, out)
			err := VerifyGridV5(before, out)
			if err == nil {
				t.Fatal("tampered document verified")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error %q does not mention %s", err, tc.want)
			}
		})
	}
}

func TestVerifyGridV5_MarkedDocumentMustBeUnchanged(t *testing.T) {
	_, out := updatedGrid(t)
	if err := VerifyGridV5(out, out); err != nil {
		t.Fatalf("unchanged marked document: %v", err)
	}
	cp, _ := deepCopy(out)
	nodeByID(t, cp, "a")["placement"].(Obj)["w"] = 4.0
	if err := VerifyGridV5(out, cp); err == nil {
		t.Fatal("a re-doubled marked document verified")
	}
}

// ---- startup ----

func TestMigrateWithBackup_UpdatesGridOnce(t *testing.T) {
	db := newStoreDB(t)
	orig := snapshot2(oldGridDoc(t))
	seed(t, db, orig)

	res, _, err := MigrateWithBackup(db, func() error { t.Fatal("v3 doc must not take the pre-migration backup"); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if res.Failed || !res.GridUpdated || res.Migrated || res.BackgroundsUpdated {
		t.Fatalf("result = %+v, want GridUpdated only", res)
	}
	var schema int
	var data, notes string
	if err := db.QueryRow(`SELECT schema, data, notes FROM config_archive`).Scan(&schema, &data, &notes); err != nil {
		t.Fatalf("want one archive row: %v", err)
	}
	if schema != 3 || data != orig || notes != "grid-v5" {
		t.Errorf("archive schema=%d notes=%q data equal=%v", schema, notes, data == orig)
	}
	doc, err := Load(db)
	if err != nil {
		t.Fatal(err)
	}
	if got := placementOf(t, doc, "f1"); got != `{"h":6,"w":8,"x":2,"y":0,"z":2}` {
		t.Errorf("stored f1 placement = %s", got)
	}
	if doc["gridUnit"] != float64(GridUnit) {
		t.Errorf("stored gridUnit = %v", doc["gridUnit"])
	}

	// Second start: nothing to do — no archive row, no write, nothing doubled again.
	stored := rawRow(t, db)
	res, _, err = MigrateWithBackup(db, func() error { return nil })
	if err != nil || res.Failed || res.GridUpdated {
		t.Fatalf("second start: res=%+v err=%v", res, err)
	}
	if archiveCount(t, db) != 1 || rawRow(t, db) != stored {
		t.Error("second start wrote something")
	}
}

func TestMigrateWithBackup_GridUpdateFailureBlocksAndWritesNothing(t *testing.T) {
	for name, tamper := range map[string]func(Obj){
		// A placement that cannot be doubled faithfully fails verification.
		"bad placement":  func(d Obj) { nodeByID(t, d, "b")["placement"].(Obj)["x"] = "left" },
		"unknown marker": func(d Obj) { d["gridUnit"] = 3 },
	} {
		t.Run(name, func(t *testing.T) {
			db := newStoreDB(t)
			doc := oldGridDoc(t)
			tamper(doc)
			orig := snapshot2(doc)
			seed(t, db, orig)
			res, _, err := MigrateWithBackup(db, func() error { return nil })
			if err != nil {
				t.Fatal(err)
			}
			if !res.Failed || !strings.Contains(res.Detail, "grid update failed") {
				t.Fatalf("result = %+v, want a visible grid-update failure", res)
			}
			if res.GridUpdated {
				t.Error("GridUpdated set on failure")
			}
			if rawRow(t, db) != orig {
				t.Error("stored config changed on failure")
			}
			if n := archiveCount(t, db); n != 0 {
				t.Errorf("archive rows = %d, want 0 (rolled back with the update)", n)
			}
		})
	}
}

func TestMigrateWithBackup_BackgroundsThenGrid(t *testing.T) {
	db := newStoreDB(t)
	seed(t, db, snapshot2(legacyDoc(t, false)))
	res, _, err := MigrateWithBackup(db, func() error { return nil })
	if err != nil || res.Failed || !res.BackgroundsUpdated || !res.GridUpdated {
		t.Fatalf("res=%+v err=%v, want both updates", res, err)
	}
	rows, err := db.Query(`SELECT notes FROM config_archive ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var notes []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			t.Fatal(err)
		}
		notes = append(notes, n)
	}
	if strings.Join(notes, ",") != "backgrounds-v4,grid-v5" {
		t.Errorf("archive notes = %v, want backgrounds-v4 then grid-v5", notes)
	}
}

// The v2→v3 converter writes the new form directly: a migrated v2 document
// is already marked, so the grid update is a no-op for it.
func TestMigrateWithBackup_V2NeedsNoGridUpdate(t *testing.T) {
	for _, f := range []string{"v2_basic.json", "real_sample.json", "real_weavers.json"} {
		t.Run(f, func(t *testing.T) {
			b, err := os.ReadFile("testdata/" + f)
			if err != nil {
				t.Fatal(err)
			}
			db := newStoreDB(t)
			seed(t, db, string(b))
			res, _, err := MigrateWithBackup(db, func() error { return nil })
			if err != nil || res.Failed || !res.Migrated || res.GridUpdated {
				t.Fatalf("res=%+v err=%v, want Migrated with no grid update", res, err)
			}
			if n := archiveCount(t, db); n != 1 {
				t.Errorf("archive rows = %d, want only the v2 one", n)
			}
		})
	}
}

// ---- v2 converter: the new form directly ----

func TestMigrateV2_WritesFinerGrid(t *testing.T) {
	for _, f := range []string{"v2_basic.json", "v2_dup_ids.json", "v2_messy.json", "real_sample.json", "real_weavers.json"} {
		t.Run(f, func(t *testing.T) {
			b, err := os.ReadFile("testdata/" + f)
			if err != nil {
				t.Fatal(err)
			}
			var v2 Obj
			if err := json.Unmarshal(b, &v2); err != nil {
				t.Fatal(err)
			}
			v3, renames, err := MigrateV2Renaming(v2)
			if err != nil {
				t.Fatal(err)
			}
			if err := VerifyMigration(v2, v3, renames); err != nil {
				t.Fatal(err)
			}
			if v3["gridUnit"] != GridUnit {
				t.Errorf("gridUnit = %v, want %d", v3["gridUnit"], GridUnit)
			}
			for _, d := range v3["dashboards"].([]any) {
				for _, tb := range d.(Obj)["tabs"].([]any) {
					root := tb.(Obj)["root"].(Obj)
					if root["columns"] != 24 {
						t.Errorf("tab %v root columns = %v, want 24", tb.(Obj)["id"], root["columns"])
					}
					for _, fo := range root["children"].([]any) {
						fm := fo.(Obj)
						p := fm["placement"].(Obj)
						cols := fm["content"].(Obj)["children"].([]any)
						w := p["w"].(int)
						perRow := w / 2
						if fm["content"].(Obj)["columns"] != w || w%2 != 0 {
							t.Errorf("folder %v: w=%d columns=%v", fm["id"], w, fm["content"].(Obj)["columns"])
						}
						rows := max(1, (len(cols)+perRow-1)/perRow)
						if p["h"] != 2*rows+2 {
							t.Errorf("folder %v: h=%v, want %d (2 per tile row + a 2-cell title)", fm["id"], p["h"], 2*rows+2)
						}
						for i, c := range cols {
							want := Obj{"x": 2 * (i % perRow), "y": 2 * (i / perRow), "w": 2, "h": 2}
							if snapshot2(c.(Obj)["placement"]) != snapshot2(want) {
								t.Errorf("folder %v tile %d placement = %s, want %s", fm["id"], i, snapshot2(c.(Obj)["placement"]), snapshot2(want))
							}
						}
					}
				}
			}
			// Already in the final form: the one-time update leaves it alone.
			if _, changed, err := UpdateGridV5(v3); err != nil || changed {
				t.Errorf("UpdateGridV5 on converted doc: changed=%v err=%v", changed, err)
			}
		})
	}
}

// The real Weavers export (13-image slideshow) still migrates and verifies.
func TestMigrateV2_RealWeaversSlideshowKept(t *testing.T) {
	b, err := os.ReadFile("testdata/real_weavers.json")
	if err != nil {
		t.Fatal(err)
	}
	var v2 Obj
	if err := json.Unmarshal(b, &v2); err != nil {
		t.Fatal(err)
	}
	v3, renames, err := MigrateV2Renaming(v2)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyMigration(v2, v3, renames); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, d := range v3["dashboards"].([]any) {
		if bg, ok := d.(Obj)["background"].(Obj); ok {
			if imgs, ok := bg["images"].([]any); ok && len(imgs) == 13 {
				found = true
			}
		}
	}
	if !found {
		t.Error("no dashboard kept a 13-image slideshow")
	}
}

func TestVerifyMigration_RequiresGridMarker(t *testing.T) {
	var v2 Obj
	if err := json.Unmarshal([]byte(v2Bytes(t)), &v2); err != nil {
		t.Fatal(err)
	}
	v3, err := MigrateV2(v2)
	if err != nil {
		t.Fatal(err)
	}
	delete(v3, "gridUnit")
	if err := Verify(v2, v3); err == nil || !strings.Contains(err.Error(), "gridUnit") {
		t.Fatalf("err = %v, want a missing gridUnit problem", err)
	}
}

// Spec §9 deviation: a grid root that was not 12 columns becomes twice its old
// width (so it looks the same), not 24 — and that anomaly is logged at WARN.
func TestMigrateWithBackup_OddGridRootWarns(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	db := newStoreDB(t)
	doc := oldGridDoc(t)
	tabByID(t, doc, "u2")["root"].(Obj)["columns"] = 6
	seed(t, db, snapshot2(doc))
	res, _, err := MigrateWithBackup(db, func() error { return nil })
	if err != nil || res.Failed || !res.GridUpdated {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	stored, _ := Load(db)
	if c := tabByID(t, stored, "u2")["root"].(Obj)["columns"]; c != 12.0 {
		t.Errorf("odd root columns = %v, want 12 (twice 6)", c)
	}
	logs := buf.String()
	if !strings.Contains(logs, "level=WARN") || !strings.Contains(logs, "tab=u2") || strings.Contains(logs, "tab=t1") {
		t.Errorf("want exactly one WARN naming tab u2, got:\n%s", logs)
	}
}
