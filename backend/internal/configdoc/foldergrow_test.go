package configdoc

import "testing"

// A tab-level folder below its minimum — counted with its nested folders'
// contents size — is grown, its overlapped neighbour pushed aside, and the
// growth reported. A folder already big enough is untouched.
func TestGrowFolderMinimums_NestedAndPush(t *testing.T) {
	d := Obj{"id": "d1", "tabs": []any{Obj{"id": "t1", "root": Obj{"columns": RootColumns, "children": []any{
		Obj{"id": "f1", "kind": "folder", "name": "Media", "contentSize": "small",
			"placement": Obj{"x": 22, "y": 0, "w": 2, "h": 5, "z": 3},
			"content": Obj{"children": []any{
				Obj{"id": "f2", "kind": "folder", "name": "Inner", "contentSize": "large", "content": Obj{"children": []any{}}},
			}}},
		Obj{"id": "n1", "kind": "tile", "placement": Obj{"x": 20, "y": 6, "w": 2, "h": 2}},
		Obj{"id": "ok", "kind": "folder", "name": "Fine", "contentSize": "small", "placement": Obj{"x": 0, "y": 0, "w": 4, "h": 6}},
	}}}}}
	g := GrowFolderMinimums(d)
	mw, mh := FolderMinCells("large")
	if len(g) != 1 || g[0].FolderID != "f1" || g[0].NewW != mw || g[0].NewH != mh || g[0].OldW != 2 || g[0].OldH != 5 {
		t.Fatalf("growth %+v, want f1 2×5 → %d×%d", g, mw, mh)
	}
	kids := d["tabs"].([]any)[0].(Obj)["root"].(Obj)["children"].([]any)
	fx, fy, fw, fh, _ := intRect(kids[0].(Obj)["placement"])
	if fw != mw || fh != mh || fx+fw > RootColumns || fy != 0 {
		t.Errorf("grown box %d,%d %d×%d", fx, fy, fw, fh)
	}
	if kids[0].(Obj)["placement"].(Obj)["z"] != 3 {
		t.Error("z dropped")
	}
	nx, ny, nw, nh, _ := intRect(kids[1].(Obj)["placement"])
	if rectsOverlap([4]int{fx, fy, fw, fh}, [4]int{nx, ny, nw, nh}) {
		t.Errorf("neighbour %d,%d still overlaps", nx, ny)
	}
	if p := kids[2].(Obj)["placement"].(Obj); p["w"] != 4 || p["h"] != 6 {
		t.Errorf("a big-enough folder changed: %v", p)
	}
	if g[0].String() == "" {
		t.Error("empty report line")
	}
}
