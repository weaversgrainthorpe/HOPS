package converters

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// A Homer, Dashy or Heimdall file, converted and brought to v3 as an import
// does, has no field HOPS does not know: the converters build HOPS's own
// types, so nothing foreign passes through to be reported.
func TestConvertedFilesHaveNoUnknownFields(t *testing.T) {
	cases := map[string]func([]byte) ([]byte, []string, error){
		"homer-homelab.yml":    ConvertFromHomer,
		"homer-upstream.yml":   ConvertFromHomer,
		"dashy-homelab.yml":    ConvertFromDashy,
		"dashy-upstream.yml":   ConvertFromDashy,
		"heimdall-export.json": ConvertFromHeimdall,
	}
	for file, convert := range cases {
		data, err := os.ReadFile("testdata/" + file)
		if err != nil {
			t.Fatal(err)
		}
		out, _, err := convert(data)
		if err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		var doc configdoc.Obj
		if err := json.Unmarshal(out, &doc); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		dashes, _ := doc["dashboards"].([]any)
		if len(dashes) == 0 {
			t.Fatalf("%s: no dashboards", file)
		}
		for _, d := range dashes {
			v3, err := configdoc.ConvertDashboardV2(d.(configdoc.Obj))
			if err != nil {
				t.Fatalf("%s: %v", file, err)
			}
			if fs := configdoc.UnknownFields(v3); len(fs) != 0 {
				t.Errorf("%s: unknown fields %+v", file, fs)
			}
		}
	}
}
