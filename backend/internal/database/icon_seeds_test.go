package database

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// Every preset icon (and category icon) seeded from icon_seeds.go must exist in the
// bundled icon name lists, so a name that renders broken cannot ship.
func TestPresetSeedIconsExistInBundledNames(t *testing.T) {
	raw, err := os.ReadFile("../../../frontend/src/lib/icons/icon-names.ts")
	if err != nil {
		t.Fatalf("read icon-names.ts: %v", err)
	}
	src := string(raw)
	i := strings.Index(src, "ICON_NAME_LISTS = ")
	j := strings.LastIndex(src, ";")
	if i < 0 || j < i {
		t.Fatal("icon-names.ts: ICON_NAME_LISTS not found")
	}
	var lists map[string]map[string]string
	if err := json.Unmarshal([]byte(src[i+len("ICON_NAME_LISTS = "):j]), &lists); err != nil {
		t.Fatalf("parse icon-names.ts: %v", err)
	}
	known := map[string]bool{}
	for prefix, kinds := range lists {
		for _, joined := range kinds {
			for _, n := range strings.Split(joined, "\n") {
				known[prefix+":"+n] = true
			}
		}
	}
	if len(known) < 1000 {
		t.Fatalf("only %d icon names parsed; the file format changed?", len(known))
	}

	db := newSchemaDB(t)
	if err := seedIconData(db); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"icons", "icon_categories"} {
		rows, err := db.Query("SELECT id, icon FROM " + table + " WHERE is_preset = 1")
		if err != nil {
			t.Fatal(err)
		}
		n := 0
		for rows.Next() {
			var id, icon string
			if err := rows.Scan(&id, &icon); err != nil {
				t.Fatal(err)
			}
			n++
			if strings.Contains(icon, ":") && !known[icon] {
				t.Errorf("%s %q seeds icon %q, which is not in the bundled icon names", table, id, icon)
			}
		}
		rows.Close()
		if n == 0 {
			t.Errorf("no preset rows in %s", table)
		}
	}
}

func TestSeedRepairsBrokenVirtualServerIcon(t *testing.T) {
	db := newSchemaDB(t)
	if err := seedIconData(db); err != nil {
		t.Fatal(err)
	}
	db.Exec("UPDATE icons SET icon='mdi:virtual-server' WHERE id='virtualization-vm'")
	db.Exec("INSERT INTO icons (id, name, icon, category_id, is_preset) VALUES ('mine','Mine','mdi:virtual-server','virtualization',0)")
	if err := seedIconData(db); err != nil {
		t.Fatal(err)
	}
	var a, b string
	db.QueryRow("SELECT icon FROM icons WHERE id='virtualization-vm'").Scan(&a)
	db.QueryRow("SELECT icon FROM icons WHERE id='mine'").Scan(&b)
	if a != "mdi:monitor-multiple" || b != "mdi:virtual-server" {
		t.Fatalf("preset=%q user=%q", a, b)
	}
}
