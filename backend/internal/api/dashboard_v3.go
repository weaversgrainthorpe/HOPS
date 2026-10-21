package api

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"reflect"
	"strings"
	"unicode/utf8"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// Request-body caps for the native v3 dashboard endpoints. A dashboard of
// MaxDashboardNodes items is a few MiB of JSON at most.
const (
	maxDashboardBodyBytes = 16 << 20 // PUT /api/dashboards/{id}, POST transfer
	maxSmallBodyBytes     = 1 << 20  // POST /api/dashboards, PUT order
	maxDashboardNameRunes = 200
)

// decodeBody reads one JSON value from the request, bounded to limit bytes.
// Trailing garbage and oversized bodies are visible errors, never silently cut.
func decodeBody(w http.ResponseWriter, req *http.Request, limit int64, v any) *apiError {
	req.Body = http.MaxBytesReader(w, req.Body, limit)
	dec := json.NewDecoder(req.Body)
	if err := dec.Decode(v); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return newAPIError(http.StatusRequestEntityTooLarge, fmt.Sprintf("Request body is larger than the %d MiB limit", limit>>20))
		}
		return newAPIError(http.StatusBadRequest, "Invalid JSON: "+err.Error())
	}
	return nil
}

// newUUID returns a random (version 4) UUID string.
func newUUID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}

// newNodeID is `${kind}-<uuid>`, the format of the frontend's newNodeId.
func newNodeID(kind string) (string, *apiError) {
	u, err := newUUID()
	if err != nil {
		return "", newAPIError(http.StatusInternalServerError, "Could not generate an id: "+err.Error())
	}
	return kind + "-" + u, nil
}

// pathClash is the 409 path_taken when another stored dashboard already
// serves path p. selfID is skipped (empty for a new dashboard).
func pathClash(stored configdoc.Obj, selfID, p string) *apiError {
	for id, d := range storedDashboards(stored) {
		if id == selfID {
			continue
		}
		if sp, _ := d["path"].(string); sp != "" && normPath(sp) == normPath(p) {
			e := newAPIError(http.StatusConflict, "path_taken")
			e.body["dashboardId"] = id
			e.body["path"] = p
			e.body["detail"] = fmt.Sprintf("Path %s is already used by the dashboard %s", p, dashboardLabel(d))
			return e
		}
	}
	return nil
}

// verifyErr maps a VerifyDashboard failure to a visible 400.
func verifyErr(err error) *apiError {
	return newAPIError(http.StatusBadRequest, "Invalid dashboard: "+verifyProblems(err))
}

// transientDashboardKeys are top-level keys of a GET /api/config or write
// response (or the document) that a client may echo back inside a dashboard;
// they are never dashboard content and are dropped rather than stored. The
// last two were keys of the retired legacy view: a cached old client may still
// echo them (Ruling 17). `display` is computed per GET (Ruling 9); `notices`
// is this process's one-time notices (notices.go). They are spelled in pieces so the retired-names scan
// (TestNoLegacyReferencesInBackend) keeps guarding real uses.
var transientDashboardKeys = map[string]bool{
	"schemaVersion": true, "layout": true, "migrationNotices": true, "notices": true, "display": true,
	"dashboard" + "Revisions": true, "v3" + "OnlyDashboards": true,
}

