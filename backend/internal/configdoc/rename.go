package configdoc

import "fmt"

// Rename records one id changed by MigrateV2Renaming because an earlier
// object in the v2 document already used it.
type Rename struct {
	// Path locates the v2 object, e.g. "dashboards[1].tabs[0].groups[2]".
	Path string `json:"path"`
	// Kind is the v3 kind: dashboard, tab, folder or tile.
	Kind string `json:"kind"`
	// DashboardID is the (new) id of the owning dashboard.
	DashboardID string `json:"dashboardId"`
	OldID       string `json:"oldId"`
	NewID       string `json:"newId"`
}

// v2Node is one id-bearing object of a v2 document, in document order.
type v2Node struct {
	obj    Obj
	path   string
	kind   string
	dashIx int // index into the dashboards list
}

// v2Nodes lists every dashboard, tab, group and entry object of a v2
// document depth-first in array order. Non-object items are skipped (the
// converter and Verify report them).
func v2Nodes(v2 Obj) []v2Node {
	var out []v2Node
	dashes, _ := v2["dashboards"].([]any)
	for i, d := range dashes {
		dm, ok := d.(Obj)
		if !ok {
			continue
		}
		dp := fmt.Sprintf("dashboards[%d]", i)
		out = append(out, v2Node{dm, dp, "dashboard", i})
		tabs, _ := dm["tabs"].([]any)
		for j, t := range tabs {
			tm, ok := t.(Obj)
			if !ok {
				continue
			}
			tp := fmt.Sprintf("%s.tabs[%d]", dp, j)
			out = append(out, v2Node{tm, tp, "tab", i})
			groups, _ := tm["groups"].([]any)
			for k, g := range groups {
				gm, ok := g.(Obj)
				if !ok {
					continue
				}
				gp := fmt.Sprintf("%s.groups[%d]", tp, k)
				out = append(out, v2Node{gm, gp, "folder", i})
				entries, _ := gm["entries"].([]any)
				for l, e := range entries {
					if em, ok := e.(Obj); ok {
						out = append(out, v2Node{em, fmt.Sprintf("%s.entries[%d]", gp, l), "tile", i})
					}
				}
			}
		}
	}
	return out
}

// firstOccurrence maps every non-empty string id in a v2 document to the
// path of the first object (document order) that carries it.
func firstOccurrence(nodes []v2Node) map[string]string {
	first := map[string]string{}
	for _, n := range nodes {
		if id, ok := n.obj["id"].(string); ok && id != "" {
			if _, seen := first[id]; !seen {
				first[id] = n.path
			}
		}
	}
	return first
}

// ReservedDashboardIDs are ids no dashboard may carry: /api/dashboards/order
// and /api/dashboards/transfer are collection routes that would shadow them.
var ReservedDashboardIDs = map[string]bool{"order": true, "transfer": true}

// IsReservedDashboardID reports whether id is reserved (see ReservedDashboardIDs).
func IsReservedDashboardID(id string) bool { return ReservedDashboardIDs[id] }

// renameDuplicates rewrites, in place, the id of every object that repeats
// an id already used earlier in document order. The first occurrence keeps
// its id; later ones become <old>-<owning dashboard id> (dashboards:
// <old>-2, <old>-3, ...), with -2, -3, ... appended until unused. New ids
// never collide with any id present anywhere in the input.
func renameDuplicates(v2 Obj) []Rename {
	nodes := v2Nodes(v2)
	first := firstOccurrence(nodes)
	taken := map[string]bool{}
	for id := range first {
		taken[id] = true
	}
	dashID := map[int]string{}
	var renames []Rename
	for _, n := range nodes {
		id, ok := n.obj["id"].(string)
		if !ok || id == "" {
			continue
		}
		if first[id] != n.path || (n.kind == "dashboard" && IsReservedDashboardID(id)) {
			var cand string
			if n.kind == "dashboard" {
				for s := 2; ; s++ {
					if cand = fmt.Sprintf("%s-%d", id, s); !taken[cand] {
						break
					}
				}
			} else {
				base := id + "-" + dashID[n.dashIx]
				cand = base
				for s := 2; taken[cand]; s++ {
					cand = fmt.Sprintf("%s-%d", base, s)
				}
			}
			taken[cand] = true
			n.obj["id"] = cand
			if n.kind == "dashboard" {
				dashID[n.dashIx] = cand
			}
			renames = append(renames, Rename{Path: n.path, Kind: n.kind, DashboardID: dashID[n.dashIx], OldID: id, NewID: cand})
			continue
		}
		if n.kind == "dashboard" {
			dashID[n.dashIx] = id
		}
	}
	return renames
}
