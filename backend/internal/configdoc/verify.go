package configdoc

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

// maxProblems caps how many problems a VerifyError lists.
const maxProblems = 20

// VerifyError lists why a v3 document is not a faithful conversion of v2.
type VerifyError struct{ Problems []string }

func (e *VerifyError) Error() string {
	return fmt.Sprintf("configdoc: verification failed (%d problem(s)): %s",
		len(e.Problems), strings.Join(e.Problems, "; "))
}

type verifier struct {
	problems []string
	// Set by VerifyMigration only.
	renames     map[string]Rename // by v2 path
	usedRenames map[string]bool
	sizes       map[string]SizeChange // by v2 entry path (Ruling 3)
	usedSizes   map[string]bool
	first       map[string]string // v2 id -> path of its first occurrence
}

func (v *verifier) add(format string, args ...any) {
	if len(v.problems) < maxProblems {
		v.problems = append(v.problems, fmt.Sprintf(format, args...))
	}
}

// VerifyIDs checks a v3 document on its own: it is schemaVersion 3, its tree
// is well-formed, and every dashboard/tab/folder/tile id is non-empty and
// unique document-wide. It returns a *VerifyError listing up to 20 problems.
func VerifyIDs(doc Obj) error {
	v := &verifier{}
	if !IsV3(doc) {
		v.add("document: schemaVersion is %s, want %d", show(doc["schemaVersion"]), SchemaVersion)
	}
	v.checkIDs(doc)
	if len(v.problems) > 0 {
		return &VerifyError{Problems: v.problems}
	}
	return nil
}

// VerifyImportedDashboard checks one dashboard of an imported v3 document on
// its own: non-empty string path, the converter-owned keys (revision, the six
// settings keys) and a well-formed tree in the current layout form whose ids are non-empty
// and unique within the dashboard. It returns a *VerifyError.
func VerifyImportedDashboard(d Obj) error {
	v := &verifier{}
	id, _ := d["id"].(string)
	if p, ok := d["path"].(string); !ok || p == "" {
		v.add("dashboard %q: path is %s, want a non-empty string", id, show(d["path"]))
	}
	v.checkOwned(id, d)
	v.checkIDs(Obj{"dashboards": []any{d}})
	v.checkStatusChecks(d)
	v.checkTileURLs(d)
	v.checkAwayURLs(d)
	v.checkFolderMinimums(d)
	if len(v.problems) > 0 {
		return &VerifyError{Problems: v.problems}
	}
	return nil
}

// checkFolderMinimums refuses a tab-level folder whose open box is below its
// minimum, FolderMinCellsOf (Ruling 7, Ruling 9): such a box would clip its
// item or its page bar, a silent failure. It is refused, never silently
// grown, naming the folder and both sizes. Run on saves, imports and the
// converter's output (not on the whole stored document), like
// checkStatusChecks. Boxes that are not whole numbers are left to
// checkTabPlacement.
func (v *verifier) checkFolderMinimums(d Obj) {
	tabs, _ := d["tabs"].([]any)
	for _, t := range tabs {
		tm, _ := t.(Obj)
		root, _ := tm["root"].(Obj)
		kids, _ := root["children"].([]any)
		for _, k := range kids {
			f, _ := k.(Obj)
			if f == nil || f["kind"] != "folder" {
				continue
			}
			p, _ := f["placement"].(Obj)
			w, okW := numberValue(p["w"])
			h, okH := numberValue(p["h"])
			if p == nil || !okW || !okH {
				continue
			}
			mw, mh := FolderMinCellsOf(f)
			if w < float64(mw) || h < float64(mh) {
				name, _ := f["name"].(string)
				if name == "" {
					name = "Untitled"
				}
				size := LargestContentSize(f)
				v.add("folder %q (%s) on tab %s: its open box is %v×%v cells, below its minimum %d×%d for %s contents; make it at least %d×%d",
					trunc(name), show(f["id"]), show(tm["id"]), w, h, mw, mh, size, mw, mh)
			}
		}
	}
}

