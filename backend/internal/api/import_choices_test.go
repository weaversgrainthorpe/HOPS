package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"sort"
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

// choicesField sends choices with no clash targets (each ""): enough for a
// refusal test; choose sends the targets a preview gave, as the dialog does.
func choicesField(cs ...string) map[string]string {
	b, _ := json.Marshal(cs)
	ts, _ := json.Marshal(make([]string, len(cs)))
	return map[string]string{"choices": string(b), "targets": string(ts)}
}

// previewTargets previews file and returns each row's clash id ("" for none).
func previewTargets(t *testing.T, c *apiClient, file []byte) []string {
	t.Helper()
	code, resp := c.importFileWith(file, map[string]string{"preview": "true"})
	if code != 200 {
		t.Fatalf("preview: %d %v", code, resp)
	}
	var out []string
	for _, r := range resp["dashboards"].([]interface{}) {
		id := ""
		if cl, ok := r.(map[string]interface{})["clash"].(map[string]interface{}); ok {
			id = cl["id"].(string)
		}
		out = append(out, id)
	}
	return out
}

// choose previews file, then imports it with cs and the preview's targets.
func choose(t *testing.T, c *apiClient, file []byte, cs ...string) (int, map[string]interface{}) {
	t.Helper()
	b, _ := json.Marshal(cs)
	ts, _ := json.Marshal(previewTargets(t, c, file))
	return c.importFileWith(file, map[string]string{"choices": string(b), "targets": string(ts)})
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

	var fileEnv map[string]interface{}
	_ = json.Unmarshal(file, &fileEnv)
	var fileFirst configdoc.Obj
	for _, fd := range fileEnv["config"].(map[string]interface{})["dashboards"].([]interface{}) {
		if fd.(map[string]interface{})["name"] == "First" {
			fileFirst = fd.(map[string]interface{})
		}
	}
	code, resp := choose(t, c, file, "replace", "keep", "skip", "add")
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
	// The replaced dashboard's own ids are freed, so the file's tab, folder and tile ids are kept as they are.
	if got, want := fmt.Sprint(sortedKeys(idsOf(first))), fmt.Sprint(sortedKeys(idsOf(fileFirst))); got != want {
		t.Errorf("Replace ids %s, want the file's %s", got, want)
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
		code, resp := choose(t, c, file, "keep")
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
		{map[string]string{"choices": `["keep"]`}, 400, "targets"}, // the clash ids the admin saw are required
		{map[string]string{"choices": `["keep"]`, "targets": `[]`}, 400, "0 target(s)"},
		{map[string]string{"choices": `["keep"]`, "targets": `["someone-else"]`}, 409, "check the file again"},
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

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// M1: an Add earlier in the file carrying the replaced dashboard's id must not take it.
func TestImport_ReplaceKeepsItsIDAgainstAnEarlierAdd(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	bID := newDash(t, c, "New", "/new")
	file := c.export("?scope=dashboards") // First (d1), New
	delDash(t, c, db, bID)
	doc := storedDoc(t, db)
	d1 := storedDashboards(doc)["d1"]
	firstPath := d1["path"]
	d1["name"], d1["path"] = "New", "/new"
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
	// Row 0, "First" (id d1), has no clash now: Add. Row 1, "New", clashes with d1: Replace.
	code, resp := choose(t, c, file, "add", "replace")
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	doc = storedDoc(t, db)
	replaced := dashByName(doc, "New")
	if replaced["id"] != "d1" || replaced["path"] != "/new" {
		t.Errorf("Replace lost its id: %v at %v, want d1 at /new", replaced["id"], replaced["path"])
	}
	added := dashByName(doc, "First")
	if added == nil || added["id"] == "d1" || added["path"] != firstPath {
		t.Errorf("the Add must get another id: %v", added)
	}
	assertUniqueIDs(t, doc)
}

// L1: Keep both picks the next number no dashboard in the store or the file will have.
func TestImport_KeepBothNumberIgnoresFileOrder(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	newDash(t, c, "Home", "/home")
	two := newDash(t, c, "Home (2)", "/home-2")
	file := c.export("?scope=dashboards") // First, Home, Home (2)
	delDash(t, c, db, two)
	code, resp := choose(t, c, file, "skip", "keep", "add")
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	names := map[string]int{}
	for _, d := range dashList(storedDoc(t, db)) {
		names[d["name"].(string)]++
	}
	if names["Home (2)"] != 1 || names["Home (3)"] != 1 {
		t.Errorf("names %v, want one Home (2) (added) and one Home (3) (kept both)", names)
	}
}

func TestImport_TwoReplacesOfOneDashboardRefused(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	var env map[string]interface{}
	_ = json.Unmarshal(c.export("?dashboardId=d1"), &env)
	cfg := env["config"].(map[string]interface{})
	ds := cfg["dashboards"].([]interface{})
	cp, _ := json.Marshal(ds[0])
	var dup map[string]interface{}
	_ = json.Unmarshal(cp, &dup)
	cfg["dashboards"] = append(ds, dup)
	file, _ := json.Marshal(env)
	before := storedJSON(t, db)
	code, resp := choose(t, c, file, "replace", "replace")
	if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "both replace") {
		t.Errorf("double Replace: %d %v, want 400", code, resp)
	}
	if storedJSON(t, db) != before {
		t.Errorf("a refused import changed the stored config")
	}
}

// L2: Replace is of the dashboard the admin saw, not whichever has that name now.
func TestImport_ReplaceTargetChangedIs409(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	file := c.export("?dashboardId=d1")
	targets := previewTargets(t, c, file) // ["d1"]
	delDash(t, c, db, "d1")
	newDash(t, c, "First", "/first-again")
	ts, _ := json.Marshal(targets)
	before := storedJSON(t, db)
	code, resp := c.importFileWith(file, map[string]string{"choices": `["replace"]`, "targets": string(ts)})
	if code != 409 || !strings.Contains(fmt.Sprint(resp["error"]), "check the file again") {
		t.Errorf("changed target: %d %v, want 409", code, resp)
	}
	if storedJSON(t, db) != before {
		t.Errorf("a refused import changed the stored config")
	}
}

// L3: an import refused for its choices takes no backup (none rotated away).
func TestImport_RefusedChoicesTakeNoBackup(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	long := strings.Repeat("x", maxDashboardNameRunes-1)
	longID := newDash(t, c, long, "/long")
	longFile := c.export("?dashboardId=" + longID)
	single := c.export("?dashboardId=d1")
	var env map[string]interface{}
	_ = json.Unmarshal(single, &env)
	cfg := env["config"].(map[string]interface{})
	ds := cfg["dashboards"].([]interface{})
	cp, _ := json.Marshal(ds[0])
	var dup map[string]interface{}
	_ = json.Unmarshal(cp, &dup)
	cfg["dashboards"] = append(ds, dup)
	double, _ := json.Marshal(env)

	n := backupCount(t, c)
	for _, tc := range []struct {
		name string
		code int
		run  func() (int, map[string]interface{})
	}{
		{"add on a clash", 409, func() (int, map[string]interface{}) { return c.importFileWith(single, choicesField("add")) }},
		{"stale target", 409, func() (int, map[string]interface{}) {
			return c.importFileWith(single, map[string]string{"choices": `["replace"]`, "targets": `["gone"]`})
		}},
		{"double replace", 400, func() (int, map[string]interface{}) { return choose(t, c, double, "replace", "replace") }},
		{"keep both name too long", 400, func() (int, map[string]interface{}) { return choose(t, c, longFile, "keep") }},
	} {
		code, resp := tc.run()
		if code != tc.code {
			t.Errorf("%s: %d %v, want %d", tc.name, code, resp, tc.code)
		}
		if got := backupCount(t, c); got != n {
			t.Errorf("%s: backups %d, want %d (a refused import takes none)", tc.name, got, n)
		}
	}
}

// L4: the pictures of a skipped dashboard are not restored.
func TestImport_SkippedDashboardsPicturesAreNotRestored(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	newDash(t, c, "Second", "/second")
	var env map[string]interface{}
	_ = json.Unmarshal(c.export("?scope=dashboards"), &env)
	cfg := env["config"].(map[string]interface{})
	ds := cfg["dashboards"].([]interface{})
	ds[0].(map[string]interface{})["background"] = map[string]interface{}{"type": "image", "value": "/backgrounds/kept.png"}
	ds[1].(map[string]interface{})["background"] = map[string]interface{}{"type": "image", "value": "/backgrounds/skipped.png"}
	// Both are broken, so an attempt to restore either is listed as failed.
	cfg["assets"] = map[string]interface{}{
		"/backgrounds/kept.png":    map[string]interface{}{"contentType": "image/png", "data": "!!!not base64!!!"},
		"/backgrounds/skipped.png": map[string]interface{}{"contentType": "image/png", "data": "!!!not base64!!!"},
	}
	file, _ := json.Marshal(env)
	code, resp := choose(t, c, file, "keep", "skip")
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	failed := fmt.Sprint(resp["assetsFailed"])
	if !strings.Contains(failed, "kept.png") || strings.Contains(failed, "skipped.png") {
		t.Errorf("assetsFailed %s: want kept.png tried and skipped.png left alone", failed)
	}
}

// L5: choices work for a converted format (Homer) as for a HOPS export.
func TestImport_ChoicesWithAConvertedFormat(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	homer, err := os.ReadFile("../converters/testdata/homer-upstream.yml")
	if err != nil {
		t.Fatal(err)
	}
	if code, resp := choose(t, c, homer, "add"); code != 200 {
		t.Fatalf("first import: %d %v", code, resp)
	}
	name := dashList(storedDoc(t, db))[1]["name"].(string)
	code, resp := choose(t, c, homer, "keep")
	if code != 200 {
		t.Fatalf("second import: %d %v", code, resp)
	}
	if dashByName(storedDoc(t, db), name+" (2)") == nil {
		t.Errorf("no %q after Keep both: %v", name+" (2)", resp)
	}
	if code, resp := choose(t, c, homer, "add"); code != 409 {
		t.Errorf("Add on a clash from a converted file: %d %v, want 409", code, resp)
	}
}

// L6: a YAML export of another type is refused like a JSON one; Export all
// of a document with no dashboards writes an empty list, not null.
func TestImport_YAMLExportTypeAndEmptyExportAll(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	y := []byte("format: hops-export\nschemaVersion: 3\nexportType: icons\nconfig:\n  dashboards: []\n")
	code, resp := c.importFile(y)
	if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "icons") {
		t.Errorf("YAML unknown export type: %d %v", code, resp)
	}

	doc := storedDoc(t, db)
	delete(doc, "dashboards")
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
	var env map[string]interface{}
	if err := json.Unmarshal(c.export("?scope=dashboards"), &env); err != nil {
		t.Fatal(err)
	}
	if ds, ok := env["config"].(map[string]interface{})["dashboards"].([]interface{}); !ok || len(ds) != 0 {
		t.Errorf("empty Export all dashboards = %v, want []", env["config"].(map[string]interface{})["dashboards"])
	}
}
