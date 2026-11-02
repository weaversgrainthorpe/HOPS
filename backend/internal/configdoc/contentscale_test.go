package configdoc

import (
	"strings"
	"testing"
)

// The dashboard's "Tile content size" (contentScale): a whole number from 75 to 125 in steps of 5.
// Missing means 100. Anything else is refused on save and import with a message naming the value.
func TestVerifyDashboard_ContentScale(t *testing.T) {
	cases := []struct {
		name string
		v    any
		set  bool
		ok   bool
	}{
		{"missing means 100", nil, false, true},
		{"75", float64(75), true, true},
		{"100", float64(100), true, true},
		{"125", float64(125), true, true},
		{"110 as int", 110, true, true},
		{"below 75", float64(70), true, false},
		{"above 125", float64(130), true, false},
		{"not a step of 5", float64(102), true, false},
		{"fraction", 97.5, true, false},
		{"string", "100", true, false},
		{"null", nil, true, false},
		{"bool", true, true, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			d := validDashboardForStatusTest()
			d["tabs"] = []any{}
			if c.set {
				d["contentScale"] = c.v
			}
			err := VerifyDashboard(d)
			if c.ok && err != nil {
				t.Fatalf("refused: %v", err)
			}
			if !c.ok {
				if err == nil {
					t.Fatal("accepted")
				}
				if !strings.Contains(err.Error(), "tile content size") || !strings.Contains(err.Error(), "75 to 125") {
					t.Fatalf("unclear message: %v", err)
				}
			}
			// An import checks the same.
			if ierr := VerifyImportedDashboard(d); (ierr == nil) != c.ok {
				t.Fatalf("import: %v", ierr)
			}
		})
	}
}
