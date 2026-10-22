package api

import (
	"database/sql"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

func dupIDsRouter(t *testing.T) (*apiClient, interface {
	QueryRow(string, ...any) *sql.Row
}) {
	t.Helper()
	b, err := os.ReadFile("../configdoc/testdata/v2_dup_ids.json")
	if err != nil {
		t.Fatal(err)
	}
	router, db := setupTestRouterSeeded(t, string(b))
	return newClient(t, router), db
}

func notices(t *testing.T, v map[string]interface{}) []string {
	t.Helper()
	raw, ok := v["migrationNotices"].([]interface{})
	if !ok {
		t.Fatalf("migrationNotices = %#v, want a list", v["migrationNotices"])
	}
	out := make([]string, len(raw))
	for i, n := range raw {
		out[i] = n.(string)
	}
	return out
}

func TestGetConfig_MigrationNoticesAfterRenamingMigration(t *testing.T) {
	c, db := dupIDsRouter(t)
	v := getView(t, c)
	want := []string{
		`Tab "main" in dashboard "Heimdall Import" was renamed to "main-heimdall" because another dashboard already used that id`,
		`Folder "services" in dashboard "Heimdall Import" was renamed to "services-heimdall" because another dashboard already used that id`,
	}
	if got := notices(t, v); !reflect.DeepEqual(got, want) {
		t.Fatalf("notices:\n got %q\nwant %q", got, want)
	}

	// A dashboard save that echoes the notices strips them: never stored.
	d := v["dashboards"].([]interface{})[0].(map[string]interface{})
	d["migrationNotices"] = v["migrationNotices"]
	if code, r := c.do("PUT", "/api/dashboards/"+d["id"].(string), map[string]interface{}{"schema": 3, "dashboard": d, "revision": d["revision"], "layoutVersion": 1}); code != 200 {
		t.Fatalf("PUT: %d %v", code, r)
	}
	if strings.Contains(storedRaw(db), "migrationNotices") {
		t.Fatal("migrationNotices was stored")
	}
	// Still reported for the life of this process.
	if got := notices(t, getView(t, c)); !reflect.DeepEqual(got, want) {
		t.Fatalf("notices after PUT: %q", got)
	}
}

func TestGetConfig_NoMigrationNoticesWithoutRenames(t *testing.T) {
	router, _ := setupTestRouter(t)
	v := getView(t, newClient(t, router))
	if _, has := v["migrationNotices"]; has {
		t.Fatalf("migrationNotices present without renames: %v", v["migrationNotices"])
	}
}

func TestMigrationNoticeText(t *testing.T) {
	v2 := configdoc.Obj{"dashboards": []any{
		configdoc.Obj{"id": "d", "name": "Home", "tabs": []any{
			configdoc.Obj{"id": "t", "groups": []any{
				configdoc.Obj{"id": "g", "entries": []any{configdoc.Obj{"id": "e"}, configdoc.Obj{"id": "e"}}},
			}},
		}},
		configdoc.Obj{"id": "d", "tabs": []any{}},
	}}
	doc, renames, err := configdoc.MigrateV2Renaming(v2)
	if err != nil {
		t.Fatal(err)
	}
	got := migrationNotices(renames, doc)
	want := []string{
		`Tile "e" in dashboard "Home" was renamed to "e-d" because another item in the same dashboard already used that id`,
		`Dashboard "d-2" had its id "d" renamed to "d-2" because another dashboard already used that id`,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("notices:\n got %q\nwant %q", got, want)
	}
	// The first occurrence was since deleted: still a clear message.
	gone := migrationNotices([]configdoc.Rename{{Kind: "tile", DashboardID: "zz", OldID: "x", NewID: "x-zz"}},
		configdoc.Obj{"dashboards": []any{}})
	if len(gone) != 1 || !strings.Contains(gone[0], `dashboard "zz"`) || !strings.Contains(gone[0], "already used that id") {
		t.Fatalf("notice without first occurrence: %q", gone)
	}
}
