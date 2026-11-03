package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// newDash creates a dashboard through the API and returns its id.
func newDash(t *testing.T, c *apiClient, name, path string) string {
	t.Helper()
	code, resp := c.do("POST", "/api/dashboards", map[string]interface{}{"name": name, "path": path})
	if code != 200 {
		t.Fatalf("create %s: %d %v", name, code, resp)
	}
	return resp["id"].(string)
}

func dashByName(doc configdoc.Obj, name string) configdoc.Obj {
	for _, d := range dashList(doc) {
		if d["name"] == name {
			return d
		}
	}
	return nil
}

func idsOf(d configdoc.Obj) map[string]bool {
	return collectIDs(configdoc.Obj{"dashboards": []any{d}})
}

func choicesField(cs ...string) map[string]string {
	b, _ := json.Marshal(cs)
	return map[string]string{"choices": string(b)}
}

func storedJSON(t *testing.T, db *sql.DB) string {
	t.Helper()
	b, _ := json.Marshal(storedDoc(t, db))
	return string(b)
}

// delDash deletes a dashboard at its stored revision.
func delDash(t *testing.T, c *apiClient, db *sql.DB, id string) {
	t.Helper()
	rev, _ := intRevision(storedDashboards(storedDoc(t, db))[id]["revision"])
	if code, resp := c.do("DELETE", fmt.Sprintf("/api/dashboards/%s?revision=%d", id, rev), nil); code != 200 {
		t.Fatalf("delete %s: %d %v", id, code, resp)
	}
}

func TestExport_AllDashboardsIsDashboardsOnly(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	newDash(t, c, "Second", "/second")

	var env map[string]interface{}
	if err := json.Unmarshal(c.export("?scope=dashboards"), &env); err != nil {
		t.Fatal(err)
	}
	if env["format"] != "hops-export" || env["exportType"] != "dashboards" {
		t.Fatalf("envelope: %v", env)
	}
	cfg := env["config"].(map[string]interface{})
	ds := cfg["dashboards"].([]interface{})
	if len(ds) != 2 {
		t.Fatalf("dashboards %d, want 2", len(ds))
	}
	for _, k := range []string{"theme", "settings"} {
		if _, has := cfg[k]; has {
			t.Errorf("an Export all carries %q; it is dashboards only", k)
		}
	}
	if cfg[configdoc.LayoutVersionKey] == nil {
		t.Errorf("no layout marker: %v", cfg)
	}
	code, _ := c.raw("GET", "/api/config/export?scope=everything", nil, "")
	if code != 400 {
		t.Errorf("unknown scope: %d, want 400", code)
	}
}

func TestImport_PreviewListsClashesAndWritesNothing(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	newDash(t, c, "Second", "/second")
	file := c.export("?scope=dashboards")
	delDash(t, c, db, "d1")
	before := storedJSON(t, db)

	code, resp := c.importFileWith(file, map[string]string{"preview": "true"})
	if code != 200 {
		t.Fatalf("preview: %d %v", code, resp)
	}
	rows := resp["dashboards"].([]interface{})
	if len(rows) != 2 {
		t.Fatalf("rows %v", rows)
	}
	first, second := rows[0].(map[string]interface{}), rows[1].(map[string]interface{})
	if first["name"] != "First" || first["clash"] != nil {
		t.Errorf("First should be a plain add: %v", first)
	}
	clash, _ := second["clash"].(map[string]interface{})
	if second["name"] != "Second" || clash == nil || clash["name"] != "Second" {
		t.Errorf("Second should clash with the stored Second: %v", second)
	}
	if after := storedJSON(t, db); after != before {
		t.Errorf("a preview changed the stored config")
	}
}

func TestImport_ChoicesReplaceKeepBothSkipAdd(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	newDash(t, c, "Second", "/second")
	newDash(t, c, "Third", "/third")
	fourth := newDash(t, c, "Fourth", "/fourth")
	file := c.export("?scope=dashboards")

	// After the export: Fourth goes, and First is renamed in a way the Replace must undo.
	delDash(t, c, db, fourth)
	doc := storedDoc(t, db)
	firstBefore := dashByName(doc, "First")
	secondFile := dashByName(doc, "Second")
	secondIDs := idsOf(secondFile)
	firstRev, _ := intRevision(firstBefore["revision"])
	tabs := firstBefore["tabs"].([]any)
	tab0 := tabs[0].(configdoc.Obj)
	origTab := tab0["name"]
	tab0["name"] = "Changed after export"
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}

	code, resp := c.importFileWith(file, choicesField("replace", "keep", "skip", "add"))
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	doc = storedDoc(t, db)
	if n := len(dashList(doc)); n != 5 {
		t.Fatalf("dashboards %d, want 5 (3 kept + Second (2) + Fourth)", n)
	}
	first := dashByName(doc, "First")
	if first["id"] != "d1" || first["path"] != firstBefore["path"] {
		t.Errorf("Replace must keep the dashboard's id and path: %v %v", first["id"], first["path"])
	}
	if rev, _ := intRevision(first["revision"]); rev != firstRev+1 {
		t.Errorf("Replace revision %d, want %d", rev, firstRev+1)
	}
	if n := first["tabs"].([]any)[0].(configdoc.Obj)["name"]; n != origTab {
		t.Errorf("Replace did not bring the file's content back: tab %v", n)
	}
	kept := dashByName(doc, "Second (2)")
	if kept == nil {
		t.Fatalf("no Second (2): %v", resp)
	}
	for id := range idsOf(kept) {
		if secondIDs[id] {
			t.Errorf("Keep both reused id %q", id)
		}
	}
	if dashByName(doc, "Second") == nil || dashByName(doc, "Fourth") == nil {
		t.Errorf("Second kept and Fourth added expected")
	}
	if dashByName(doc, "Third") == nil {
		t.Errorf("Skip must leave the stored Third alone")
	}
	assertUniqueIDs(t, doc)

	sum := resp["summary"].(map[string]interface{})
	want := map[string]string{"added": "[Fourth]", "replaced": "[First]", "skipped": "[Third]"}
	for k, v := range want {
		if got := fmt.Sprint(sum[k]); got != v {
			t.Errorf("summary %s = %s, want %s", k, got, v)
		}
	}
	ren := sum["renamed"].([]interface{})
	if len(ren) != 1 || ren[0].(map[string]interface{})["to"] != "Second (2)" || ren[0].(map[string]interface{})["from"] != "Second" {
		t.Errorf("summary renamed = %v", ren)
	}
}

