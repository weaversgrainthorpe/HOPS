// Package configdoc defines the v3 tree-shaped HOPS config document and the
// pure (no DB, no HTTP) operations on it. Documents are raw JSON maps so that
// every key present in stored data survives untouched.
package configdoc

import "errors"

// Obj is a raw JSON object.
type Obj = map[string]any

const (
	// SchemaVersion is the document schema version produced by this package.
	SchemaVersion = 3
	// RootColumns is the column count of every tab root: every tab is a
	// 24-column grid (layout.go).
	RootColumns = 24
)

// ErrNotV3 is returned when a document is not schemaVersion 3.
var ErrNotV3 = errors.New("configdoc: document is not schemaVersion 3")

// IsV3 reports whether doc carries schemaVersion 3.
func IsV3(doc Obj) bool {
	v, ok := doc["schemaVersion"].(float64)
	if ok {
		return v == SchemaVersion
	}
	i, ok := doc["schemaVersion"].(int)
	return ok && i == SchemaVersion
}

// Walk visits every folder and tile, depth-first in array order. path holds
// the ancestor folders of node. Returning false from fn stops the walk.
func Walk(doc Obj, fn func(dash Obj, tab Obj, path []Obj, node Obj) bool) {
	dashes, _ := doc["dashboards"].([]any)
	for _, d := range dashes {
		dash, _ := d.(Obj)
		if dash == nil {
			continue
		}
		tabs, _ := dash["tabs"].([]any)
		for _, t := range tabs {
			tab, _ := t.(Obj)
			if tab == nil {
				continue
			}
			root, _ := tab["root"].(Obj)
			if !walkChildren(dash, tab, nil, root, fn) {
				return
			}
		}
	}
}

func walkChildren(dash, tab Obj, path []Obj, container Obj, fn func(Obj, Obj, []Obj, Obj) bool) bool {
	children, _ := container["children"].([]any)
	for _, c := range children {
		node, _ := c.(Obj)
		if node == nil {
			continue
		}
		if !fn(dash, tab, path, node) {
			return false
		}
		if node["kind"] == "folder" {
			content, _ := node["content"].(Obj)
			// Copy so callers retaining path never see later appends.
			sub := append(append([]Obj(nil), path...), node)
			if !walkChildren(dash, tab, sub, content, fn) {
				return false
			}
		}
	}
	return true
}

// FindTile returns the tile with the given id and its owning dashboard.
func FindTile(doc Obj, id string) (dash Obj, tile Obj, ok bool) {
	Walk(doc, func(d, _ Obj, _ []Obj, n Obj) bool {
		if n["kind"] == "tile" && n["id"] == id {
			dash, tile, ok = d, n, true
			return false
		}
		return true
	})
	return
}

// FindTileWithAncestors returns the tile with the given id and every level
// above it: its dashboard, its tab and its ancestor folders (outermost
// first), as EffectiveStatusChecks takes them.
func FindTileWithAncestors(doc Obj, id string) (dash, tab Obj, folders []Obj, tile Obj, ok bool) {
	Walk(doc, func(d, t Obj, path []Obj, n Obj) bool {
		if n["kind"] == "tile" && n["id"] == id {
			dash, tab, folders, tile, ok = d, t, path, n, true
			return false
		}
		return true
	})
	return
}
