package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strings"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

const migrationBackupHint = "Admin → Backups holds the automatic pre-v3-migration and startup backups"

// apiError is an error that carries the HTTP status and JSON body to send.
type apiError struct {
	status int
	body   map[string]interface{}
}

func (e *apiError) Error() string { return fmt.Sprint(e.body["error"]) }

func newAPIError(status int, msg string) *apiError {
	return &apiError{status: status, body: map[string]interface{}{"error": msg, "status": status}}
}

func conflictError(dashboardID string, current int) *apiError {
	e := newAPIError(http.StatusConflict, "conflict")
	e.body["detail"] = "This dashboard was changed by someone else since you loaded it. Reload and re-apply your change."
	e.body["dashboardId"] = dashboardID
	e.body["currentRevision"] = current
	return e
}

// deletedElsewhereError is the 409 for a save that still holds a dashboard
// another client deleted.
func deletedElsewhereError(dashboardID string) *apiError {
	e := conflictError(dashboardID, 0)
	e.body["detail"] = "A dashboard in your save was deleted somewhere else since you loaded it. Reload to see the current dashboards, then re-apply your change."
	e.body["deleted"] = true
	return e
}

func writeAPIError(w http.ResponseWriter, err error) {
	var ae *apiError
	if !errors.As(err, &ae) {
		ae = newAPIError(http.StatusInternalServerError, err.Error())
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(ae.status)
	if err := json.NewEncoder(w).Encode(ae.body); err != nil {
		slog.Error("failed to encode error response", "error", err)
	}
}

// migrationGuard writes the 503 migration_failed body and returns false when
// the startup migration failed. Every endpoint touching the config doc calls it.
func (r *Router) migrationGuard(w http.ResponseWriter) bool {
	if !r.migration.Failed {
		return true
	}
	writeAPIError(w, &apiError{status: http.StatusServiceUnavailable, body: map[string]interface{}{
		"error":      "migration_failed",
		"status":     http.StatusServiceUnavailable,
		"detail":     r.migration.Detail,
		"backupHint": migrationBackupHint,
	}})
	return false
}

// loadErr maps a configdoc.Load failure to a visible 500.
func loadErr(err error) *apiError {
	return newAPIError(http.StatusInternalServerError, "Failed to load config: "+err.Error())
}

// intRevision reads a JSON-decoded revision number.
func intRevision(v any) (int, bool) {
	f, ok := v.(float64)
	if !ok || f != float64(int(f)) {
		return 0, false
	}
	return int(f), true
}

// storedDashboards indexes the stored doc's dashboards by id.
func storedDashboards(doc configdoc.Obj) map[string]configdoc.Obj {
	out := map[string]configdoc.Obj{}
	l, _ := doc["dashboards"].([]any)
	for _, d := range l {
		if m, ok := d.(configdoc.Obj); ok {
			if id, ok := m["id"].(string); ok {
				out[id] = m
			}
		}
	}
	return out
}

// storedRevision reads a stored dashboard's revision; a missing or
// non-numeric one is a visible 500, never silently 0.
func storedRevision(id string, d configdoc.Obj) (int, *apiError) {
	n, ok := intRevision(d["revision"])
	if !ok {
		return 0, newAPIError(http.StatusInternalServerError, "stored revision unreadable for dashboard "+id)
	}
	return n, nil
}

// checkRevision returns a 409 unless the incoming revision (as decoded from
// the request; nil when absent) equals the stored dashboard's revision. A
// missing or non-numeric revision on an existing dashboard is a conflict too.
func checkRevision(id string, stored configdoc.Obj, incoming any) *apiError {
	cur, serr := storedRevision(id, stored)
	if serr != nil {
		return serr
	}
	in, ok := intRevision(incoming)
	if !ok || in != cur {
		return conflictError(id, cur)
	}
	return nil
}

// normalizedWithoutRevision returns a dashboard's JSON with `revision` dropped.
func normalizedWithoutRevision(d configdoc.Obj) ([]byte, error) {
	cp := make(configdoc.Obj, len(d))
	for k, v := range d {
		if k != "revision" {
			cp[k] = v
		}
	}
	return json.Marshal(cp) // map keys are sorted: stable
}

// docUpdateFn computes the new document and the response body from the stored
// one. It must be repeatable (it may run twice, see updateDocWithBackup): no
// side effects beyond mutating the stored doc it is handed.
type docUpdateFn func(stored configdoc.Obj) (configdoc.Obj, interface{}, error)

// updateDoc runs fn on the stored config inside one transaction. fn returns
// the new document and the response body; any error rolls everything back.
func (r *Router) updateDoc(w http.ResponseWriter, fn docUpdateFn) {
	r.updateDocWithLoadErr(w, loadErr, fn)
}

// computeDoc loads the stored config through tx, runs fn, and verifies the
// result has a well-formed tree with non-empty, document-wide unique ids, so
// no writer can store a document that import, FindTile or conflict checks
// would trip over.
func computeDoc(tx *sql.Tx, onLoadErr func(error) *apiError, fn docUpdateFn) (configdoc.Obj, interface{}, error) {
	stored, err := configdoc.Load(tx)
	if err != nil {
		return nil, nil, onLoadErr(err)
	}
	next, resp, err := fn(stored)
	if err != nil {
		return nil, nil, err
	}
	if err := configdoc.VerifyIDs(next); err != nil {
		return nil, nil, newAPIError(http.StatusBadRequest, "Invalid config: "+verifyProblems(err))
	}
	return next, resp, nil
}

// updateDocWithLoadErr is updateDoc with a caller-chosen mapping for a failure
// to load the stored config (e.g. import's "refused so nothing is overwritten").
func (r *Router) updateDocWithLoadErr(w http.ResponseWriter, onLoadErr func(error) *apiError, fn docUpdateFn) {
	tx, err := r.db.Begin()
	if err != nil {
		writeAPIError(w, newAPIError(http.StatusInternalServerError, "Failed to start save: "+err.Error()))
		return
	}
	defer tx.Rollback() //nolint:errcheck // no-op after Commit

	next, resp, err := computeDoc(tx, onLoadErr, fn)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if err := configdoc.Save(tx, next); err != nil {
		writeAPIError(w, newAPIError(http.StatusInternalServerError, "Failed to save config: "+err.Error()))
		return
	}
	if err := tx.Commit(); err != nil {
		writeAPIError(w, newAPIError(http.StatusInternalServerError, "Failed to commit config: "+err.Error()))
		return
	}
	writeJSON(w, resp)
}

// updateDocWithBackup is updateDoc preceded by the pre-update backup, which is
// taken only for a save that will be accepted: fn first runs in a rolled-back
// dry run, so a 400/404/409 takes no backup (and so cannot rotate older
// backups away). The backup runs outside any transaction (with one pooled
// connection, VACUUM INTO would otherwise wait on the open tx), then the
// update runs for real, re-checking everything against the stored doc. A
// backup failure never blocks the save; it is attached to a map response as
// "warning" so the UI shows it.
func (r *Router) updateDocWithBackup(w http.ResponseWriter, fn docUpdateFn) {
	if err := r.dryRunDoc(fn); err != nil {
		writeAPIError(w, err)
		return
	}
	warning := r.preUpdateBackup()
	r.updateDoc(w, func(stored configdoc.Obj) (configdoc.Obj, interface{}, error) {
		next, resp, err := fn(stored)
		if err == nil && warning != "" {
			if m, ok := resp.(map[string]interface{}); ok {
				m["warning"] = warning
			}
		}
		return next, resp, err
	})
}

// dryRunDoc runs fn (and the id check) against the stored config in a
// transaction that is always rolled back.
func (r *Router) dryRunDoc(fn docUpdateFn) error {
	tx, err := r.db.Begin()
	if err != nil {
		return newAPIError(http.StatusInternalServerError, "Failed to start save: "+err.Error())
	}
	defer tx.Rollback() //nolint:errcheck // read-only check
	_, _, err = computeDoc(tx, loadErr, fn)
	return err
}

// preUpdateBackup takes the pre-update backup. A failure is returned as a
// warning string for the response; it never blocks the save. It must run
// before any transaction is opened.
func (r *Router) preUpdateBackup() string {
	if r.backupManager == nil {
		return ""
	}
	if _, err := r.backupManager.CreateBackupWithDB(r.db, "pre-config-update"); err != nil {
		slog.Warn("failed to create pre-update backup", "component", "backup", "error", err)
		return "Pre-update backup failed: " + err.Error() + ". Config saved anyway."
	}
	return ""
}

// applyLegacyView turns a legacy whole-config body into the new v3 doc,
// checking every body dashboard's revision against stored FIRST (FromLegacy
// overwrites revision with the stored one, so a later check would never fire)
// and bumping the revision of changed dashboards.
func applyLegacyView(stored configdoc.Obj, in configdoc.Obj) (configdoc.Obj, map[string]int, error) {
	prev := storedDashboards(stored)
	seen, _ := in["dashboardRevisions"].(map[string]interface{})
	// Shallow copy so the caller's body is untouched (updateDocWithBackup
	// runs this twice).
	body := make(configdoc.Obj, len(in))
	for k, v := range in {
		if k != "dashboardRevisions" && k != "migrationNotices" { // view-only; never stored
			body[k] = v
		}
	}
	bodyDashes, _ := body["dashboards"].([]any)
	inBody := map[string]bool{}
	for _, d := range bodyDashes {
		if dm, ok := d.(map[string]interface{}); ok {
			if id, _ := dm["id"].(string); id != "" {
				if inBody[id] {
					return nil, nil, newAPIError(http.StatusBadRequest, "Invalid config: duplicate dashboard id "+id)
				}
				inBody[id] = true
			}
		}
	}
	for _, d := range bodyDashes {
		dm, ok := d.(map[string]interface{})
		if !ok {
			continue // MigrateV2 reports malformed dashboards
		}
		id, _ := dm["id"].(string)
		if p, exists := prev[id]; exists {
			if ce := checkRevision(id, p, dm["revision"]); ce != nil {
				return nil, nil, ce
			}
			continue
		}
		// Not stored, yet the client knew a revision for it: it was deleted
		// somewhere else. Saving would silently bring it back.
		_, hasRev := intRevision(dm["revision"])
		_, wasSeen := seen[id]
		if id != "" && (hasRev || wasSeen) {
			return nil, nil, deletedElsewhereError(id)
		}
	}
	// A stored dashboard absent from the body is a deletion; allow it only if
	// the client saw it at its current revision.
	ids := make([]string, 0, len(prev))
	for id := range prev {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		p := prev[id]
		if inBody[id] {
			continue
		}
		if ce := checkRevision(id, p, seen[id]); ce != nil {
			return nil, nil, ce
		}
	}
	next, err := configdoc.FromLegacy(body, stored)
	if err != nil {
		return nil, nil, newAPIError(http.StatusBadRequest, "Invalid config: "+err.Error())
	}
	revs := map[string]int{}
	nextDashes, _ := next["dashboards"].([]any)
	for _, d := range nextDashes {
		nd, ok := d.(configdoc.Obj)
		if !ok {
			continue
		}
		id, _ := nd["id"].(string)
		p, exists := prev[id]
		if !exists {
			nd["revision"] = 1
			revs[id] = 1
			continue
		}
		cur, rerr := storedRevision(id, p)
		if rerr != nil {
			return nil, nil, rerr
		}
		a, err1 := normalizedWithoutRevision(p)
		b, err2 := normalizedWithoutRevision(nd)
		if err1 != nil || err2 != nil {
			return nil, nil, newAPIError(http.StatusInternalServerError, "Failed to compare dashboard content")
		}
		if !bytes.Equal(a, b) {
			cur++
		}
		nd["revision"] = cur
		revs[id] = cur
	}
	return next, revs, nil
}

// handleDashboards dispatches /api/dashboards/{id} and /api/dashboards/{id}/settings.
func (r *Router) handleDashboards(w http.ResponseWriter, req *http.Request) {
	if !r.migrationGuard(w) {
		return
	}
	rest := strings.TrimPrefix(req.URL.Path, "/api/dashboards/")
	id, sub, _ := strings.Cut(rest, "/")
	if id == "" {
		writeJSONError(w, "Dashboard id required", http.StatusBadRequest)
		return
	}
	switch {
	case sub == "" && req.Method == http.MethodPut:
		r.handlePutDashboard(w, req, id)
	case sub == "settings" && req.Method == http.MethodGet:
		r.handleGetDashboardSettings(w, id)
	case sub == "settings" && req.Method == http.MethodPut:
		r.handlePutDashboardSettings(w, req, id)
	case sub == "" || sub == "settings":
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
	default:
		writeJSONError(w, "Not found", http.StatusNotFound)
	}
}

func (r *Router) handlePutDashboard(w http.ResponseWriter, req *http.Request, id string) {
	var body struct {
		Dashboard configdoc.Obj `json:"dashboard"`
		Revision  any           `json:"revision"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil || body.Dashboard == nil {
		writeJSONError(w, "Invalid JSON: expected {\"dashboard\": {...}, \"revision\": n}", http.StatusBadRequest)
		return
	}
	if bid, _ := body.Dashboard["id"].(string); bid != id {
		writeJSONError(w, "Dashboard id in body does not match the URL", http.StatusBadRequest)
		return
	}
	r.updateDocWithBackup(w, func(stored configdoc.Obj) (configdoc.Obj, interface{}, error) {
		prev, ok := storedDashboards(stored)[id]
		if !ok {
			return nil, nil, newAPIError(http.StatusNotFound, "Dashboard not found: "+id)
		}
		if ce := checkRevision(id, prev, body.Revision); ce != nil {
			return nil, nil, ce
		}
		// Convert just this dashboard; FromLegacy carries settings, layouts
		// and defaultLayout from prev.
		one, err := configdoc.FromLegacy(
			configdoc.Obj{"dashboards": []any{map[string]interface{}(body.Dashboard)}},
			configdoc.Obj{"schemaVersion": configdoc.SchemaVersion, "dashboards": []any{prev}},
		)
		if err != nil {
			return nil, nil, newAPIError(http.StatusBadRequest, "Invalid dashboard: "+err.Error())
		}
		nd := one["dashboards"].([]any)[0].(configdoc.Obj)
		cur, rerr := storedRevision(id, prev)
		if rerr != nil {
			return nil, nil, rerr
		}
		nd["revision"] = cur + 1
		next := replaceDashboard(stored, id, nd)
		return next, map[string]interface{}{"revision": cur + 1}, nil
	})
}

// replaceDashboard swaps the dashboard with the given id in stored (in place).
func replaceDashboard(stored configdoc.Obj, id string, nd configdoc.Obj) configdoc.Obj {
	l, _ := stored["dashboards"].([]any)
	for i, d := range l {
		if m, ok := d.(configdoc.Obj); ok && m["id"] == id {
			l[i] = nd
		}
	}
	return stored
}

// settingJSONKeys are the six per-dashboard override keys.
func settingJSONKeys() []string {
	keys := make([]string, 0, len(configdoc.SettingKeys))
	for k := range configdoc.SettingKeys {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func (r *Router) handleGetDashboardSettings(w http.ResponseWriter, id string) {
	stored, err := configdoc.Load(r.db)
	if err != nil {
		writeAPIError(w, loadErr(err))
		return
	}
	d, ok := storedDashboards(stored)[id]
	if !ok {
		writeAPIError(w, newAPIError(http.StatusNotFound, "Dashboard not found: "+id))
		return
	}
	overrides := map[string]interface{}{}
	ov, _ := d["settings"].(configdoc.Obj)
	for _, k := range settingJSONKeys() {
		overrides[k] = ov[k] // nil when absent
	}
	eff := configdoc.Resolve(r.settings, d)
	rev, rerr := storedRevision(id, d)
	if rerr != nil {
		writeAPIError(w, rerr)
		return
	}
	writeJSON(w, map[string]interface{}{
		"overrides": overrides,
		"effective": map[string]interface{}{
			"statusChecksEnabled":        eff.StatusChecksEnabled,
			"statusCheckIntervalMinutes": eff.StatusCheckIntervalMinutes,
			"statusCheckTimeoutSeconds":  eff.StatusCheckTimeoutSeconds,
			"editIdleTimeoutMinutes":     eff.EditIdleTimeoutMinutes,
			"animatedFolderBackgrounds":  eff.AnimatedFolderBackgrounds,
			"defaultLayout":              eff.DefaultLayout,
		},
		"revision": rev,
	})
}

func (r *Router) handlePutDashboardSettings(w http.ResponseWriter, req *http.Request, id string) {
	var body struct {
		Overrides configdoc.Obj `json:"overrides"`
		Revision  any           `json:"revision"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil || body.Overrides == nil {
		writeJSONError(w, "Invalid JSON: expected {\"overrides\": {...}, \"revision\": n}", http.StatusBadRequest)
		return
	}
	if err := configdoc.ValidateOverrides(r.settings, body.Overrides); err != nil {
		writeJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	r.updateDoc(w, func(stored configdoc.Obj) (configdoc.Obj, interface{}, error) {
		d, ok := storedDashboards(stored)[id]
		if !ok {
			return nil, nil, newAPIError(http.StatusNotFound, "Dashboard not found: "+id)
		}
		if ce := checkRevision(id, d, body.Revision); ce != nil {
			return nil, nil, ce
		}
		// Merge: absent key keeps its stored value; explicit null resets it.
		old, _ := d["settings"].(configdoc.Obj)
		full := configdoc.Obj{}
		for _, k := range settingJSONKeys() {
			if v, present := body.Overrides[k]; present {
				full[k] = v
			} else {
				full[k] = old[k]
			}
		}
		d["settings"] = full
		cur, _ := intRevision(d["revision"]) // validated by checkRevision above
		d["revision"] = cur + 1
		return stored, map[string]interface{}{"revision": cur + 1}, nil
	})
}

// renameKindLabel is the user-facing word for a Rename.Kind (the admin UI
// still shows the legacy groups/entries view).
var renameKindLabel = map[string]string{"dashboard": "Dashboard", "tab": "Tab", "folder": "Group", "tile": "Entry"}

// migrationNotices renders this start's migration renames for the user. The
// dashboard is named by its current name, and the reason says whether the
// clashing first occurrence (which kept the id) is in another dashboard.
func migrationNotices(renames []configdoc.Rename, doc configdoc.Obj) []string {
	owner := map[string]string{} // id -> owning dashboard id
	names := map[string]string{} // dashboard id -> display name
	for id, d := range storedDashboards(doc) {
		names[id] = dashboardLabel(d)
		owner[id] = id
		tabs, _ := d["tabs"].([]any)
		for _, t := range tabs {
			if tm, ok := t.(configdoc.Obj); ok {
				if tid, ok := tm["id"].(string); ok {
					owner[tid] = id
				}
			}
		}
	}
	configdoc.Walk(doc, func(d, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		if id, ok := n["id"].(string); ok {
			owner[id], _ = d["id"].(string)
		}
		return true
	})
	out := make([]string, 0, len(renames))
	for _, rn := range renames {
		label := renameKindLabel[rn.Kind]
		if label == "" {
			label = "Item"
		}
		dash := names[rn.DashboardID]
		if dash == "" {
			dash = rn.DashboardID
		}
		reason := "another item already used that id"
		if o, ok := owner[rn.OldID]; ok {
			if o == rn.DashboardID {
				reason = "another item in the same dashboard already used that id"
			} else {
				reason = "another dashboard already used that id"
			}
		}
		if rn.Kind == "dashboard" {
			out = append(out, fmt.Sprintf("Dashboard %q had its id %q renamed to %q because %s", dash, rn.OldID, rn.NewID, reason))
			continue
		}
		out = append(out, fmt.Sprintf("%s %q in dashboard %q was renamed to %q because %s", label, rn.OldID, dash, rn.NewID, reason))
	}
	return out
}
