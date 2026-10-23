package configdoc

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// folderMinCases is testdata/folder_min_cases.json, THE open-folder minimum
// table shared with the frontend's geometry test (Ruling 9).
type folderMinCases struct {
	MinOpen []struct {
		ContentSize any            `json:"contentSize"`
		Want        map[string]int `json:"want"`
	} `json:"minOpen"`
	Folders []struct {
		Name    string         `json:"name"`
		Folder  Obj            `json:"folder"`
		Largest string         `json:"largest"`
		Min     map[string]int `json:"min"`
	} `json:"folders"`
}

func TestFolderMinCells_SharedCases(t *testing.T) {
	raw, err := os.ReadFile("testdata/folder_min_cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var c folderMinCases
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	if len(c.MinOpen) == 0 || len(c.Folders) == 0 {
		t.Fatal("folder_min_cases.json has no cases")
	}
	for _, tc := range c.MinOpen {
		w, h := FolderMinCells(tc.ContentSize)
		if w != tc.Want["w"] || h != tc.Want["h"] {
			t.Errorf("FolderMinCells(%v) = %dx%d, want %dx%d", tc.ContentSize, w, h, tc.Want["w"], tc.Want["h"])
		}
	}
	for _, tc := range c.Folders {
		if got := LargestContentSize(tc.Folder); got != tc.Largest {
			t.Errorf("%s: LargestContentSize = %q, want %q", tc.Name, got, tc.Largest)
		}
		w, h := FolderMinCellsOf(tc.Folder)
		if w != tc.Min["w"] || h != tc.Min["h"] {
			t.Errorf("%s: FolderMinCellsOf = %dx%d, want %dx%d", tc.Name, w, h, tc.Min["w"], tc.Min["h"])
		}
	}
}

// itemsPerRow is how many items of span cells fit across a w-cell open box
// at the narrowest grid cell: the content width less the padding.
func itemsPerRow(w, span int) int {
	return (w*MinGridCellPx - FolderPadPx) / (span * MinGridCellPx)
}

// Every folder the v2 converter writes from the real exports is at least its
// minimum, and holds all its v2 entries on page 1 (no page bar) at every grid
// width: the narrowest cell is the worst case.
func TestConvert_RealFoldersMeetMinimumAndFitPageOne(t *testing.T) {
	for _, f := range []string{"testdata/real_weavers.json", "testdata/real_sample.json"} {
		t.Run(f, func(t *testing.T) {
			v2 := realV2(t, f)
			v3, _, sizes, err := MigrateV2Full(v2)
			if err != nil {
				t.Fatal(err)
			}
			if err := VerifyMigrationFull(v2, v3, nil, sizes); err != nil {
				t.Fatal(err)
			}
			n := 0
			Walk(v3, func(_, _ Obj, path []Obj, node Obj) bool {
				if node["kind"] != "folder" || len(path) != 0 {
					return true
				}
				n++
				p := node["placement"].(Obj)
				w, h := int(toNum(p["w"])), int(toNum(p["h"]))
				mw, mh := FolderMinCellsOf(node)
				if w < mw || h < mh {
					t.Errorf("folder %v box %dx%d is below its minimum %dx%d", node["id"], w, h, mw, mh)
				}
				span, _ := SizeSpan(node["contentSize"])
				kids, _ := node["content"].(Obj)["children"].([]any)
				perRow := itemsPerRow(w, span)
				rows := (h*MinGridCellPx - FolderTitlePx - FolderTabPx - FolderPadPx) / (span * MinGridCellPx)
				if perRow*rows < len(kids) {
					t.Errorf("folder %v box %dx%d holds %d×%d items on page 1, want all %d", node["id"], w, h, perRow, rows, len(kids))
				}
				return true
			})
			if n == 0 {
				t.Fatal("no tab-level folders converted")
			}
		})
	}
}

func toNum(x any) float64 { f, _ := numberValue(x); return f }

// A tab-level folder box below its minimum is refused on import and save,
// naming the folder and both sizes (Important 2): never stored to be clipped.
func TestVerifyDashboard_RefusesUndersizedFolderBox(t *testing.T) {
	d := Obj{
		"id": "d1", "path": "home", "revision": 1,
		"tabs": []any{Obj{"id": "t1", "name": "T", "root": Obj{"columns": RootColumns, "children": []any{
			Obj{"id": "f1", "kind": "folder", "name": "Services", "size": "medium", "contentSize": "small",
				"placement": Obj{"x": 0, "y": 0, "w": 24, "h": 4},
				"content": Obj{"children": []any{
					Obj{"id": "f2", "kind": "folder", "name": "Inner", "size": "small", "contentSize": "medium", "content": Obj{"children": []any{}}},
				}}},
		}}}},
	}
	settings := Obj{}
	for _, k := range settingsKeys {
		settings[k] = nil
	}
	d["settings"] = settings
	for name, verify := range map[string]func(Obj) error{"import": VerifyImportedDashboard, "save": VerifyDashboard} {
		err := verify(d)
		if err == nil {
			t.Fatalf("%s: undersized box accepted", name)
		}
		for _, part := range []string{"Services", "24×4", "3×6"} {
			if !strings.Contains(err.Error(), part) {
				t.Errorf("%s: %v does not name %q", name, err, part)
			}
		}
	}
	// At its minimum it is accepted.
	root := d["tabs"].([]any)[0].(Obj)["root"].(Obj)
	root["children"].([]any)[0].(Obj)["placement"] = Obj{"x": 0, "y": 0, "w": 3, "h": 6}
	if err := VerifyDashboard(d); err != nil {
		t.Fatalf("box at its minimum refused: %v", err)
	}
}
