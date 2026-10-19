package configdoc

import (
	"encoding/json"
	"fmt"
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
// settings keys, defaultLayout) and a well-formed tree whose ids are non-empty
// and unique within the dashboard. It returns a *VerifyError.
func VerifyImportedDashboard(d Obj) error {
	v := &verifier{}
	id, _ := d["id"].(string)
	if p, ok := d["path"].(string); !ok || p == "" {
		v.add("dashboard %q: path is %s, want a non-empty string", id, show(d["path"]))
	}
	v.checkOwned(id, d)
	v.checkIDs(Obj{"dashboards": []any{d}})
	if len(v.problems) > 0 {
		return &VerifyError{Problems: v.problems}
	}
	return nil
}

// Verify proves v3 is a faithful conversion of v2 with no ids renamed; it is
// VerifyMigration with an empty rename list, so a v3 document that kept a
// duplicate id still fails.
func Verify(v2, v3 Obj) error { return VerifyMigration(v2, v3, nil) }

// VerifyMigration proves v3 is a faithful conversion of v2 given the renames
// MigrateV2Renaming reported:
//   - every v2 dashboard/tab/group/entry appears exactly once at the matching
//     level, under the matching parent, in the same order, under its own id
//     or — when a rename names its v2 path — under that rename's NewID;
//   - each rename names a real v2 object of its kind whose id is OldID and
//     repeats an id used earlier in the document;
//   - counts match (nothing extra in v3);
//   - every other v2 key/value on each object equals the v3 object's (child
//     lists excepted);
//   - IDs are unique document-wide and the v3 tree is well-formed.
//
// It returns a *VerifyError listing up to 20 problems.
func VerifyMigration(v2, v3 Obj, renames []Rename) error {
	v := &verifier{}
	if !IsV3(v3) {
		v.add("document: schemaVersion is %s, want %d", show(v3["schemaVersion"]), SchemaVersion)
	}
	v.checkIDs(v3)
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

	v.compareKeys("document", v2, v3, "dashboards", "schemaVersion")
	v2d, ok2 := asList(v2["dashboards"])
	v3d, ok3 := asList(v3["dashboards"])
	switch {
	case !ok2:
		v.add("document: v2 dashboards is %T, want array", v2["dashboards"])
	case !ok3:
		v.add("document: v3 dashboards is %T, want array", v3["dashboards"])
	default:
		v.compareLevel("dashboard", "document", "dashboards", v2d, v3d, "", func(a, b Obj, id, path string) {
			// revision, settings and defaultLayout are converter-owned:
			// ConvertDashboardV2 deliberately overwrites any v2 value (Ruling 4),
			// so skip the equality check but still require them well-formed.
			v.compareKeys("dashboard "+id, a, b, "tabs", "revision", "settings", "defaultLayout")
			v.checkOwned(id, b)
			v.compareTabs(id, path, a, b)
		})
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
	v.compareLevel("tab", "dashboard "+dashID, dashPath+".tabs", v2t, v3t, "", func(ta, tb Obj, tid, tpath string) {
		v.compareKeys("tab "+tid, ta, tb, "groups")
		v2g, _ := asList(ta["groups"])
		root, _ := tb["root"].(Obj)
		v3g, ok := asList(root["children"])
		if !ok {
			return // reported by checkIDs
		}
		v.compareLevel("group", "tab "+tid, tpath+".groups", v2g, v3g, "folder", func(ga, gb Obj, gid, gpath string) {
			v.compareKeys("group "+gid, ga, gb, "entries")
			v2e, _ := asList(ga["entries"])
			content, _ := gb["content"].(Obj)
			v3e, ok := asList(content["children"])
			if !ok {
				return
			}
			v.compareLevel("entry", "group "+gid, gpath+".entries", v2e, v3e, "tile", func(ea, eb Obj, eid, _ string) {
				v.compareKeys("entry "+eid, ea, eb)
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
	if _, ok := d["defaultLayout"].(string); !ok {
		v.add("dashboard %q: key \"defaultLayout\" is %s, want a string", id, show(d["defaultLayout"]))
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
	if first, ok := v.first[id]; !ok || first == path {
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
		if show(av) != show(bv) {
			v.add("%s: key %q changed (v2 %s, v3 %s)", what, k, trunc(show(av)), trunc(show(bv)))
		}
	}
}

// checkIDs walks the whole v3 tree, enforcing document-wide ID uniqueness and
// reporting every malformed node instead of skipping it.
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
			root, ok := tm["root"].(Obj)
			if !ok {
				v.add("%s: root is %T, want object", tn, tm["root"])
				continue
			}
			v.checkContainer(tn, root, "folder", note, func(fn string, f Obj) {
				content, ok := f["content"].(Obj)
				if !ok {
					v.add("%s: content is %T, want object", fn, f["content"])
					return
				}
				v.checkContainer(fn, content, "tile", note, nil)
			})
		}
	}
}

func (v *verifier) checkContainer(owner string, c Obj, kind string, note func(string, Obj) string, sub func(string, Obj)) {
	kids, ok := asList(c["children"])
	if !ok {
		v.add("%s: children is %T, want array", owner, c["children"])
		return
	}
	for i, k := range kids {
		km, ok := k.(Obj)
		if !ok {
			v.add("%s: children[%d] is %T, want object", owner, i, k)
			continue
		}
		n := note(fmt.Sprintf("%s child[%d]", owner, i), km)
		if km["kind"] != kind {
			v.add("%s: kind is %s, want %q", n, show(km["kind"]), kind)
			continue
		}
		if sub != nil {
			sub(n, km)
		}
	}
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
