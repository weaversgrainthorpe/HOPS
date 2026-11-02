package configdoc

// The dashboard's "Tile content size" (key contentScale, in %): what is drawn inside every tile and
// minimised folder on the dashboard scales by it; boxes and the grid never change. Missing means
// DefaultContentScale (no migration). Twin of the frontend's contentScale.ts.
const (
	MinContentScale     = 75
	MaxContentScale     = 125
	ContentScaleStep    = 5
	DefaultContentScale = 100
)

// checkContentScale refuses a present contentScale that is not a whole number from 75 to 125 in
// steps of 5 (null, text and fractions included). Run on saves and imports.
func (v *verifier) checkContentScale(id string, d Obj) {
	raw, has := d["contentScale"]
	if !has {
		return
	}
	if n, ok := numberValue(raw); ok && finiteNumber(raw) && n == float64(int(n)) {
		i := int(n)
		if i >= MinContentScale && i <= MaxContentScale && i%ContentScaleStep == 0 {
			return
		}
	}
	v.add("dashboard %q: the tile content size (contentScale) is %s; it must be a whole number from 75 to 125, in steps of 5 (100 is normal)",
		id, trunc(show(raw)))
}
