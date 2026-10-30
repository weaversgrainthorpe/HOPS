package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/settings"
)

// notice is a one-time message for the user, shown while it applies to the
// current config until dismissed. GET /api/config carries the current ones as
// `notices` (never stored in the document: a write drops the key,
// transientDashboardKeys).
type notice struct {
	ID   string `json:"id"`
	Text string `json:"text"`
	// Level is "warning" for a problem (shown as one); empty is information.
	Level string `json:"level,omitempty"`
	// Sticky notices cannot be dismissed: they go when their cause is fixed.
	Sticky bool `json:"sticky,omitempty"`
	// Link points at the settings page where the notice can be acted on.
	Link *noticeLink `json:"link,omitempty"`
}

// noticeLink is a labelled in-app link (the page renders it as text + <a>,
// never from markup in the notice text).
type noticeLink struct {
	Href  string `json:"href"`
	Label string `json:"label"`
}

// noticeLayeredStatusChecks announces the change to status checks: the
// most specific level now wins, so tiles switched on under a dashboard whose
// checks are off start being checked.
const noticeLayeredStatusChecks = "layered-status-checks-v4"

// noticeUploadDefaultsMoved announces that upload limits still at the
// old defaults were moved to the new ones at startup (settings.DefaultMoves).
const noticeUploadDefaultsMoved = "upload-defaults-moved-v3"

// knownNotices is every notice id this build can show; dismissing any other
// id is a 404.
var knownNotices = map[string]bool{
	noticeLayeredStatusChecks: true, noticeUploadDefaultsMoved: true, configdoc.NoticeV2StatusOff: true,
}

// uploadLimitLabels names each moved setting as the settings page does.
var uploadLimitLabels = map[string]string{
	settings.KeyUploadMaxBytesImport:     "Largest import",
	settings.KeyUploadMaxBytesBackground: "Largest background upload",
	settings.KeyUploadMaxBytesIcon:       "Largest icon upload",
}

// uploadDefaultsNotice describes the one-time default move, or false when
// nothing moved.
func uploadDefaultsNotice(moves []settings.DefaultMove) (notice, bool) {
	if len(moves) == 0 {
		return notice{}, false
	}
	parts := make([]string, 0, len(moves))
	for _, m := range moves {
		label := uploadLimitLabels[m.Key]
		if label == "" {
			label = m.Key
		}
		parts = append(parts, fmt.Sprintf("%s %s → %s", label, mbText(m.From), mbText(m.To)))
	}
	return notice{
		ID: noticeUploadDefaultsMoved,
		Text: "Upload limits updated to the new defaults: " + strings.Join(parts, "; ") +
			". Limits you had changed yourself were left as they were.",
	}, true
}

// mbText shows a byte count in MB as the settings page does.
func mbText(b int) string {
	if b%settings.MB == 0 {
		return fmt.Sprintf("%d MB", b/settings.MB)
	}
	return fmt.Sprintf("%.1f MB", float64(b)/float64(settings.MB))
}

// noticeTileSizesPrefix starts the id of the tile-size notice. The
// rest is a hash of its text, so a later import's tiles get a fresh notice
// even after an earlier one was dismissed.
const noticeTileSizesPrefix = "tile-sizes-medium-"

// sizeNoteState lists, for this process, the tiles whose unknown v2 size was
// set to Medium by the start-up migration or an import, until the notice
// naming them is dismissed.
type sizeNoteState struct {
	mu    sync.Mutex
	items []string
}

func (s *sizeNoteState) add(items ...string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items = append(s.items, items...)
}

// notice returns the current tile-size notice, or false when there is none.
func (s *sizeNoteState) notice() (notice, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.items) == 0 {
		return notice{}, false
	}
	text := "Some tiles had a size HOPS does not recognise, so they are now Medium (change them in the editor if needed): " +
		strings.Join(s.items, "; ") + "."
	h := fnv.New32a()
	h.Write([]byte(text)) // #nosec G104 -- hash.Hash.Write never returns an error
	return notice{ID: fmt.Sprintf("%s%08x", noticeTileSizesPrefix, h.Sum32()), Text: text}, true
}

