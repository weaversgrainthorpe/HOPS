package configdoc

import (
	"fmt"
	"sort"
	"strings"
)

// The fields HOPS knows, per level of a dashboard: THE one list. A dashboard
// keeps every key it is given (documents are raw maps), so a field not listed
// here is kept but nothing reads it; an import names such fields rather than
// keeping them silently (UnknownFields). The lists are what the code reads and
// writes: this package (layout, verify, convert, backgrounds, status checks,
// away addresses), the editor's types (frontend/src/lib/types) and the v2
// fields the converter carries over unchanged (marked v2). testdata/
// known_fields.json is the same lists for the frontend's check; a test keeps
// the two equal.
var (
	// DashboardFields: transientDashboardKeys (api) are dropped before an
	// import is checked, so they are not listed.
	DashboardFields = []string{
		"id", "name", "path", "revision", "order", "settings", "header", "background", "tabs",
		"theme", // v2 dashboard colour; carried, unused
	}
	// TabFields is a tab's.
	TabFields = []string{
		"id", "name", "icon", "iconUrl", "iconBgColor", "color", "opacity", "textColor",
		"background", "statusChecksEnabled", "root",
		"order", // v2 tab order; carried
	}
	// TileFields is a tile's (the frontend's Entry, plus its kind and placement).
	TileFields = []string{
		"id", "kind", "type", "name", "url", AwayURLKey, "icon", "iconUrl", "iconBgColor", "description",
		"openMode", "statusCheck", "size", "color", "opacity", "textOpacity", "iconOpacity", "textColor",
		"order", "showStatus", "placement",
	}
	// FolderFields is a folder's.
	FolderFields = []string{
		"id", "kind", "name", "description", "icon", "iconUrl", "iconBgColor", "color", "opacity",
		"textColor", "display", "size", "contentSize", "shape", "tabPosition", "minimisedIcon",
		"showTitle", "background", "statusChecksEnabled", "placement", "content",
		"order", // v2 group order; carried
	}
	// ContainerFields is a tab's root or a folder's content.
	ContainerFields = []string{"columns", "children"}
	// PlacementFields is a tab-level item's place on the grid.
	PlacementFields = []string{"x", "y", "w", "h", "z"}
	// BackgroundFields is a dashboard's, tab's or folder's background (either form).
	BackgroundFields = []string{
		"type", "inherit", "opacity", "value", "images", "interval", "fit", "transition",
		"transitionDuration", "overlayOpacity", "overlayBlur",
	}
	// StatusCheckFields is a tile's statusCheck.
	StatusCheckFields = []string{"type", "enabled", "interval"}
	// HeaderFields is a dashboard's header.
	HeaderFields = []string{"leftText", "centerTitle", "showLeft", "showCenter"}
	// ThemeFields is a v2 dashboard's theme.
	ThemeFields = []string{"color", "opacity"}
)

// KnownFields is every list by level name, as testdata/known_fields.json
// holds it. A dashboard's settings are SettingKeys.
func KnownFields() map[string][]string {
	sorted := func(l []string) []string {
		out := append([]string(nil), l...)
		sort.Strings(out)
		return out
	}
	return map[string][]string{
		"dashboard":   sorted(DashboardFields),
		"tab":         sorted(TabFields),
		"tile":        sorted(TileFields),
		"folder":      sorted(FolderFields),
		"container":   sorted(ContainerFields),
		"placement":   sorted(PlacementFields),
		"background":  sorted(BackgroundFields),
		"statusCheck": sorted(StatusCheckFields),
		"header":      sorted(HeaderFields),
		"theme":       sorted(ThemeFields),
		"settings":    sorted(settingsKeys),
	}
}

// UnknownField is one field of a dashboard HOPS does not know.
type UnknownField struct {
	// Path is the field's place in the dashboard as stored, e.g.
	// tabs[0].root.children[2].foo.
	Path string
	// Where is the same place in words: tab "Home" › tile "Plex" › foo.
	Where string
}

// UnknownFields lists every field of dashboard d (its tabs, items at any depth
// and their nested objects) that is not in the lists above, in document
// order (keys of one object alphabetically). A nested value of the wrong type
// is left to the verifier; only objects are looked inside.
func UnknownFields(d Obj) []UnknownField {
	var out []UnknownField
	add := func(o Obj, known []string, path, where string) {
		for _, k := range unknownKeys(o, known) {
			out = append(out, UnknownField{Path: joinPath(path, k), Where: joinWhere(where, k)})
		}
	}
	// nested checks o's object-valued key against known, under "key." names.
	nested := func(o Obj, key string, known []string, path, where string) {
		if sub, ok := o[key].(Obj); ok {
			add(sub, known, joinPath(path, key), joinWhere(where, key+"."))
		}
	}
	add(d, DashboardFields, "", "")
	nested(d, "settings", settingsKeys, "", "")
	nested(d, "header", HeaderFields, "", "")
	nested(d, "theme", ThemeFields, "", "")
	nested(d, "background", BackgroundFields, "", "")
	var walk func(c Obj, path, where string)
	walk = func(c Obj, path, where string) {
		add(c, ContainerFields, path, where)
		kids, _ := c["children"].([]any)
		for i, k := range kids {
			n, ok := k.(Obj)
			if !ok {
				continue
			}
			np := fmt.Sprintf("%s.children[%d]", path, i)
			kind, _ := n["kind"].(string)
			nw := joinWhere(where, fmt.Sprintf("%s %s", kindWord(kind), quotedName(n)))
			nested(n, "placement", PlacementFields, np, nw)
			switch kind {
			case "tile":
				add(n, TileFields, np, nw)
				nested(n, "statusCheck", StatusCheckFields, np, nw)
			case "folder":
				add(n, FolderFields, np, nw)
				nested(n, "background", BackgroundFields, np, nw)
				if content, ok := n["content"].(Obj); ok {
					walk(content, np+".content", nw)
				}
			}
			// Any other kind is refused by the verifier.
		}
	}
	tabs, _ := d["tabs"].([]any)
	for i, t := range tabs {
		tm, ok := t.(Obj)
		if !ok {
			continue
		}
		tp := fmt.Sprintf("tabs[%d]", i)
		tw := "tab " + quotedName(tm)
		add(tm, TabFields, tp, tw)
		nested(tm, "background", BackgroundFields, tp, tw)
		if root, ok := tm["root"].(Obj); ok {
			walk(root, tp+".root", tw)
		}
	}
	return out
}

func unknownKeys(o Obj, known []string) []string {
	var out []string
	for k := range o {
		if !containsString(known, k) {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

func containsString(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}

func joinPath(path, k string) string {
	if path == "" {
		return k
	}
	return path + "." + k
}

// joinWhere adds k to a words path: "a › b", or "a › background.k" after a
// nested object's "background." prefix.
func joinWhere(where, k string) string {
	switch {
	case where == "":
		return k
	case strings.HasSuffix(where, "."):
		return where + k
	}
	return where + " › " + k
}

func kindWord(kind string) string {
	if kind == "tile" || kind == "folder" {
		return kind
	}
	return "item"
}

// quotedName is an object's name in quotes, or "Untitled".
func quotedName(o Obj) string {
	name, _ := o["name"].(string)
	if strings.TrimSpace(name) == "" {
		name = "Untitled"
	}
	return fmt.Sprintf("%q", trunc(name))
}
