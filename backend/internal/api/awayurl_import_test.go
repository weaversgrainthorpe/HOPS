package api

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// An imported v3 export carries a tile's awayUrl through; a bad one is refused.
func TestImport_AwayURL(t *testing.T) {
	withAway := func(t *testing.T, c *apiClient, away string) []byte {
		var env map[string]interface{}
		if err := json.Unmarshal(c.export(""), &env); err != nil {
			t.Fatal(err)
		}
		set := false
		configdoc.Walk(env["config"].(map[string]interface{}), func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
			if !set && n["kind"] == "tile" {
				n["awayUrl"] = away
				set = true
			}
			return true
		})
		if !set {
			t.Fatal("no tile in export")
		}
		b, _ := json.Marshal(env)
		return b
	}
	t.Run("valid", func(t *testing.T) {
		router, db := setupTestRouter(t)
		c := newClient(t, router)
		seed(t, db)
		code, resp := c.importFile(withAway(t, c, "https://nas.tailnet.ts.net"))
		if code != 200 {
			t.Fatalf("import: %d %v", code, resp)
		}
		found := false
		configdoc.Walk(storedDoc(t, db), func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
			if n["awayUrl"] == "https://nas.tailnet.ts.net" {
				found = true
			}
			return true
		})
		if !found {
			t.Error("awayUrl not kept on import")
		}
	})
	t.Run("bad", func(t *testing.T) {
		router, db := setupTestRouter(t)
		c := newClient(t, router)
		seed(t, db)
		code, resp := c.importFile(withAway(t, c, "javascript:alert(1)"))
		if code != 400 || !strings.Contains(fmt.Sprint(resp["error"]), "awayUrl") {
			t.Fatalf("got %d %v", code, resp)
		}
	})
}
