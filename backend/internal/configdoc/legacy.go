package configdoc

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
)

// ErrNotLegacyRepresentable means the v3 layout cannot be shown in the v2 view.
var ErrNotLegacyRepresentable = errors.New("configdoc: layout cannot be shown in the v2 view")

// ErrV3OnlyDashboard means a legacy view holds the id of a stored dashboard
// that is not LegacyEditable (it is never in the view, so it cannot be saved
// through it).
var ErrV3OnlyDashboard = errors.New("configdoc: dashboard uses v3 layout features and cannot be saved through the legacy view")

// ToLegacy renders v3 as the v2 shape. Folders become groups, tiles become
// entries, children are ordered by (placement.y, placement.x), and all v3-only
// keys are removed EXCEPT dashboard `revision` and `settings`, which pass
// through. Dashboards that are not LegacyEditable are left out (FromLegacy
// carries them over), including one that cannot be read (a malformed tree or
// placement): LegacyEditable reports it as "it cannot be read: ..." so the API
// lists it as view-only with that reason, and one bad dashboard never takes
// the whole view down. The input is not modified.
func ToLegacy(v3 Obj) (Obj, error) { return (*LegacyCache)(nil).ToLegacy(v3) }

// LegacyCache memoises each dashboard's legacy form (or the reason it has
// none) by the dashboard's content, for the life of one request, so a request
// that asks about the same dashboard several times (GET: view + v3-only list;
// a legacy write: dry run, real run, and the committed response) computes it
// once. Keying by content means a dashboard changed in between is simply a
// new entry, never a stale answer. A nil *LegacyCache computes every time.
// Not safe for concurrent use.
type LegacyCache struct {
	m        map[string]legacyResult
	computed int
}

type legacyResult struct {
	legacyJSON []byte // the legacy form, when editable
	reason     string // why not editable ("" when editable)
}

// NewLegacyCache returns an empty request-scoped cache.
func NewLegacyCache() *LegacyCache { return &LegacyCache{m: map[string]legacyResult{}} }

// Computed reports how many legacy forms this cache has computed (tests).
func (c *LegacyCache) Computed() int {
	if c == nil {
		return 0
	}
	return c.computed
}

// lookup returns the dashboard's legacy form (a fresh copy the caller may
// mutate) and "" when it is LegacyEditable, or nil and the reason when not.
// An unreadable dashboard's reason starts "it cannot be read: ".
func (c *LegacyCache) lookup(dash Obj) (Obj, string) {
	var key string
	if c != nil {
		b, err := json.Marshal(dash)
		if err == nil {
			key = string(b)
			if r, ok := c.m[key]; ok {
				if r.reason != "" {
					return nil, r.reason
				}
				var legacy Obj
				if err := json.Unmarshal(r.legacyJSON, &legacy); err == nil {
					return legacy, ""
				}
				// Unreachable (we marshalled it); fall through and recompute.
			}
		}
	}
	legacy, reason, err := legacyForm(dash)
	if err != nil {
		legacy, reason = nil, "it cannot be read: "+err.Error()
	}
	if c != nil {
		c.computed++
		if key != "" {
			r := legacyResult{reason: reason}
			if reason == "" {
				b, merr := json.Marshal(legacy)
				if merr != nil {
					return legacy, reason // not cached; still correct
				}
				r.legacyJSON = b
			}
			c.m[key] = r
		}
	}
	return legacy, reason
}

// Editable is LegacyEditable through the cache.
func (c *LegacyCache) Editable(dash Obj) (ok bool, reason string) {
	_, reason = c.lookup(dash)
	return reason == "", reason
}

// ToLegacy is the package ToLegacy through the cache.
func (c *LegacyCache) ToLegacy(v3 Obj) (Obj, error) {
	if !IsV3(v3) {
		return nil, ErrNotV3
	}
	dashes, err := objList(v3, "dashboards")
	if err != nil {
		return nil, err
	}
	out := make(Obj, len(v3))
	for k, v := range v3 {
		if k == "dashboards" || k == "schemaVersion" {
			continue
		}
		out[k] = v
	}
	out, err = deepCopy(out)
	if err != nil {
		return nil, fmt.Errorf("configdoc: copy v3 document: %w", err)
	}
	kept := make([]any, 0, len(dashes))
	for _, d := range dashes {
		legacy, reason := c.lookup(d)
		if reason != "" {
			continue // v3-only (or unreadable): never in the view
		}
		kept = append(kept, legacy)
	}
	out["dashboards"] = kept
	return out, nil
}

// DashboardToLegacy renders one v3 dashboard (a deep copy) in the v2 shape. It
// errors with ErrNotLegacyRepresentable if any tile sits at a tab root or a
// folder contains a folder. It does not check LegacyEditable.
func DashboardToLegacy(dash Obj) (Obj, error) {
	d, err := deepCopy(dash)
	if err != nil {
		return nil, fmt.Errorf("configdoc: copy dashboard: %w", err)
	}
	if err := dashToLegacy(d); err != nil {
		return nil, err
	}
	return d, nil
}

