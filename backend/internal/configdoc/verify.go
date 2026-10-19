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

type verifier struct{ problems []string }

func (v *verifier) add(format string, args ...any) {
	if len(v.problems) < maxProblems {
		v.problems = append(v.problems, fmt.Sprintf(format, args...))
	}
}

// Verify proves v3 is a faithful conversion of v2:
//   - every v2 dashboard/tab/group/entry ID appears exactly once at the
//     matching level, under the matching parent, in the same order;
//   - counts match (nothing extra in v3);
//   - every v2 key/value on each object equals the v3 object's (child lists
//     excepted);
//   - IDs are unique document-wide and the v3 tree is well-formed.
//
// It returns a *VerifyError listing up to 20 problems.
func Verify(v2, v3 Obj) error {
	v := &verifier{}
	if !IsV3(v3) {
		v.add("document: schemaVersion is %s, want %d", show(v3["schemaVersion"]), SchemaVersion)
	}
	v.checkIDs(v3)

	v.compareKeys("document", v2, v3, "dashboards", "schemaVersion")
	v2d, ok2 := asList(v2["dashboards"])
	v3d, ok3 := asList(v3["dashboards"])
	switch {
	case !ok2:
		v.add("document: v2 dashboards is %T, want array", v2["dashboards"])
	case !ok3:
		v.add("document: v3 dashboards is %T, want array", v3["dashboards"])
	default:
		v.compareLevel("dashboard", "document", v2d, v3d, "", func(a, b Obj, id string) {
			v.compareKeys("dashboard "+id, a, b, "tabs")
			v.compareTabs(id, a, b)
		})
	}
	if len(v.problems) == 0 {
		return nil
	}
	return &VerifyError{Problems: v.problems}
}

func (v *verifier) compareTabs(dashID string, a, b Obj) {
	v2t, _ := asList(a["tabs"])
	v3t, ok := asList(b["tabs"])
	if !ok {
		v.add("dashboard %q: v3 tabs is %T, want array", dashID, b["tabs"])
		return
	}
	v.compareLevel("tab", "dashboard "+dashID, v2t, v3t, "", func(ta, tb Obj, tid string) {
		v.compareKeys("tab "+tid, ta, tb, "groups")
		v2g, _ := asList(ta["groups"])
		root, _ := tb["root"].(Obj)
		v3g, ok := asList(root["children"])
		if !ok {
			return // reported by checkIDs
		}
		v.compareLevel("group", "tab "+tid, v2g, v3g, "folder", func(ga, gb Obj, gid string) {
			v.compareKeys("group "+gid, ga, gb, "entries")
			v2e, _ := asList(ga["entries"])
			content, _ := gb["content"].(Obj)
			v3e, ok := asList(content["children"])
			if !ok {
				return
			}
			v.compareLevel("entry", "group "+gid, v2e, v3e, "tile", func(ea, eb Obj, eid string) {
				v.compareKeys("entry "+eid, ea, eb)
			})
		})
	})
}

// compareLevel pairs v2 and v3 children by ID, reporting missing, unexpected
// and reordered items, and calls each for every matched pair.
func (v *verifier) compareLevel(level, parent string, v2l, v3l []any, wantKind string, each func(a, b Obj, id string)) {
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
	clean := len(v2l) == len(v3l)
	for i, x := range v2l {
		a, ok := x.(Obj)
		id, _ := a["id"].(string)
		if !ok || id == "" {
			v.add("%s: v2 %s[%d] has no string id", parent, level, i)
			clean = false
			continue
		}
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
		each(a, b, id)
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
			if v2l[i].(Obj)["id"] != v3l[i].(Obj)["id"] {
				v.add("%s: %s order differs (position %d: v2 %s, v3 %s)", parent, level, i,
					show(v2l[i].(Obj)["id"]), show(v3l[i].(Obj)["id"]))
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
	note := func(where string, o Obj) string {
		id, ok := o["id"].(string)
		if !ok || id == "" {
			v.add("%s: id is %s, want non-empty string", where, show(o["id"]))
			return where
		}
		if first, dup := seen[id]; dup {
			v.add("duplicate id %q (at %s and %s)", id, first, where)
		} else {
			seen[id] = where
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
		dn := note(fmt.Sprintf("dashboard[%d]", i), dm)
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