// checkStatusChecks requires every layered status-check setting below the
// dashboard to be on, off or inherit: a tab's or folder's statusChecksEnabled
// is true, false or absent/null (inherit), and a tile's statusCheck is an
// object (or absent/null: off) whose enabled is true, false, null (inherit)
// or absent (off). Run on saves and
// imports only (not on the whole stored document), so legacy stored data
// never blocks unrelated writes.
func (v *verifier) checkStatusChecks(d Obj) {
	triOK := func(x any) bool { _, isBool := x.(bool); return x == nil || isBool }
	tabs, _ := d["tabs"].([]any)
	for j, t := range tabs {
		tm, _ := t.(Obj)
		if tm != nil && !triOK(tm["statusChecksEnabled"]) {
			v.add("tab[%d] %s: statusChecksEnabled is %s, want true or false (or absent to inherit)", j, show(tm["id"]), trunc(show(tm["statusChecksEnabled"])))
		}
	}
	Walk(Obj{"dashboards": []any{d}}, func(_, _ Obj, _ []Obj, n Obj) bool {
		switch n["kind"] {
		case "folder":
			if !triOK(n["statusChecksEnabled"]) {
				v.add("folder %s: statusChecksEnabled is %s, want true or false (or absent to inherit)", show(n["id"]), trunc(show(n["statusChecksEnabled"])))
			}
		case "tile":
			sc := n["statusCheck"]
			if sc == nil {
				break
			}
			scm, ok := sc.(Obj)
			if !ok {
				v.add("tile %s: statusCheck is %s, want an object whose enabled is true, false or null", show(n["id"]), trunc(show(sc)))
			} else if !triOK(scm["enabled"]) {
				v.add("tile %s: statusCheck.enabled is %s, want true, false or null (null inherits)", show(n["id"]), trunc(show(scm["enabled"])))
			}
		}
		return true
	})
}

// Bounds on one natively saved dashboard (Task 5): the editor and renderer
// stay responsive, and a request cannot make the server walk an unbounded tree.
const (
	MaxDashboardNodes = 5000
	MaxNestingDepth   = 12
	MaxTabs           = 200
)

// VerifyDashboard checks one dashboard written by the v3 editor: everything
// VerifyImportedDashboard checks (path, converter-owned keys, a well-formed
// tree with finite placements and ids unique within the dashboard), plus the
// size bounds: at most MaxDashboardNodes nodes (tiles and folders) and folder
// nesting no deeper than MaxNestingDepth (a root child is at depth 1). The
// bounds are checked first, so an oversized tree is rejected with a message
// naming the limit before it is walked in full. It returns a *VerifyError.
func VerifyDashboard(d Obj) error {
	if msg := boundsProblem(d); msg != "" {
		return &VerifyError{Problems: []string{msg}}
	}
	return VerifyImportedDashboard(d)
}

// boundsProblem returns why d's tree is too big or too deep, or "". It stops
// walking as soon as a limit is crossed.
func boundsProblem(d Obj) string {
	if tabs, _ := d["tabs"].([]any); len(tabs) > MaxTabs {
		return fmt.Sprintf("dashboard has more than %d tabs (the limit is %d per dashboard)", MaxTabs, MaxTabs)
	}
	count := 0
	var walk func(c Obj, depth int) string
	walk = func(c Obj, depth int) string {
		kids, _ := c["children"].([]any)
		for _, k := range kids {
			km, ok := k.(Obj)
			if !ok {
				continue // reported by the structure check
			}
			count++
			if count > MaxDashboardNodes {
				return fmt.Sprintf("dashboard has more than %d items (the limit is %d per dashboard)", MaxDashboardNodes, MaxDashboardNodes)
			}
			if depth > MaxNestingDepth {
				return fmt.Sprintf("items are nested deeper than %d levels (the limit is %d)", MaxNestingDepth, MaxNestingDepth)
			}
			if km["kind"] == "folder" {
				content, _ := km["content"].(Obj)
				if msg := walk(content, depth+1); msg != "" {
					return msg
				}
			}
		}
		return ""
	}
	tabs, _ := d["tabs"].([]any)
	for _, t := range tabs {
		tm, _ := t.(Obj)
		root, _ := tm["root"].(Obj)
		if msg := walk(root, 1); msg != "" {
			return msg
		}
	}
	return ""
}

