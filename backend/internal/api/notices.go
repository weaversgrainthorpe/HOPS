package api

import (
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// notice is a one-time message for the user, shown until dismissed. GET
// /api/config carries the current ones as `notices` (never stored in the
// document: a write drops the key, transientDashboardKeys).
type notice struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// noticeLayeredStatusChecks announces the M4 change to status checks: the
// most specific level now wins, so tiles switched on under a dashboard whose
// checks are off start being checked.
const noticeLayeredStatusChecks = "layered-status-checks-v4"

// knownNotices is every notice id this build can show; dismissing any other
// id is a 404.
var knownNotices = map[string]bool{noticeLayeredStatusChecks: true}

// noticeIDPattern bounds a notice id taken from a URL.
var noticeIDPattern = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)

// noticeState is this process's list of notices: computed once at startup,
// then shrunk by dismissals.
type noticeState struct {
	mu   sync.Mutex
	list []notice
}

func (s *noticeState) current() []notice {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]notice{}, s.list...)
}

func (s *noticeState) remove(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := s.list[:0:0]
	for _, n := range s.list {
		if n.ID != id {
			kept = append(kept, n)
		}
	}
	s.list = kept
}

// computeNotices builds this start's notices from the stored config, leaving
// out the dismissed ones. A failure to read the dismissals shows the notices
// anyway (an extra notice is visible and harmless; a hidden one is silent)
// and is logged at ERROR.
func (r *Router) computeNotices() []notice {
	var out []notice
	doc, err := configdoc.Load(r.db)
	if err != nil {
		// GET /api/config fails visibly on the same load; nothing to add.
		slog.Error("notices: cannot load config", "component", "api", "error", err)
		return out
	}
	if names := dashboardsWithTilesOnUnderOff(r, doc); len(names) > 0 {
		out = append(out, notice{
			ID: noticeLayeredStatusChecks,
			Text: "Status checks now follow the most specific setting. These dashboards have tiles switched on " +
				"while the dashboard is off, so those tiles are now checked: " + strings.Join(names, ", ") + ".",
		})
	}
	if len(out) == 0 {
		return out
	}
	dismissed := map[string]bool{}
	rows, err := r.db.Query(`SELECT id FROM dismissed_notices`)
	if err != nil {
		slog.Error("notices: cannot read dismissed notices; showing all", "component", "api", "error", err)
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			slog.Error("notices: cannot read dismissed notices; showing all", "component", "api", "error", err)
			return out
		}
		dismissed[id] = true
	}
	if err := rows.Err(); err != nil {
		slog.Error("notices: cannot read dismissed notices; showing all", "component", "api", "error", err)
		return out
	}
	kept := out[:0]
	for _, n := range out {
		if !dismissed[n.ID] {
			kept = append(kept, n)
		}
	}
	return kept
}

// dashboardsWithTilesOnUnderOff names, in document order, the dashboards
// whose checks are off (their effective setting) holding a link tile with a
// URL whose own status check is explicitly on: tiles the previous build did
// not check and this one does.
func dashboardsWithTilesOnUnderOff(r *Router, doc configdoc.Obj) []string {
	var names []string
	listed := map[string]bool{}
	offCache := map[string]bool{}
	configdoc.Walk(doc, func(dash, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		if n["kind"] != "tile" {
			return true
		}
		if t, _ := n["type"].(string); t == "note" {
			return true
		}
		if u, _ := n["url"].(string); u == "" {
			return true
		}
		if on, set := configdoc.TileStatusCheck(n); !on || !set {
			return true
		}
		id, _ := dash["id"].(string)
		if listed[id] {
			return true
		}
		off, ok := offCache[id]
		if !ok {
			off = !configdoc.Resolve(r.settings, dash).StatusChecksEnabled
			offCache[id] = off
		}
		if off {
			listed[id] = true
			names = append(names, dashboardLabel(dash))
		}
		return true
	})
	return names
}

// handleNotices serves POST /api/notices/{id}/dismiss (protected: auth +
// CSRF). The dismissal is stored, so the notice stays gone after a restart.
func (r *Router) handleNotices(w http.ResponseWriter, req *http.Request) {
	rest := strings.TrimPrefix(req.URL.Path, "/api/notices/")
	id, action, ok := strings.Cut(rest, "/")
	if !ok || action != "dismiss" {
		writeJSONError(w, "Not found", http.StatusNotFound)
		return
	}
	if req.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !noticeIDPattern.MatchString(id) {
		writeJSONError(w, "Invalid notice id", http.StatusBadRequest)
		return
	}
	if !knownNotices[id] {
		writeJSONError(w, "Notice not found: "+id, http.StatusNotFound)
		return
	}
	if _, err := r.db.Exec(`INSERT OR IGNORE INTO dismissed_notices (id) VALUES (?)`, id); err != nil {
		slog.Error("notices: cannot store dismissal", "component", "api", "notice", id, "error", err)
		writeJSONError(w, "Could not save the dismissal", http.StatusInternalServerError)
		return
	}
	r.notices.remove(id)
	writeJSON(w, map[string]interface{}{"success": true, "notices": r.notices.current()})
}
