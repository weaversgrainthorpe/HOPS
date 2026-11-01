package api

import (
	"crypto/sha256"
	"encoding/hex"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// The index-plus-one read: GET /api/config?dashboard=<path-or-id> serves the
// same document as GET /api/config, but only the requested dashboard in full;
// every other dashboard is an index entry. The index carries exactly what a
// viewer reads from a dashboard that is not open (audit of frontend/src):
//
//	id, name, path  the switcher (Navbar navDashboards), dashboardHref, and
//	                resolveDashboardRoute (path first, then id)
//	order           display order: the switcher and the "/" redirect
//	revision        per-dashboard staleness check (a newer one reloads)
//	display         animations switches, read per dashboard by the animation
//	                gates (animatedFolderBackgroundsFor, dropAnimation)
//	settings        dashboard settings the status-check tooltips name
//	                (disabledTooltip / levelNameIn)
//	header          the navbar's title and text while a dashboard opened
//	                before the rest arrived is fetched
//	partial: true   this entry has no tabs; the client must fetch it before use
//
// Nothing else is in an entry: tabs, background and the rest only matter once
// a dashboard is open. Tile-level reads (Home/Away URLs, Recently used) work on
// the open dashboard only.
var indexKeys = []string{"id", "name", "path", "order", "revision", "display", "settings", "header"}

// shapeIndexPlusOne rewrites view["dashboards"] in place: the dashboard that
// `key` selects stays full; the rest become index entries. key is resolved as
// the frontend resolves a URL segment, and an empty key or "/" means the
// dashboard "/" forwards to (the first in display order). An unknown key
// leaves every entry partial and sets "missing", so the client decides the
// redirect exactly as it does today. Every response carries configRevision.
func shapeIndexPlusOne(view map[string]interface{}, key string) {
	chosen := findDashboardForRoute(view, key)
	if chosen == nil && strings.Trim(key, "/") != "" {
		view["missing"] = key
	}
	list, _ := view["dashboards"].([]any)
	out := make([]any, 0, len(list))
	for _, d := range list {
		dm, ok := d.(configdoc.Obj)
		if !ok || (chosen != nil && sameDashboard(dm, chosen)) {
			out = append(out, d)
			continue
		}
		e := make(configdoc.Obj, len(indexKeys)+1)
		for _, k := range indexKeys {
			if v, has := dm[k]; has {
				e[k] = v
			}
		}
		e["partial"] = true
		out = append(out, e)
	}
	view["dashboards"] = out
	view["configRevision"] = configRevision(view)
}

func sameDashboard(a, b configdoc.Obj) bool { return a["id"] == b["id"] }

// findDashboardForRoute is resolveDashboardRoute (frontend stores/config.ts):
// a path match (leading slashes ignored) wins over an id match. An empty key
// is the "/" route: the first dashboard in display order (sortedDashboards).
func findDashboardForRoute(view map[string]interface{}, key string) configdoc.Obj {
	list, _ := view["dashboards"].([]any)
	var all []configdoc.Obj
	for _, d := range list {
		if dm, ok := d.(configdoc.Obj); ok {
			all = append(all, dm)
		}
	}
	bare := strings.TrimLeft(key, "/")
	if bare == "" {
		sorted := append([]configdoc.Obj(nil), all...)
		sort.SliceStable(sorted, func(i, j int) bool { return orderKey(sorted[i]) < orderKey(sorted[j]) })
		if len(sorted) == 0 {
			return nil
		}
		return sorted[0]
	}
	want := normPath(key)
	for _, d := range all {
		if p, _ := d["path"].(string); normPath(p) == want {
			return d
		}
	}
	for _, d := range all {
		if id, _ := d["id"].(string); id == bare {
			return d
		}
	}
	return nil
}

// orderKey is the frontend's sort key: a finite numeric `order`, else last.
func orderKey(d configdoc.Obj) float64 {
	if f, ok := d["order"].(float64); ok && !math.IsInf(f, 0) && !math.IsNaN(f) {
		return f
	}
	return math.Inf(1)
}

// configRevision identifies the set of dashboards and their revisions as a
// whole. The stored document has no counter of its own (revisions are per
// dashboard), so this is a short fingerprint of each dashboard's id, path,
// order, name and revision in document order: it changes when any dashboard is
// saved, added, removed, renamed or reordered. Compare for equality only.
func configRevision(view map[string]interface{}) string {
	h := sha256.New()
	list, _ := view["dashboards"].([]any)
	for _, d := range list {
		dm, ok := d.(configdoc.Obj)
		if !ok {
			continue
		}
		for _, k := range []string{"id", "path", "name", "order", "revision"} {
			switch v := dm[k].(type) {
			case string:
				h.Write([]byte(v))
			case float64:
				h.Write([]byte(strconv.FormatFloat(v, 'g', -1, 64)))
			}
			h.Write([]byte{0})
		}
		h.Write([]byte{1})
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}