// dashToLegacy converts an already-copied dashboard in place.
func dashToLegacy(d Obj) error {
	delete(d, "defaultLayout")
	tabs, err := objList(d, "tabs")
	if err != nil {
		return fmt.Errorf("dashboard %v: %w", d["id"], err)
	}
	for _, t := range tabs {
		if err := tabToLegacy(t); err != nil {
			return fmt.Errorf("dashboard %v: tab %v: %w", d["id"], t["id"], err)
		}
	}
	return nil
}

// LegacyEditable reports whether a legacy round trip (ToLegacy then FromLegacy)
// reproduces the dashboard exactly. False when: any tile at a tab root, any
// folder inside a folder, any tab or folder whose layout is "free", any tab
// with designWidth, or any placement/columns differing from what
// ConvertDashboardV2 would produce for the same order. reason names the first cause.
func LegacyEditable(dash Obj) (ok bool, reason string) {
	return (*LegacyCache)(nil).Editable(dash)
}

// legacyForm returns the dashboard's legacy rendering when it is
// LegacyEditable, the reason when it is not, or an error when it is malformed.
// The input is not modified.
func legacyForm(dash Obj) (legacy Obj, reason string, err error) {
	if reason := v3FeatureReason(dash); reason != "" {
		return nil, reason, nil
	}
	legacy, err = DashboardToLegacy(dash)
	if errors.Is(err, ErrNotLegacyRepresentable) {
		return nil, err.Error(), nil
	}
	if err != nil {
		return nil, "", err
	}
	back, err := ConvertDashboardV2(legacy)
	if err != nil {
		return nil, "", fmt.Errorf("dashboard %v: %w", dash["id"], err)
	}
	orig, err := canonicalForCompare(dash)
	if err != nil {
		return nil, "", fmt.Errorf("dashboard %v: %w", dash["id"], err)
	}
	conv, err := canonicalForCompare(back)
	if err != nil {
		return nil, "", fmt.Errorf("dashboard %v: %w", dash["id"], err)
	}
	if reason := firstDiff(orig, conv); reason != "" {
		return nil, reason, nil
	}
	return legacy, "", nil
}

// v3FeatureReason names the first explicit v3-only feature: a tile at a tab
// root, a folder inside a folder, a free tab or folder, or a tab designWidth.
// Malformed shapes are ignored here (DashboardToLegacy reports them).
func v3FeatureReason(dash Obj) string {
	tabs, _ := dash["tabs"].([]any)
	for _, x := range tabs {
		t, _ := x.(Obj)
		if t == nil {
			continue
		}
		if t["layout"] == "free" {
			return fmt.Sprintf("tab %v uses the free layout", t["id"])
		}
		if _, has := t["designWidth"]; has {
			return fmt.Sprintf("tab %v has a designWidth (free layout)", t["id"])
		}
		root, _ := t["root"].(Obj)
		kids, _ := root["children"].([]any)
		for _, k := range kids {
			n, _ := k.(Obj)
			if n == nil {
				continue
			}
			if n["kind"] == "tile" {
				return fmt.Sprintf("tile %v sits at the root of tab %v, outside any folder", n["id"], t["id"])
			}
			if n["kind"] != "folder" {
				continue
			}
			if n["layout"] == "free" {
				return fmt.Sprintf("folder %v uses the free layout", n["id"])
			}
			content, _ := n["content"].(Obj)
			inner, _ := content["children"].([]any)
			for _, c := range inner {
				if cn, _ := c.(Obj); cn != nil && cn["kind"] == "folder" {
					return fmt.Sprintf("folder %v is nested inside folder %v", cn["id"], n["id"])
				}
			}
		}
	}
	return ""
}

// canonicalForCompare deep-copies a v3 dashboard without the four things
// FromLegacy carries from the stored one (revision, settings, defaultLayout,
// tab layout) and with every container's children sorted by placement, the
// order the legacy view shows them in.
func canonicalForCompare(dash Obj) (Obj, error) {
	d, err := deepCopy(dash)
	if err != nil {
		return nil, err
	}
	for _, k := range []string{"revision", "settings", "defaultLayout"} {
		delete(d, k)
	}
	tabs, _ := d["tabs"].([]any)
	for _, x := range tabs {
		t, _ := x.(Obj)
		if t == nil {
			continue
		}
		delete(t, "layout")
		if err := sortContainer(t["root"]); err != nil {
			return nil, fmt.Errorf("tab %v: %w", t["id"], err)
		}
	}
	return d, nil
}

func sortContainer(c any) error {
	co, _ := c.(Obj)
	if co == nil {
		return nil
	}
	kids, err := objList(co, "children")
	if err != nil {
		return err
	}
	sorted, err := sortByPlacement(kids)
	if err != nil {
		return err
	}
	l := make([]any, len(sorted))
	for i, k := range sorted {
		l[i] = k
		if k["kind"] == "folder" {
			if err := sortContainer(k["content"]); err != nil {
				return err
			}
		}
	}
	co["children"] = l
	return nil
}

