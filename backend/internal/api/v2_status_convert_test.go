package api

import (
	"encoding/json"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// v2StatusDoc is a stored v2 document: Alpha has one tile not ticked and one
// ticked, Beta one tile unticked (enabled false), Gamma only a ticked tile and
// Notes a note tile.
func v2StatusDoc(t *testing.T) string {
	t.Helper()
	on := map[string]interface{}{"type": "http", "enabled": true}
	alpha := statusDash("da", "Alpha", nil, "")
	group := alpha["tabs"].([]interface{})[0].(map[string]interface{})["groups"].([]interface{})[0].(map[string]interface{})
	group["entries"] = append(group["entries"].([]interface{}), map[string]interface{}{
		"id": "da-on", "name": "On", "url": "https://example.com/on", "order": 1, "statusCheck": on,
	})
	b, err := json.Marshal(map[string]interface{}{"dashboards": []interface{}{
		alpha,
		statusDash("db", "Beta", map[string]interface{}{"type": "http", "enabled": false}, ""),
		statusDash("dc", "Gamma", on, ""),
		statusDash("dn", "Notes", nil, "note"),
	}})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// The startup v2 conversion pins exactly what 2.2.1 checked: a ticked tile is
// On, every other tile Off, and no gate key is written anywhere. No notice is
// raised.
func TestV2Conversion_TickedTilesOnOthersOff(t *testing.T) {
	router, db := setupTestRouterSeeded(t, v2StatusDoc(t))
	doc, err := configdoc.Load(db)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{"da-e": false, "da-on": true, "db-e": false, "dc-e": true}
	seen := 0
	configdoc.Walk(doc, func(dash, tab configdoc.Obj, path []configdoc.Obj, n configdoc.Obj) bool {
		if n["kind"] == "folder" {
			if _, has := n["statusChecksEnabled"]; has {
				t.Errorf("folder %v got a gate key", n["id"])
			}
		}
		if _, has := tab["statusChecksEnabled"]; has {
			t.Errorf("tab %v got a gate key", tab["id"])
		}
		if n["kind"] != "tile" {
			return true
		}
		id, _ := n["id"].(string)
		sc, _ := n["statusCheck"].(configdoc.Obj)
		if id == "dn-e" {
			return true // a note is never checked and left as it was
		}
		seen++
		if sc["enabled"] != want[id] {
			t.Errorf("tile %s: statusCheck %v, want enabled %v", id, n["statusCheck"], want[id])
		}
		return true
	})
	if seen != len(want) {
		t.Errorf("saw %d tiles, want %d", seen, len(want))
	}
	if ns := noticesOf(t, getView(t, newClient(t, router))); len(ns) != 0 {
		t.Errorf("notices after a v2 conversion: %v, want none", ns)
	}
}

// A v2 import converts the same way and raises no notice.
func TestV2Import_TickedTilesOnOthersOff(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	on := map[string]interface{}{"type": "http", "enabled": true}
	b, _ := json.Marshal(map[string]interface{}{"dashboards": []interface{}{
		statusDash("dx", "Imported", nil, ""), statusDash("dy", "Ticked", on, ""),
	}})
	if code, resp := c.importFile(b); code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	doc, err := configdoc.Load(db)
	if err != nil {
		t.Fatal(err)
	}
	for id, wantOn := range map[string]bool{"dx-e": false, "dy-e": true} {
		_, tile, ok := configdoc.FindTile(doc, id)
		if !ok {
			t.Fatalf("tile %s not imported", id)
		}
		if sc, _ := tile["statusCheck"].(configdoc.Obj); sc["enabled"] != wantOn {
			t.Errorf("tile %s: statusCheck %v, want enabled %v", id, tile["statusCheck"], wantOn)
		}
	}
	if ns := noticesOf(t, getView(t, c)); len(ns) != 0 {
		t.Errorf("notices after a v2 import: %v, want none", ns)
	}
}
