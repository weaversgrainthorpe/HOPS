package api

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// v2Dash is a synthetic v2 dashboard: one tab of two groups (a header group
// and a collapsed, folder-style half-width one), ids prefixed with p.
func v2Dash(p, name, path string) map[string]interface{} {
	entry := func(id, n string) map[string]interface{} {
		return map[string]interface{}{"id": id, "name": n, "url": "https://" + id + ".example.com", "icon": "mdi:web", "openMode": "newtab", "size": "medium", "order": 0}
	}
	checked := entry(p+"-e1", "Checked")
	checked["statusCheck"] = map[string]interface{}{"type": "http", "enabled": true, "interval": 60}
	return map[string]interface{}{
		"id": p, "name": name, "path": path, "order": 0,
		"tabs": []interface{}{map[string]interface{}{
			"id": p + "-t1", "name": "Main", "order": 0,
			"groups": []interface{}{
				map[string]interface{}{"id": p + "-g1", "name": "Apps", "order": 0, "collapsed": false,
					"entries": []interface{}{checked, entry(p+"-e2", "Plain")}},
				map[string]interface{}{"id": p + "-g2", "name": "Tools", "order": 1, "collapsed": true,
					"displayStyle": "folder", "width": "half", "entries": []interface{}{entry(p+"-e3", "Tool")}},
			},
		}},
	}
}

func v2File(dashes ...map[string]interface{}) []byte {
	l := make([]interface{}, len(dashes))
	for i, d := range dashes {
		l[i] = d
	}
	b, _ := json.Marshal(map[string]interface{}{"dashboards": l})
	return b
}

// assertConvertedFromV2 checks d holds v2Dash's content as v3: each group a
// folder (header group Rounded, folder-style Flat, collapsed kept), its
// entries tiles inside it, the ticked status check On and the other Off.
func assertConvertedFromV2(t *testing.T, label string, d configdoc.Obj) {
	t.Helper()
	tabs, _ := d["tabs"].([]any)
	if len(tabs) != 1 {
		t.Fatalf("%s: tabs %v", label, tabs)
	}
	root := tabs[0].(configdoc.Obj)["root"].(configdoc.Obj)
	if n, _ := root["columns"].(float64); n != configdoc.RootColumns {
		t.Errorf("%s: root columns %v", label, root["columns"])
	}
	kids := root["children"].([]any)
	if len(kids) != 2 {
		t.Fatalf("%s: root children %d, want 2 folders", label, len(kids))
	}
	want := []struct {
		name, shape, display string
		tiles                []string
	}{
		{"Apps", configdoc.ShapeConverted, "expanded", []string{"Checked", "Plain"}},
		{"Tools", configdoc.ShapeCreated, "collapsed", []string{"Tool"}},
	}
	for i, w := range want {
		f := kids[i].(configdoc.Obj)
		if f["kind"] != "folder" || f["name"] != w.name || f["shape"] != w.shape || f["display"] != w.display {
			t.Errorf("%s: folder %d = %v %v %v %v, want folder %s %s %s", label, i, f["kind"], f["name"], f["shape"], f["display"], w.name, w.shape, w.display)
		}
		if _, ok := f["placement"].(configdoc.Obj); !ok {
			t.Errorf("%s: folder %s has no placement", label, w.name)
		}
		for _, gone := range []string{"collapsed", "displayStyle", "width", "entries"} {
			if _, has := f[gone]; has {
				t.Errorf("%s: folder %s still has v2 key %q", label, w.name, gone)
			}
		}
		var names []string
		for _, k := range f["content"].(configdoc.Obj)["children"].([]any) {
			tile := k.(configdoc.Obj)
			if tile["kind"] != "tile" {
				t.Errorf("%s: %v in %s is not a tile", label, tile["name"], w.name)
			}
			if _, has := tile["placement"]; has {
				t.Errorf("%s: tile %v in a folder has a placement", label, tile["name"])
			}
			names = append(names, fmt.Sprint(tile["name"]))
			on := tile["statusCheck"].(configdoc.Obj)["enabled"]
			if wantOn := tile["name"] == "Checked"; on != wantOn {
				t.Errorf("%s: tile %v status check enabled %v, want %v", label, tile["name"], on, wantOn)
			}
		}
		if fmt.Sprint(names) != fmt.Sprint(w.tiles) {
			t.Errorf("%s: folder %s tiles %v, want %v", label, w.name, names, w.tiles)
		}
	}
	if err := configdoc.VerifyImportedDashboard(d); err != nil {
		t.Errorf("%s: stored dashboard does not verify: %v", label, err)
	}
	if fs := configdoc.UnknownFields(d); len(fs) != 0 {
		t.Errorf("%s: unknown fields %v", label, fs)
	}
}

