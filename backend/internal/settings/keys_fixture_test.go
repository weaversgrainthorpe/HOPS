package settings

import (
	"encoding/json"
	"flag"
	"os"
	"reflect"
	"testing"
)

var updateKeysFixture = flag.Bool("update", false, "rewrite testdata/setting_keys.json from Definitions")

// keysFixture is testdata/setting_keys.json: every key in Definitions, in order. The frontend's
// global settings grouping table (M6 §10) is checked against it, so a new setting can never be
// left out of the table unnoticed. See testdata/setting_keys.README.md.
type keysFixture struct {
	Keys []string `json:"keys"`
}

func TestSettingKeysFixture(t *testing.T) {
	want := make([]string, 0, len(Definitions))
	for _, d := range Definitions {
		want = append(want, d.Key)
	}
	const path = "testdata/setting_keys.json"
	if *updateKeysFixture {
		raw, err := json.MarshalIndent(keysFixture{Keys: want}, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, append(raw, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var got keysFixture
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	if len(got.Keys) == 0 {
		t.Fatalf("%s has no keys", path)
	}
	if !reflect.DeepEqual(got.Keys, want) {
		t.Errorf("%s is out of date with Definitions:\n got  %v\n want %v\nregenerate: go test ./internal/settings -run TestSettingKeysFixture -update",
			path, got.Keys, want)
	}
}
