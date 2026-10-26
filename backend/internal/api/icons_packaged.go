package api

import (
	"io/fs"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/assets"
	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// Settings › Icons › Packaged icons: what ships with HOPS, counted from the
// real sources (the embedded Dashboard Icons files and the database's preset
// rows), and "where used" for packaged icons. Kept apart from the upload and
// delete code in icons_manage.go.

const dashboardIconURLPrefix = "/api/icons/dashboard/"

// shippedDashboardIcons lists the embedded Dashboard Icons SVGs by bare name
// (no ".svg"), sorted. An unreadable embed is an error, never an empty list.
func shippedDashboardIcons() ([]string, error) {
	entries, err := fs.ReadDir(assets.DashboardIcons, "dashboard-icons")
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".svg") {
			continue
		}
		names = append(names, strings.TrimSuffix(e.Name(), ".svg"))
	}
	sort.Strings(names)
	return names, nil
}

// handlePackagedIcons: GET /api/icons/packaged (admin). The Dashboard Icons
// shipped (every embedded SVG, light/dark variants included), how many of them
// are icon-library rows, and how many preset library (Iconify) rows there are.
func (r *Router) handlePackagedIcons(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	names, err := shippedDashboardIcons()
	if err != nil {
		slog.Error("packaged icons: could not read the embedded Dashboard Icons", "component", "icons", "error", err)
		writeJSONError(w, "Couldn't read the Dashboard Icons shipped with HOPS: "+err.Error(), http.StatusInternalServerError)
		return
	}
	var presetRows, dashboardRows int
	if err := r.db.QueryRow(`SELECT COUNT(*) FROM icons WHERE is_preset = 1 AND (image_url IS NULL OR image_url = '')`).Scan(&presetRows); err != nil {
		writeJSONError(w, "Couldn't count the preset library icons: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := r.db.QueryRow(`SELECT COUNT(*) FROM icons WHERE is_preset = 1 AND image_url LIKE '/api/icons/dashboard/%'`).Scan(&dashboardRows); err != nil {
		writeJSONError(w, "Couldn't count the Dashboard Icons in the library: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, map[string]any{
		"fetchedAt":      time.Now().UTC().Format(time.RFC3339),
		"dashboardIcons": map[string]any{"count": len(names), "names": names},
		"dashboardRows":  dashboardRows,
		"presetRows":     presetRows,
	})
}

// packagedIconUsage is "where used" for packaged icons, from the same walk of
// the stored layout as the uploads' usage: images under /api/icons/dashboard/
// (by URL) and Iconify names (by name). A place with an image shows the image,
// so its Iconify name is not counted. Only used icons are keys; the whole
// layout is walked, so an absent key means "not used".
func packagedIconUsage(doc configdoc.Obj, byURL map[string][]iconUse) map[string]any {
	images := map[string][]iconUse{}
	for u, uses := range byURL {
		if strings.HasPrefix(u, dashboardIconURLPrefix) {
			images[u] = uses
		}
	}
	names := map[string][]iconUse{}
	str := func(o configdoc.Obj, k string) string { s, _ := o[k].(string); return s }
	// shown: the Iconify name a node displays, or "" when it has an image (or none).
	shown := func(o configdoc.Obj) string {
		if str(o, "iconUrl") != "" {
			return ""
		}
		return str(o, "icon")
	}
	dashes, _ := doc["dashboards"].([]any)
	for _, d := range dashes {
		dash, _ := d.(configdoc.Obj)
		if dash == nil {
			continue
		}
		dashName, dashID := str(dash, "name"), str(dash, "id")
		if n := shown(dash); n != "" {
			names[n] = append(names[n], iconUse{Kind: "dashboard", Name: dashName, DashboardID: dashID, Dashboard: dashName})
		}
		tabs, _ := dash["tabs"].([]any)
		for _, t := range tabs {
			tab, _ := t.(configdoc.Obj)
			if tab == nil {
				continue
			}
			if n := shown(tab); n != "" {
				names[n] = append(names[n], iconUse{Kind: "tab", Name: str(tab, "name"), DashboardID: dashID, Dashboard: dashName, Tab: str(tab, "name")})
			}
		}
	}
	configdoc.Walk(doc, func(dash, tab configdoc.Obj, path []configdoc.Obj, node configdoc.Obj) bool {
		n := shown(node)
		if n == "" {
			return true
		}
		kind := "tile"
		if node["kind"] == "folder" {
			kind = "folder"
		}
		use := iconUse{Kind: kind, Name: str(node, "name"), DashboardID: str(dash, "id"), Dashboard: str(dash, "name"), Tab: str(tab, "name")}
		if len(path) > 0 {
			use.Folder = str(path[len(path)-1], "name")
		}
		names[n] = append(names[n], use)
		return true
	})
	return map[string]any{"images": images, "names": names}
}