// Verify proves v3 is a faithful conversion of v2 with no ids renamed; it is
// VerifyMigration with an empty rename list, so a v3 document that kept a
// duplicate id still fails.
func Verify(v2, v3 Obj) error { return VerifyMigrationFull(v2, v3, nil, nil) }

// VerifyMigration is VerifyMigrationFull with no normalised tile sizes.
func VerifyMigration(v2, v3 Obj, renames []Rename) error {
	return VerifyMigrationFull(v2, v3, renames, nil)
}

// VerifyMigrationFull proves v3 is a faithful conversion of v2 given the renames
// MigrateV2Renaming reported:
//   - every v2 dashboard/tab/group/entry appears exactly once at the matching
//     level, under the matching parent, in the same order, under its own id
//     or — when a rename names its v2 path — under that rename's NewID;
//   - each rename names a real v2 object of its kind whose id is OldID and
//     repeats an id used earlier in the document;
//   - counts match (nothing extra in v3);
//   - every other v2 key/value on each object equals the v3 object's (child
//     lists excepted);
//   - IDs are unique document-wide and the v3 tree is well-formed and in
//     the current layout form (see layout.go);
//   - v3 carries this build's layoutVersion;
//   - a v2 entry's size differs only where sizes reports it: an unknown
//     size, now "medium" (Ruling 3); every reported change happened.
//
// It returns a *VerifyError listing up to 20 problems.
func VerifyMigrationFull(v2, v3 Obj, renames []Rename, sizes []SizeChange) error {
	v := &verifier{}
	if !IsV3(v3) {
		v.add("document: schemaVersion is %s, want %d", show(v3["schemaVersion"]), SchemaVersion)
	}
	if err := CheckLayoutVersion(v3); err != nil {
		v.add("document: %s: %v", LayoutVersionKey, err)
	}
	v.checkIDs(v3)
	if dashes, ok := asList(v3["dashboards"]); ok {
		for _, d := range dashes {
			if dm, ok := d.(Obj); ok {
				v.checkFolderMinimums(dm)
			}
		}
	}
	v.renames = map[string]Rename{}
	v.usedRenames = map[string]bool{}
	for _, r := range renames {
		if _, dup := v.renames[r.Path]; dup {
			v.add("rename list names path %s twice", r.Path)
			continue
		}
		v.renames[r.Path] = r
	}
	v.first = firstOccurrence(v2Nodes(v2))
	v.sizes = map[string]SizeChange{}
	v.usedSizes = map[string]bool{}
	for _, sc := range sizes {
		if _, dup := v.sizes[sc.Path]; dup {
			v.add("size change list names path %s twice", sc.Path)
			continue
		}
		v.sizes[sc.Path] = sc
	}

	v.compareKeys("document", v2, v3, "dashboards", "schemaVersion", LayoutVersionKey)
	v2d, ok2 := asList(v2["dashboards"])
	v3d, ok3 := asList(v3["dashboards"])
	switch {
	case !ok2:
		v.add("document: v2 dashboards is %T, want array", v2["dashboards"])
	case !ok3:
		v.add("document: v3 dashboards is %T, want array", v3["dashboards"])
	default:
		v.compareLevel("dashboard", "document", "dashboards", v2d, v3d, "", func(a, b Obj, id, path string) {
			// revision and settings are converter-owned: ConvertDashboardV2
			// deliberately overwrites any v2 value (Ruling 4), so skip the
			// equality check but still require them well-formed. A v2
			// defaultLayout is dropped (every tab is a grid tab; checkIDs
			// requires it gone).
			// perTabBackgrounds is retired into the tabs' background form
			// (checked per tab in compareTabs) and must be gone.
			v.compareKeys("dashboard "+id, a, b, "tabs", "revision", "settings", "defaultLayout", legacyPerTabKey)
			if _, has := b[legacyPerTabKey]; has {
				v.add("dashboard %q: key %q is still present", id, legacyPerTabKey)
			}
			v.checkOwned(id, b)
			v.compareTabs(id, path, a, b)
		})
	}
	for _, sc := range sizes {
		if !v.usedSizes[sc.Path] {
			v.add("size change %s (tile %q, size %s) does not match any v2 entry", sc.Path, sc.TileID, trunc(show(sc.OldSize)))
		}
	}
	for _, r := range renames {
		if !v.usedRenames[r.Path] {
			v.add("rename %s (%q → %q) does not match any v2 object", r.Path, r.OldID, r.NewID)
		}
	}
	if len(v.problems) == 0 {
		return nil
	}
	return &VerifyError{Problems: v.problems}
}