// handlePutDashboardV3 saves a dashboard written by the v3 editor. The body's
// settings are ignored (they have their own endpoint) and so is its revision
// beyond the conflict check: the stored one is bumped.
func (r *Router) handlePutDashboardV3(w http.ResponseWriter, id string, in configdoc.Obj, revision any) {
	r.updateDocWithBackup(w, func(stored configdoc.Obj) (configdoc.Obj, interface{}, error) {
		prev, ok := storedDashboards(stored)[id]
		if !ok {
			return nil, nil, newAPIError(http.StatusNotFound, "Dashboard not found: "+id)
		}
		if ce := checkRevision(id, prev, revision); ce != nil {
			return nil, nil, ce
		}
		if pathChanged(prev, in) {
			p, _ := in["path"].(string)
			if strings.TrimLeft(p, "/") == "" {
				return nil, nil, newAPIError(http.StatusBadRequest, "A dashboard path is required")
			}
			if pe := unsafePathError(in); pe != nil {
				return nil, nil, pe
			}
			if ce := pathClash(stored, id, p); ce != nil {
				return nil, nil, ce
			}
		}
		cur, rerr := storedRevision(id, prev)
		if rerr != nil {
			return nil, nil, rerr
		}
		nd := make(configdoc.Obj, len(in))
		for k, v := range in {
			if !transientDashboardKeys[k] {
				nd[k] = v
			}
		}
		nd["settings"] = prev["settings"]
		nd["revision"] = cur + 1
		if o, has := prev["order"]; has { // order has its own endpoint
			nd["order"] = o
		} else {
			delete(nd, "order")
		}
		if ne := nameBoundsError(nd); ne != nil {
			return nil, nil, ne
		}
		if err := configdoc.VerifyDashboard(nd); err != nil {
			return nil, nil, verifyErr(err)
		}
		return replaceDashboard(stored, id, nd), map[string]interface{}{"revision": cur + 1}, nil
	})
}

// nameBoundsError bounds the dashboard's name and its tabs' names to
// maxDashboardNameRunes, the same limit create and promote enforce. A visible
// 400, nothing stored. (Names that are not strings are left to VerifyDashboard.)
func nameBoundsError(d configdoc.Obj) *apiError {
	if n, ok := d["name"].(string); ok && utf8.RuneCountInString(n) > maxDashboardNameRunes {
		return newAPIError(http.StatusBadRequest, fmt.Sprintf("Dashboard name is longer than %d characters", maxDashboardNameRunes))
	}
	tabs, _ := d["tabs"].([]any)
	for _, t := range tabs {
		tm, _ := t.(configdoc.Obj)
		if n, ok := tm["name"].(string); ok && utf8.RuneCountInString(n) > maxDashboardNameRunes {
			return newAPIError(http.StatusBadRequest, fmt.Sprintf("Tab name is longer than %d characters", maxDashboardNameRunes))
		}
	}
	return nil
}

// handleDashboardsRoot serves /api/dashboards (no id): POST creates one.
func (r *Router) handleDashboardsRoot(w http.ResponseWriter, req *http.Request) {
	if !r.migrationGuard(w) {
		return
	}
	if req.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Name string `json:"name"`
		Path string `json:"path"`
	}
	if ae := decodeBody(w, req, maxSmallBodyBytes, &body); ae != nil {
		writeAPIError(w, ae)
		return
	}
	name := strings.TrimSpace(body.Name)
	switch {
	case name == "":
		writeJSONError(w, "A dashboard name is required", http.StatusBadRequest)
		return
	case utf8.RuneCountInString(name) > maxDashboardNameRunes:
		writeJSONError(w, fmt.Sprintf("Dashboard name is longer than %d characters", maxDashboardNameRunes), http.StatusBadRequest)
		return
	case strings.TrimLeft(body.Path, "/") == "":
		writeJSONError(w, "A dashboard path is required", http.StatusBadRequest)
		return
	}
	if why := dashboardPathProblem(body.Path); why != "" {
		writeJSONError(w, "Invalid path: the path "+why, http.StatusBadRequest)
		return
	}
	id, ae := newNodeID("dashboard")
	if ae != nil {
		writeAPIError(w, ae)
		return
	}
	tabID, ae := newNodeID("tab")
	if ae != nil {
		writeAPIError(w, ae)
		return
	}
	r.updateDocWithBackup(w, func(stored configdoc.Obj) (configdoc.Obj, interface{}, error) {
		if ce := pathClash(stored, id, body.Path); ce != nil {
			return nil, nil, ce
		}
		settings := configdoc.Obj{}
		for _, k := range settingJSONKeys() {
			settings[k] = nil
		}
		nd := configdoc.Obj{
			"id": id, "name": name, "path": body.Path, "revision": 1,
			"order":         nextOrder(stored),
			"settings":      settings,
			"defaultLayout": "grid",
			"tabs": []any{configdoc.Obj{
				"id": tabID, "name": "Home", "layout": "inherit",
				"root": configdoc.Obj{"columns": configdoc.RootColumns, "children": []any{}},
			}},
		}
		if err := configdoc.VerifyDashboard(nd); err != nil {
			return nil, nil, verifyErr(err)
		}
		list, _ := stored["dashboards"].([]any)
		stored["dashboards"] = append(list, nd)
		return stored, map[string]interface{}{"id": id, "revision": 1}, nil
	})
}

