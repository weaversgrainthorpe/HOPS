package configdoc

import (
	"encoding/json"
	"strings"
	"testing"
)

// A tile's and a folder's textColor, when present, is "auto", "light" or
// "dark" (absent = Auto); a description, when present, is text. Both are
// kept through save and import exactly as written.

func textDash(field string, value any, onFolder, nested bool) Obj {
	tile := currentTile("t1", "medium", 0, 0)
	f := currentFolder("f1", 4, 0, 6, 8, inner(currentTile("t2", "medium", 0, 0)))
	var target Obj
	switch {
	case onFolder && nested:
		sub := inner(currentFolder("f2", 0, 0, 0, 0))
		f["content"].(Obj)["children"] = append(f["content"].(Obj)["children"].([]any), sub)
		target = sub
	case onFolder:
		target = f
	case nested:
		target = f["content"].(Obj)["children"].([]any)[0].(Obj)
	default:
		target = tile
	}
	if value != nil {
		target[field] = value
	}
	return currentDash(tile, f)
}

func TestVerify_TextColourAndDescription(t *testing.T) {
	verifiers := map[string]func(Obj) error{"save": VerifyDashboard, "import": VerifyImportedDashboard}
	for name, verify := range verifiers {
		for _, onFolder := range []bool{false, true} {
			for _, nested := range []bool{false, true} {
				what := map[bool]string{false: "tile", true: "folder"}[onFolder]
				// Absent and every listed value are accepted.
				for _, ok := range []any{nil, "auto", "light", "dark"} {
					if err := verify(textDash("textColor", ok, onFolder, nested)); err != nil {
						t.Errorf("%s %s nested=%v: textColor %v refused: %v", name, what, nested, ok, err)
					}
				}
				for _, ok := range []any{nil, "", "Shown when you point at it", strings.Repeat("long ", 400)} {
					if err := verify(textDash("description", ok, onFolder, nested)); err != nil {
						t.Errorf("%s %s nested=%v: description %v refused: %v", name, what, nested, ok, err)
					}
				}
				// Anything else is refused, naming the field and the allowed values.
				for _, bad := range []any{"Auto", "white", "#fff", "", 1.0, true, Obj{"x": 1}} {
					err := verify(textDash("textColor", bad, onFolder, nested))
					if err == nil {
						t.Errorf("%s %s nested=%v: textColor %v accepted", name, what, nested, bad)
						continue
					}
					for _, part := range []string{"textColor", "auto", "light", "dark"} {
						if !strings.Contains(err.Error(), part) {
							t.Errorf("%s: %v does not mention %q", name, err, part)
						}
					}
				}
				for _, bad := range []any{1.0, true, Obj{"x": 1}, []any{"a"}} {
					err := verify(textDash("description", bad, onFolder, nested))
					if err == nil {
						t.Errorf("%s %s nested=%v: description %v accepted", name, what, nested, bad)
						continue
					}
					if !strings.Contains(err.Error(), "description") {
						t.Errorf("%s: %v does not mention description", name, err)
					}
				}
			}
		}
	}
}

// Export and import carry the new fields through unchanged: a dashboard
// written to JSON and read back (the export envelope's config) still has a
// folder's description and a tile's text colour, and still verifies.
func TestTextColourAndDescription_RoundTrip(t *testing.T) {
	d := textDash("description", "Media things", true, false)
	d["tabs"].([]any)[0].(Obj)["root"].(Obj)["children"].([]any)[0].(Obj)["textColor"] = "dark"
	b, err := json.Marshal(Obj{"config": Obj{"dashboards": []any{d}}})
	if err != nil {
		t.Fatal(err)
	}
	var back Obj
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	got := back["config"].(Obj)["dashboards"].([]any)[0].(Obj)
	if err := VerifyImportedDashboard(got); err != nil {
		t.Fatalf("round-tripped dashboard refused: %v", err)
	}
	kids := got["tabs"].([]any)[0].(Obj)["root"].(Obj)["children"].([]any)
	if kids[0].(Obj)["textColor"] != "dark" {
		t.Errorf("tile textColor = %v, want dark", kids[0].(Obj)["textColor"])
	}
	if kids[1].(Obj)["description"] != "Media things" {
		t.Errorf("folder description = %v, want Media things", kids[1].(Obj)["description"])
	}
}
