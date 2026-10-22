package configdoc

import (
	"fmt"
	"math"
)

// The stored layout form (M5 spec §2a). One integer, layoutVersion, at the
// top of the document marks the form the stored layout is in; it is bumped
// whenever that form changes. There is no v3→v3 update: v3 was never
// released, so the only data that is ever converted is v2 (and Homer, Dashy
// and Heimdall imports), and the converter writes the current form directly.
// Anything at another layoutVersion is refused visibly, never guessed at.
//
// The current form (layoutVersion 1, the one folder model):
//   - every tab is a grid tab: its root has RootColumns columns and no
//     `layout` or `designWidth`; a dashboard has no `defaultLayout`;
//   - a tab-level tile is exactly Small 1×1, Medium 2×2 or Large 4×4 cells,
//     matching its `size` (a missing size is Medium); tab-level items never
//     overlap and sit on whole cells inside the RootColumns columns;
//   - a folder has `size` and `contentSize` (small, medium or large), no
//     `layout`, and its content has no `columns`: its children are an
//     ordered list with no placements.
//
// In an export envelope the marker travels inside "config" (the document, or
// {dashboards: [one]} for a single-dashboard export).
const (
	// LayoutVersion is the layout form this build reads and writes.
	LayoutVersion = 1
	// LayoutVersionKey is the document key of the layout-form marker.
	LayoutVersionKey = "layoutVersion"
	// FolderTitleRows is a converted folder's title row, in grid cells.
	FolderTitleRows = 2
)

// sizeSpans is the side, in grid cells, of each standard size.
var sizeSpans = map[string]int{"small": 1, "medium": 2, "large": 4}

// SizeSpan returns the side in grid cells of a tile size: Small 1, Medium 2,
// Large 4. A missing (nil) or empty size is Medium (v2's Entry.size has no
// omitempty, so "" is its zero value). Any other value is not a size.
func SizeSpan(size any) (int, bool) {
	if size == nil || size == "" {
		return sizeSpans["medium"], true
	}
	s, _ := size.(string)
	n, ok := sizeSpans[s]
	return n, ok
}

// LayoutVersionOf returns the document's layoutVersion when it is a whole
// number; ok is false when it is missing or not a whole number.
func LayoutVersionOf(doc Obj) (int, bool) {
	f, ok := numberValue(doc[LayoutVersionKey])
	if !ok || math.IsNaN(f) || math.IsInf(f, 0) || f != math.Trunc(f) {
		return 0, false
	}
	return int(f), true
}

// CheckLayoutVersion returns nil when doc carries this build's layoutVersion,
// else an error that names both versions (or says the marker is missing).
func CheckLayoutVersion(doc Obj) error {
	raw, has := doc[LayoutVersionKey]
	if !has {
		return fmt.Errorf("it has no %s (it comes from a pre-release HOPS v3 build); this HOPS reads layout version %d", LayoutVersionKey, LayoutVersion)
	}
	if n, ok := LayoutVersionOf(doc); !ok || n != LayoutVersion {
		return fmt.Errorf("it is at layout version %s; this HOPS reads layout version %d", trunc(show(raw)), LayoutVersion)
	}
	return nil
}