func (v *verifier) compareTabs(dashID, dashPath string, a, b Obj) {
	v2t, _ := asList(a["tabs"])
	v3t, ok := asList(b["tabs"])
	if !ok {
		v.add("dashboard %q: v3 tabs is %T, want array", dashID, b["tabs"])
		return
	}
	active := tabBackgroundsActive(a)
	v.compareLevel("tab", "dashboard "+dashID, dashPath+".tabs", v2t, v3t, "", func(ta, tb Obj, tid, tpath string) {
		// The background is v2's, plus inherit:true when the dashboard's
		// perTabBackgrounds was off; nothing else about it may differ.
		// A tab's layout and designWidth are dropped (every tab is a grid
		// tab; checkIDs requires them gone).
		v.compareKeys("tab "+tid, ta, tb, "groups", "background", legacyEnabledKey, "layout", "designWidth")
		if _, has := tb[legacyEnabledKey]; has {
			v.add("tab %q: key %q is still present", tid, legacyEnabledKey)
		}
		v.checkBackgroundKept("tab "+tid, ta, tb, !active)
		v2g, _ := asList(ta["groups"])
		root, _ := tb["root"].(Obj)
		v3g, ok := asList(root["children"])
		if !ok {
			return // reported by checkIDs
		}
		v.compareLevel("group", "tab "+tid, tpath+".groups", v2g, v3g, "folder", func(ga, gb Obj, gid, gpath string) {
			// A folder has no layout of its own (M5; checkIDs requires it gone).
			// width, displayStyle and collapsed are mapped to placement, shape and
			// display by the converter and must be gone: a stale second copy
			// could disagree with the v3 field.
			v.compareKeys("group "+gid, ga, gb, "entries", "layout", "width", "displayStyle", "collapsed")
			v.noKeys("folder "+gid, gb, "width", "displayStyle", "collapsed")
			wantDisplay := "expanded"
			if c, _ := ga["collapsed"].(bool); c {
				wantDisplay = "collapsed"
			}
			if gb["display"] != wantDisplay {
				v.add("folder %s: display is %v, want %s (from the v2 collapsed flag)", gid, gb["display"], wantDisplay)
			}
			v2e, _ := asList(ga["entries"])
			content, _ := gb["content"].(Obj)
			v3e, ok := asList(content["children"])
			if !ok {
				return
			}
			v.compareLevel("entry", "group "+gid, gpath+".entries", v2e, v3e, "tile", func(ea, eb Obj, eid, epath string) {
				sc, normalised := v.sizes[epath]
				if !normalised {
					v.compareKeys("entry "+eid, ea, eb)
					if _, had := ea["size"]; !had {
						if _, has := eb["size"]; has {
							v.add("entry %s: key \"size\" was added (%s) without a reported size change", eid, trunc(show(eb["size"])))
						}
					}
					return
				}
				// Ruling 3: exactly this reported tile's unknown size became
				// Medium; everything else about it is unchanged.
				v.usedSizes[epath] = true
				v.compareKeys("entry "+eid, ea, eb, "size")
				if _, known := SizeSpan(ea["size"]); known || show(ea["size"]) != show(sc.OldSize) {
					v.add("size change %s: v2 size is %s, reported %s (only an unknown size may be normalised)", epath, trunc(show(ea["size"])), trunc(show(sc.OldSize)))
				}
				if eb["size"] != "medium" {
					v.add("entry %s: size is %s, want \"medium\" (normalised from %s)", eid, trunc(show(eb["size"])), trunc(show(sc.OldSize)))
				}
				if sc.TileID != eid {
					v.add("size change %s: tile id %q, want %q", epath, sc.TileID, eid)
				}
			})
		})
	})
}