// nextOrder is one past the largest stored dashboard order (0 when none).
func nextOrder(stored configdoc.Obj) int {
	next := 0
	for _, d := range storedDashboards(stored) {
		if n, ok := toFloat(d["order"]); ok && int(n)+1 > next {
			next = int(n) + 1
		}
	}
	return next
}

// handleOrderDashboards rewrites every dashboard's `order` from the given id
// list. Order is not draft content, so no content revision is bumped.
func (r *Router) handleOrderDashboards(w http.ResponseWriter, req *http.Request) {
	var body struct {
		Order []string `json:"order"`
	}
	if ae := decodeBody(w, req, maxSmallBodyBytes, &body); ae != nil {
		writeAPIError(w, ae)
		return
	}
	r.updateDocWithBackup(w, func(stored configdoc.Obj) (configdoc.Obj, interface{}, error) {
		all := storedDashboards(stored)
		seen := map[string]bool{}
		for _, id := range body.Order {
			if _, ok := all[id]; !ok {
				return nil, nil, newAPIError(http.StatusBadRequest, "Unknown dashboard in order: "+id+". Reload and try again.")
			}
			if seen[id] {
				return nil, nil, newAPIError(http.StatusBadRequest, "Dashboard listed twice in order: "+id)
			}
			seen[id] = true
		}
		if len(seen) != len(all) {
			return nil, nil, newAPIError(http.StatusBadRequest,
				fmt.Sprintf("Order must list every dashboard exactly once (%d given, %d stored). Reload and try again.", len(seen), len(all)))
		}
		for i, id := range body.Order {
			all[id]["order"] = i
		}
		return stored, map[string]interface{}{"status": "ok"}, nil
	})
}

type transferRequest struct {
	Mode           string   `json:"mode"`
	SourceID       string   `json:"sourceId"`
	SourceRevision any      `json:"sourceRevision"`
	NodeIDs        []string `json:"nodeIds"`
	TargetID       string   `json:"targetId"`
	TargetRevision any      `json:"targetRevision"`
	Target         struct {
		TabID    string `json:"tabId"`
		FolderID string `json:"folderId"`
	} `json:"target"`
}

