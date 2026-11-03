package api

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// fileDash returns the dashboard called name in an export envelope.
func fileDash(t *testing.T, env map[string]interface{}, name string) configdoc.Obj {
	t.Helper()
	for _, d := range env["config"].(map[string]interface{})["dashboards"].([]interface{}) {
		if dm := d.(map[string]interface{}); dm["name"] == name {
			return dm
		}
	}
	t.Fatalf("no dashboard %q in the file", name)
	return nil
}

func previewRows(t *testing.T, c *apiClient, file []byte) []map[string]interface{} {
	t.Helper()
	code, resp := c.importFileWith(file, map[string]string{"preview": "true"})
	if code != 200 {
		t.Fatalf("preview: %d %v", code, resp)
	}
	var out []map[string]interface{}
	for _, r := range resp["dashboards"].([]interface{}) {
		out = append(out, r.(map[string]interface{}))
	}
	return out
}

func stringsOf(v interface{}) []string {
	l, _ := v.([]interface{})
	out := make([]string, 0, len(l))
	for _, x := range l {
		out = append(out, fmt.Sprint(x))
	}
	return out
}

// Fields HOPS doesn't recognise are imported as they are, and the preview and
// the result name them per dashboard (never silently kept). A skipped
// dashboard's are not listed; a Keep both copy is named as stored.
func TestImport_UnknownFieldsAreKeptAndNamed(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	newDash(t, c, "Second", "/second")
	var env map[string]interface{}
	if err := json.Unmarshal(c.export("?scope=dashboards"), &env); err != nil {
		t.Fatal(err)
	}
	first := fileDash(t, env, "First")
	first["mood"] = "sunny"
	tab := first["tabs"].([]interface{})[0].(map[string]interface{})
	tab["tabNote"] = 1
	folder := tab["root"].(map[string]interface{})["children"].([]interface{})[0].(map[string]interface{})
	tile := folder["content"].(map[string]interface{})["children"].([]interface{})[0].(map[string]interface{})
	tile["foo"] = map[string]interface{}{"bar": true}
	fileDash(t, env, "Second")["other"] = 1
	file, _ := json.Marshal(env)

	rows := previewRows(t, c, file)
	want := `3 fields HOPS doesn't recognise will be kept but not used: mood; tab "Tab" › tabNote; tab "Tab" › folder "Group" › tile "Example" › foo`
	if rows[0]["unknownFields"] != want {
		t.Errorf("preview First:\n got %v\nwant %s", rows[0]["unknownFields"], want)
	}
	if rows[1]["unknownFields"] != `1 field HOPS doesn't recognise will be kept but not used: other` {
		t.Errorf("preview Second: %v", rows[1]["unknownFields"])
	}

	code, resp := choose(t, c, file, "keep", "skip")
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	lines := stringsOf(resp["unknownFields"])
	wantLine := `Dashboard "First (2)": 3 fields HOPS doesn't recognise were kept but are not used: mood; tab "Tab" › tabNote; tab "Tab" › folder "Group" › tile "Example" › foo`
	if len(lines) != 1 || lines[0] != wantLine {
		t.Errorf("result unknownFields:\n got %q\nwant [%q] (the skipped Second is not listed)", lines, wantLine)
	}
	if msg, _ := resp["message"].(string); !strings.Contains(msg, "1 dashboard(s) have fields HOPS doesn't recognise (listed separately)") {
		t.Errorf("message does not mention them: %q", msg)
	}
	// Kept as they were, not dropped.
	stored := dashByName(storedDoc(t, db), "First (2)")
	if stored["mood"] != "sunny" {
		t.Errorf("dashboard field not kept: %v", stored["mood"])
	}
	st := stored["tabs"].([]any)[0].(configdoc.Obj)
	sf := st["root"].(configdoc.Obj)["children"].([]any)[0].(configdoc.Obj)
	stt := sf["content"].(configdoc.Obj)["children"].([]any)[0].(configdoc.Obj)
	if st["tabNote"] != float64(1) || fmt.Sprint(stt["foo"]) != "map[bar:true]" {
		t.Errorf("tab/tile fields not kept: %v %v", st["tabNote"], stt["foo"])
	}
}

// A clean export has nothing to name: no preview note, an empty list.
func TestImport_CleanFileHasNoUnknownFields(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	file := c.export("?scope=dashboards")
	if rows := previewRows(t, c, file); rows[0]["unknownFields"] != nil {
		t.Errorf("preview note on a clean file: %v", rows[0]["unknownFields"])
	}
	code, resp := choose(t, c, file, "keep")
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	if l, ok := resp["unknownFields"].([]interface{}); !ok || len(l) != 0 {
		t.Errorf("unknownFields = %v, want an empty list", resp["unknownFields"])
	}
}

// The full fixture (every field HOPS has, at every level) imports with
// nothing named, through the real import.
func TestImport_FullFieldsFixtureHasNoUnknownFields(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	doc := loadTestdata(t, "../configdoc/testdata/v3_full_fields.json")
	file, _ := json.Marshal(map[string]interface{}{
		"format": "hops-export", "schemaVersion": 3, "exportType": "dashboards", "config": doc,
	})
	if rows := previewRows(t, c, file); rows[0]["unknownFields"] != nil {
		t.Errorf("preview: %v", rows[0]["unknownFields"])
	}
	code, resp := choose(t, c, file, "add")
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	if l := stringsOf(resp["unknownFields"]); len(l) != 0 {
		t.Errorf("unknownFields = %q", l)
	}
}

// A v2 file goes through the converter, which keeps keys it doesn't know:
// they are named too, as the converted dashboard holds them.
func TestImport_V2UnknownFieldsAreNamed(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	d := legacyDashWithID("media", "Media")
	d["slug"] = "media"
	entry := d["tabs"].([]interface{})[0].(map[string]interface{})["groups"].([]interface{})[0].(map[string]interface{})["entries"].([]interface{})[0].(map[string]interface{})
	entry["custom"] = 7
	file, _ := json.Marshal(map[string]interface{}{"dashboards": []interface{}{d}})
	code, resp := choose(t, c, file, "add")
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	want := `Dashboard "Media": 2 fields HOPS doesn't recognise were kept but are not used: slug; tab "Tab" › folder "Group" › tile "Example" › custom`
	if l := stringsOf(resp["unknownFields"]); len(l) != 1 || l[0] != want {
		t.Errorf("unknownFields = %q, want [%q]", l, want)
	}
}

// One dashboard's line names at most maxUnknownListed fields, then says how
// many more.
func TestUnknownFieldsText_Capped(t *testing.T) {
	var fs []configdoc.UnknownField
	for i := 0; i < maxUnknownListed+3; i++ {
		fs = append(fs, configdoc.UnknownField{Path: fmt.Sprintf("f%d", i), Where: fmt.Sprintf("f%d", i)})
	}
	got := unknownFieldsText(fs, true)
	if !strings.HasPrefix(got, "13 fields HOPS doesn't recognise were kept but are not used: f0; f1;") ||
		!strings.HasSuffix(got, "f9; and 3 more") {
		t.Errorf("capped text: %q", got)
	}
	if unknownFieldsText(nil, true) != "" {
		t.Error("no fields must give no text")
	}
}

func loadTestdata(t *testing.T, path string) configdoc.Obj {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var o configdoc.Obj
	if err := json.Unmarshal(b, &o); err != nil {
		t.Fatal(err)
	}
	return o
}