func (v *verifier) checkOwned(id string, d Obj) {
	switch r := d["revision"].(type) {
	case int:
		if r <= 0 {
			v.add("dashboard %q: key \"revision\" is %d, want a positive number", id, r)
		}
	case float64:
		if r <= 0 {
			v.add("dashboard %q: key \"revision\" is %v, want a positive number", id, r)
		}
	default:
		v.add("dashboard %q: key \"revision\" is %s, want a positive number", id, show(d["revision"]))
	}
	if s, ok := d["settings"].(Obj); !ok {
		v.add("dashboard %q: key \"settings\" is %s, want an object", id, trunc(show(d["settings"])))
	} else {
		for _, k := range settingsKeys {
			if _, has := s[k]; !has {
				v.add("dashboard %q: settings is missing key %q", id, k)
			}
		}
	}
}

// levelKind maps a compareLevel level to the Rename.Kind for it.
var levelKind = map[string]string{"dashboard": "dashboard", "tab": "tab", "group": "folder", "entry": "tile"}

// expectedID returns the id the v3 counterpart of the v2 object a at path
// must carry, and a (or, when renamed, a shallow copy whose id is the new
// one, so compareKeys requires every other key unchanged).
func (v *verifier) expectedID(level, path, id string, a Obj) (string, Obj) {
	r, ok := v.renames[path]
	if !ok {
		return id, a
	}
	v.usedRenames[path] = true
	if r.OldID != id {
		v.add("rename %s: old id %q, but the v2 object there has id %q", path, r.OldID, id)
	}
	if want := levelKind[level]; r.Kind != want {
		v.add("rename %s: kind %q, want %q", path, r.Kind, want)
	}
	if first, ok := v.first[id]; (!ok || first == path) && !(level == "dashboard" && IsReservedDashboardID(id)) {
		v.add("rename %s: id %q is not duplicated by an earlier object (first at %s), so it must keep its id", path, id, first)
	}
	cp := make(Obj, len(a))
	for k, val := range a {
		cp[k] = val
	}
	cp["id"] = r.NewID
	return r.NewID, cp
}

// compareLevel pairs v2 and v3 children — each v2 child under the id it must
// have in v3 (its own, or its rename's NewID, looked up by the child's v2
// path) — reporting missing, unexpected and reordered items, and calls each
// for every matched pair with the v3 id and the v2 path.
func (v *verifier) compareLevel(level, parent, seg string, v2l, v3l []any, wantKind string, each func(a, b Obj, id, path string)) {
	byID := map[string]Obj{}
	for _, x := range v3l {
		if o, ok := x.(Obj); ok {
			if id, ok := o["id"].(string); ok {
				if _, dup := byID[id]; !dup {
					byID[id] = o
				}
			}
		}
	}
	in2 := map[string]bool{}
	want := make([]string, len(v2l))
	clean := len(v2l) == len(v3l)
	for i, x := range v2l {
		path := fmt.Sprintf("%s[%d]", seg, i)
		a, ok := x.(Obj)
		id, _ := a["id"].(string)
		if !ok || id == "" {
			v.add("%s: v2 %s[%d] has no string id", parent, level, i)
			clean = false
			continue
		}
		id, a = v.expectedID(level, path, id, a)
		want[i] = id
		in2[id] = true
		b, found := byID[id]
		if !found {
			v.add("%s: %s %q is missing from v3", parent, level, id)
			clean = false
			continue
		}
		if wantKind != "" && b["kind"] != wantKind {
			v.add("%s %q: kind is %s, want %q", level, id, show(b["kind"]), wantKind)
		}
		each(a, b, id, path)
	}
	for _, x := range v3l {
		if o, ok := x.(Obj); ok {
			if id, _ := o["id"].(string); in2[id] {
				continue
			}
			v.add("%s: unexpected %s %s in v3", parent, level, show(o["id"]))
			clean = false
		}
	}
	if clean {
		for i := range v2l {
			if want[i] != v3l[i].(Obj)["id"] {
				v.add("%s: %s order differs (position %d: want %s, v3 %s)", parent, level, i,
					show(want[i]), show(v3l[i].(Obj)["id"]))
				break
			}
		}
	}
}

