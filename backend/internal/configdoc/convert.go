package configdoc

import (
	"encoding/json"
	"fmt"
)

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

// SizeChange records one v2 tile whose size HOPS does not recognise (not
// small, medium or large, nor missing/empty), which the converter set to
// Medium (Ruling 3: a cosmetic value must not block the release migration,
// but the change is reported, never silent). Path is the tile's v2 path.
type SizeChange struct {
	Path        string `json:"path"`
	DashboardID string `json:"dashboardId"`
	TileID      string `json:"tileId"`
	TileName    string `json:"tileName"`
	OldSize     any    `json:"oldSize"`
}

// MigrateV2 deep-copies v2 and returns the v3 document, exactly as
// MigrateV2Full does, without the reports. Callers that store the result
// use MigrateV2Full and VerifyMigrationFull.
func MigrateV2(v2 Obj) (Obj, error) {
	doc, _, _, err := MigrateV2Full(v2)
	return doc, err
}

// MigrateV2Renaming is MigrateV2Full without the size report: its result
// verifies with VerifyMigration only when no tile size was normalised.
func MigrateV2Renaming(v2 Obj) (Obj, []Rename, error) {
	doc, renames, _, err := MigrateV2Full(v2)
	return doc, renames, err
}

// MigrateV2Full deep-copies v2, gives every repeated id a new deterministic
// one (see renameDuplicates) and converts the result to v3. It returns the
// renames and the normalised tile sizes in document order;
// VerifyMigrationFull checks the result against both. It never mutates its
// input.
func MigrateV2Full(v2 Obj) (Obj, []Rename, []SizeChange, error) {
	cp, err := deepCopy(v2)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("configdoc: copy v2 document: %w", err)
	}
	dashes, present := cp["dashboards"]
	var in []any
	if present && dashes != nil {
		var ok bool
		if in, ok = dashes.([]any); !ok {
			return nil, nil, nil, fmt.Errorf("configdoc: dashboards is %T, want array", dashes)
		}
	}
	renames := renameDuplicates(cp)
	var sizes []SizeChange
	out := make([]any, 0, len(in))
	for i, d := range in {
		dm, ok := d.(Obj)
		if !ok {
			return nil, nil, nil, fmt.Errorf("configdoc: dashboards[%d] is %T, want object", i, d)
		}
		nd, sc, err := convertDashboard(dm, fmt.Sprintf("dashboards[%d]", i))
		if err != nil {
			return nil, nil, nil, fmt.Errorf("configdoc: dashboards[%d]: %w", i, err)
		}
		out = append(out, nd)
		sizes = append(sizes, sc...)
	}
	cp["dashboards"] = out
	cp["schemaVersion"] = SchemaVersion
	cp[LayoutVersionKey] = LayoutVersion // written straight in the current form
	return cp, renames, sizes, nil
}

// ConvertDashboardV2 is ConvertDashboardV2Full without the size report.
func ConvertDashboardV2(d Obj) (Obj, error) {
	nd, _, err := ConvertDashboardV2Full(d)
	return nd, err
}

// ConvertDashboardV2Full converts one v2 dashboard (deep copy) to v3 with
// revision 1 and all-null settings. The size report's paths treat it as
// dashboards[0] of a one-dashboard document.
func ConvertDashboardV2Full(d Obj) (Obj, []SizeChange, error) {
	cp, err := deepCopy(d)
	if err != nil {
		return nil, nil, fmt.Errorf("configdoc: copy dashboard: %w", err)
	}
	return convertDashboard(cp, "dashboards[0]")
}