// A v2 file of several dashboards, through the preview and the per-dashboard
// choices: Replace keeps the stored id and path with the file's content as v3
// folders, Keep both is renamed with fresh ids, Skip leaves the stored one
// alone and Add brings the new one in.
func TestImport_V2FileWithChoices(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db) // "First": id d1, path /d1, tab t1, folder g1, tile e1
	secondID := newDash(t, c, "Second", "/second")
	thirdID := newDash(t, c, "Third", "/third")
	before := storedDoc(t, db)
	firstRev, _ := intRevision(dashByName(before, "First")["revision"])
	thirdBefore, _ := json.Marshal(storedDashboards(before)[thirdID])
	secondBefore := idsOf(dashByName(before, "Second"))

	// Names clash case-blind; the replacement reuses the stored First's ids,
	// and Media one of the replacement's (both in one file).
	first := v2Dash("v2first", "first", "/v2-first")
	first["tabs"].([]interface{})[0].(map[string]interface{})["id"] = "t1"
	media := v2Dash("media", "Media", "/media")
	media["tabs"].([]interface{})[0].(map[string]interface{})["groups"].([]interface{})[1].(map[string]interface{})["id"] = "v2first-g2"
	file := v2File(first, v2Dash("v2second", "Second", "/second"), v2Dash("v2third", "Third", "/v2-third"), media)

	rows := previewRows(t, c, file)
	if len(rows) != 4 {
		t.Fatalf("preview rows %d, want 4", len(rows))
	}
	wantClash := []string{"d1", secondID, thirdID, ""}
	for i, r := range rows {
		id := ""
		if cl, ok := r["clash"].(map[string]interface{}); ok {
			id = cl["id"].(string)
		}
		if id != wantClash[i] || r["tabs"] != float64(1) || r["unknownFields"] != nil {
			t.Errorf("preview row %d = %v, want clash %q, 1 tab, no unknown fields", i, r, wantClash[i])
		}
	}

	code, resp := choose(t, c, file, "replace", "keep", "skip", "add")
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	doc := storedDoc(t, db)
	if n := len(dashList(doc)); n != 5 {
		t.Fatalf("dashboards %d, want 5 (First replaced, Second, Second (2), Third, Media)", n)
	}
	assertUniqueIDs(t, doc)
	if configdoc.CheckLayoutVersion(doc) != nil {
		t.Errorf("stored layout version changed: %v", doc[configdoc.LayoutVersionKey])
	}

	// Replace: the stored id, path and place; the file's name and content, as v3.
	rep := dashList(doc)[0]
	if rep["id"] != "d1" || rep["path"] != "/d1" || rep["name"] != "first" {
		t.Errorf("Replace: id %v path %v name %v, want d1 /d1 first", rep["id"], rep["path"], rep["name"])
	}
	if rev, _ := intRevision(rep["revision"]); rev != firstRev+1 {
		t.Errorf("Replace revision %d, want %d", rev, firstRev+1)
	}
	if tab := rep["tabs"].([]any)[0].(configdoc.Obj); tab["id"] != "t1" {
		t.Errorf("Replace: the replaced dashboard's ids are freed, so the file's tab id t1 is kept; got %v", tab["id"])
	}
	assertConvertedFromV2(t, "Replace", rep)

	// Keep both: renamed, nothing shared with the stored Second.
	kept := dashByName(doc, "Second (2)")
	if kept == nil {
		t.Fatalf("no Second (2): %v", resp)
	}
	for id := range idsOf(kept) {
		if secondBefore[id] || strings.HasPrefix(id, "v2second") {
			t.Errorf("Keep both kept id %q (stored Second's or the file's)", id)
		}
	}
	if kept["path"] == "/second" {
		t.Errorf("Keep both copy took the stored Second's path")
	}
	assertConvertedFromV2(t, "Keep both", kept)

	// Skip: the stored Third exactly as it was; the file's never stored.
	if after, _ := json.Marshal(storedDashboards(doc)[thirdID]); string(after) != string(thirdBefore) {
		t.Errorf("Skip changed the stored Third:\n%s\n%s", thirdBefore, after)
	}
	if storedDashboards(doc)["v2third"] != nil {
		t.Errorf("a skipped dashboard was stored")
	}

	// Add: the file's id and path; the id it shared with the replacement renamed.
	added := dashByName(doc, "Media")
	if added == nil || added["id"] != "media" || added["path"] != "/media" {
		t.Fatalf("Add: %v", added)
	}
	assertConvertedFromV2(t, "Add", added)
	if f := added["tabs"].([]any)[0].(configdoc.Obj)["root"].(configdoc.Obj)["children"].([]any)[1].(configdoc.Obj); f["id"] == "v2first-g2" {
		t.Errorf("Add kept an id the replacement also has")
	}

	msg, _ := resp["message"].(string)
	wantMsg := `Imported from HOPS JSON format. Added "Media"; replaced "first"; kept both, the new one is "Second (2)"; skipped "Third"`
	if !strings.HasPrefix(msg, wantMsg) {
		t.Errorf("message:\n got %q\nwant prefix %q", msg, wantMsg)
	}
	if !strings.Contains(msg, "1 internal id(s) were renamed") {
		t.Errorf("message does not say the shared id was renamed: %q", msg)
	}
	sum := resp["summary"].(map[string]interface{})
	for k, v := range map[string]string{"added": "[Media]", "replaced": "[first]", "skipped": "[Third]"} {
		if got := fmt.Sprint(sum[k]); got != v {
			t.Errorf("summary %s = %s, want %s", k, got, v)
		}
	}
	if ren := sum["renamed"].([]interface{}); len(ren) != 1 || fmt.Sprint(ren[0]) != "map[from:Second to:Second (2)]" {
		t.Errorf("summary renamed = %v", ren)
	}
	if l := stringsOf(resp["unknownFields"]); len(l) != 0 {
		t.Errorf("unknownFields = %q", l)
	}
}