// isCurrent reports whether id is the current tile-size notice.
func (s *sizeNoteState) isCurrent(id string) bool {
	n, ok := s.notice()
	return ok && n.ID == id
}

// clearIf drops the listed tiles when id is still their notice (dismissed).
func (s *sizeNoteState) clearIf(id string) {
	if s.isCurrent(id) {
		s.mu.Lock()
		s.items = nil
		s.mu.Unlock()
	}
}

// sizeNoteItems describes each normalised tile for the notice, naming its
// dashboard from doc (by id; the id itself when it is not found).
func sizeNoteItems(changes []configdoc.SizeChange, doc configdoc.Obj) []string {
	names := map[string]string{}
	for id, d := range storedDashboards(doc) {
		names[id] = dashboardLabel(d)
	}
	out := make([]string, 0, len(changes))
	for _, sc := range changes {
		dash := names[sc.DashboardID]
		if dash == "" {
			dash = sc.DashboardID
		}
		tile := sc.TileName
		if tile == "" {
			tile = sc.TileID
		}
		old, _ := json.Marshal(sc.OldSize)
		out = append(out, fmt.Sprintf("%q in dashboard %q (was %s)", tile, dash, old))
	}
	return out
}

// noticeIDPattern bounds a notice id taken from a URL.
var noticeIDPattern = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)

// noticeState holds the dismissed and armed notice ids for this process:
// loaded from dismissed_notices and armed_notices at startup and kept current
// by dismissals and arming. The notices themselves are computed per GET
// /api/config from the current config, so they never go stale.
type noticeState struct {
	mu        sync.Mutex
	loaded    bool // false until both tables have been read successfully
	dismissed map[string]bool
	armed     map[string]bool
	loadErr   bool // a load failure was already logged (log once, retry quietly)
}

// load reads dismissed_notices and armed_notices into memory. It reports
// whether they are loaded; while they aren't, every notice is shown (an extra
// notice is visible and harmless; a hidden one is silent) and the next GET
// retries.
func (s *noticeState) load(db *sql.DB) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loaded {
		return true
	}
	ids, err := readIDs(db, `SELECT id FROM dismissed_notices`)
	var armed map[string]bool
	if err == nil {
		armed, err = readIDs(db, `SELECT id FROM armed_notices`)
	}
	if err != nil {
		if !s.loadErr {
			slog.Error("notices: cannot read dismissed or armed notices; showing all until it succeeds",
				"component", "api", "error", err)
			s.loadErr = true
		}
		return false
	}
	if s.loadErr {
		slog.Info("notices: dismissed and armed notices read", "component", "api")
	}
	for id := range s.dismissed { // dismissed meanwhile in this process
		ids[id] = true
	}
	for id := range s.armed { // armed meanwhile (its stored dismissal was cleared then)
		armed[id] = true
	}
	s.dismissed, s.armed, s.loaded, s.loadErr = ids, armed, true, false
	return true
}

