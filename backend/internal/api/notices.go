package api

import (
	"database/sql"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// notice is a one-time message for the user, shown while it applies to the
// current config until dismissed. GET /api/config carries the current ones as
// `notices` (never stored in the document: a write drops the key,
// transientDashboardKeys).
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

// noticeState holds the dismissed notice ids for this process: loaded from
// dismissed_notices at startup and kept current by dismissals. The notices
// themselves are computed per GET /api/config from the current config, so
// they never go stale.
type noticeState struct {
	mu        sync.Mutex
	loaded    bool // false until dismissed_notices has been read successfully
	dismissed map[string]bool
	loadErr   bool // a load failure was already logged (log once, retry quietly)
}

// load reads dismissed_notices into memory. It reports whether the set is
// loaded; while it isn't, every notice is shown (an extra notice is visible
// and harmless; a hidden one is silent) and the next GET retries.
func (s *noticeState) load(db *sql.DB) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loaded {
		return true
	}
	ids, err := readDismissed(db)
	if err != nil {
		if !s.loadErr {
			slog.Error("notices: cannot read dismissed notices; showing all until it succeeds",
				"component", "api", "error", err)
			s.loadErr = true
		}
		return false
	}
	if s.loadErr {
		slog.Info("notices: dismissed notices read", "component", "api")
	}
	for id := range s.dismissed { // dismissed meanwhile in this process
		ids[id] = true
	}
	s.dismissed, s.loaded, s.loadErr = ids, true, false
	return true
}

func readDismissed(db *sql.DB) (map[string]bool, error) {
	rows, err := db.Query(`SELECT id FROM dismissed_notices`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids[id] = true
	}
	return ids, rows.Err()
}

func (s *noticeState) isDismissed(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dismissed[id]
}

func (s *noticeState) dismiss(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.dismissed == nil {
		s.dismissed = map[string]bool{}
	}
	s.dismissed[id] = true
}

// currentNotices is the notices for GET /api/config, computed from stored
// (the document the handler just loaded), leaving out dismissed ones.
func (r *Router) currentNotices(stored configdoc.Obj) []notice {
	var out []notice
	if names := dashboardsWithTilesOnUnderOff(r, stored); len(names) > 0 {
		out = append(out, notice{
			ID: noticeLayeredStatusChecks,
			Text: "Status checks now follow the most specific setting. These dashboards have tiles switched on " +
				"while the dashboard is off, so those tiles are now checked: " + strings.Join(names, ", ") + ".",
		})
	}
	if len(out) == 0 {
		return out
	}
	r.notices.load(r.db) // retries if the startup read failed
	kept := out[:0]
	for _, n := range out {
		if !r.notices.isDismissed(n.ID) {
			kept = append(kept, n)
		}
	}
	return kept
}

// dashboardsWithTilesOnUnderOff names, in document order, the dashboards
// whose checks are off (their effective setting) holding a link tile (with
// an id and a URL) that is checked because it is itself switched on — the
// tiles the previous build did not check and this one does.
func dashboardsWithTilesOnUnderOff(r *Router, doc configdoc.Obj) []string {
	var names []string
	listed := map[string]bool{}
	offCache := map[string]bool{}
	configdoc.Walk(doc, func(dash, tab configdoc.Obj, path []configdoc.Obj, n configdoc.Obj) bool {
		if n["kind"] != "tile" {
			return true
		}
		if t, _ := n["type"].(string); t == "note" {
			return true
		}
		if id, _ := n["id"].(string); id == "" {
			return true
		}
		if u, _ := n["url"].(string); u == "" {
			return true
		}
		dashID, _ := dash["id"].(string)
		if listed[dashID] {
			return true
		}
		if on, src, _ := configdoc.EffectiveStatusChecks(r.settings, dash, tab, path, n); !on || src != configdoc.SourceTile {
			return true
		}
		off, ok := offCache[dashID]
		if !ok {
			off = !configdoc.Resolve(r.settings, dash).StatusChecksEnabled
			offCache[dashID] = off
		}
		if off {
			listed[dashID] = true
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
	r.notices.dismiss(id)
	writeJSONSuccess(w)
}