// convertDashboard converts an already-copied dashboard in place.
func convertDashboard(d Obj, path string) (Obj, []SizeChange, error) {
	// v2's perTabBackgrounds switch is written straight into the M4 form:
	// when it was off, each tab background becomes {inherit: true, …picture}
	// (kept, not shown); the switch itself is dropped.
	perTab := tabBackgroundsActive(d)
	delete(d, legacyPerTabKey)
	tabs, err := listOf(d, "tabs")
	if err != nil {
		return nil, nil, err
	}
	var sizes []SizeChange
	newTabs := make([]any, 0, len(tabs))
	for i, t := range tabs {
		tm, ok := t.(Obj)
		if !ok {
			return nil, nil, fmt.Errorf("tabs[%d] is %T, want object", i, t)
		}
		nt, sc, err := convertTab(tm, perTab, fmt.Sprintf("%s.tabs[%d]", path, i))
		if err != nil {
			return nil, nil, fmt.Errorf("tabs[%d]: %w", i, err)
		}
		newTabs = append(newTabs, nt)
		sizes = append(sizes, sc...)
	}
	dashID, _ := d["id"].(string)
	for i := range sizes {
		sizes[i].DashboardID = dashID
	}
	d["tabs"] = newTabs
	d["revision"] = 1
	settings := Obj{}
	for _, k := range settingsKeys {
		settings[k] = nil
	}
	d["settings"] = settings
	// Every tab is a grid tab (M5): no dashboard default layout.
	delete(d, "defaultLayout")
	return d, sizes, nil
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

func convertTab(t Obj, perTab bool, path string) (Obj, []SizeChange, error) {
	groups, err := listOf(t, "groups")
	if err != nil {
		return nil, nil, err
	}
	delete(t, "groups")
	children := make([]any, 0, len(groups))
	sizes := make([][2]int, len(groups))
	medium, _ := SizeSpan("medium")
	for i, g := range groups {
		gm, ok := g.(Obj)
		if !ok {
			return nil, nil, fmt.Errorf("groups[%d] is %T, want object", i, g)
		}
		perRow := groupWidth(gm)
		n := 0
		if es, ok := gm["entries"].([]any); ok {
			n = len(es)
		}
		// The folder's open box on the tab (Ruling 9): v2's footprint, perRow
		// Medium tiles wide, so groups that sat side by side in v2 still do,
		// and tall enough that every entry shows on page 1 at every grid width
		// (the padding takes a column, so a full v2 row wraps to a second
		// one). Never below the open-folder minimum (FolderBoxFor).
		w, h := FolderBoxFor(Obj{"contentSize": "medium"}, n, perRow*medium)
		sizes[i] = [2]int{w, h}
	}
	placed := packRowMajor(sizes, RootColumns)
	var changed []SizeChange
	for i, g := range groups {
		f, sc, err := convertGroup(g.(Obj), placed[i], fmt.Sprintf("%s.groups[%d]", path, i))
		if err != nil {
			return nil, nil, fmt.Errorf("groups[%d]: %w", i, err)
		}
		children = append(children, f)
		changed = append(changed, sc...)
	}
	// Every tab is a grid tab (M5): no per-tab layout or design width.
	delete(t, "layout")
	delete(t, "designWidth")
	delete(t, legacyEnabledKey)
	if bg, has := t["background"]; has && !perTab {
		f, err := inheritForm(bg)
		if err != nil {
			return nil, nil, err
		}
		t["background"] = f
	}
	t["root"] = Obj{"columns": RootColumns, "children": children}
	return t, changed, nil
}

// groupWidth is a v2 group's width in tiles per row (a v2 row held 12 tiles).
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

// convertGroup turns a v2 group into an M5 folder placed at p: Medium on the
// tab, Medium contents, and its entries as an ordered list of tiles with no
// placements, in v2 entry order (array order; v2 `order` is carried, never
// used to re-sort). A tile size HOPS does not recognise becomes Medium and is
// reported (Ruling 3).
func convertGroup(g Obj, p [4]int, path string) (Obj, []SizeChange, error) {
	entries, err := listOf(g, "entries")
	if err != nil {
		return nil, nil, err
	}
	delete(g, "entries")
	var changed []SizeChange
	tiles := make([]any, 0, len(entries))
	for i, e := range entries {
		em, ok := e.(Obj)
		if !ok {
			return nil, nil, fmt.Errorf("entries[%d] is %T, want object", i, e)
		}
		em["kind"] = "tile"
		if _, ok := SizeSpan(em["size"]); !ok {
			id, _ := em["id"].(string)
			name, _ := em["name"].(string)
			changed = append(changed, SizeChange{Path: fmt.Sprintf("%s.entries[%d]", path, i),
				TileID: id, TileName: name, OldSize: em["size"]})
			em["size"] = "medium"
		}
		tiles = append(tiles, em)
	}
	g["kind"] = "folder"
	delete(g, "layout")
	g["size"] = "medium"
	g["contentSize"] = "medium"
	if c, _ := g["collapsed"].(bool); c {
		g["display"] = "collapsed"
	} else {
		g["display"] = "expanded"
	}
	// M6 §3a.1, §3a.5: a v2 folder-style group is Flat; every other
	// converted folder (v2 header groups, Homer, Dashy, Heimdall) Rounded.
	if g["displayStyle"] == "folder" {
		g["shape"] = ShapeCreated
	} else {
		g["shape"] = ShapeConverted
	}
	g["showTitle"] = true
	g["placement"] = placement(p[0], p[1], p[2], p[3])
	g["content"] = Obj{"children": tiles}
	return g, changed, nil
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
