package configdoc

import (
	"reflect"
	"testing"
)

func migrateRenaming(t *testing.T, v2 Obj) (Obj, []Rename) {
	t.Helper()
	before := snapshot(t, v2)
	doc, renames, err := MigrateV2Renaming(v2)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot(t, v2) != before {
		t.Fatal("MigrateV2Renaming mutated its input")
	}
	return doc, renames
}

func wantRenames(t *testing.T, got, want []Rename) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("renames:\n got %+v\nwant %+v", got, want)
	}
}

// The real dev-data shape: dashboards `sample` and `heimdall` both carry tab
// "main" and group "services".
func TestMigrateV2Renaming_DevShape(t *testing.T) {
	v2 := loadJSON(t, "testdata/v2_dup_ids.json")
	doc, renames := migrateRenaming(t, v2)
	wantRenames(t, renames, []Rename{
		{Path: "dashboards[1].tabs[0]", Kind: "tab", DashboardID: "heimdall", OldID: "main", NewID: "main-heimdall"},
		{Path: "dashboards[1].tabs[0].groups[0]", Kind: "folder", DashboardID: "heimdall", OldID: "services", NewID: "services-heimdall"},
	})
	ds := list(t, doc, "dashboards")
	if id := list(t, ds[0], "tabs")[0]["id"]; id != "main" {
		t.Errorf("first tab id = %v, want main kept", id)
	}
	if id := children(t, list(t, ds[0], "tabs")[0]["root"].(Obj))[0]["id"]; id != "services" {
		t.Errorf("first folder id = %v, want services kept", id)
	}
	tab := list(t, ds[1], "tabs")[0]
	if tab["id"] != "main-heimdall" {
		t.Errorf("second tab id = %v", tab["id"])
	}
	if f := children(t, tab["root"].(Obj))[0]; f["id"] != "services-heimdall" || f["name"] != "Services" {
		t.Errorf("second folder = %v/%v", f["id"], f["name"])
	}
	if err := VerifyMigration(v2, doc, renames); err != nil {
		t.Fatalf("VerifyMigration: %v", err)
	}
	if err := VerifyIDs(doc); err != nil {
		t.Fatalf("VerifyIDs: %v", err)
	}
	// MigrateV2 renames too (ResetConfig and startup go through it).
	plain, err := MigrateV2(v2)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot(t, plain) != snapshot(t, doc) {
		t.Fatal("MigrateV2 and MigrateV2Renaming disagree")
	}
	// Deterministic.
	again, renames2 := migrateRenaming(t, v2)
	if snapshot(t, again) != snapshot(t, doc) || !reflect.DeepEqual(renames, renames2) {
		t.Fatal("rename is not deterministic")
	}
}

func TestMigrateV2Renaming_NoDuplicatesNoRenames(t *testing.T) {
	v2 := loadJSON(t, "testdata/v2_basic.json")
	doc, renames := migrateRenaming(t, v2)
	if len(renames) != 0 {
		t.Fatalf("renames = %+v, want none", renames)
	}
	if err := VerifyMigration(v2, doc, nil); err != nil {
		t.Fatal(err)
	}
}

func TestMigrateV2Renaming_DuplicateInsideOneDashboard(t *testing.T) {
	v2 := Obj{"dashboards": []any{Obj{"id": "d1", "tabs": []any{
		Obj{"id": "t", "groups": []any{
			Obj{"id": "g1", "entries": []any{Obj{"id": "e", "name": "A"}}},
			Obj{"id": "g2", "entries": []any{Obj{"id": "e", "name": "B"}, Obj{"id": "e", "name": "C"}}},
		}},
		Obj{"id": "t", "groups": []any{}},
	}}}}
	doc, renames := migrateRenaming(t, v2)
	wantRenames(t, renames, []Rename{
		{Path: "dashboards[0].tabs[0].groups[1].entries[0]", Kind: "tile", DashboardID: "d1", OldID: "e", NewID: "e-d1"},
		{Path: "dashboards[0].tabs[0].groups[1].entries[1]", Kind: "tile", DashboardID: "d1", OldID: "e", NewID: "e-d1-2"},
		{Path: "dashboards[0].tabs[1]", Kind: "tab", DashboardID: "d1", OldID: "t", NewID: "t-d1"},
	})
	if _, tile, _ := FindTile(doc, "e-d1-2"); tile["name"] != "C" {
		t.Fatalf("e-d1-2 = %v", tile)
	}
	if err := VerifyMigration(v2, doc, renames); err != nil {
		t.Fatal(err)
	}
}

func TestMigrateV2Renaming_DuplicateDashboardID(t *testing.T) {
	dash := func(name string) Obj {
		return Obj{"id": "d", "name": name, "tabs": []any{Obj{"id": "t-" + name, "groups": []any{}}}}
	}
	v2 := Obj{"dashboards": []any{dash("a"), dash("b"), dash("c"),
		Obj{"id": "x", "tabs": []any{Obj{"id": "t-a", "groups": []any{}}}}}}
	doc, renames := migrateRenaming(t, v2)
	wantRenames(t, renames, []Rename{
		{Path: "dashboards[1]", Kind: "dashboard", DashboardID: "d-2", OldID: "d", NewID: "d-2"},
		{Path: "dashboards[2]", Kind: "dashboard", DashboardID: "d-3", OldID: "d", NewID: "d-3"},
		{Path: "dashboards[3].tabs[0]", Kind: "tab", DashboardID: "x", OldID: "t-a", NewID: "t-a-x"},
	})
	if err := VerifyMigration(v2, doc, renames); err != nil {
		t.Fatal(err)
	}
}

