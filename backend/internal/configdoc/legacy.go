package configdoc

import (
	"errors"
	"fmt"
	"sort"
)

// ErrNotLegacyRepresentable means the v3 layout cannot be shown in the v2 view.
var ErrNotLegacyRepresentable = errors.New("configdoc: layout cannot be shown in the v2 view")

// ToLegacy renders v3 as the v2 shape. Folders become groups, tiles become
// entries, children are ordered by (placement.y, placement.x), and all v3-only
// keys are removed EXCEPT dashboard `revision` and `settings`, which pass
// through. It errors with ErrNotLegacyRepresentable if any tile sits at a tab
// root or a folder contains a folder. The input is not modified.
func ToLegacy(v3 Obj) (Obj, error) {
	if !IsV3(v3) {
		return nil, ErrNotV3
	}
	out, err := deepCopy(v3)
	if err != nil {
		return nil, fmt.Errorf("configdoc: copy v3 document: %w", err)
	}
	delete(out, "schemaVersion")
	dashes, err := objList(out, "dashboards")
	if err != nil {
		return nil, err
	}
	for _, d := range dashes {
		delete(d, "defaultLayout")
		tabs, err := objList(d, "tabs")
		if err != nil {
			return nil, fmt.Errorf("dashboard %v: %w", d["id"], err)
		}
		for _, t := range tabs {
			if err := tabToLegacy(t); err != nil {
				return nil, fmt.Errorf("tab %v: %w", t["id"], err)
			}
		}
	}
	return out, nil
}

func tabToLegacy(t Obj) error {
	root, ok := t["root"].(Obj)
	if !ok {
		return fmt.Errorf("root is %T, want object", t["root"])
	}
	folders, err := orderedChildren(root, "folder")
	if err != nil {
		return err
	}
	groups := make([]any, 0, len(folders))
	for _, f := range folders {
		content, ok := f["content"].(Obj)
		if !ok {
			return fmt.Errorf("folder %v: content is %T, want object", f["id"], f["content"])
		}
		tiles, err := orderedChildren(content, "tile")
		if err != nil {
			return fmt.Errorf("folder %v: %w", f["id"], err)
		}
		entries := make([]any, 0, len(tiles))
		for _, e := range tiles {
			delete(e, "kind")
			delete(e, "placement")
			entries = append(entries, e)
		}
		for _, k := range []string{"kind", "placement", "layout", "display", "shape", "showTitle", "content"} {
			delete(f, k)
		}
		f["entries"] = entries
		groups = append(groups, f)
	}
	for _, k := range []string{"layout", "backgroundEnabled", "root"} {
		delete(t, k)
	}
	t["groups"] = groups
	return nil
}

// orderedChildren returns container's children, all of which must be of the
// given kind, sorted by (placement.y, placement.x) (stable).
func orderedChildren(container Obj, kind string) ([]Obj, error) {
	kids, err := objList(container, "children")
	if err != nil {
		return nil, err
	}
	for _, k := range kids {
		if k["kind"] != kind {
			return nil, fmt.Errorf("%w: %v is a %v where only %ss are allowed", ErrNotLegacyRepresentable, k["id"], k["kind"], kind)
		}
	}
	type pos struct{ x, y float64 }
	ps := make([]pos, len(kids))
	for i, k := range kids {
		p, ok := k["placement"].(Obj)
		if !ok {
			return nil, fmt.Errorf("%v: placement is %T, want object", k["id"], k["placement"])
		}
		x, okx := p["x"].(float64)
		y, oky := p["y"].(float64)
		if !okx || !oky {
			return nil, fmt.Errorf("%v: placement x/y are %s/%s, want numbers", k["id"], show(p["x"]), show(p["y"]))
		}
		ps[i] = pos{x, y}
	}
	idx := make([]int, len(kids))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool {
		pa, pb := ps[idx[a]], ps[idx[b]]
		if pa.y != pb.y {
			return pa.y < pb.y
		}
		return pa.x < pb.x
	})
	sorted := make([]Obj, len(kids))
	for i, j := range idx {
		sorted[i] = kids[j]
	}
	return sorted, nil
}

// objList reads o[key] as a list of objects; missing/null is empty.
func objList(o Obj, key string) ([]Obj, error) {
	l, err := listOf(o, key)
	if err != nil {
		return nil, err
	}
	out := make([]Obj, len(l))
	for i, x := range l {
		m, ok := x.(Obj)
		if !ok {
			return nil, fmt.Errorf("%s[%d] is %T, want object", key, i, x)
		}
		out[i] = m
	}
	return out, nil
}

// FromLegacy converts a v2-shaped view back to v3 with ConvertDashboardV2. For
// each dashboard whose id exists in prev, it carries prev's `settings`,
// `revision` and `defaultLayout`, and each matching tab's `layout`. It does not
// check revisions; callers must do that first.
func FromLegacy(view Obj, prev Obj) (Obj, error) {
	if len(prev) > 0 && !IsV3(prev) {
		return nil, ErrNotV3
	}
	// Not MigrateV2: a client's ids are never silently rewritten here.
	out, _, err := migrateV2(view, false)
	if err != nil {
		return nil, err
	}
	if len(prev) == 0 {
		return out, nil
	}
	prevCopy, err := deepCopy(prev)
	if err != nil {
		return nil, fmt.Errorf("configdoc: copy previous document: %w", err)
	}
	prevDashes, err := objList(prevCopy, "dashboards")
	if err != nil {
		return nil, fmt.Errorf("configdoc: previous document: %w", err)
	}
	byID := map[string]Obj{}
	for _, d := range prevDashes {
		if id, ok := d["id"].(string); ok {
			byID[id] = d
		}
	}
	dashes, _ := out["dashboards"].([]any)
	for _, d := range dashes {
		nd := d.(Obj)
		id, _ := nd["id"].(string)
		pd, ok := byID[id]
		if !ok {
			continue
		}
		for _, k := range []string{"settings", "revision", "defaultLayout"} {
			if val, has := pd[k]; has {
				nd[k] = val
			}
		}
		prevTabs, err := objList(pd, "tabs")
		if err != nil {
			return nil, fmt.Errorf("configdoc: previous dashboard %q: %w", id, err)
		}
		layouts := map[string]any{}
		for _, pt := range prevTabs {
			if tid, ok := pt["id"].(string); ok {
				if l, has := pt["layout"]; has {
					layouts[tid] = l
				}
			}
		}
		tabs, _ := nd["tabs"].([]any)
		for _, t := range tabs {
			nt := t.(Obj)
			if tid, ok := nt["id"].(string); ok {
				if l, has := layouts[tid]; has {
					nt["layout"] = l
				}
			}
		}
	}
	return out, nil
}
