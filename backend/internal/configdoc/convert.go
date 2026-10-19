package configdoc

import (
	"encoding/json"
	"fmt"
)

var settingsKeys = []string{
	"statusChecksEnabled", "statusCheckIntervalMinutes", "statusCheckTimeoutSeconds",
	"editIdleTimeoutMinutes", "animatedFolderBackgrounds", "defaultLayout",
}

func deepCopy(o Obj) (Obj, error) {
	b, err := json.Marshal(o)
	if err != nil {
		return nil, err
	}
	var out Obj
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// MigrateV2 deep-copies v2 and returns the v3 document. It never mutates its
// input and does not check ID uniqueness (Verify does).
func MigrateV2(v2 Obj) (Obj, error) {
	cp, err := deepCopy(v2)
	if err != nil {
		return nil, fmt.Errorf("configdoc: copy v2 document: %w", err)
	}
	dashes, present := cp["dashboards"]
	var in []any
	if present && dashes != nil {
		var ok bool
		if in, ok = dashes.([]any); !ok {
			return nil, fmt.Errorf("configdoc: dashboards is %T, want array", dashes)
		}
	}
	out := make([]any, 0, len(in))
	for i, d := range in {
		dm, ok := d.(Obj)
		if !ok {
			return nil, fmt.Errorf("configdoc: dashboards[%d] is %T, want object", i, d)
		}
		nd, err := convertDashboard(dm)
		if err != nil {
			return nil, fmt.Errorf("configdoc: dashboards[%d]: %w", i, err)
		}
		out = append(out, nd)
	}
	cp["dashboards"] = out
	cp["schemaVersion"] = SchemaVersion
	return cp, nil
}

// ConvertDashboardV2 converts one v2 dashboard (deep copy) to v3 with revision 1
// and all-null settings.
func ConvertDashboardV2(d Obj) (Obj, error) {
	cp, err := deepCopy(d)
	if err != nil {
		return nil, fmt.Errorf("configdoc: copy dashboard: %w", err)
	}
	return convertDashboard(cp)
}

// convertDashboard converts an already-copied dashboard in place.
func convertDashboard(d Obj) (Obj, error) {
	perTab, _ := d["perTabBackgrounds"].(bool)
	tabs, err := listOf(d, "tabs")
	if err != nil {
		return nil, err
	}
	newTabs := make([]any, 0, len(tabs))
	for i, t := range tabs {
		tm, ok := t.(Obj)
		if !ok {
			return nil, fmt.Errorf("tabs[%d] is %T, want object", i, t)
		}
		nt, err := convertTab(tm, perTab)
		if err != nil {
			return nil, fmt.Errorf("tabs[%d]: %w", i, err)
		}
		newTabs = append(newTabs, nt)
	}
	d["tabs"] = newTabs
	d["revision"] = 1
	settings := Obj{}
	for _, k := range settingsKeys {
		settings[k] = nil
	}
	d["settings"] = settings
	d["defaultLayout"] = "grid"
	return d, nil
}

func listOf(o Obj, key string) ([]any, error) {
	v, ok := o[key]
	if !ok || v == nil {
		return nil, nil
	}
	l, ok := v.([]any)
	if !ok {
		return nil, fmt.Errorf("%s is %T, want array", key, v)
	}
	return l, nil
}

func convertTab(t Obj, perTab bool) (Obj, error) {
	groups, err := listOf(t, "groups")
	if err != nil {
		return nil, err
	}
	delete(t, "groups")
	children := make([]any, 0, len(groups))
	sizes := make([][2]int, len(groups))
	widths := make([]int, len(groups))
	for i, g := range groups {
		gm, ok := g.(Obj)
		if !ok {
			return nil, fmt.Errorf("groups[%d] is %T, want object", i, g)
		}
		w := groupWidth(gm)
		n := 0
		if es, ok := gm["entries"].([]any); ok {
			n = len(es)
		}
		widths[i] = w
		sizes[i] = [2]int{w, max(1, ceilDiv(n, w)) + 1}
	}
	placed := packRowMajor(sizes, RootColumns)
	for i, g := range groups {
		f, err := convertGroup(g.(Obj), widths[i], placed[i])
		if err != nil {
			return nil, fmt.Errorf("groups[%d]: %w", i, err)
		}
		children = append(children, f)
	}
	t["layout"] = "inherit"
	if _, has := t["background"]; has {
		t["backgroundEnabled"] = perTab
	}
	t["root"] = Obj{"columns": RootColumns, "children": children}
	return t, nil
}

func groupWidth(g Obj) int {
	switch g["width"] {
	case "half":
		return 6
	case "third":
		return 4
	}
	return 12
}

func ceilDiv(a, b int) int { return (a + b - 1) / b }

func placement(x, y, w, h int) Obj {
	return Obj{"x": x, "y": y, "w": w, "h": h}
}

func convertGroup(g Obj, w int, p [4]int) (Obj, error) {
	entries, err := listOf(g, "entries")
	if err != nil {
		return nil, err
	}
	delete(g, "entries")
	tiles := make([]any, 0, len(entries))
	for i, e := range entries {
		em, ok := e.(Obj)
		if !ok {
			return nil, fmt.Errorf("entries[%d] is %T, want object", i, e)
		}
		em["kind"] = "tile"
		em["placement"] = placement(i%w, i/w, 1, 1)
		tiles = append(tiles, em)
	}
	g["kind"] = "folder"
	g["layout"] = "inherit"
	if c, _ := g["collapsed"].(bool); c {
		g["display"] = "collapsed"
	} else {
		g["display"] = "expanded"
	}
	if g["displayStyle"] == "folder" {
		g["shape"] = "folder-tab"
	} else {
		g["shape"] = "rounded"
	}
	g["showTitle"] = true
	g["placement"] = placement(p[0], p[1], p[2], p[3])
	g["content"] = Obj{"columns": w, "children": tiles}
	return g, nil
}

// packRowMajor shelf-packs (w,h) sizes left to right into columns, starting a
// new shelf at y = max(y+h) of the current shelf when an item does not fit.
func packRowMajor(sizes [][2]int, columns int) [][4]int {
	out := make([][4]int, len(sizes))
	x, shelfY, shelfBottom := 0, 0, 0
	for i, s := range sizes {
		w, h := s[0], s[1]
		if x+w > columns && x > 0 {
			shelfY = shelfBottom
			x = 0
		}
		out[i] = [4]int{x, shelfY, w, h}
		x += w
		shelfBottom = max(shelfBottom, shelfY+h)
	}
	return out
}
