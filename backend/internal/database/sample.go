package database

import (
	_ "embed"
	"encoding/json"
	"fmt"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// SampleConfig is the configuration a fresh install starts with (and a
// factory reset restores): one native v3 dashboard, /sample, derived from the
// v3 Showcase. It shows tabs, folders of every shape, folders whose contents
// are small/medium/large, nested folders, minimised folders, tiles of each
// size and packaged background pictures. Every host is *.example.lan and
// every icon is in the offline bundle (TestSample_* assert both), so it
// renders with no internet and points at nothing real.
//
//go:embed sample.json
var SampleConfig string

// SampleDoc returns a fresh, verified copy of the Sample document.
func SampleDoc() (configdoc.Obj, error) { return parseSample(SampleConfig) }

// parseSample decodes raw as a v3 document and verifies it as the store and
// import paths do: schemaVersion 3, the current layout version, unique ids,
// and every dashboard well-formed (placements, folder minimums, tile URLs,
// size bounds). Anything else is an error; nothing is ever silently fixed.
func parseSample(raw string) (configdoc.Obj, error) {
	var doc configdoc.Obj
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		return nil, fmt.Errorf("default config is not valid JSON: %w", err)
	}
	if err := configdoc.VerifyIDs(doc); err != nil {
		return nil, fmt.Errorf("default config verification failed: %w", err)
	}
	if err := configdoc.CheckLayoutVersion(doc); err != nil {
		return nil, fmt.Errorf("default config verification failed: %w", err)
	}
	ds, _ := doc["dashboards"].([]any)
	if len(ds) == 0 {
		return nil, fmt.Errorf("default config verification failed: no dashboards")
	}
	for _, d := range ds {
		dash, ok := d.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("default config verification failed: a dashboard is not an object")
		}
		if err := configdoc.VerifyDashboard(dash); err != nil {
			return nil, fmt.Errorf("default config verification failed: %w", err)
		}
	}
	return doc, nil
}
