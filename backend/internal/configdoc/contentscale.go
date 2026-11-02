package configdoc

import "fmt"

// The dashboard's "Tile content size" (key contentScale, in %): what is drawn inside every tile and
// minimised folder on the dashboard scales by it; boxes and the grid never change. Missing means
// DefaultContentScale (no migration). Twin of the frontend's contentScale.ts.
const (
	MinContentScale     = 75
	MaxContentScale     = 125
	ContentScaleStep    = 5
	DefaultContentScale = 100
)

// contentScaleProblem says why a present contentScale is refused (not a whole number from 75 to 125 in
// steps of 5: null, text and fractions included), or "". It is part of wholeProblems, so a save, an
// import and a backup restore all refuse it.
func contentScaleProblem(id string, d Obj) string {
	raw, has := d["contentScale"]
	if !has {
		return ""
	}
	if n, ok := numberValue(raw); ok && finiteNumber(raw) && n == float64(int(n)) {
		i := int(n)
		if i >= MinContentScale && i <= MaxContentScale && i%ContentScaleStep == 0 {
			return ""
		}
	}
	return fmt.Sprintf("dashboard %q: the tile content size (contentScale) is %s; it must be a whole number from 75 to 125, in steps of 5 (100 is normal)",
		id, trunc(show(raw)))
}
