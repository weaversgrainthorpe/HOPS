package api

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// putFolderWithLargeSub saves into d1 a tab-level folder "Outer" holding a
// Small folder "Sub" whose contents are Large, so Outer's box is at Large's
// minimum (5×8, with the M6 tab allowance).
func putFolderWithLargeSub(t *testing.T, c *apiClient) {
	t.Helper()
	d := v3Body(t, c, "d1")
	rootOf(d)["children"] = append(rootOf(d)["children"].([]interface{}), map[string]interface{}{
		"id": "outer", "kind": "folder", "name": "Outer", "display": "expanded",
		"size": "medium", "contentSize": "medium",
		"placement": map[string]interface{}{"x": 0, "y": 9, "w": 5, "h": 8},
		"content": map[string]interface{}{"children": []interface{}{map[string]interface{}{
			"id": "sub", "kind": "folder", "name": "Sub", "size": "small", "contentSize": "large",
			"content": map[string]interface{}{"children": []interface{}{inFolder(tileJSON("inner1", 0, 0))}}}}}})
	if code, r := v3Put(c, "d1", d, 1); code != 200 {
		t.Fatalf("%d %v", code, r)
	}
}

// A folder that comes out of a folder onto another dashboard's tab gets a box
// at least its minimum (Ruling 7a, Ruling 9): Small with Large contents is
// 5×8, not size×3 by size×2 (3×2).
func TestTransfer_FolderOutOfFolderGetsMinimumBox(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db)
	putFolderWithLargeSub(t, c)
	code, resp := c.do("POST", "/api/dashboards/transfer", transferBody(map[string]interface{}{
		"sourceRevision": 2, "nodeIds": []string{"sub"}, "target": map[string]interface{}{"tabId": "d2-t1"}}))
	if code != 200 {
		t.Fatalf("%d %v", code, resp)
	}
	d2 := storedDashboards(storedDoc(t, db))["d2"]
	var sub configdoc.Obj
	for _, k := range d2["tabs"].([]any)[0].(configdoc.Obj)["root"].(configdoc.Obj)["children"].([]any) {
		if m := k.(configdoc.Obj); m["name"] == "Sub" {
			sub = m
		}
	}
	if sub == nil {
		t.Fatal("Sub not on d2's tab")
	}
	if _, _, w, h, _ := rect(sub["placement"]); w != 5 || h != 8 {
		t.Errorf("Sub's box %v, want 5×8 (its minimum for Large contents)", sub["placement"])
	}
}

// Into a folder on another dashboard: the receiving tab-level box grows to its
// new minimum when there is room (Ruling 7b), in the same write.
func TestTransfer_IntoFolderGrowsReceivingBox(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db)
	putFolderWithLargeSub(t, c)
	code, resp := c.do("POST", "/api/dashboards/transfer", transferBody(map[string]interface{}{
		"sourceRevision": 2, "nodeIds": []string{"sub"},
		"target": map[string]interface{}{"tabId": "d2-t1", "folderId": "d2-g1"}}))
	if code != 200 {
		t.Fatalf("%d %v", code, resp)
	}
	g := findNode(storedDashboards(storedDoc(t, db))["d2"], "d2-g1")[0]
	if _, _, w, h, _ := rect(g["placement"]); w < 5 || h < 8 {
		t.Errorf("receiving box %v, want at least 5×8", g["placement"])
	}
}

// No room to grow: refused visibly (409), naming the folder and both sizes;
// nothing stored.
func TestTransfer_IntoFolderNoRoomRefused(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db)
	putFolderWithLargeSub(t, c)
	// A tile right under d2's group blocks its growth downwards.
	d2 := v3Body(t, c, "d2")
	_, _, _, gh, _ := rect(configdoc.Obj(rootOf(d2)["children"].([]interface{})[0].(map[string]interface{})["placement"].(map[string]interface{})))
	rootOf(d2)["children"] = append(rootOf(d2)["children"].([]interface{}), tileJSON("blocker", 0, int(gh)))
	if code, r := v3Put(c, "d2", d2, 1); code != 200 {
		t.Fatalf("%d %v", code, r)
	}
	before := storedRaw(db)
	code, resp := c.do("POST", "/api/dashboards/transfer", transferBody(map[string]interface{}{
		"sourceRevision": 2, "targetRevision": 2, "nodeIds": []string{"sub"},
		"target": map[string]interface{}{"tabId": "d2-t1", "folderId": "d2-g1"}}))
	if code != 409 {
		t.Fatalf("code %d %v, want 409", code, resp)
	}
	msg, _ := resp["error"].(string)
	for _, part := range []string{"Group", "24×6", "24×8"} {
		if !strings.Contains(msg, part) {
			t.Errorf("message %q does not name %q", msg, part)
		}
	}
	if storedRaw(db) != before {
		t.Error("a refused transfer changed the stored document")
	}
}

