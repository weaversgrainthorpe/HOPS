package api

import (
	"database/sql"
	"log/slog"
	"net/http"
	"sort"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/settings"
)

// deadLink is one tile whose status check has failed without a break for
// longer than status.dead_after_hours, with where it lives so the admin can
// find it ("Show it") and fix or remove it.
type deadLink struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	URL           string   `json:"url"`
	DashboardID   string   `json:"dashboardId"`
	DashboardPath string   `json:"dashboardPath"`
	DashboardName string   `json:"dashboardName"`
	TabID         string   `json:"tabId"`
	FolderIDs     []string `json:"folderIds"`
	// Path is the names from the dashboard down to the tile's folder:
	// dashboard, tab, folders (outermost first).
	Path         []string `json:"path"`
	FailingSince string   `json:"failingSince"`
	LastChecked  string   `json:"lastChecked"`
	LastError    string   `json:"lastError"`
}

// handleDeadLinks serves GET /api/dead-links (admin). It never answers with a
// bare empty list: it says whether checks are on globally, how many tiles
// are checked at all, and when failure tracking began, so the UI can tell
// "nothing is dead" from "nothing is being watched".
func (r *Router) handleDeadLinks(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	doc, err := configdoc.Load(r.db)
	if err != nil {
		slog.Error("dead links: cannot load config", "component", "api", "error", err)
		writeJSONError(w, "Config unavailable", http.StatusServiceUnavailable)
		return
	}

	failing := map[string][3]string{} // id → since, last_checked, last_error
	rows, err := r.db.Query("SELECT entry_id, since, last_checked, last_error FROM status_failing")
	if err != nil {
		slog.Error("dead links: cannot read status_failing", "component", "api", "error", err)
		writeJSONError(w, "Failure history unavailable", http.StatusInternalServerError)
		return
	}
	for rows.Next() {
		var id, since, checked, lastErr string
		if err := rows.Scan(&id, &since, &checked, &lastErr); err != nil {
			rows.Close() // #nosec G104 -- Close on an error path or after a read-only/bounded read; the primary error is already surfaced and nothing was written
			writeJSONError(w, "Failure history unreadable", http.StatusInternalServerError)
			return
		}
		failing[id] = [3]string{since, checked, lastErr}
	}
	if err := rows.Err(); err != nil {
		rows.Close() // #nosec G104 -- Close on an error path or after a read-only/bounded read; the primary error is already surfaced and nothing was written
		writeJSONError(w, "Failure history unreadable", http.StatusInternalServerError)
		return
	}
	rows.Close() // #nosec G104 -- Close on an error path or after a read-only/bounded read; the primary error is already surfaced and nothing was written

	var started sql.NullString
	if err := r.db.QueryRow("SELECT started_at FROM status_history WHERE id = 1").Scan(&started); err != nil && err != sql.ErrNoRows {
		writeJSONError(w, "Failure history unavailable", http.StatusInternalServerError)
		return
	}

	hours := r.settings.GetInt(settings.KeyStatusDeadAfterHours)
	if hours < 1 {
		hours = 168
	}
	cutoff := time.Now().UTC().Add(-time.Duration(hours) * time.Hour)

	links := []deadLink{}
	checked := 0
	configdoc.Walk(doc, func(dash, tab configdoc.Obj, path []configdoc.Obj, node configdoc.Obj) bool {
		if node["kind"] != "tile" {
			return true
		}
		if t, _ := node["type"].(string); t == "note" {
			return true
		}
		id, _ := node["id"].(string)
		u, _ := node["url"].(string)
		if id == "" || u == "" {
			return true
		}
		if on, _, _ := configdoc.EffectiveStatusChecks(r.settings, dash, tab, path, node); !on {
			return true
		}
		checked++
		f, ok := failing[id]
		if !ok {
			return true
		}
		since, err := time.Parse(time.RFC3339, f[0])
		if err != nil || !since.Before(cutoff) {
			return true
		}
		str := func(o configdoc.Obj, k string) string { s, _ := o[k].(string); return s }
		names := []string{str(dash, "name"), str(tab, "name")}
		folderIDs := []string{}
		for _, fo := range path {
			names = append(names, str(fo, "name"))
			folderIDs = append(folderIDs, str(fo, "id"))
		}
		links = append(links, deadLink{
			ID: id, Name: str(node, "name"), URL: u,
			DashboardID: str(dash, "id"), DashboardPath: str(dash, "path"), DashboardName: str(dash, "name"),
			TabID: str(tab, "id"), FolderIDs: folderIDs, Path: names,
			FailingSince: f[0], LastChecked: f[1], LastError: f[2],
		})
		return true
	})
	// Longest-failing first.
	sort.SliceStable(links, func(i, j int) bool { return links[i].FailingSince < links[j].FailingSince })

	writeJSON(w, map[string]any{
		"checksEnabled":    r.settings.GetBool(settings.KeyStatusChecksEnabled),
		"thresholdHours":   hours,
		"historyStartedAt": started.String,
		"checkedTiles":     checked,
		"links":            links,
	})
}
