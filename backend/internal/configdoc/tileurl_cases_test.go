package configdoc

import (
	"encoding/json"
	"os"
	"testing"
)

// TestValidTileURL_SharedCases runs testdata/tile_url_cases.json, which the
// frontend's isValidUrl test runs too, so the tile dialog refuses exactly
// what a save would.
func TestValidTileURL_SharedCases(t *testing.T) {
	b, err := os.ReadFile("testdata/tile_url_cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Cases []struct {
			URL   string `json:"url"`
			Valid bool   `json:"valid"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) == 0 {
		t.Fatal("no cases in tile_url_cases.json")
	}
	for _, c := range f.Cases {
		if got := ValidTileURL(c.URL); got != c.Valid {
			t.Errorf("ValidTileURL(%q) = %v, want %v", c.URL, got, c.Valid)
		}
	}
}