// firstDiff compares a canonical dashboard with its canonical legacy round
// trip and names the first difference ("" when identical).
func firstDiff(orig, conv Obj) string {
	if k := diffKey(orig, conv, "tabs"); k != "" {
		return fmt.Sprintf("dashboard %v: %s differs from what the legacy editor saves", orig["id"], k)
	}
	ot, _ := orig["tabs"].([]any)
	ct, _ := conv["tabs"].([]any)
	if len(ot) != len(ct) {
		return fmt.Sprintf("dashboard %v: tabs differ from what the legacy editor saves", orig["id"])
	}
	for i := range ot {
		a, _ := ot[i].(Obj)
		b, _ := ct[i].(Obj)
		if k := diffKey(a, b, "root"); k != "" {
			return fmt.Sprintf("tab %v: %s differs from what the legacy editor saves", a["id"], k)
		}
		if r := containerDiff(fmt.Sprintf("tab %v", a["id"]), a["root"], b["root"]); r != "" {
			return r
		}
	}
	return ""
}

func containerDiff(where string, a, b any) string {
	ac, _ := a.(Obj)
	bc, _ := b.(Obj)
	if k := diffKey(ac, bc, "children"); k != "" {
		return fmt.Sprintf("%s: %s differs from the legacy grid", where, k)
	}
	ak, _ := ac["children"].([]any)
	bk, _ := bc["children"].([]any)
	if len(ak) != len(bk) {
		return fmt.Sprintf("%s: children differ from the legacy grid", where)
	}
	for i := range ak {
		an, _ := ak[i].(Obj)
		bn, _ := bk[i].(Obj)
		label := fmt.Sprintf("%v %v", an["kind"], an["id"])
		if k := diffKey(an, bn, "content"); k != "" {
			return fmt.Sprintf("%s: %s differs from the legacy grid", label, k)
		}
		if an["kind"] == "folder" {
			if r := containerDiff(label, an["content"], bn["content"]); r != "" {
				return r
			}
		}
	}
	return ""
}

// diffKey returns the first key (sorted) whose JSON differs between a and b,
// ignoring skip; "" when none.
func diffKey(a, b Obj, skip string) string {
	keys := map[string]bool{}
	for k := range a {
		keys[k] = true
	}
	for k := range b {
		keys[k] = true
	}
	sorted := make([]string, 0, len(keys))
	for k := range keys {
		if k != skip {
			sorted = append(sorted, k)
		}
	}
	sort.Strings(sorted)
	for _, k := range sorted {
		av, aok := a[k]
		bv, bok := b[k]
		if aok != bok {
			return k
		}
		aj, err1 := json.Marshal(av)
		bj, err2 := json.Marshal(bv)
		if err1 != nil || err2 != nil || !bytes.Equal(aj, bj) {
			return k
		}
	}
	return ""
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
	return sortByPlacement(kids)
}

// sortByPlacement returns kids sorted by (placement.y, placement.x) (stable).
func sortByPlacement(kids []Obj) ([]Obj, error) {
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
// `revision` and `defaultLayout`, and each matching tab's `layout`. Every prev
// dashboard that is not LegacyEditable (so never in the view) is carried over
// unchanged, in its original position relative to the others; a view that
// holds such a dashboard's id is refused with ErrV3OnlyDashboard. It does not
// check revisions; callers must do that first.
func FromLegacy(view Obj, prev Obj) (Obj, error) {
	return (*LegacyCache)(nil).FromLegacy(view, prev)
}

// FromLegacy is the package FromLegacy through the cache.
func (c *LegacyCache) FromLegacy(view Obj, prev Obj) (Obj, error) {
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
	inView := map[string]bool{}
	for _, d := range dashes {
		if id, ok := d.(Obj)["id"].(string); ok {
			inView[id] = true
		}
	}
	// v3-only dashboards, grouped by the nearest preceding prev dashboard
	// that is in the view ("" = before all of them).
	carried := map[string][]any{}
	anchor := ""
	for _, pd := range prevDashes {
		id, _ := pd["id"].(string)
		if ok, _ := c.Editable(pd); !ok {
			if inView[id] {
				return nil, fmt.Errorf("%w: %s", ErrV3OnlyDashboard, id)
			}
			carried[anchor] = append(carried[anchor], pd)
			continue
		}
		if inView[id] {
			anchor = id
		}
	}
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
	merged := append([]any{}, carried[""]...)
	for _, d := range dashes {
		merged = append(merged, d)
		if id, ok := d.(Obj)["id"].(string); ok && id != "" {
			merged = append(merged, carried[id]...)
		}
	}
	out["dashboards"] = merged
	return out, nil
}
