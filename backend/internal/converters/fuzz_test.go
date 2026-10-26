package converters

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// §3 security pass: config import (HOPS v2/v3 JSON or YAML, Homer, Dashy,
// Heimdall) is fuzzed through the same steps as POST /api/config/import:
// limits, format detection, conversion, then the configdoc conversion and
// verification of every dashboard. Any input must give a result or an error,
// never a panic. Seeds are synthetic (never real exports). Run as a normal
// test, the seeds are checked.
func FuzzImport(f *testing.F) {
	for _, name := range []string{"v2_basic.json", "v2_dup_ids.json", "v2_messy.json", "v3_showcase_export.json"} {
		b, err := os.ReadFile("../configdoc/testdata/" + name)
		if err != nil {
			f.Fatal(err)
		}
		f.Add(b)
	}
	f.Add([]byte("title: Home\nservices:\n  - name: Apps\n    icon: fas fa-cloud\n    items:\n      - name: Proxmox\n        url: https://pve.example\n        logo: assets/pve.png\n"))
	f.Add([]byte("pageInfo:\n  title: Dash\nsections:\n  - name: Media\n    icon: hl-plex\n    items:\n      - title: Plex\n        url: http://plex.example\n        icon: si-plex\n        tags: [a]\n"))
	f.Add([]byte(`[{"title":"Sonarr","url":"http://sonarr.example","colour":"#123456","icon":"sonarr.png"}]`))
	f.Add([]byte("format: hops-export\nschemaVersion: 3\nconfig:\n  dashboards: []\n"))
	f.Add([]byte("a: &a [x, x]\nb: &b [*a, *a]\nservices: [*b, *b]\n"))
	f.Fuzz(func(t *testing.T, data []byte) {
		if err := CheckImportLimits(data); err != nil {
			return
		}
		format, err := DetectFormat(data)
		// Every converter must cope with any input, whatever it was detected as.
		outs := map[string][]byte{}
		if b, err := ConvertFromHomer(data); err == nil {
			outs["homer"] = b
		}
		if b, err := ConvertFromDashy(data); err == nil {
			outs["dashy"] = b
		}
		if b, err := ConvertFromHeimdall(data); err == nil {
			outs["heimdall"] = b
		}
		if err != nil {
			return
		}
		var cfg configdoc.Obj
		switch format {
		case "hops":
			_ = json.Unmarshal(data, &cfg)
		case "hops-v3":
			var env struct {
				Config configdoc.Obj `json:"config"`
			}
			_ = json.Unmarshal(data, &env)
			cfg = env.Config
		default:
			b, ok := outs[format]
			if !ok {
				return
			}
			if err := json.Unmarshal(b, &cfg); err != nil {
				t.Fatalf("%s converter produced invalid JSON: %v", format, err)
			}
		}
		dashes, _ := cfg["dashboards"].([]any)
		for _, d := range dashes {
			dm, ok := d.(configdoc.Obj)
			if !ok {
				continue
			}
			if format == "hops-v3" {
				_ = configdoc.VerifyImportedDashboard(dm)
				continue
			}
			if v3, sizes, err := configdoc.ConvertDashboardV2Full(dm); err == nil {
				_ = configdoc.VerifyMigrationFull(configdoc.Obj{"dashboards": []any{dm}},
					configdoc.Obj{"schemaVersion": configdoc.SchemaVersion, configdoc.LayoutVersionKey: configdoc.LayoutVersion, "dashboards": []any{v3}}, nil, sizes)
			}
		}
	})
}

func TestImportLimits(t *testing.T) {
	deepJSON := strings.Repeat("[", MaxImportDepth+1) + strings.Repeat("]", MaxImportDepth+1)
	okJSON := `{"dashboards":` + strings.Repeat("[", MaxImportDepth-1) + strings.Repeat("]", MaxImportDepth-1) + `}`
	manyJSON := "[" + strings.Repeat("1,", MaxImportNodes) + "1]"
	deepYAML := "services: " + strings.Repeat("[", MaxImportDepth+1) + strings.Repeat("]", MaxImportDepth+1) + "\n"
	var block strings.Builder
	for i := 0; i <= MaxImportDepth; i++ {
		block.WriteString(strings.Repeat("  ", i) + "k:\n")
	}
	block.WriteString(strings.Repeat("  ", MaxImportDepth+1) + "v\n")
	// "Billion laughs": nine levels, each nine aliases of the one before.
	var laughs strings.Builder
	laughs.WriteString("a0: &a0 [lol]\n")
	for i := 1; i <= 9; i++ {
		refs := make([]string, 9)
		for j := range refs {
			refs[j] = fmt.Sprintf("*a%d", i-1)
		}
		fmt.Fprintf(&laughs, "a%d: &a%d [%s]\n", i, i, strings.Join(refs, ", "))
	}
	laughs.WriteString("services: *a9\n")
	selfRef := "a: &a\n  b: *a\nservices: *a\n"

	refused := map[string]string{
		"deep JSON": deepJSON, "many JSON values": manyJSON, "deep YAML flow": deepYAML,
		"deep YAML block": block.String(), "alias bomb": laughs.String(), "self-referencing alias": selfRef,
	}
	for name, doc := range refused {
		err := CheckImportLimits([]byte(doc))
		if !errors.Is(err, ErrImportTooLarge) {
			t.Errorf("%s: want ErrImportTooLarge, got %v", name, err)
		}
		if _, err := DetectFormat([]byte(doc)); !errors.Is(err, ErrImportTooLarge) {
			t.Errorf("%s: DetectFormat: want ErrImportTooLarge, got %v", name, err)
		}
	}
	if _, err := ConvertFromHomer([]byte(laughs.String())); !errors.Is(err, ErrImportTooLarge) {
		t.Errorf("Homer alias bomb: %v", err)
	}
	if _, err := ConvertFromDashy([]byte(strings.Replace(laughs.String(), "services:", "sections:", 1))); !errors.Is(err, ErrImportTooLarge) {
		t.Errorf("Dashy alias bomb: %v", err)
	}
	if _, err := ConvertFromHeimdall([]byte(deepJSON)); !errors.Is(err, ErrImportTooLarge) {
		t.Errorf("Heimdall deep: %v", err)
	}
	// Within the caps, and every synthetic testdata file, passes.
	if err := CheckImportLimits([]byte(okJSON)); err != nil {
		t.Errorf("depth at the cap refused: %v", err)
	}
	for _, name := range []string{"v2_basic.json", "v2_messy.json", "v3_showcase_export.json"} {
		b, _ := os.ReadFile("../configdoc/testdata/" + name)
		if err := CheckImportLimits(b); err != nil {
			t.Errorf("%s refused: %v", name, err)
		}
	}
	if err := CheckImportLimits([]byte("a: &x [1, 2]\nb: *x\nservices: []\n")); err != nil {
		t.Errorf("a modest alias refused: %v", err)
	}
}
