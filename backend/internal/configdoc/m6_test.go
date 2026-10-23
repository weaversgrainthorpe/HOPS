package configdoc

import (
	"strings"
	"testing"
)

// M6 (folder shapes spec §3.9, §3a.1, §3a.4, §3a.5, §3a.8): a folder's shape
// is one of seven fixed names and its tabPosition one of left/centre/right;
// anything else is refused on save and import. v2 folder-style groups become
// Flat, every other converted folder Rounded. The folder minimum carries a
// tab-height allowance (no shape parameter), and layoutVersion is 2.

func TestLayoutVersion_IsTwo(t *testing.T) {
	if LayoutVersion != 2 {
		t.Fatalf("LayoutVersion = %d, want 2 (M6 §3a.4: the stricter minimum is a format rule)", LayoutVersion)
	}
	err := CheckLayoutVersion(Obj{LayoutVersionKey: 1.0})
	if err == nil {
		t.Fatal("a layout version 1 document is accepted")
	}
	for _, part := range []string{"layout version 1", "layout version 2"} {
		if !strings.Contains(err.Error(), part) {
			t.Errorf("%v does not name %q", err, part)
		}
	}
}

func TestFolderMinCells_IncludesTabAllowance(t *testing.T) {
	if FolderTabPx <= 0 {
		t.Fatalf("FolderTabPx = %d, want a positive tab-height allowance", FolderTabPx)
	}
	for size, span := range sizeSpans {
		_, h := FolderMinCells(size)
		want := span + ceilCells(FolderTitlePx+FolderTabPx+FolderPadPx+PageBarPx)
		if h != want {
			t.Errorf("FolderMinCells(%s) h = %d, want %d (bar, tab, padding, one item, page bar)", size, h, want)
		}
	}
	// Small 2×5, Medium 3×6, Large 5×8: one row taller than M5's 2×4, 3×5, 5×7.
	for size, want := range map[string][2]int{"small": {2, 5}, "medium": {3, 6}, "large": {5, 8}} {
		if w, h := FolderMinCells(size); w != want[0] || h != want[1] {
			t.Errorf("FolderMinCells(%s) = %d×%d, want %d×%d", size, w, h, want[0], want[1])
		}
	}
}

// FolderBoxFor's chrome includes the tab allowance too: the box it gives
// holds its items on page 1 with the tab drawn.
func TestFolderBoxFor_CountsTab(t *testing.T) {
	f := Obj{"contentSize": "medium"}
	for n := 1; n <= 30; n++ {
		w, h := FolderBoxFor(f, n, 12)
		perRow := (w*MinGridCellPx - FolderPadPx) / (2 * MinGridCellPx)
		rows := (h*MinGridCellPx - FolderTitlePx - FolderTabPx - FolderPadPx) / (2 * MinGridCellPx)
		if perRow*rows < n {
			t.Errorf("FolderBoxFor(%d) = %d×%d holds %d×%d, want all %d with the tab", n, w, h, perRow, rows, n)
		}
	}
}

func shapedDash(shape, tabPos any, nested bool) Obj {
	f := m5Folder("f1", 0, 0, 6, 8, inner(m5Tile("t1", "medium", 0, 0)))
	target := f
	if nested {
		sub := inner(m5Folder("f2", 0, 0, 0, 0))
		f["content"].(Obj)["children"] = append(f["content"].(Obj)["children"].([]any), sub)
		target = sub
	}
	if shape != nil {
		target["shape"] = shape
	}
	if tabPos != nil {
		target["tabPosition"] = tabPos
	}
	return m5Dash(f)
}

func TestVerify_FolderShapeAndTabPosition(t *testing.T) {
	verifiers := map[string]func(Obj) error{"save": VerifyDashboard, "import": VerifyImportedDashboard}
	for _, nested := range []bool{false, true} {
		for name, verify := range verifiers {
			// Absent values and every listed value are accepted.
			if err := verify(shapedDash(nil, nil, nested)); err != nil {
				t.Errorf("%s nested=%v: absent shape/tabPosition refused: %v", name, nested, err)
			}
			for _, s := range FolderShapes {
				for _, p := range FolderTabPositions {
					if err := verify(shapedDash(s, p, nested)); err != nil {
						t.Errorf("%s nested=%v: shape %q tabPosition %q refused: %v", name, nested, s, p, err)
					}
				}
			}
			// Anything else is refused, naming the value and the field.
			for _, bad := range []any{"folder-tab", "star", "Rounded", "", 3.0, true, Obj{"svg": "<path/>"}} {
				err := verify(shapedDash(bad, nil, nested))
				if err == nil {
					t.Errorf("%s nested=%v: shape %v accepted", name, nested, bad)
					continue
				}
				for _, part := range []string{"shape", "folder-flat", "rounded"} {
					if !strings.Contains(err.Error(), part) {
						t.Errorf("%s: %v does not mention %q", name, err, part)
					}
				}
			}
			for _, bad := range []any{"center", "middle", "Left", "", 1.0} {
				err := verify(shapedDash("folder-flat", bad, nested))
				if err == nil {
					t.Errorf("%s nested=%v: tabPosition %v accepted", name, nested, bad)
					continue
				}
				for _, part := range []string{"tabPosition", "left", "centre", "right"} {
					if !strings.Contains(err.Error(), part) {
						t.Errorf("%s: %v does not mention %q", name, err, part)
					}
				}
			}
		}
	}
}

func TestFolderShapes_List(t *testing.T) {
	want := "rounded simple-tab folder-flat folder-paper folder-outline folder-cartoon folder-open"
	if got := strings.Join(FolderShapes, " "); got != want {
		t.Errorf("FolderShapes = %s, want %s", got, want)
	}
	if got := strings.Join(FolderTabPositions, " "); got != "left centre right" {
		t.Errorf("FolderTabPositions = %s", got)
	}
}

// §3a.1: a v2 group with displayStyle "folder" becomes Flat; every other
// group Rounded. Checked on the real Weavers export, which has both.
func TestConvert_RealV2FolderStyleBecomesFlat(t *testing.T) {
	for _, file := range []string{"testdata/real_weavers.json", "testdata/real_sample.json", "testdata/v2_basic.json", "testdata/v2_messy.json"} {
		t.Run(file, func(t *testing.T) {
			v2 := realV2(t, file)
			v3, _, sizes, err := MigrateV2Full(v2)
			if err != nil {
				t.Fatal(err)
			}
			if err := VerifyMigrationFull(v2, v3, nil, sizes); err != nil {
				t.Fatal(err)
			}
			flat, rounded := 0, 0
			Walk(v3, func(_, _ Obj, _ []Obj, n Obj) bool {
				if n["kind"] != "folder" {
					return true
				}
				want := "rounded"
				if n["displayStyle"] == "folder" {
					want = "folder-flat"
					flat++
				} else {
					rounded++
				}
				if n["shape"] != want {
					t.Errorf("folder %v (displayStyle %v): shape %v, want %s", n["id"], n["displayStyle"], n["shape"], want)
				}
				if _, has := n["tabPosition"]; has {
					t.Errorf("folder %v: converter wrote tabPosition %v (absent means left)", n["id"], n["tabPosition"])
				}
				return true
			})
			if file == "testdata/real_weavers.json" && (flat != 4 || rounded != 5) {
				t.Errorf("Weavers: %d Flat, %d Rounded; want 4 and 5 (its folder and header groups)", flat, rounded)
			}
		})
	}
}
