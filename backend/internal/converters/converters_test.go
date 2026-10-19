package converters

import (
	"os"
	"testing"
)

func TestDetectFormat(t *testing.T) {
	v3 := `{"format":"hops-export","schemaVersion":3,"config":{"dashboards":[]}}`
	v3yaml := "format: hops-export\nschemaVersion: 3\nconfig:\n  dashboards: []\n"
	cases := []struct{ name, in, want string }{
		{"v3 json", v3, "hops-v3"},
		{"v3 yaml", v3yaml, "hops-v3"},
		{"v2 hops", `{"dashboards":[]}`, "hops"},
		{"wrong version", `{"format":"hops-export","schemaVersion":4,"config":{}}`, ""},
		{"homer", "services: []\n", "homer"},
		{"dashy", "sections: []\n", "dashy"},
		{"heimdall", `[{"title":"a","url":"b"}]`, "heimdall"},
	}
	for _, tc := range cases {
		got, err := DetectFormat([]byte(tc.in))
		if tc.want == "" {
			if err == nil {
				t.Errorf("%s: want error, got %q", tc.name, got)
			}
			continue
		}
		if err != nil || got != tc.want {
			t.Errorf("%s: got %q, %v want %q", tc.name, got, err, tc.want)
		}
	}
}

func TestDetectFormat_RealV2Exports(t *testing.T) {
	for _, f := range []string{"real_sample.json", "real_weavers.json"} {
		data, err := os.ReadFile("../configdoc/testdata/" + f)
		if err != nil {
			t.Fatal(err)
		}
		if got, err := DetectFormat(data); err != nil || got != "hops" {
			t.Errorf("%s: %q, %v", f, got, err)
		}
	}
}
