package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/settings"
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

// layoutVersionError is the 409 layout_version_mismatch for a
// placement-carrying write whose layoutVersion is not
// configdoc.LayoutVersion, or nil when it is (M5 spec §2a). A page loaded
// before HOPS was updated runs older code that holds the old layout form;
// storing it would put a layout the server no longer reads behind a "saved"
// toast. The request is refused before the document is read, so nothing
// changes.
func layoutVersionError(v any) *apiError {
	if f, ok := v.(float64); ok && f == configdoc.LayoutVersion {
		return nil
	}
	e := newAPIError(http.StatusConflict, "layout_version_mismatch")
	e.body["detail"] = "HOPS was updated since this page was loaded, so this change was not saved. Reload the page, then make the change again."
	e.body["layoutVersion"] = configdoc.LayoutVersion
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

// normPath compares dashboard paths the way the UI routes them: every
// leading "/" is dropped and one is added back ("x", "/x" and "//x" reach the
// same dashboard). The frontend's normPath (stores/config.ts) uses the same rule.
func normPath(p string) string { return "/" + strings.TrimLeft(p, "/") }

// dashboardPathProblem says why p cannot be stored as a dashboard path, or ""
// when it is fine. A backslash or an ASCII control character can make a
// browser resolve the path off-origin; leading/trailing whitespace is
// invisible and ambiguous.
func dashboardPathProblem(p string) string {
	if p != strings.TrimSpace(p) {
		return "starts or ends with whitespace"
	}
	for _, r := range p {
		if r == '\\' {
			return `contains a backslash ("\")`
		}
		if r < 0x20 || r == 0x7f {
			return "contains a control character"
		}
	}
	return ""
}

// unsafePathError is the 400 for a write that would set an unsafe path on d.
func unsafePathError(d map[string]interface{}) *apiError {
	p, ok := d["path"].(string)
	if !ok {
		return nil
	}
	if why := dashboardPathProblem(p); why != "" {
		return newAPIError(http.StatusBadRequest, fmt.Sprintf("Invalid path for dashboard %q: the path %s", dashboardLabel(d), why))
	}
	return nil
}

// pathChanged reports whether body sets a path different from prev's (or prev
// is absent). Only a path being set is checked, so an older stored path never
// blocks unrelated saves.
func pathChanged(prev configdoc.Obj, body map[string]interface{}) bool {
	if prev == nil {
		return true
	}
	pp, _ := prev["path"].(string)
	bp, _ := body["path"].(string)
	return pp != bp
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

// docAfterFn runs inside the write transaction after the new document is
// saved (e.g. promote marking its scan results); an error rolls everything
// back.
type docAfterFn func(tx *sql.Tx) error

// publicDoc is what GET /api/config serves and every write response carries
// as `layout`: the schema version, the layout-form marker layoutVersion
// and the dashboards, nothing else from the stored document.
//
// Each dashboard also carries a read-only `display` block computed from its
// effective settings (Ruling 9): what every viewer, signed in or not, needs to
// render it (animatedFolderBackgrounds, and the global animations switch). It is never stored: a write
// drops it (transientDashboardKeys).
func (r *Router) publicDoc(stored configdoc.Obj) map[string]interface{} {
	raw, _ := stored["dashboards"].([]any)
	dashes := make([]any, 0, len(raw))
	for _, d := range raw {
		dm, ok := d.(configdoc.Obj)
		if !ok {
			dashes = append(dashes, d)
			continue
		}
		out := make(configdoc.Obj, len(dm)+1)
		for k, v := range dm {
			out[k] = v
		}
		eff := configdoc.Resolve(r.settings, dm)
		out["display"] = map[string]interface{}{
			"animatedFolderBackgrounds": eff.AnimatedFolderBackgrounds,
			// The global "Animations" setting (M6 §7.13); no per-dashboard override.
			"animations": r.settings.Get(settings.KeyDisplayAnimations), // "on" | "off" | "always" (Ruling 5)
		}
		dashes = append(dashes, out)
	}
	out := map[string]interface{}{"schemaVersion": configdoc.SchemaVersion, "dashboards": dashes}
	// The layout-form marker is served, so the frontend can refuse (visibly)
	// to save into a document that is not in the form it writes. Start-up
	// refuses a stored document at another version (MigrateWithBackup).
	if v, ok := stored[configdoc.LayoutVersionKey]; ok {
		out[configdoc.LayoutVersionKey] = v
	}
	return out
}

// attachLayout adds `layout` (the committed document, as GET /api/config
// serves it) to a write response, so a client never keeps a layout older
// than its own save.
func (r *Router) attachLayout(resp map[string]interface{}, committed configdoc.Obj) {
	resp["layout"] = r.publicDoc(committed)
}

// updateDoc runs fn on the stored config inside one transaction. fn returns
// the new document and the response body; any error rolls everything back.
func (r *Router) updateDoc(w http.ResponseWriter, fn docUpdateFn) {
	r.updateDocTx(w, loadErr, fn, nil, nil)
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
// onCommit (when given) runs once the write has committed, before the
// response is written: process state that must follow the stored document
// only (e.g. import's notices) is updated there, never on a rolled-back write.
func (r *Router) updateDocWithLoadErr(w http.ResponseWriter, onLoadErr func(error) *apiError, fn docUpdateFn, onCommit func()) {
	r.updateDocTx(w, onLoadErr, fn, nil, onCommit)
}

// updateDocTx is the one write path: load, fn, verify ids, save, then after
// (when given), all in one transaction; the response carries the committed
// document as `layout`.
func (r *Router) updateDocTx(w http.ResponseWriter, onLoadErr func(error) *apiError, fn docUpdateFn, after docAfterFn, onCommit func()) {
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
	if after != nil {
		if err := after(tx); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	// Re-read what was just written (same transaction) so the response carries
	// exactly the committed document.
	var committed configdoc.Obj
	if _, ok := resp.(map[string]interface{}); ok {
		c, lerr := configdoc.Load(tx)
		if lerr != nil {
			writeAPIError(w, newAPIError(http.StatusInternalServerError, "Failed to read back saved config: "+lerr.Error()))
			return
		}
		committed = c
	}
	if err := tx.Commit(); err != nil {
		writeAPIError(w, newAPIError(http.StatusInternalServerError, "Failed to commit config: "+err.Error()))
		return
	}
	if onCommit != nil {
		onCommit()
	}
	if m, ok := resp.(map[string]interface{}); ok {
		r.attachLayout(m, committed)
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
	r.updateDocWithBackupAfter(w, fn, nil)
}

// updateDocWithBackupAfter is updateDocWithBackup with an after step run in
// the write transaction once the new document is saved.
func (r *Router) updateDocWithBackupAfter(w http.ResponseWriter, fn docUpdateFn, after docAfterFn) {
	if err := r.dryRunDoc(fn); err != nil {
		writeAPIError(w, err)
		return
	}
	warning := r.preUpdateBackup()
	r.updateDocTx(w, loadErr, func(stored configdoc.Obj) (configdoc.Obj, interface{}, error) {
		next, resp, err := fn(stored)
		if err == nil && warning != "" {
			if m, ok := resp.(map[string]interface{}); ok {
				m["warning"] = joinWarnings(m["warning"], warning)
			}
		}
		return next, resp, err
	}, after, nil)
}

// joinWarnings appends w to an existing response warning (if any).
func joinWarnings(existing any, w string) string {
	if s, _ := existing.(string); s != "" {
		return s + " " + w
	}
	return w
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
	// The literal segments "order" and "transfer" are collection routes, not
	// dashboard ids, and are matched before any {id} route.
	if sub == "" && (id == "order" || id == "transfer") {
		switch {
		case id == "order" && req.Method == http.MethodPut:
			r.handleOrderDashboards(w, req)
		case id == "transfer" && req.Method == http.MethodPost:
			r.handleTransferNodes(w, req)
		default:
			writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}
	switch {
	case sub == "" && req.Method == http.MethodPut:
		r.handlePutDashboard(w, req, id)
	case sub == "" && req.Method == http.MethodDelete:
		r.handleDeleteDashboard(w, req, id)
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
		Schema        any           `json:"schema"`
		Dashboard     configdoc.Obj `json:"dashboard"`
		Revision      any           `json:"revision"`
		LayoutVersion any           `json:"layoutVersion"`
	}
	req.Body = http.MaxBytesReader(w, req.Body, maxDashboardBodyBytes)
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil || body.Dashboard == nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeAPIError(w, newAPIError(http.StatusRequestEntityTooLarge, "Request body is larger than the 16 MiB limit"))
			return
		}
		writeJSONError(w, "Invalid JSON: expected {\"schema\": 3, \"dashboard\": {...}, \"revision\": n}", http.StatusBadRequest)
		return
	}
	if bid, _ := body.Dashboard["id"].(string); bid != id {
		writeJSONError(w, "Dashboard id in body does not match the URL", http.StatusBadRequest)
		return
	}
	if n, ok := intRevision(body.Schema); !ok || n != configdoc.SchemaVersion {
		writeJSONError(w, fmt.Sprintf("Unsupported schema %v: this endpoint accepts schema %d dashboards ({\"schema\": 3, \"dashboard\": {...}, \"revision\": n})", body.Schema, configdoc.SchemaVersion), http.StatusBadRequest)
		return
	}
	if le := layoutVersionError(body.LayoutVersion); le != nil {
		writeAPIError(w, le)
		return
	}
	r.handlePutDashboardV3(w, id, body.Dashboard, body.Revision)
}

// handleDeleteDashboard deletes one dashboard seen at ?revision=n. The pre-update backup is taken only once the checks
// pass (updateDocWithBackup's dry run).
func (r *Router) handleDeleteDashboard(w http.ResponseWriter, req *http.Request, id string) {
	raw := req.URL.Query().Get("revision")
	if raw == "" {
		writeJSONError(w, "revision query parameter required: DELETE /api/dashboards/{id}?revision=n", http.StatusBadRequest)
		return
	}
	rev, err := strconv.Atoi(raw)
	if err != nil {
		writeJSONError(w, "revision must be an integer", http.StatusBadRequest)
		return
	}
	r.updateDocWithBackup(w, func(stored configdoc.Obj) (configdoc.Obj, interface{}, error) {
		prev, ok := storedDashboards(stored)[id]
		if !ok {
			return nil, nil, newAPIError(http.StatusNotFound, "Dashboard not found: "+id)
		}
		if ce := checkRevision(id, prev, float64(rev)); ce != nil {
			return nil, nil, ce
		}
		l, _ := stored["dashboards"].([]any)
		kept := make([]any, 0, len(l))
		for _, d := range l {
			if m, ok := d.(configdoc.Obj); ok && m["id"] == id {
				continue
			}
			kept = append(kept, d)
		}
		stored["dashboards"] = kept
		return stored, map[string]interface{}{"status": "ok"}, nil
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

// renameKindLabel is the user-facing word for a Rename.Kind.
var renameKindLabel = map[string]string{"dashboard": "Dashboard", "tab": "Tab", "folder": "Folder", "tile": "Tile"}

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
		if rn.Kind == "dashboard" && configdoc.IsReservedDashboardID(rn.OldID) {
			reason = "that id is reserved by HOPS"
		}
		if rn.Kind == "dashboard" {
			out = append(out, fmt.Sprintf("Dashboard %q had its id %q renamed to %q because %s", dash, rn.OldID, rn.NewID, reason))
			continue
		}
		out = append(out, fmt.Sprintf("%s %q in dashboard %q was renamed to %q because %s", label, rn.OldID, dash, rn.NewID, reason))
	}
	return out
}