// handleTransferNodes moves or copies tiles/folders from one dashboard to
// another in one transaction. Copies get fresh ids; both dashboards'
// revisions are checked, and bumped when changed (the source only for a move).
func (r *Router) handleTransferNodes(w http.ResponseWriter, req *http.Request) {
	var body transferRequest
	if ae := decodeBody(w, req, maxDashboardBodyBytes, &body); ae != nil {
		writeAPIError(w, ae)
		return
	}
	bad := func(msg string) { writeJSONError(w, msg, http.StatusBadRequest) }
	switch {
	case body.Mode != "move" && body.Mode != "copy":
		bad(`mode must be "move" or "copy"`)
		return
	case body.SourceID == "" || body.TargetID == "":
		bad("sourceId and targetId are required")
		return
	case body.SourceID == body.TargetID:
		bad("Source and target are the same dashboard; drag the items inside the editor instead")
		return
	case len(body.NodeIDs) == 0:
		bad("nodeIds must list at least one item")
		return
	case len(body.NodeIDs) > configdoc.MaxDashboardNodes:
		bad(fmt.Sprintf("nodeIds lists more than %d items", configdoc.MaxDashboardNodes))
		return
	case body.Target.TabID == "":
		bad("target.tabId is required")
		return
	}
	want := map[string]bool{}
	for _, id := range body.NodeIDs {
		if id == "" || want[id] {
			bad("nodeIds must be non-empty and listed once each")
			return
		}
		want[id] = true
	}
	r.updateDocWithBackup(w, func(stored configdoc.Obj) (configdoc.Obj, interface{}, error) {
		all := storedDashboards(stored)
		src, ok := all[body.SourceID]
		if !ok {
			return nil, nil, newAPIError(http.StatusNotFound, "Dashboard not found: "+body.SourceID)
		}
		dst, ok := all[body.TargetID]
		if !ok {
			return nil, nil, newAPIError(http.StatusNotFound, "Dashboard not found: "+body.TargetID)
		}
		if ce := checkRevision(body.SourceID, src, body.SourceRevision); ce != nil {
			return nil, nil, ce
		}
		if ce := checkRevision(body.TargetID, dst, body.TargetRevision); ce != nil {
			return nil, nil, ce
		}
		found, ae := collectNodes(src, want)
		if ae != nil {
			return nil, nil, ae
		}
		container, mode, ae := resolveTarget(dst, body.Target.TabID, body.Target.FolderID)
		if ae != nil {
			return nil, nil, ae
		}
		space := newFreeSpaceCols(container, containerCols(container, mode, findTab(dst, body.Target.TabID)), freeCellBudget)
		for _, id := range body.NodeIDs { // the caller's order
			n := found[id]
			if body.Mode == "copy" {
				c, ae := cloneWithNewIDs(n)
				if ae != nil {
					return nil, nil, ae
				}
				n = c
			}
			from, _ := n["placement"].(configdoc.Obj)
			if from == nil {
				return nil, nil, newAPIError(http.StatusBadRequest, fmt.Sprintf("Item %v has no placement", n["id"]))
			}
			n["placement"] = space.place(from, mode)
			kids, _ := container["children"].([]any)
			container["children"] = append(kids, n)
		}
		if body.Mode == "move" {
			removeNodes(src, want)
		}
		dstRev, rerr := storedRevision(body.TargetID, dst)
		if rerr != nil {
			return nil, nil, rerr
		}
		srcRev, rerr := storedRevision(body.SourceID, src)
		if rerr != nil {
			return nil, nil, rerr
		}
		dst["revision"] = dstRev + 1
		if body.Mode == "move" {
			src["revision"] = srcRev + 1
			srcRev++
		}
		if err := configdoc.VerifyDashboard(dst); err != nil {
			return nil, nil, verifyErr(err)
		}
		return stored, map[string]interface{}{"sourceRevision": srcRev, "targetRevision": dstRev + 1}, nil
	})
}

// forEachContainer calls fn on every container of dashboard d (each tab root
// and each folder's content), with the node it belongs to (nil for a root).
func forEachContainer(d configdoc.Obj, fn func(c configdoc.Obj, owner configdoc.Obj)) {
	var walk func(c, owner configdoc.Obj)
	walk = func(c, owner configdoc.Obj) {
		fn(c, owner)
		kids, _ := c["children"].([]any)
		for _, k := range kids {
			if km, ok := k.(configdoc.Obj); ok && km["kind"] == "folder" {
				if content, ok := km["content"].(configdoc.Obj); ok {
					walk(content, km)
				}
			}
		}
	}
	tabs, _ := d["tabs"].([]any)
	for _, t := range tabs {
		if tm, ok := t.(configdoc.Obj); ok {
			if root, ok := tm["root"].(configdoc.Obj); ok {
				walk(root, nil)
			}
		}
	}
}