// compareKeys requires every key of a (minus skip) to exist in b with an equal value.
func (v *verifier) compareKeys(what string, a, b Obj, skip ...string) {
next:
	for k, av := range a {
		for _, s := range skip {
			if k == s {
				continue next
			}
		}
		bv, ok := b[k]
		if !ok {
			v.add("%s: key %q was dropped", what, k)
			continue
		}
		if (k == "url" || k == AwayURLKey) && trimmedEqual(av, bv) {
			continue // the conversion trims stray whitespace around a tile address
		}
		if show(av) != show(bv) {
			v.add("%s: key %q changed (v2 %s, v3 %s)", what, k, trunc(show(av)), trunc(show(bv)))
		}
	}
}

// checkIDs walks the whole v3 tree, enforcing document-wide ID uniqueness and
// the current layout form (layout.go), and reporting every malformed node
// instead of skipping it.
func (v *verifier) checkIDs(doc Obj) {
	seen := map[string]string{}
	dash := "" // id of the dashboard being walked, named in duplicate reports
	note := func(where string, o Obj) string {
		id, ok := o["id"].(string)
		if !ok || id == "" {
			v.add("%s: id is %s, want non-empty string", where, show(o["id"]))
			return where
		}
		loc := where
		if dash != "" {
			loc = fmt.Sprintf("%s in dashboard %q", where, dash)
		}
		if first, dup := seen[id]; dup {
			v.add("duplicate id %q (at %s and %s)", id, first, loc)
		} else {
			seen[id] = loc
		}
		return fmt.Sprintf("%s %q", where, id)
	}
	dashes, ok := asList(doc["dashboards"])
	if !ok {
		return
	}
	for i, d := range dashes {
		dm, ok := d.(Obj)
		if !ok {
			v.add("dashboards[%d] is %T, want object", i, d)
			continue
		}
		dash = ""
		dn := note(fmt.Sprintf("dashboard[%d]", i), dm)
		dash, _ = dm["id"].(string)
		v.checkBackground(dn, dm)
		v.noKeys(dn, dm, "defaultLayout", legacyPerTabKey)
		tabs, ok := asList(dm["tabs"])
		if !ok {
			v.add("%s: tabs is %T, want array", dn, dm["tabs"])
			continue
		}
		for j, t := range tabs {
			tm, ok := t.(Obj)
			if !ok {
				v.add("%s: tabs[%d] is %T, want object", dn, j, t)
				continue
			}
			tn := note(fmt.Sprintf("tab[%d]", j), tm)
			v.checkBackground(tn, tm)
			v.noKeys(tn, tm, "layout", "designWidth", legacyEnabledKey)
			root, ok := tm["root"].(Obj)
			if !ok {
				v.add("%s: root is %T, want object", tn, tm["root"])
				continue
			}
			if n, ok := numberValue(root["columns"]); !ok || n != RootColumns {
				v.add("%s: root columns is %s, want %d (every tab is a %d-column grid)", tn, trunc(show(root["columns"])), RootColumns, RootColumns)
			}
			v.checkContainer(tn, root, note, true)
		}
	}
}