// A one-dashboard v2 file: Replace, then Keep both of the same file, then a
// Skip that writes nothing.
func TestImport_SingleV2DashboardWithChoices(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	file := v2File(v2Dash("solo", "First", "/solo"))

	if code, resp := choose(t, c, file, "replace"); code != 200 {
		t.Fatalf("replace: %d %v", code, resp)
	}
	doc := storedDoc(t, db)
	if len(dashList(doc)) != 1 {
		t.Fatalf("Replace added a dashboard: %d", len(dashList(doc)))
	}
	rep := dashList(doc)[0]
	if rep["id"] != "d1" || rep["path"] != "/d1" {
		t.Errorf("Replace: id %v path %v, want d1 /d1", rep["id"], rep["path"])
	}
	assertConvertedFromV2(t, "Replace", rep)

	code, resp := choose(t, c, file, "keep")
	if code != 200 {
		t.Fatalf("keep: %d %v", code, resp)
	}
	doc = storedDoc(t, db)
	kept := dashByName(doc, "First (2)")
	if kept == nil || len(dashList(doc)) != 2 {
		t.Fatalf("Keep both: %v", resp)
	}
	assertConvertedFromV2(t, "Keep both", kept)
	assertUniqueIDs(t, doc)
	if msg, _ := resp["message"].(string); msg != `Imported from HOPS JSON format. Kept both, the new one is "First (2)"` {
		t.Errorf("message %q", msg)
	}

	before := storedJSON(t, db)
	code, resp = choose(t, c, file, "skip")
	if code != 200 || resp["imported"] != float64(0) {
		t.Fatalf("skip: %d %v", code, resp)
	}
	if storedJSON(t, db) != before {
		t.Errorf("Skip changed what is stored")
	}
}
