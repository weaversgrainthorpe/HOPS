package configdoc

import (
	"encoding/json"
	"os"
	"testing"
)

// §3 security pass: the v2→v3 migration and the verifiers are fuzzed with
// arbitrary JSON documents. Any input must give a document or an error,
// never a panic. Seeds are the synthetic testdata documents (never real
// exports). Run as a normal test, the seeds are checked.
func FuzzMigrateVerify(f *testing.F) {
	for _, name := range []string{"v2_basic.json", "v2_dup_ids.json", "v2_messy.json", "v3_showcase_export.json", "folder_min_cases.json", "status_checks_cases.json"} {
		b, err := os.ReadFile("testdata/" + name)
		if err != nil {
			f.Fatal(err)
		}
		f.Add(b)
	}
	f.Add([]byte(`{"dashboards":null}`))
	f.Add([]byte(`{"dashboards":[{"tabs":[{"groups":[{"items":[{"size":7}]}]}]}]}`))
	f.Add([]byte(`{"schemaVersion":3,"layoutVersion":2,"dashboards":[{"id":"a","path":"/a","tabs":[{"id":"t","items":[{"id":"f","type":"folder","children":[]}]}]}]}`))
	f.Fuzz(func(t *testing.T, data []byte) {
		var doc Obj
		if json.Unmarshal(data, &doc) != nil || doc == nil {
			return
		}
		// The v3 export envelope's config, as the import reads it.
		if c, ok := doc["config"].(Obj); ok {
			doc = c
		}
		_ = VerifyIDs(doc)
		_ = CheckLayoutVersion(doc)
		if dashes, ok := doc["dashboards"].([]any); ok {
			for _, d := range dashes {
				dm, ok := d.(Obj)
				if !ok {
					continue
				}
				_ = VerifyImportedDashboard(dm)
				_ = VerifyDashboard(dm)
				if v3, sizes, err := ConvertDashboardV2Full(dm); err == nil {
					_ = VerifyMigrationFull(Obj{"dashboards": []any{dm}},
						Obj{"schemaVersion": SchemaVersion, LayoutVersionKey: LayoutVersion, "dashboards": []any{v3}}, nil, sizes)
				}
			}
		}
		v3, renames, sizes, err := MigrateV2Full(doc)
		if err != nil {
			return
		}
		if v3 == nil {
			t.Fatal("migration succeeded without a document")
		}
		_ = VerifyMigrationFull(doc, v3, renames, sizes)
	})
}