// noKeys reports each of keys that o carries: settings of the removed free
// layout and per-container grids (M5) and the retired per-tab background
// switches (M4), which the current form never has.
func (v *verifier) noKeys(where string, o Obj, keys ...string) {
	for _, k := range keys {
		if _, has := o[k]; has {
			v.add("%s: key %q is not part of the current layout form (layout version %d)", where, k, LayoutVersion)
		}
	}
}

// checkContainer checks every child of c: each is a tile or a folder (any
// mix, any depth, per the v3 tree), and a folder's content is checked in turn.
// A tab root's children are placed on the grid (checkTabPlacement, then
// checkOverlaps); a folder's children are an ordered list with no placement.
func (v *verifier) checkContainer(owner string, c Obj, note func(string, Obj) string, tabLevel bool) {
	kids, ok := asList(c["children"])
	if !ok {
		v.add("%s: children is %T, want array", owner, c["children"])
		return
	}
	var boxes []placedBox
	for i, k := range kids {
		km, ok := k.(Obj)
		if !ok {
			v.add("%s: children[%d] is %T, want object", owner, i, k)
			continue
		}
		n := note(fmt.Sprintf("%s child[%d]", owner, i), km)
		if tabLevel {
			if b, ok := v.checkTabPlacement(n, km); ok {
				boxes = append(boxes, b)
			}
		} else if _, has := km["placement"]; has {
			v.add("%s: has a placement inside a folder, want none (folder contents are an ordered list)", n)
		}
		switch km["kind"] {
		case "tile":
			if _, ok := SizeSpan(km["size"]); !ok {
				v.add("%s: size is %s, want \"small\", \"medium\" or \"large\"", n, trunc(show(km["size"])))
			}
		case "folder":
			v.checkBackground(n, km)
			v.noKeys(n, km, "layout")
			v.checkFolderShape(n, km)
			for _, k := range []string{"size", "contentSize"} {
				if s, _ := km[k].(string); sizeSpans[s] == 0 {
					v.add("%s: %s is %s, want \"small\", \"medium\" or \"large\"", n, k, trunc(show(km[k])))
				}
			}
			content, ok := km["content"].(Obj)
			if !ok {
				v.add("%s: content is %T, want object", n, km["content"])
				continue
			}
			v.noKeys(n+" content", content, "columns")
			v.checkContainer(n, content, note, false)
		default:
			v.add("%s: kind is %s, want \"tile\" or \"folder\"", n, show(km["kind"]))
		}
	}
	if tabLevel {
		v.checkOverlaps(owner, boxes)
	}
}

// checkFolderShape requires a folder's shape, when present, to be one of
// FolderShapes and its tabPosition, when present, one of FolderTabPositions
// (M6 §3a.8). Anything else (a retired name such as "folder-tab", a typo, a
// non-string, markup) is refused with a message naming the field, the value
// and the allowed names: the renderer's "unknown shape" note is only a
// backstop, never the first line.
func (v *verifier) checkFolderShape(n string, f Obj) {
	check := func(key string, allowed []string) {
		raw, has := f[key]
		if !has {
			return
		}
		if s, ok := raw.(string); ok {
			for _, a := range allowed {
				if s == a {
					return
				}
			}
		}
		v.add("%s: %s is %s, want one of %s (or absent)", n, key, trunc(show(raw)), quoteList(allowed))
	}
	check("shape", FolderShapes)
	check("tabPosition", FolderTabPositions)
}

// quoteList is names as "a", "b" or "c".
func quoteList(names []string) string {
	q := make([]string, len(names))
	for i, s := range names {
		q[i] = fmt.Sprintf("%q", s)
	}
	if len(q) < 2 {
		return strings.Join(q, "")
	}
	return strings.Join(q[:len(q)-1], ", ") + " or " + q[len(q)-1]
}