// collectNodes finds every wanted id in d. A missing id, or an id nested
// inside another wanted folder, is a 400 (the caller selected a stale or
// overlapping set).
func collectNodes(d configdoc.Obj, want map[string]bool) (map[string]configdoc.Obj, *apiError) {
	found := map[string]configdoc.Obj{}
	var nestedIn string
	forEachContainer(d, func(c, _ configdoc.Obj) {
		kids, _ := c["children"].([]any)
		for _, k := range kids {
			if km, ok := k.(configdoc.Obj); ok {
				if id, _ := km["id"].(string); want[id] {
					found[id] = km
				}
			}
		}
	})
	for id, n := range found {
		if n["kind"] != "folder" {
			continue
		}
		inner := map[string]bool{}
		forEachContainer(configdoc.Obj{"tabs": []any{configdoc.Obj{"root": n["content"]}}}, func(c, _ configdoc.Obj) {
			kids, _ := c["children"].([]any)
			for _, k := range kids {
				if km, ok := k.(configdoc.Obj); ok {
					if kid, _ := km["id"].(string); want[kid] {
						inner[kid] = true
						nestedIn = id
					}
				}
			}
		})
		if len(inner) > 0 {
			return nil, newAPIError(http.StatusBadRequest, "Items to transfer overlap: some are inside the selected folder "+nestedIn)
		}
	}
	for id := range want {
		if found[id] == nil {
			return nil, newAPIError(http.StatusBadRequest, "Item not found in the source dashboard: "+id+". Reload and try again.")
		}
	}
	return found, nil
}

// removeNodes deletes every wanted id from d's containers (in place).
func removeNodes(d configdoc.Obj, want map[string]bool) {
	forEachContainer(d, func(c, _ configdoc.Obj) {
		kids, _ := c["children"].([]any)
		kept := make([]any, 0, len(kids))
		for _, k := range kids {
			if km, ok := k.(configdoc.Obj); ok {
				if id, _ := km["id"].(string); want[id] {
					continue
				}
			}
			kept = append(kept, k)
		}
		c["children"] = kept
	})
}

// resolveTarget finds the container named by tab/folder in d and the layout
// mode it resolves to (folder chain, then tab, then the dashboard default).
func resolveTarget(d configdoc.Obj, tabID, folderID string) (configdoc.Obj, string, *apiError) {
	tabs, _ := d["tabs"].([]any)
	for _, t := range tabs {
		tm, ok := t.(configdoc.Obj)
		if !ok || tm["id"] != tabID {
			continue
		}
		root, ok := tm["root"].(configdoc.Obj)
		if !ok {
			break
		}
		concrete := func(v any) string {
			if s, _ := v.(string); s == "grid" || s == "free" {
				return s
			}
			return ""
		}
		fallback := concrete(tm["layout"])
		if fallback == "" {
			fallback = concrete(d["defaultLayout"])
		}
		if fallback == "" {
			fallback = "grid"
		}
		if folderID == "" {
			return root, fallback, nil
		}
		var path func(c configdoc.Obj, mode string) (configdoc.Obj, string)
		path = func(c configdoc.Obj, mode string) (configdoc.Obj, string) {
			kids, _ := c["children"].([]any)
			for _, k := range kids {
				km, ok := k.(configdoc.Obj)
				if !ok || km["kind"] != "folder" {
					continue
				}
				m := mode
				if cm := concrete(km["layout"]); cm != "" {
					m = cm
				}
				content, ok := km["content"].(configdoc.Obj)
				if !ok {
					continue
				}
				if km["id"] == folderID {
					return content, m
				}
				if f, fm := path(content, m); f != nil {
					return f, fm
				}
			}
			return nil, ""
		}
		if f, m := path(root, fallback); f != nil {
			return f, m, nil
		}
		return nil, "", newAPIError(http.StatusBadRequest, "Target folder not found: "+folderID)
	}
	return nil, "", newAPIError(http.StatusBadRequest, "Target tab not found: "+tabID)
}

