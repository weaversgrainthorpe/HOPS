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
// The current form (layoutVersion 2: M5's one folder model, with M6's
// tab-aware folder minimum and fixed shape list):
//   - every tab is a grid tab: its root has RootColumns columns and no
//     `layout` or `designWidth`; a dashboard has no `defaultLayout`;
//   - a tab-level tile is exactly Small 1×1, Medium 2×2 or Large 4×4 cells,
//     matching its `size` (a missing size is Medium); tab-level items never
//     overlap and sit on whole cells inside the RootColumns columns;
//   - a folder has `size` and `contentSize` (small, medium or large), no
//     `layout`, and its content has no `columns`: its children are an
//     ordered list with no placements;
//   - a folder's `shape`, when present, is one of FolderShapes and its
//     `tabPosition`, when present, one of FolderTabPositions (M6 §3a.8);
//   - a tab-level folder's open box is at least FolderMinCellsOf, which
//     counts a tab-height allowance for every shape (M6 §3a.4).
//
// In an export envelope the marker travels inside "config" (the document, or
// {dashboards: [one]} for a single-dashboard export).
const (
	// LayoutVersion is the layout form this build reads and writes.
	LayoutVersion = 2
	// LayoutVersionKey is the document key of the layout-form marker.
	LayoutVersionKey = "layoutVersion"
)

// The open folder's chrome and the narrowest grid cell, in px: the exact twin
// of frontend/src/lib/layout/geometry.ts (FOLDER_CHROME, PAGE_BAR_PX,
// MIN_GRID_CELL_PX). testdata/folder_min_cases.json is run by both suites
// (Ruling 9), so the two minimum tables cannot drift.
const (
	// FolderTitlePx is an open folder's title bar.
	FolderTitlePx = 40
	// FolderTabPx is the tab-height allowance (M6 §3a.4): a tab shape draws
	// its tab above the body. ONE constant for every shape (Rounded too), so
	// the minimum has no shape parameter and a shape change never needs a
	// different minimum table. Twin of geometry.ts FOLDER_CHROME.tabPx.
	FolderTabPx = 24
	// FolderPadPx is an open folder's body padding plus border, each way.
	FolderPadPx = 2*8 + 2*1
	// PageBarPx is the page bar, drawn when a folder has more than one page.
	PageBarPx = 32
	// PhoneBreakpointPx is the width below which a tab stacks (no grid).
	PhoneBreakpointPx = 768
	// MinGridCellPx is the narrowest a tab's grid cell gets.
	MinGridCellPx = PhoneBreakpointPx / RootColumns
)

// sizeOf is a contents size as the client draws it: small or large as given,
// anything else Medium (geometry.ts sizeOf).
func sizeOf(size any) string {
	if s, _ := size.(string); s == "small" || s == "large" {
		return s
	}
	return "medium"
}

func ceilCells(px int) int { return (px + MinGridCellPx - 1) / MinGridCellPx }

// folderChromeYPx is an open folder's height that is not items: its bar, the
// tab allowance, border and padding (the page bar is added where it counts).
const folderChromeYPx = FolderTitlePx + FolderTabPx + FolderPadPx

// FolderMinCells is THE smallest open folder box on a tab, in cells, for
// items of contentSize (M5 §3.5, Ruling 7; M6 §3a.4): its bar, the tab
// allowance, border and padding, ONE item and the page bar, counted at the
// narrowest grid cell so it holds at every grid width. Small 2×5, Medium
// 3×6, Large 5×8, for every shape. Twin of geometry.ts minOpenFolderCells.
func FolderMinCells(contentSize any) (w, h int) {
	span := sizeSpans[sizeOf(contentSize)]
	return span + ceilCells(FolderPadPx), span + ceilCells(folderChromeYPx+PageBarPx)
}

// LargestContentSize is the largest contents size of folder and every folder
// inside it, however deep (a drilled-into sub-folder is drawn in the same open
// box). Tiles' sizes do not count. Twin of geometry.ts largestContentSize.
func LargestContentSize(folder Obj) string {
	best := sizeOf(folder["contentSize"])
	var walk func(f Obj)
	walk = func(f Obj) {
		content, _ := f["content"].(Obj)
		kids, _ := content["children"].([]any)
		for _, k := range kids {
			sub, _ := k.(Obj)
			if sub == nil || sub["kind"] != "folder" {
				continue
			}
			if s := sizeOf(sub["contentSize"]); sizeSpans[s] > sizeSpans[best] {
				best = s
			}
			walk(sub)
		}
	}
	walk(folder)
	return best
}

// FolderMinCellsOf is the smallest open box of folder on a tab: FolderMinCells
// at its largest contents size. Twin of geometry.ts folderMinCells.
func FolderMinCellsOf(folder Obj) (w, h int) {
	return FolderMinCells(LargestContentSize(folder))
}

// FolderWidthFor is the open box width, in cells, that holds perRow items of
// contentSize to a row at every grid width: the items and the padding.
func FolderWidthFor(contentSize any, perRow int) int {
	return max(1, perRow)*sizeSpans[sizeOf(contentSize)] + ceilCells(FolderPadPx)
}

// FolderBoxFor is the open box, in cells, of folder holding its n items all on
// page 1 at every grid width (the narrowest cell is the worst case), given a
// wanted width w: w is raised to the minimum and capped at RootColumns, the
// items fill it row by row, and the height takes as many rows as they need
// plus the chrome rows. Never below FolderMinCellsOf(folder) either way.
func FolderBoxFor(folder Obj, n, w int) (int, int) {
	span := sizeSpans[sizeOf(folder["contentSize"])]
	mw, mh := FolderMinCellsOf(folder)
	w = min(RootColumns, max(w, mw))
	fit := max(1, (w*MinGridCellPx-FolderPadPx)/(span*MinGridCellPx))
	rows := max(1, (n+fit-1)/fit)
	h := rows*span + ceilCells(folderChromeYPx+PageBarPx)
	return w, max(h, mh)
}

// FolderShapes is the fixed list of folder shapes (M6 §2, §3.9): Rounded,
// Simple tab and the five real-folder looks. A shape is only ever one of
// these names, never user-supplied markup; anything else is refused on save
// and import (§3a.8). Twin of the frontend's FolderShape union.
var FolderShapes = []string{"rounded", "simple-tab", "folder-flat", "folder-paper", "folder-outline", "folder-cartoon", "folder-open"}

// FolderTabPositions is where a tab shape's tab sits (M6 §3.2). Absent means
// left.
var FolderTabPositions = []string{"left", "centre", "right"}

// Default shapes (M6 §3a.5): folders made in HOPS (new, merge, Discovery
// promote) start Flat; converted folders (v2, Homer, Dashy, Heimdall) are
// Rounded, except v2 folder-style groups, which are Flat (§3a.1).
const (
	ShapeCreated   = "folder-flat"
	ShapeConverted = "rounded"
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