// placedBox is a tab-level item's cells, for the overlap check.
type placedBox struct {
	name       string
	x, y, w, h float64
}

// checkTabPlacement requires a tab-level item's placement to be whole cells
// inside the RootColumns grid (Ruling 24: the editor and renderer position by
// it), and a tile's span to be exactly its size's: Small 1×1, Medium 2×2 or
// Large 4×4 (a missing size is Medium). It returns the box when it is usable
// for the overlap check.
func (v *verifier) checkTabPlacement(n string, node Obj) (placedBox, bool) {
	pm, ok := node["placement"].(Obj)
	if !ok {
		v.add("%s: placement is %s, want an object with numeric x, y, w, h", n, trunc(show(node["placement"])))
		return placedBox{}, false
	}
	var f [4]float64
	good := true
	for i, k := range []string{"x", "y", "w", "h"} {
		if !finiteNumber(pm[k]) {
			v.add("%s: placement.%s is %s, want a finite number", n, k, trunc(show(pm[k])))
			good = false
			continue
		}
		f[i], _ = numberValue(pm[k])
		if f[i] != math.Trunc(f[i]) {
			v.add("%s: placement.%s is %v, want a whole number of grid cells", n, k, f[i])
			good = false
		}
	}
	if !good {
		return placedBox{}, false
	}
	b := placedBox{n, f[0], f[1], f[2], f[3]}
	if b.x < 0 || b.y < 0 || b.w < 1 || b.h < 1 || b.x+b.w > RootColumns {
		v.add("%s: placement %s is outside the %d-column grid", n, trunc(show(pm)), RootColumns)
		return placedBox{}, false
	}
	if node["kind"] == "tile" {
		if s, ok := SizeSpan(node["size"]); ok && (b.w != float64(s) || b.h != float64(s)) {
			v.add("%s: span is %v×%v, want %d×%d for size %s (tiles are Small 1×1, Medium 2×2 or Large 4×4)", n, b.w, b.h, s, s, trunc(show(node["size"])))
		}
	}
	return b, true
}

// checkOverlaps reports tab-level items whose cells overlap (at most a few).
// Tab-level item counts are bounded by MaxDashboardNodes, so the pairwise
// scan is bounded too.
func (v *verifier) checkOverlaps(owner string, boxes []placedBox) {
	reported := 0
	for i := 0; i < len(boxes) && reported < 3; i++ {
		a := boxes[i]
		for j := i + 1; j < len(boxes) && reported < 3; j++ {
			b := boxes[j]
			if a.x < b.x+b.w && b.x < a.x+a.w && a.y < b.y+b.h && b.y < a.y+a.h {
				v.add("%s and %s overlap", a.name, b.name)
				reported++
			}
		}
	}
}

// finiteNumber reports whether x is a finite JSON number (float64 as decoded,
// or a Go int as the converter builds it).
func finiteNumber(x any) bool {
	switch n := x.(type) {
	case float64:
		return !math.IsNaN(n) && !math.IsInf(n, 0)
	case int, int64:
		return true
	}
	return false
}

// asList treats a missing/null list as empty; any other non-array is not ok.
func asList(x any) ([]any, bool) {
	if x == nil {
		return nil, true
	}
	l, ok := x.([]any)
	return l, ok
}

// show renders a value as normalised JSON so int and float64 compare equal.
func show(x any) string {
	b, err := json.Marshal(x)
	if err != nil {
		return fmt.Sprintf("%v", x)
	}
	return string(b)
}

func trunc(s string) string {
	if len(s) > 80 {
		return s[:77] + "..."
	}
	return s
}

// trimmedEqual reports whether a and b are strings equal once surrounding
// whitespace is removed (the one change the conversion makes to a tile address).
func trimmedEqual(a, b any) bool {
	as, ok1 := a.(string)
	bs, ok2 := b.(string)
	return ok1 && ok2 && strings.TrimSpace(as) == strings.TrimSpace(bs)
}