// A renamed child of a renamed dashboard is suffixed with the dashboard's new id.
func TestMigrateV2Renaming_ChildOfRenamedDashboard(t *testing.T) {
	dash := func() Obj { return Obj{"id": "d", "tabs": []any{Obj{"id": "t", "groups": []any{}}}} }
	v2 := Obj{"dashboards": []any{dash(), dash()}}
	doc, renames := migrateRenaming(t, v2)
	wantRenames(t, renames, []Rename{
		{Path: "dashboards[1]", Kind: "dashboard", DashboardID: "d-2", OldID: "d", NewID: "d-2"},
		{Path: "dashboards[1].tabs[0]", Kind: "tab", DashboardID: "d-2", OldID: "t", NewID: "t-d-2"},
	})
	if err := VerifyMigration(v2, doc, renames); err != nil {
		t.Fatal(err)
	}
}

// `<old>-<dash>` is taken by an existing id (even one appearing later), so
// the rename gets `-2`; the existing id keeps its name.
func TestMigrateV2Renaming_SuffixCollision(t *testing.T) {
	v2 := Obj{"dashboards": []any{
		Obj{"id": "x", "tabs": []any{Obj{"id": "main", "groups": []any{}}}},
		Obj{"id": "y", "tabs": []any{
			Obj{"id": "main", "groups": []any{}},
			Obj{"id": "main-y", "groups": []any{}},
		}},
	}}
	doc, renames := migrateRenaming(t, v2)
	wantRenames(t, renames, []Rename{
		{Path: "dashboards[1].tabs[0]", Kind: "tab", DashboardID: "y", OldID: "main", NewID: "main-y-2"},
	})
	if id := list(t, list(t, doc, "dashboards")[1], "tabs")[1]["id"]; id != "main-y" {
		t.Fatalf("existing main-y renamed to %v", id)
	}
	if err := VerifyMigration(v2, doc, renames); err != nil {
		t.Fatal(err)
	}
}

// A v3 document that still holds the duplicates fails plain Verify, and the
// problem names both dashboards.
func TestVerify_DuplicateNamesDashboards(t *testing.T) {
	v2 := loadJSON(t, "testdata/v2_dup_ids.json")
	var out []any
	for _, d := range list(t, v2, "dashboards") {
		nd, err := ConvertDashboardV2(d)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, nd)
	}
	v3 := Obj{"schemaVersion": 3, "dashboards": out, "theme": v2["theme"], "settings": v2["settings"]}
	wantProblem(t, Verify(v2, v3), `duplicate id "main"`, `dashboard "sample"`, `dashboard "heimdall"`)
	wantProblem(t, VerifyIDs(v3), `duplicate id "services"`, `dashboard "sample"`, `dashboard "heimdall"`)
}

func TestVerifyMigration_RejectsBadRenames(t *testing.T) {
	v2 := loadJSON(t, "testdata/v2_dup_ids.json")
	doc, renames := migrateRenaming(t, v2)

	// Without the rename list the renamed objects do not pair up.
	wantProblem(t, Verify(v2, doc), "main")

	// A rename pointing at the wrong path (the first occurrence) is rejected,
	// even though the new id exists in v3.
	wrong := append([]Rename(nil), renames...)
	wrong[0].Path = "dashboards[0].tabs[0]"
	wantProblem(t, VerifyMigration(v2, doc, wrong), "dashboards[0].tabs[0]")

	// A rename whose path matches nothing in v2.
	extra := append(append([]Rename(nil), renames...),
		Rename{Path: "dashboards[7].tabs[0]", Kind: "tab", DashboardID: "z", OldID: "main", NewID: "main-z"})
	wantProblem(t, VerifyMigration(v2, doc, extra), "dashboards[7].tabs[0]")

	// OldID must be the v2 object's id.
	badOld := append([]Rename(nil), renames...)
	badOld[0].OldID = "other"
	wantProblem(t, VerifyMigration(v2, doc, badOld), "other")

	// Wrong kind for the level.
	badKind := append([]Rename(nil), renames...)
	badKind[0].Kind = "tile"
	wantProblem(t, VerifyMigration(v2, doc, badKind), "kind")

	// A rename of an id that was not duplicated is not a legitimate rename.
	tamper, _ := migrateRenaming(t, v2)
	list(t, list(t, tamper, "dashboards")[0], "tabs")[0]["id"] = "renamed-sample"
	bogus := append(append([]Rename(nil), renames...),
		Rename{Path: "dashboards[0].tabs[0]", Kind: "tab", DashboardID: "sample", OldID: "main", NewID: "renamed-sample"})
	// The first occurrence of a duplicated id must keep it.
	wantProblem(t, VerifyMigration(v2, tamper, bogus), "dashboards[0].tabs[0]")

	tooNew := Obj{"dashboards": []any{Obj{"id": "solo", "tabs": []any{Obj{"id": "only", "groups": []any{}}}}}}
	soloDoc, _ := migrateRenaming(t, tooNew)
	list(t, list(t, soloDoc, "dashboards")[0], "tabs")[0]["id"] = "only-solo"
	wantProblem(t, VerifyMigration(tooNew, soloDoc, []Rename{
		{Path: "dashboards[0].tabs[0]", Kind: "tab", DashboardID: "solo", OldID: "only", NewID: "only-solo"},
	}), "not duplicated")

	// The renamed object's v3 id must equal NewID.
	moved, _ := migrateRenaming(t, v2)
	list(t, list(t, moved, "dashboards")[1], "tabs")[0]["id"] = "main-elsewhere"
	wantProblem(t, VerifyMigration(v2, moved, renames), "main-heimdall")

	// Every other key of a renamed object is still compared.
	changed, _ := migrateRenaming(t, v2)
	list(t, list(t, changed, "dashboards")[1], "tabs")[0]["name"] = "Hacked"
	wantProblem(t, VerifyMigration(v2, changed, renames), "main-heimdall", "name")
}
