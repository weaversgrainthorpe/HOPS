package api

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

const badTileURL = "javascript:alert(document.domain)"

func wantURLRefused(t *testing.T, what string, code int, resp map[string]interface{}) {
	t.Helper()
	if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "url is") {
		t.Fatalf("%s: got %d %v, want 400 naming the url", what, code, resp)
	}
}

// Pentest L1: a tile url outside the allow-list is refused on save.
func TestTileURL_RefusedOnSave(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	d := v3Body(t, c, "d1")
	n := tileJSON("bad", 0, 9)
	n["url"] = badTileURL
	n["openMode"] = "iframe"
	rootOf(d)["children"] = append(rootOf(d)["children"].([]interface{}), n)
	code, resp := v3Put(c, "d1", d, 1)
	wantURLRefused(t, "save", code, resp)
	if strings.Contains(storedRaw(db), "javascript:") {
		t.Error("refused save was stored")
	}
}

// ...and on import, in both the v3 and the v2 format.
func TestTileURL_RefusedOnImport(t *testing.T) {
	t.Run("v3", func(t *testing.T) {
		router, db := setupTestRouter(t)
		c := newClient(t, router)
		seed(t, db)
		var env map[string]interface{}
		if err := json.Unmarshal(c.export(""), &env); err != nil {
			t.Fatal(err)
		}
		configdoc.Walk(env["config"].(map[string]interface{}), func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
			if n["kind"] == "tile" {
				n["url"] = badTileURL
			}
			return true
		})
		b, _ := json.Marshal(env)
		code, resp := c.importFile(b)
		wantURLRefused(t, "v3 import", code, resp)
	})
	t.Run("v2", func(t *testing.T) {
		router, db := setupTestRouter(t)
		c := newClient(t, router)
		seed(t, db)
		d := legacyDashWithID("d9", "Legacy")
		d["path"] = "/legacy"
		e := d["tabs"].([]interface{})[0].(map[string]interface{})["groups"].([]interface{})[0].(map[string]interface{})["entries"].([]interface{})[0].(map[string]interface{})
		e["url"] = badTileURL
		b, _ := json.Marshal(map[string]interface{}{"dashboards": []interface{}{d}})
		code, resp := c.importFile(b)
		wantURLRefused(t, "v2 import", code, resp)
	})
}

// ...and on transfer: a legacy stored tile with a bad url cannot be copied
// onto another dashboard, and it is still served (not silently dropped).
func TestTileURL_RefusedOnTransfer(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db)
	doc := storedDoc(t, db)
	configdoc.Walk(doc, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		if n["id"] == "e1" {
			n["url"] = badTileURL
		}
		return true
	})
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
	tabID := v3Body(t, c, "d2")["tabs"].([]interface{})[0].(map[string]interface{})["id"].(string)
	code, resp := c.do("POST", "/api/dashboards/transfer", transferBody(map[string]interface{}{"target": map[string]interface{}{"tabId": tabID}}))
	wantURLRefused(t, "transfer", code, resp)
	b, _ := json.Marshal(getView(t, c))
	if !strings.Contains(string(b), "javascript:alert") {
		t.Error("stored unsafe tile was dropped from GET /api/config; it must be shown (as unsafe), not hidden")
	}
}