func TestImport_SingleExportKeepBothNumbersOn(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	file := c.export("?dashboardId=d1")
	for i, want := range []string{"First (2)", "First (3)"} {
		code, resp := c.importFileWith(file, choicesField("keep"))
		if code != 200 {
			t.Fatalf("import %d: %d %v", i, code, resp)
		}
		if dashByName(storedDoc(t, db), want) == nil {
			t.Fatalf("no %q after import %d: %v", want, i, resp)
		}
	}
	assertUniqueIDs(t, storedDoc(t, db))
}

func TestImport_ChoicesMustMatchTheClashes(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	file := c.export("?dashboardId=d1")
	before := storedJSON(t, db)
	cases := []struct {
		fields map[string]string
		code   int
		says   string
	}{
		{choicesField("add"), 409, "First"},                // a clash needs Replace, Keep both or Skip
		{choicesField(), 400, "1 dashboard"},               // one choice per dashboard
		{choicesField("keep", "keep"), 400, "1 dashboard"}, // too many
		{choicesField("merge"), 400, "merge"},              // unknown choice
		{map[string]string{"choices": "{"}, 400, "choices"},
	}
	for _, tc := range cases {
		code, resp := c.importFileWith(file, tc.fields)
		if code != tc.code || !strings.Contains(fmt.Sprint(resp["error"]), tc.says) {
			t.Errorf("%v: %d %v, want %d naming %q", tc.fields, code, resp, tc.code, tc.says)
		}
	}
	if storedJSON(t, db) != before {
		t.Errorf("a refused import changed the stored config")
	}

	// Replace when nothing has that name any more: the file must be checked again.
	newDash(t, c, "Other", "/other")
	other := c.export("?scope=dashboards")
	delDash(t, c, db, "d1")
	code, resp := c.importFileWith(other, choicesField("replace", "skip"))
	if code != 409 {
		t.Errorf("stale Replace: %d %v, want 409", code, resp)
	}
}

func TestImport_AllSkippedWritesNothing(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	file := c.export("?dashboardId=d1")
	before := storedJSON(t, db)
	code, resp := c.importFileWith(file, choicesField("skip"))
	if code != 200 || resp["imported"] != float64(0) {
		t.Fatalf("all skipped: %d %v", code, resp)
	}
	if storedJSON(t, db) != before {
		t.Errorf("skipping everything changed the stored config")
	}
}

func TestImport_MultiWithOneInvalidImportsNothing(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	newDash(t, c, "Second", "/second")
	var env map[string]interface{}
	_ = json.Unmarshal(c.export("?scope=dashboards"), &env)
	ds := env["config"].(map[string]interface{})["dashboards"].([]interface{})
	delete(ds[1].(map[string]interface{}), "tabs")
	bad, _ := json.Marshal(env)
	before := storedJSON(t, db)
	code, resp := c.importFileWith(bad, map[string]string{"preview": "true"})
	if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), `"Second"`) {
		t.Errorf("invalid dashboard: %d %v, want 400 naming Second", code, resp)
	}

	// A list entry that is not a dashboard refuses the whole file, never a partial import.
	_ = json.Unmarshal(c.export("?scope=dashboards"), &env)
	cfg := env["config"].(map[string]interface{})
	cfg["dashboards"] = append(cfg["dashboards"].([]interface{}), "not a dashboard")
	bad, _ = json.Marshal(env)
	code, resp = c.importFileWith(bad, choicesField("keep", "keep", "keep"))
	if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "not a dashboard") {
		t.Errorf("non-object entry: %d %v, want 400", code, resp)
	}

	// Name bounds as a save: too long a name names the dashboard.
	_ = json.Unmarshal(c.export("?dashboardId=d1"), &env)
	d := env["config"].(map[string]interface{})["dashboards"].([]interface{})[0].(map[string]interface{})
	d["name"] = strings.Repeat("x", maxDashboardNameRunes+1)
	bad, _ = json.Marshal(env)
	code, resp = c.importFileWith(bad, map[string]string{"preview": "true"})
	if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "longer than") {
		t.Errorf("long name: %d %v, want 400", code, resp)
	}
	if storedJSON(t, db) != before {
		t.Errorf("a refused import changed the stored config")
	}
}

func TestImport_RefusesWhatIsNotADashboardExport(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	sqlite := append([]byte("SQLite format 3\x00"), make([]byte, 100)...)
	code, resp := c.importFile(sqlite)
	if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "backup") {
		t.Errorf("backup file: %d %v", code, resp)
	}
	gz := append([]byte{0x1f, 0x8b, 0x08}, make([]byte, 50)...)
	code, resp = c.importFile(gz)
	if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "backup") {
		t.Errorf("archive file: %d %v", code, resp)
	}
	other := []byte(`{"format":"hops-export","schemaVersion":3,"exportType":"icons","config":{"dashboards":[]}}`)
	code, resp = c.importFile(other)
	if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "icons") {
		t.Errorf("unknown export type: %d %v", code, resp)
	}
}