// PUT and import refuse a folder box below its minimum (400), naming it.
func TestPut_UndersizedFolderBoxRefused(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	d := v3Body(t, c, "d1")
	g := rootOf(d)["children"].([]interface{})[0].(map[string]interface{})
	g["placement"] = map[string]interface{}{"x": 0, "y": 0, "w": 24, "h": 4}
	code, resp := v3Put(c, "d1", d, 1)
	if code != 400 {
		t.Fatalf("code %d %v, want 400", code, resp)
	}
	msg, _ := resp["error"].(string)
	for _, part := range []string{"24×4", "3×6"} {
		if !strings.Contains(msg, part) {
			t.Errorf("message %q does not name %q", msg, part)
		}
	}
}

// A HOPS export whose folder box is below its minimum (hand-made, or stored
// before the minimum) is enlarged on import, its neighbour pushed aside, and
// the import result lists it — never imported squashed, never silent.
func TestImport_V3UndersizedFolderEnlargedAndListed(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	var env map[string]interface{}
	if err := json.Unmarshal(c.export(""), &env); err != nil {
		t.Fatal(err)
	}
	cfg := env["config"].(map[string]interface{})
	d := cfg["dashboards"].([]interface{})[0].(map[string]interface{})
	root := d["tabs"].([]interface{})[0].(map[string]interface{})["root"].(map[string]interface{})
	var kids []interface{}
	for _, k := range root["children"].([]interface{}) {
		if k.(map[string]interface{})["kind"] == "folder" {
			g := k.(map[string]interface{})
			g["name"] = "Media"
			g["contentSize"] = "medium"
			g["placement"] = map[string]interface{}{"x": 0, "y": 0, "w": 2, "h": 4}
			kids = append(kids, g)
			break
		}
	}
	if len(kids) == 0 {
		t.Fatal("seed has no tab-level folder")
	}
	kids = append(kids, tileJSON("neighbour", 0, 4))
	root["children"] = kids
	code, resp := c.importFile(v3ExportOf(t, cfg))
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	msg, _ := resp["message"].(string)
	if !strings.Contains(msg, `Folder "Media" was smaller than it can be drawn (2×4); it was enlarged to 3×6`) {
		t.Errorf("message does not say the folder was enlarged: %q", msg)
	}
	list, _ := resp["foldersEnlarged"].([]interface{})
	if len(list) != 1 {
		t.Fatalf("foldersEnlarged %v, want one entry", resp["foldersEnlarged"])
	}
	ds := dashList(storedDoc(t, db))
	imp := ds[len(ds)-1]
	kidsOut := imp["tabs"].([]any)[0].(configdoc.Obj)["root"].(configdoc.Obj)["children"].([]any)
	var gx, gy, gw, gh, nx, ny, nw, nh float64
	for _, k := range kidsOut {
		m := k.(configdoc.Obj)
		x, y, w, h, _ := rect(m["placement"])
		if m["kind"] == "folder" {
			gx, gy, gw, gh = x, y, w, h
		} else {
			nx, ny, nw, nh = x, y, w, h
		}
	}
	if gw != 3 || gh != 6 {
		t.Errorf("folder box %v×%v, want 3×6", gw, gh)
	}
	if nx < gx+gw && gx < nx+nw && ny < gy+gh && gy < ny+nh {
		t.Errorf("neighbour (%v,%v %v×%v) still overlaps the enlarged folder", nx, ny, nw, nh)
	}
}

// A v2 import converts every group to at least its minimum box, so nothing
// needs enlarging; the result still carries the (empty) list.
func TestImport_V2GroupsAreNeverUndersized(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	v2 := []byte(`{"dashboards":[{"id":"x","name":"X","path":"/x","order":0,"tabs":[{"id":"t","name":"T","order":0,
	  "groups":[{"id":"g","name":"Media","order":0,"width":"third","entries":[{"id":"e","name":"A","url":"https://a","order":0}]}]}]}]}`)
	code, resp := c.importFile(v2)
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	if l, ok := resp["foldersEnlarged"].([]interface{}); !ok || len(l) != 0 {
		t.Errorf("foldersEnlarged %v, want an empty list", resp["foldersEnlarged"])
	}
	ds := dashList(storedDoc(t, db))
	g := ds[len(ds)-1]["tabs"].([]any)[0].(configdoc.Obj)["root"].(configdoc.Obj)["children"].([]any)[0].(configdoc.Obj)
	mw, mh := configdoc.FolderMinCellsOf(g)
	if _, _, w, h, _ := rect(g["placement"]); w < float64(mw) || h < float64(mh) {
		t.Errorf("converted box %v×%v below its minimum %d×%d", w, h, mw, mh)
	}
}