// cloneWithNewIDs deep-copies a node, giving it and every descendant a fresh
// `${kind}-<uuid>` id.
func cloneWithNewIDs(n configdoc.Obj) (configdoc.Obj, *apiError) {
	b, err := json.Marshal(n)
	if err != nil {
		return nil, newAPIError(http.StatusInternalServerError, "Failed to copy item: "+err.Error())
	}
	var c configdoc.Obj
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, newAPIError(http.StatusInternalServerError, "Failed to copy item: "+err.Error())
	}
	var rename func(x configdoc.Obj) *apiError
	rename = func(x configdoc.Obj) *apiError {
		kind, _ := x["kind"].(string)
		id, ae := newNodeID(kind)
		if ae != nil {
			return ae
		}
		x["id"] = id
		if kind == "folder" {
			content, _ := x["content"].(configdoc.Obj)
			kids, _ := content["children"].([]any)
			for _, k := range kids {
				if km, ok := k.(configdoc.Obj); ok {
					if ae := rename(km); ae != nil {
						return ae
					}
				}
			}
		}
		return nil
	}
	if ae := rename(c); ae != nil {
		return nil, ae
	}
	return c, nil
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, !math.IsNaN(n) && !math.IsInf(n, 0)
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	}
	return 0, false
}

// rect reads a placement's x, y, w, h.
func rect(p any) (x, y, w, h float64, ok bool) {
	pm, isObj := p.(configdoc.Obj)
	if !isObj {
		return 0, 0, 0, 0, false
	}
	var o [4]bool
	x, o[0] = toFloat(pm["x"])
	y, o[1] = toFloat(pm["y"])
	w, o[2] = toFloat(pm["w"])
	h, o[3] = toFloat(pm["h"])
	return x, y, w, h, o[0] && o[1] && o[2] && o[3]
}

// freeCellBudget is the total number of box comparisons one request may spend
// searching for free cells, across every node it places. Once spent, cells go
// below everything already placed, so a crafted container plus a large
// transfer cannot stall the server (the update function runs twice per
// request, each run with its own budget).
const freeCellBudget = 2_000_000

type box struct{ x, y, w, h float64 }

// freeSpace is a container's occupied boxes, grown as nodes are placed.
type freeSpace struct {
	cols   float64
	taken  []box
	bottom float64
	budget int
}

func newFreeSpace(c configdoc.Obj, budget int) *freeSpace {
	cols := float64(configdoc.RootColumns)
	if n, ok := toFloat(c["columns"]); ok && math.Floor(n) >= 1 {
		cols = math.Floor(n)
	}
	return newFreeSpaceCols(c, cols, budget)
}

// newFreeSpaceCols is newFreeSpace with an explicit width (a free tab root's
// extent is its design width, not its nominal columns).
func newFreeSpaceCols(c configdoc.Obj, cols float64, budget int) *freeSpace {
	fs := &freeSpace{cols: cols, budget: budget}
	kids, _ := c["children"].([]any)
	for _, k := range kids {
		if km, ok := k.(configdoc.Obj); ok && renderableNode(km) {
			x, y, w, h, _ := rect(km["placement"])
			fs.add(box{x, y, w, h})
		}
	}
	return fs
}

func (fs *freeSpace) add(b box) {
	fs.taken = append(fs.taken, b)
	fs.bottom = math.Max(fs.bottom, b.y+b.h)
}

// renderableNode mirrors the frontend's isRenderable: a tile or folder with
// a finite placement (a folder also needs a content.children array).
func renderableNode(n configdoc.Obj) bool {
	if n["kind"] != "tile" && n["kind"] != "folder" {
		return false
	}
	if _, _, _, _, ok := rect(n["placement"]); !ok {
		return false
	}
	if n["kind"] == "folder" {
		content, _ := n["content"].(configdoc.Obj)
		if _, ok := content["children"].([]any); !ok {
			return false
		}
	}
	return true
}