func readIDs(db *sql.DB, query string) (map[string]bool, error) {
	rows, err := db.Query(query)
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

// isArmed reports whether id is armed. Until the tables are read, every
// notice counts as armed, so none is hidden by a failed read.
func (s *noticeState) isArmed(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.loaded || s.armed[id]
}

// arm marks id armed in this process and clears its dismissal here.
func (s *noticeState) arm(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.armed == nil {
		s.armed = map[string]bool{}
	}
	s.armed[id] = true
	delete(s.dismissed, id)
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
	if n, ok := r.sampleNotice(); ok {
		out = append(out, n)
	}
	if n, ok := uploadDefaultsNotice(r.settings.DefaultMoves()); ok {
		out = append(out, n)
	}
	if n, ok := r.sizeNotes.notice(); ok {
		out = append(out, n)
	}
	if names := dashboardsWithTilesOnUnderOff(r, stored); len(names) > 0 {
		out = append(out, notice{
			ID: noticeLayeredStatusChecks,
			Text: "Status checks now follow the most specific setting. These dashboards have tiles switched on " +
				"while the dashboard is off, so those tiles are now checked: " + strings.Join(names, ", ") + ".",
			Link: &noticeLink{Href: "/settings/dashboards/status-overrides", Label: "Review status check overrides"},
		})
	}
	r.notices.load(r.db) // retries if the startup read failed
	if n, ok := r.v2StatusOffNotice(stored); ok {
		out = append(out, n)
	}
	if len(out) == 0 {
		return out
	}
	kept := out[:0]
	for _, n := range out {
		if !r.notices.isDismissed(n.ID) {
			kept = append(kept, n)
		}
	}
	return kept
}

// v2StatusOffNotice says, once a v2 conversion has set tiles Off
// (configdoc.NoticeV2StatusOff armed), which dashboards still hold tiles set
// Off on their own; it goes when none are left, or when dismissed.
func (r *Router) v2StatusOffNotice(doc configdoc.Obj) (notice, bool) {
	if !r.notices.isArmed(configdoc.NoticeV2StatusOff) {
		return notice{}, false
	}
	var names []string
	count := 0
	counted := map[string]bool{}
	configdoc.Walk(doc, func(dash, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		if n["kind"] != "tile" || !configdoc.TileSetsOff(n) {
			return true
		}
		count++
		if id, _ := dash["id"].(string); !counted[id] {
			counted[id] = true
			names = append(names, dashboardLabel(dash))
		}
		return true
	})
	if count == 0 {
		return notice{}, false
	}
	tiles := "1 tile is still set to Off on its own"
	if count != 1 {
		tiles = fmt.Sprintf("%d tiles are still set to Off on their own", count)
	}
	return notice{
		ID: configdoc.NoticeV2StatusOff,
		Text: "Converted from v2: tiles that did not have status checks ticked were set to Off, so the same " +
			"tiles are checked as before. " + tiles + ", in: " + strings.Join(names, ", ") +
			". To let them follow their folder, tab or dashboard instead, restore inheritance for them.",
		Link: &noticeLink{Href: "/settings/dashboards/status-overrides", Label: "Review status check overrides"},
	}, true
}

// armNotice arms a one-time notice after a committed change (a v2 import).
// If it cannot be stored the failure is logged and the notice is still shown
// in this process, never dropped.
func (r *Router) armNotice(id string) {
	r.notices.arm(id)
	if err := configdoc.ArmNotice(r.db, id); err != nil {
		slog.Error("notices: cannot store an armed notice; it is shown until restart", "component", "api", "notice", id, "error", err)
	}
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
		if !configdoc.IsCheckableTile(n) {
			return true
		}
		if id, _ := n["id"].(string); id == "" {
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
	// The tile-size notice is one-time: dismissing it clears its list.
	if kind, ok := dismissibleBackupNotice(id); ok {
		// Reports of what happened (backups deleted for the ceiling, a restore
		// that couldn't be applied): kept across restarts until dismissed.
		if !r.backupManager.DismissProblem(kind) {
			writeJSONError(w, "Notice not found: "+id, http.StatusNotFound)
			return
		}
		writeJSONSuccess(w)
		return
	}
	if isBackupNoticeID(id) {
		writeJSONError(w, "This notice stays until the backup problem is fixed", http.StatusConflict)
		return
	}
	if !knownNotices[id] && !r.sizeNotes.isCurrent(id) {
		writeJSONError(w, "Notice not found: "+id, http.StatusNotFound)
		return
	}
	if _, err := r.db.Exec(`INSERT OR IGNORE INTO dismissed_notices (id) VALUES (?)`, id); err != nil {
		slog.Error("notices: cannot store dismissal", "component", "api", "notice", id, "error", err)
		writeJSONError(w, "Could not save the dismissal", http.StatusInternalServerError)
		return
	}
	r.notices.dismiss(id)
	r.sizeNotes.clearIf(id)
	writeJSONSuccess(w)
}
