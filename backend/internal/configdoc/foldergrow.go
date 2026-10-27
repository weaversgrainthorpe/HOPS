package configdoc

import (
	"fmt"
	"math"
	"sort"
)

// FolderGrowth records one tab-level folder whose stored open box was below
// its minimum (FolderMinCellsOf) and was enlarged on import. Never silent:
// the import result lists every one.
type FolderGrowth struct {
	DashboardID string
	TabID       string
	FolderID    string
	FolderName  string
	OldW, OldH  int
	NewW, NewH  int
}

// String is the import result's line for g.
func (g FolderGrowth) String() string {
	name := g.FolderName
	if name == "" {
		name = "Untitled"
	}
	return fmt.Sprintf("Folder %q was smaller than it can be drawn (%d×%d); it was enlarged to %d×%d", trunc(name), g.OldW, g.OldH, g.NewW, g.NewH)
}

// GrowFolderMinimums enlarges, in place, every tab-level folder of dashboard d
// whose open box is below its minimum (FolderMinCellsOf — which already counts
// every nested folder's contents size), pushing the neighbours it now overlaps
// aside by the editor's rules (treeOps.ts pushAside: nearest free column, then
// further down). It returns each folder it grew. Placements that are not whole
// numbers, or a minimum wider than the tab, are left as they are for the
// verifier to refuse with the reason.
func GrowFolderMinimums(d Obj) []FolderGrowth {
	var out []FolderGrowth
	dashID, _ := d["id"].(string)
	tabs, _ := d["tabs"].([]any)
	for _, t := range tabs {
		tm, _ := t.(Obj)
		root, _ := tm["root"].(Obj)
		kids, _ := root["children"].([]any)
		for fi, k := range kids {
			f, _ := k.(Obj)
			if f == nil || f["kind"] != "folder" {
				continue
			}
			x, y, w, h, ok := intRect(f["placement"])
			if !ok {
				continue
			}
			mw, mh := FolderMinCellsOf(f)
			if (w >= mw && h >= mh) || mw > RootColumns {
				continue
			}
			nw, nh := max(w, mw), max(h, mh)
			nx := min(x, RootColumns-nw)
			setRect(f, nx, y, nw, nh)
			pushAside(kids, fi, [4]int{nx, y, nw, nh})
			tabID, _ := tm["id"].(string)
			fid, _ := f["id"].(string)
			name, _ := f["name"].(string)
			out = append(out, FolderGrowth{DashboardID: dashID, TabID: tabID, FolderID: fid, FolderName: name,
				OldW: w, OldH: h, NewW: nw, NewH: nh})
		}
	}
	return out
}

// intRect is a placement's whole-number x, y, w, h.
func intRect(p any) (x, y, w, h int, ok bool) {
	pm, _ := p.(Obj)
	if pm == nil {
		return 0, 0, 0, 0, false
	}
	var v [4]int
	for i, key := range []string{"x", "y", "w", "h"} {
		n, isNum := numberValue(pm[key])
		if !isNum || n != math.Trunc(n) || math.Abs(n) > 1e6 {
			return 0, 0, 0, 0, false
		}
		v[i] = int(n)
	}
	return v[0], v[1], v[2], v[3], true
}

func setRect(n Obj, x, y, w, h int) {
	p, _ := n["placement"].(Obj)
	np := Obj{}
	for k, v := range p {
		np[k] = v
	}
	np["x"], np["y"], np["w"], np["h"] = x, y, w, h
	n["placement"] = np
}

func rectsOverlap(a, b [4]int) bool {
	return a[0] < b[0]+b[2] && b[0] < a[0]+a[2] && a[1] < b[1]+b[3] && b[1] < a[1]+a[3]
}

// pushAside moves every placed sibling of mover that overlaps target to the
// nearest free spot at or below its row (twin of treeOps.ts pushAside).
func pushAside(kids []any, mover int, target [4]int) {
	type other struct {
		n Obj
		i int
		p [4]int
	}
	var others []other
	for i, k := range kids {
		n, _ := k.(Obj)
		if n == nil || i == mover {
			continue
		}
		x, y, w, h, ok := intRect(n["placement"])
		if !ok {
			continue
		}
		others = append(others, other{n, i, [4]int{x, y, w, h}})
	}
	sort.SliceStable(others, func(a, b int) bool {
		pa, pb := others[a].p, others[b].p
		if pa[1] != pb[1] {
			return pa[1] < pb[1]
		}
		if pa[0] != pb[0] {
			return pa[0] < pb[0]
		}
		return others[a].i < others[b].i
	})
	occupied := [][4]int{target}
	var displaced []other
	for _, o := range others {
		if rectsOverlap(o.p, target) {
			displaced = append(displaced, o)
		} else {
			occupied = append(occupied, o.p)
		}
	}
	for _, o := range displaced {
		orig := o.p
		var xs []int
		for x := 0; x+orig[2] <= RootColumns; x++ {
			xs = append(xs, x)
		}
		sort.SliceStable(xs, func(a, b int) bool {
			da, db := absInt(xs[a]-orig[0]), absInt(xs[b]-orig[0])
			if da != db {
				return da < db
			}
			return xs[a] > xs[b]
		})
		if len(xs) == 0 { // wider than the tab: left for the verifier
			continue
		}
		var final [4]int
	search:
		for y := orig[1]; ; y++ {
			for _, x := range xs {
				cand := [4]int{x, y, orig[2], orig[3]}
				free := true
				for _, oc := range occupied {
					if rectsOverlap(cand, oc) {
						free = false
						break
					}
				}
				if free {
					final = cand
					break search
				}
			}
		}
		occupied = append(occupied, final)
		setRect(o.n, final[0], final[1], final[2], final[3])
	}
}

func absInt(a int) int {
	if a < 0 {
		return -a
	}
	return a
}