// place is the Go twin of the frontend's firstFreeCell (treeOps.ts): the first
// w x h position overlapping nothing, recorded as taken. Grid scans row-major
// one cell at a time; free scans in tile-sized steps. Width is capped at the
// column count and w and h are clamped to at least 1, as the frontend does;
// z is carried.
func (fs *freeSpace) place(from configdoc.Obj, mode string) configdoc.Obj {
	w, _ := toFloat(from["w"])
	h, _ := toFloat(from["h"])
	cw := math.Min(math.Max(1, math.Floor(w)), fs.cols)
	chh := math.Max(1, math.Floor(h))
	stepX, stepY := 1.0, 1.0
	if mode == "free" {
		stepX, stepY = cw, chh
	}
	x, y := 0.0, math.Ceil(fs.bottom/stepY)*stepY
search:
	for cy := 0.0; cy <= fs.bottom; cy += stepY {
		for cx := 0.0; cx+cw <= fs.cols; cx += stepX {
			free := true
			for _, t := range fs.taken {
				if fs.budget--; fs.budget < 0 {
					break search // spent: keep the fallback below everything
				}
				if cx < t.x+t.w && t.x < cx+cw && cy < t.y+t.h && t.y < cy+chh {
					free = false
					break
				}
			}
			if free {
				x, y = cx, cy
				break search
			}
		}
	}
	fs.add(box{x, y, cw, chh})
	out := configdoc.Obj{"x": x, "y": y, "w": cw, "h": chh}
	if z, ok := from["z"]; ok {
		out["z"] = z
	}
	return out
}

// findTab returns the tab with id in dashboard d, or nil.
func findTab(d configdoc.Obj, id string) configdoc.Obj {
	tabs, _ := d["tabs"].([]any)
	for _, t := range tabs {
		if tm, ok := t.(configdoc.Obj); ok && tm["id"] == id {
			return tm
		}
	}
	return nil
}

// freeSideOf is one grid cell in free design units for a tab (Ruling 2):
// exactly half the old 12-column side, round(designWidth / 12 / 8) / 2 —
// 6.5 at 1280, 10 at 1920 — the frontend's freeSideOf (geometry.ts). It may
// be fractional; every conversion rounds its result to whole units.
//
// Why half the old side rather than round(designWidth / 24 / 8) (7 at 1280):
// free layouts made by the old grid→free conversion sit on multiples of the
// old side, which map to whole doubled cells and back exactly (52 → 8 cells →
// 52), and a full-width grid row is 24 · 6.5 = 156 units, exactly the old
// 12 · 13, so it still fits a 1280 free root (160). With 7 the same row would
// be 168 (wider than the root) and 52 would drift to 49.
func freeSideOf(tab configdoc.Obj) float64 {
	dw, ok := toFloat(tab["designWidth"])
	if !ok || dw <= 0 {
		dw = 1280
	}
	oldSide := math.Max(1, math.Round(dw/(configdoc.RootColumns/configdoc.GridUnit)/8))
	return oldSide / configdoc.GridUnit
}

// containerCols is the width placements may use in a container: its columns,
// except a free tab root, whose extent is the tab's design width in 8 px units.
func containerCols(c configdoc.Obj, mode string, tab configdoc.Obj) float64 {
	if root, _ := tab["root"].(configdoc.Obj); mode == "free" && isSameObj(root, c) {
		dw, ok := toFloat(tab["designWidth"])
		if !ok || dw <= 0 {
			dw = 1280
		}
		return math.Max(1, math.Floor(dw/8))
	}
	if n, ok := toFloat(c["columns"]); ok && math.Floor(n) >= 1 {
		return math.Floor(n)
	}
	return configdoc.RootColumns
}

// isSameObj reports whether a and b are the same map (not just equal).
func isSameObj(a, b configdoc.Obj) bool {
	if a == nil || b == nil {
		return false
	}
	return reflect.ValueOf(a).UnsafePointer() == reflect.ValueOf(b).UnsafePointer()
}
