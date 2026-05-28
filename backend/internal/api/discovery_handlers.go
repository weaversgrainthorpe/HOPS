package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"database/sql"

	"github.com/weaversgrainthorpe/HOPS/internal/discovery"
)

// Discovery API handlers (Phase 1).
//
// Routes registered in setupRoutes:
//
//   POST   /api/discovery/scans                              start new scan
//   GET    /api/discovery/scans                              list drafts
//   GET    /api/discovery/scans/{id}                         get one draft + results
//   POST   /api/discovery/scans/{id}/cancel                  cancel running scan
//   DELETE /api/discovery/scans/{id}                         delete draft
//   POST   /api/discovery/scans/{id}/promote                 promote selected results
//   PATCH  /api/discovery/scans/{id}/results/{rid}           update curate state
//   GET    /api/discovery/suggest-cidr                       default CIDR for the host
//
// All endpoints require auth + CSRF (mutations) via r.protected.

// handleDiscoveryScansCollection routes /api/discovery/scans (no trailing ID).
func (r *Router) handleDiscoveryScansCollection(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		r.handleListScans(w, req)
	case http.MethodPost:
		r.handleCreateScan(w, req)
	default:
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleDiscoveryScansItem dispatches /api/discovery/scans/{id} and its
// sub-paths: /cancel, /promote, /results/{rid}. We hand-roll path parsing
// rather than reach for a router library because the rest of HOPS does so
// and consistency wins.
func (r *Router) handleDiscoveryScansItem(w http.ResponseWriter, req *http.Request) {
	rest := strings.TrimPrefix(req.URL.Path, "/api/discovery/scans/")
	parts := strings.Split(rest, "/")
	if len(parts) == 0 || parts[0] == "" {
		writeJSONError(w, "Scan ID required", http.StatusBadRequest)
		return
	}
	scanID := parts[0]

	// /api/discovery/scans/{id}
	if len(parts) == 1 {
		switch req.Method {
		case http.MethodGet:
			r.handleGetScan(w, req, scanID)
		case http.MethodDelete:
			r.handleDeleteScan(w, req, scanID)
		default:
			writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	// /api/discovery/scans/{id}/{action}
	switch parts[1] {
	case "cancel":
		if req.Method != http.MethodPost {
			writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		r.handleCancelScan(w, req, scanID)
	case "promote":
		if req.Method != http.MethodPost {
			writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		r.handlePromoteScan(w, req, scanID)
	case "results":
		if len(parts) != 3 || parts[2] == "" {
			writeJSONError(w, "Result ID required", http.StatusBadRequest)
			return
		}
		if req.Method != http.MethodPatch {
			writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		r.handlePatchResult(w, req, scanID, parts[2])
	default:
		writeJSONError(w, "Not found", http.StatusNotFound)
	}
}

// handleCreateScan: POST /api/discovery/scans
// Body: { cidr, intensity?, label?, internalDomain? }. intensity defaults to "light".
func (r *Router) handleCreateScan(w http.ResponseWriter, req *http.Request) {
	var body struct {
		CIDR           string `json:"cidr"`
		Intensity      string `json:"intensity"`
		Label          string `json:"label"`
		InternalDomain string `json:"internalDomain"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	body.CIDR = strings.TrimSpace(body.CIDR)
	if body.CIDR == "" {
		writeJSONError(w, "targets are required", http.StatusBadRequest)
		return
	}
	if err := validateTargets(body.CIDR); err != nil {
		writeJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}

	intensity := body.Intensity
	if intensity == "" {
		intensity = discovery.IntensityLight
	}
	switch intensity {
	case discovery.IntensityPassive, discovery.IntensityLight, discovery.IntensityFull:
		// Phase 1 only actually scans at "light" intensity, but we accept
		// the field so the API contract is stable across phases.
	default:
		writeJSONError(w, "intensity must be one of: passive, light, full", http.StatusBadRequest)
		return
	}

	internalDomain := strings.ToLower(strings.TrimSpace(body.InternalDomain))
	if err := validateInternalDomain(internalDomain); err != nil {
		writeJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Best-effort user-ID lookup for the audit trail. We've already passed
	// the auth middleware so a valid session exists.
	createdBy := 0
	if sid := extractSessionID(req); sid != "" {
		if uid, err := r.authService.ValidateSession(sid); err == nil {
			createdBy = uid
		}
	}

	id := newScanID()
	scan, err := r.discoveryStore.CreateScan(id, body.CIDR, intensity, body.Label, internalDomain, createdBy)
	if err != nil {
		slog.Error("discovery: failed to create scan", "component", "discovery", "error", err)
		writeJSONError(w, "Failed to create scan", http.StatusInternalServerError)
		return
	}

	r.discoveryOrch.Submit(scan.ID)

	// Set Content-Type BEFORE WriteHeader — once status line is sent,
	// late header sets in writeJSON are silently dropped, leaving the
	// client to guess at a text/plain default.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(scan); err != nil {
		slog.Error("discovery: failed to encode scan response", "error", err)
	}
}

// handleDiscoveryDiagnostics: GET /api/discovery/diagnostics
//
// Returns the deduplicated set of HTTP fallback rows across all scans —
// services that responded to a probe but no specific detector
// recognized them. Each row carries the favicon data URL (when one
// was captured), the extracted HTML title, and the response server
// header, so the diagnostics UI can render a meaningful row and the
// admin can bootstrap a new detector from it in two clicks.
func (r *Router) handleDiscoveryDiagnostics(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rows, err := r.discoveryStore.ListUnidentifiedResults()
	if err != nil {
		slog.Error("discovery: failed to list unidentified results",
			"component", "discovery", "error", err)
		writeJSONError(w, "Failed to load diagnostics", http.StatusInternalServerError)
		return
	}
	summary, err := r.discoveryStore.DetectionSummary()
	if err != nil {
		slog.Error("discovery: failed to compute detection summary",
			"component", "discovery", "error", err)
		// Non-fatal — still return what we have.
		summary = nil
	}
	writeJSON(w, map[string]interface{}{
		"unidentified": rows,
		"summary":      summary,
	})
}

// handleListScans: GET /api/discovery/scans
func (r *Router) handleListScans(w http.ResponseWriter, _ *http.Request) {
	scans, err := r.discoveryStore.ListScans()
	if err != nil {
		slog.Error("discovery: failed to list scans", "component", "discovery", "error", err)
		writeJSONError(w, "Failed to list scans", http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{"scans": scans})
}

// handleGetScan: GET /api/discovery/scans/{id} — returns scan header + results.
// Supports `?resultsSince=<rfc3339>` for cursor-based delta polling.
func (r *Router) handleGetScan(w http.ResponseWriter, req *http.Request, scanID string) {
	scan, err := r.discoveryStore.GetScan(scanID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSONError(w, "Scan not found", http.StatusNotFound)
			return
		}
		slog.Error("discovery: failed to get scan", "component", "discovery", "scan_id", scanID, "error", err)
		writeJSONError(w, "Failed to load scan", http.StatusInternalServerError)
		return
	}
	// Cursor-based delta polling: the curate UI polls every 1s during
	// a running scan. Without the cursor, each poll re-fetches every
	// row (including base64 favicon data URLs) — 100s of KB/s for
	// large scans. With `?resultsSince=<rfc3339>` the server returns
	// only rows whose created_at is strictly newer. The client merges
	// them into its existing list by ID.
	since := req.URL.Query().Get("resultsSince")
	results, err := r.discoveryStore.ListResultsSince(scanID, since)
	if err != nil {
		slog.Error("discovery: failed to list scan results", "component", "discovery", "scan_id", scanID, "error", err)
		writeJSONError(w, "Failed to load scan results", http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{
		"scan":        scan,
		"results":     results,
		"recentHosts": r.discoveryOrch.RecentHosts(scanID),
		"phase":       r.discoveryOrch.Phase(scanID),
		"warnings":    r.discoveryOrch.Warnings(scanID),
	})
}

// handleCancelScan: POST /api/discovery/scans/{id}/cancel
// Idempotent on already-terminal scans (no-op).
func (r *Router) handleCancelScan(w http.ResponseWriter, _ *http.Request, scanID string) {
	scan, err := r.discoveryStore.GetScan(scanID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSONError(w, "Scan not found", http.StatusNotFound)
			return
		}
		writeJSONError(w, "Failed to load scan", http.StatusInternalServerError)
		return
	}
	if isTerminalState(scan.State) {
		writeJSONSuccess(w)
		return
	}
	r.discoveryOrch.Cancel(scanID)
	writeJSONSuccess(w)
}

// handleDeleteScan: DELETE /api/discovery/scans/{id}
// Running scans are cancelled first; deletion cascades to scan_results.
func (r *Router) handleDeleteScan(w http.ResponseWriter, _ *http.Request, scanID string) {
	scan, err := r.discoveryStore.GetScan(scanID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSONError(w, "Scan not found", http.StatusNotFound)
			return
		}
		writeJSONError(w, "Failed to load scan", http.StatusInternalServerError)
		return
	}
	if !isTerminalState(scan.State) {
		// Cancel first so the worker exits cleanly before the rows
		// disappear from under it.
		r.discoveryOrch.Cancel(scanID)
	}
	if err := r.discoveryStore.DeleteScan(scanID); err != nil {
		slog.Error("discovery: failed to delete scan", "component", "discovery", "scan_id", scanID, "error", err)
		writeJSONError(w, "Failed to delete scan", http.StatusInternalServerError)
		return
	}
	// Drop the in-memory warnings list — keeping it leaks memory for
	// no benefit once the scan rows are gone.
	r.discoveryOrch.ClearWarnings(scanID)
	writeJSONSuccess(w)
}

// handlePatchResult: PATCH /api/discovery/scans/{id}/results/{rid}
// Body: { curateState?, overrides?, category? }
//
// Each field is independently optional — pass only what you want to
// change. Category is validated against the catalogue; promoted rows
// reject any change (their tile is already on a dashboard).
func (r *Router) handlePatchResult(w http.ResponseWriter, req *http.Request, scanID, resultID string) {
	var body struct {
		CurateState string                 `json:"curateState"`
		Overrides   map[string]interface{} `json:"overrides"`
		Category    *string                `json:"category"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	existing, err := r.discoveryStore.GetResult(scanID, resultID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSONError(w, "Result not found", http.StatusNotFound)
			return
		}
		writeJSONError(w, "Failed to load result", http.StatusInternalServerError)
		return
	}

	newState := existing.CurateState
	if body.CurateState != "" {
		switch body.CurateState {
		case discovery.CuratePending, discovery.CurateSelected, discovery.CurateIgnored:
			newState = body.CurateState
		default:
			writeJSONError(w, "curateState must be one of: pending, selected, ignored", http.StatusBadRequest)
			return
		}
	}
	overrides := existing.CurateOverrides
	if body.Overrides != nil {
		overrides = body.Overrides
	}

	if err := r.discoveryStore.UpdateResultCurate(scanID, resultID, newState, overrides); err != nil {
		writeJSONError(w, "Failed to update result", http.StatusInternalServerError)
		return
	}

	if body.Category != nil {
		cat := strings.TrimSpace(*body.Category)
		if !discovery.IsValidCategory(cat) {
			writeJSONError(w, "Invalid category", http.StatusBadRequest)
			return
		}
		if err := r.discoveryStore.UpdateResultCategory(scanID, resultID, cat); err != nil {
			writeJSONError(w, "Failed to update category", http.StatusInternalServerError)
			return
		}
	}

	writeJSONSuccess(w)
}

// promoteTarget is the destination spec for a promote operation. The
// dashboard and tab are admin-picked (either ID-of-existing or a "new"
// block with a name). Groups are NO LONGER admin-picked — the promote
// handler distributes the selected results across groups by their
// `category` slug, finding-or-creating one group per category. This
// turns "promote 20 tiles" from a single-group dump into a sensible
// layout-on-arrival ("Sonarr into Downloads, Pi-hole into Network…").
// Cascading rule retained: a new dashboard implies a new tab.
type promoteTarget struct {
	DashboardID  string             `json:"dashboardId"`
	NewDashboard *newDashboardInput `json:"newDashboard"`
	TabID        string             `json:"tabId"`
	NewTab       *newNamedInput     `json:"newTab"`
}

type newDashboardInput struct {
	Name string `json:"name"`
	Path string `json:"path"` // optional; auto-slugified from Name when blank
}

type newNamedInput struct {
	Name string `json:"name"`
}

// handlePromoteScan: POST /api/discovery/scans/{id}/promote
// Body: { target: promoteTarget, resultIds: [...] }
// All-or-nothing inside a single transaction that mutates the config JSON.
func (r *Router) handlePromoteScan(w http.ResponseWriter, req *http.Request, scanID string) {
	var body struct {
		Target    promoteTarget `json:"target"`
		ResultIDs []string      `json:"resultIds"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if err := validatePromoteTarget(&body.Target); err != nil {
		writeJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	if len(body.ResultIDs) == 0 {
		writeJSONError(w, "At least one resultId is required", http.StatusBadRequest)
		return
	}

	scan, err := r.discoveryStore.GetScan(scanID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSONError(w, "Scan not found", http.StatusNotFound)
			return
		}
		writeJSONError(w, "Failed to load scan", http.StatusInternalServerError)
		return
	}
	if scan.State != discovery.StateComplete && scan.State != discovery.StateCancelled {
		writeJSONError(w, "Scan must be complete or cancelled before promoting", http.StatusBadRequest)
		return
	}

	// Load the requested results and apply per-result overrides. Per-row
	// re-promotion is rejected here — a result already turned into a
	// tile shouldn't quietly produce a second tile on the next click.
	resultsByID := make(map[string]*discovery.Result, len(body.ResultIDs))
	for _, rid := range body.ResultIDs {
		res, err := r.discoveryStore.GetResult(scanID, rid)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeJSONError(w, fmt.Sprintf("Result %q not found", rid), http.StatusBadRequest)
				return
			}
			writeJSONError(w, "Failed to load result", http.StatusInternalServerError)
			return
		}
		if res.CurateState == discovery.CuratePromoted {
			writeJSONError(w, fmt.Sprintf("Result %q has already been promoted", rid), http.StatusConflict)
			return
		}
		resultsByID[rid] = res
	}

	// Load and mutate the config JSON inside a transaction.
	tx, err := r.db.Begin()
	if err != nil {
		writeJSONError(w, "Failed to start transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback() //nolint:errcheck

	var configJSON string
	if err := tx.QueryRow(`SELECT data FROM config WHERE id = 1`).Scan(&configJSON); err != nil {
		writeJSONError(w, "Failed to load config", http.StatusInternalServerError)
		return
	}
	var cfg map[string]interface{}
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		writeJSONError(w, "Config is corrupt; promotion aborted", http.StatusInternalServerError)
		return
	}

	dashboard, dashboardPath, err := resolveDashboard(cfg, &body.Target)
	if err != nil {
		writeJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	tab, err := resolveTab(dashboard, &body.Target)
	if err != nil {
		writeJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Distribute results across groups by category. Each unique category
	// becomes (or reuses) one group inside the target tab; the tile
	// lands there. Tracks which groups were created so the response can
	// echo a summary if the UI wants to show "added 5 tiles to 3
	// groups: Network, Downloads, Media".
	groupsByCategory := map[string]map[string]interface{}{}
	promoted := 0
	for _, rid := range body.ResultIDs {
		res := resultsByID[rid]
		cat := res.Category
		if cat == "" || !discovery.IsValidCategory(cat) {
			cat = discovery.CategoryOther
		}
		group, ok := groupsByCategory[cat]
		if !ok {
			group = findOrCreateGroupForCategory(tab, cat)
			groupsByCategory[cat] = group
		}
		entries, _ := group["entries"].([]interface{})
		entry := resultToEntry(res, len(entries))
		group["entries"] = append(entries, entry)
		promoted++
	}

	newConfigJSON, err := json.Marshal(cfg)
	if err != nil {
		writeJSONError(w, "Failed to encode config", http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(
		`UPDATE config SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
		string(newConfigJSON),
	); err != nil {
		writeJSONError(w, "Failed to save config", http.StatusInternalServerError)
		return
	}
	// Mark the promoted results so they can't be promoted again. The
	// scan itself stays in StateComplete so the admin can come back and
	// promote additional rows from the same draft later.
	if err := r.discoveryStore.MarkResultsPromoted(tx, scanID, body.ResultIDs); err != nil {
		writeJSONError(w, "Failed to mark results as promoted", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(); err != nil {
		writeJSONError(w, "Failed to commit promotion", http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]interface{}{
		"promoted":      promoted,
		"dashboardPath": dashboardPath,
	})
}

// validatePromoteTarget enforces the "exactly one of ID-or-new" rule for
// dashboard and tab, plus the cascading rule (new dashboard ⇒ new tab).
// Groups are derived from result categories at promote time, so this
// function doesn't validate them.
func validatePromoteTarget(t *promoteTarget) error {
	dashNew := t.NewDashboard != nil
	tabNew := t.NewTab != nil

	if dashNew && strings.TrimSpace(t.NewDashboard.Name) == "" {
		return errors.New("newDashboard.name is required")
	}
	if tabNew && strings.TrimSpace(t.NewTab.Name) == "" {
		return errors.New("newTab.name is required")
	}

	if !dashNew && t.DashboardID == "" {
		return errors.New("either target.dashboardId or target.newDashboard is required")
	}
	if dashNew && !tabNew {
		return errors.New("creating a new dashboard requires creating a new tab inside it")
	}
	if !tabNew && t.TabID == "" {
		return errors.New("either target.tabId or target.newTab is required")
	}
	return nil
}

// resolveDashboard returns the target dashboard map (creating it if the
// target asks for one) and the dashboard's path so the handler can send
// the user there on success.
func resolveDashboard(cfg map[string]interface{}, t *promoteTarget) (map[string]interface{}, string, error) {
	dashboards, _ := cfg["dashboards"].([]interface{})
	if t.NewDashboard != nil {
		path := strings.TrimSpace(t.NewDashboard.Path)
		if path == "" {
			path = slugifyDashboardPath(t.NewDashboard.Name)
		}
		path = ensureUniqueDashboardPath(dashboards, path)
		dash := map[string]interface{}{
			"id":    discovery.NewID(),
			"name":  strings.TrimSpace(t.NewDashboard.Name),
			"path":  path,
			"tabs":  []interface{}{},
			"order": len(dashboards),
		}
		dashboards = append(dashboards, dash)
		cfg["dashboards"] = dashboards
		return dash, path, nil
	}
	for _, d := range dashboards {
		dm, ok := d.(map[string]interface{})
		if ok && dm["id"] == t.DashboardID {
			path, _ := dm["path"].(string)
			return dm, path, nil
		}
	}
	return nil, "", fmt.Errorf("dashboard %q not found", t.DashboardID)
}

func resolveTab(dashboard map[string]interface{}, t *promoteTarget) (map[string]interface{}, error) {
	tabs, _ := dashboard["tabs"].([]interface{})
	if t.NewTab != nil {
		tab := map[string]interface{}{
			"id":     discovery.NewID(),
			"name":   strings.TrimSpace(t.NewTab.Name),
			"groups": []interface{}{},
			"order":  len(tabs),
		}
		tabs = append(tabs, tab)
		dashboard["tabs"] = tabs
		return tab, nil
	}
	for _, t2 := range tabs {
		tm, ok := t2.(map[string]interface{})
		if ok && tm["id"] == t.TabID {
			return tm, nil
		}
	}
	return nil, fmt.Errorf("tab %q not found in dashboard", t.TabID)
}

// findOrCreateGroupForCategory finds a group inside tab whose name
// matches the category's display name (case-insensitive); if none
// exists, creates a new one with that name + the category's icon, then
// appends it to the tab. The returned group is a mutable handle into
// the cfg blob — caller appends entries to its "entries" slice.
func findOrCreateGroupForCategory(tab map[string]interface{}, category string) map[string]interface{} {
	info := discovery.CategoryInfoFor(category)
	target := strings.ToLower(info.DisplayName)

	groups, _ := tab["groups"].([]interface{})
	for _, g := range groups {
		gm, ok := g.(map[string]interface{})
		if !ok {
			continue
		}
		name, _ := gm["name"].(string)
		if strings.ToLower(strings.TrimSpace(name)) == target {
			if _, ok := gm["entries"].([]interface{}); !ok {
				gm["entries"] = []interface{}{}
			}
			return gm
		}
	}

	group := map[string]interface{}{
		"id":        discovery.NewID(),
		"name":      info.DisplayName,
		"icon":      info.Icon,
		"collapsed": false,
		"entries":   []interface{}{},
		"order":     len(groups),
	}
	tab["groups"] = append(groups, group)
	return group
}

// slugifyDashboardPath converts a free-text dashboard name into a clean
// URL path. Examples:
//
//	"Home"          → "/home"
//	"Network Tools" → "/network-tools"
//	"Pi-hole + DNS" → "/pi-hole-dns"
func slugifyDashboardPath(name string) string {
	var b strings.Builder
	prevDash := true // suppress leading '-'
	for _, r := range strings.ToLower(name) {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			prevDash = false
		default:
			if !prevDash {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	s := strings.Trim(b.String(), "-")
	if s == "" {
		s = "dashboard"
	}
	return "/" + s
}

// ensureUniqueDashboardPath appends -2, -3, … if the candidate clashes
// with an existing dashboard.
func ensureUniqueDashboardPath(dashboards []interface{}, candidate string) string {
	taken := make(map[string]bool)
	for _, d := range dashboards {
		if dm, ok := d.(map[string]interface{}); ok {
			if p, ok := dm["path"].(string); ok {
				taken[p] = true
			}
		}
	}
	if !taken[candidate] {
		return candidate
	}
	for i := 2; ; i++ {
		c := fmt.Sprintf("%s-%d", candidate, i)
		if !taken[c] {
			return c
		}
	}
}

// handleSuggestCIDR: GET /api/discovery/suggest-cidr — picks a sensible
// default for the scan form by walking the host's interfaces and
// returning the first RFC1918 IPv4 network that's bigger than /32.
// Never auto-submits; just a helpful default.
func (r *Router) handleSuggestCIDR(w http.ResponseWriter, _ *http.Request) {
	cidr := suggestLocalCIDR()
	writeJSON(w, map[string]interface{}{"cidr": cidr})
}

// suggestLocalCIDR returns the first RFC1918 IPv4 network found on a
// non-loopback interface, sized to /24 if the interface advertises a
// larger network (a /16 default would surprise people).
func suggestLocalCIDR() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return "192.168.1.0/24"
	}
	for _, a := range addrs {
		ipnet, ok := a.(*net.IPNet)
		if !ok || ipnet.IP.IsLoopback() {
			continue
		}
		ip4 := ipnet.IP.To4()
		if ip4 == nil {
			continue
		}
		if !isPrivateIPv4(ip4) {
			continue
		}
		// Clamp to /24 minimum prefix length so we don't suggest a /16
		// or /8 by accident.
		ones, _ := ipnet.Mask.Size()
		if ones < 24 {
			ones = 24
		}
		mask := net.CIDRMask(ones, 32)
		network := ip4.Mask(mask)
		return fmt.Sprintf("%s/%d", network.String(), ones)
	}
	return "192.168.1.0/24"
}

func isPrivateIPv4(ip net.IP) bool {
	switch {
	case ip[0] == 10:
		return true
	case ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31:
		return true
	case ip[0] == 192 && ip[1] == 168:
		return true
	}
	return false
}

// validateTargets accepts the scan-targets input — a comma-separated
// list of CIDRs, ranges ("10.0.0.1-50" or "10.0.0.1-10.0.1.50"), and
// single IPs — and rejects malformed or forbidden entries before the
// orchestrator picks the scan up. Link-local / multicast / unspecified
// addresses are blocked at the API edge so the orchestrator never has
// to wonder why the SSRF dial guard refused one of its own hosts.
func validateTargets(input string) error {
	input = strings.TrimSpace(input)
	if input == "" {
		return errors.New("targets are required")
	}
	pieces := strings.Split(input, ",")
	sawInclude := false
	sawAny := false
	for _, raw := range pieces {
		p := strings.TrimSpace(raw)
		if p == "" {
			continue
		}
		sawAny = true
		// Strip a leading `!` or `NOT ` exclusion marker before validating
		// the underlying CIDR / range / single-IP form. The orchestrator
		// re-parses the prefix when expanding; we just need to validate
		// the address part here.
		isExclude := false
		body := p
		if strings.HasPrefix(body, "!") {
			isExclude = true
			body = strings.TrimSpace(strings.TrimPrefix(body, "!"))
		} else if low := strings.ToLower(body); strings.HasPrefix(low, "not ") {
			isExclude = true
			body = strings.TrimSpace(body[len("not "):])
		}
		if body == "" {
			return fmt.Errorf("%q: empty after stripping exclusion prefix", p)
		}
		if err := validateOneTarget(body); err != nil {
			return fmt.Errorf("%q: %v", p, err)
		}
		if !isExclude {
			sawInclude = true
		}
	}
	if !sawAny {
		return errors.New("targets are required")
	}
	if !sawInclude {
		return errors.New("at least one target without a ! / NOT prefix is required")
	}
	return nil
}

func validateOneTarget(t string) error {
	switch {
	case strings.Contains(t, "/"):
		_, ipnet, err := net.ParseCIDR(t)
		if err != nil {
			return fmt.Errorf("invalid CIDR: %v", err)
		}
		if ipnet.IP.To4() == nil {
			return errors.New("only IPv4 CIDRs are supported")
		}
		ones, _ := ipnet.Mask.Size()
		if ones < 16 {
			return fmt.Errorf("CIDR too large (max /16, got /%d)", ones)
		}
		if ipnet.IP.IsLinkLocalUnicast() || ipnet.IP.IsMulticast() || ipnet.IP.IsUnspecified() {
			return errors.New("forbidden range (link-local / multicast / unspecified)")
		}
		return nil
	case strings.Contains(t, "-"):
		// Range form. The orchestrator's expandRange does the real
		// parsing; we sanity-check the format AND that end ≥ start
		// here so the API can reject obvious mistakes before scan
		// creation. Both forms ("A.B.C.D-X" octet shorthand and
		// "A.B.C.D-W.X.Y.Z" full IP) are validated.
		parts := strings.SplitN(t, "-", 2)
		if len(parts) != 2 {
			return errors.New("range needs start-end format")
		}
		start := net.ParseIP(strings.TrimSpace(parts[0]))
		if start == nil || start.To4() == nil {
			return errors.New("invalid range start IP")
		}
		if start.IsLinkLocalUnicast() || start.IsMulticast() || start.IsUnspecified() {
			return errors.New("forbidden range start (link-local / multicast / unspecified)")
		}
		endStr := strings.TrimSpace(parts[1])
		startV4 := start.To4()
		var endV4 net.IP
		if strings.Contains(endStr, ".") {
			endIP := net.ParseIP(endStr)
			if endIP == nil || endIP.To4() == nil {
				return errors.New("invalid range end IP")
			}
			endV4 = endIP.To4()
		} else {
			// Octet shorthand: "10.0.0.1-50" → end = 10.0.0.50
			n, err := strconv.Atoi(endStr)
			if err != nil || n < 0 || n > 255 {
				return fmt.Errorf("invalid range end octet %q (must be 0-255)", endStr)
			}
			endV4 = net.IPv4(startV4[0], startV4[1], startV4[2], byte(n)).To4()
		}
		// Compare as uint32 so ordering is unambiguous across octet
		// boundaries.
		startNum := uint32(startV4[0])<<24 | uint32(startV4[1])<<16 | uint32(startV4[2])<<8 | uint32(startV4[3])
		endNum := uint32(endV4[0])<<24 | uint32(endV4[1])<<16 | uint32(endV4[2])<<8 | uint32(endV4[3])
		if endNum < startNum {
			return fmt.Errorf("range end %s is before start %s", endV4, startV4)
		}
		return nil
	default:
		ip := net.ParseIP(t)
		if ip == nil || ip.To4() == nil {
			return errors.New("not a valid IPv4 address, CIDR, or range")
		}
		if ip.IsLinkLocalUnicast() || ip.IsMulticast() || ip.IsUnspecified() {
			return errors.New("forbidden address (link-local / multicast / unspecified)")
		}
		return nil
	}
}

// validateInternalDomain accepts the optional "internal domain" string
// the admin types when starting a scan. Empty is fine — DNS forward
// enumeration just won't run. Non-empty must be a syntactically valid
// DNS name and outside a small denylist of footgun TLDs.
func validateInternalDomain(d string) error {
	if d == "" {
		return nil
	}
	if len(d) > 253 {
		return errors.New("internal domain is too long (max 253 chars)")
	}
	// Strict label syntax per RFC 1035 §2.3.1 lowercased: each label
	// starts and ends with [a-z0-9], may contain hyphens in the middle,
	// labels joined by single dots.
	if !internalDomainRegex.MatchString(d) {
		return errors.New("internal domain has invalid syntax (expected something like 'internal' or 'home.arpa')")
	}
	// Block TLDs that would cause weird probes if used as zones.
	tld := d
	if i := strings.LastIndex(d, "."); i >= 0 {
		tld = d[i+1:]
	}
	switch tld {
	case "localhost", "arpa":
		return fmt.Errorf("internal domain TLD %q is reserved", tld)
	}
	switch d {
	case "in-addr.arpa", "ip6.arpa":
		return fmt.Errorf("internal domain %q is reserved", d)
	}
	return nil
}

var internalDomainRegex = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$`)

func isTerminalState(state string) bool {
	switch state {
	case discovery.StateComplete, discovery.StateCancelled, discovery.StateFailed, discovery.StatePromoted:
		return true
	}
	return false
}

// resultToEntry constructs the JSON shape of an Entry (as used in the
// existing config blob) from one scan result + any admin overrides.
// Mirrors the Entry struct in internal/models/models.go.
//
// Icon routing: HOPS tiles render icons from two fields. `icon` is an
// Iconify name (`mdi:server`, `simple-icons:proxmox`); `iconUrl` is a
// URL pointing at an image (the bundled dashboard-icons set lives at
// `/api/icons/dashboard/<file>.svg`). Detectors set SuggestedIcon to
// either form; we discriminate on the presence of `:` — a bare slug
// becomes a dashboard-icons URL, an Iconify-style name stays in `icon`.
func resultToEntry(r *discovery.Result, order int) map[string]interface{} {
	name := r.SuggestedName
	icon := r.SuggestedIcon
	url := r.SuggestedURL
	desc := r.SuggestedDesc

	if v, ok := r.CurateOverrides["name"].(string); ok && v != "" {
		name = v
	}
	if v, ok := r.CurateOverrides["icon"].(string); ok {
		icon = v
	}
	if v, ok := r.CurateOverrides["url"].(string); ok && v != "" {
		url = v
	}
	if v, ok := r.CurateOverrides["description"].(string); ok {
		desc = v
	}
	openMode := "newtab"
	if v, ok := r.CurateOverrides["openMode"].(string); ok && v != "" {
		openMode = v
	}
	size := "medium"
	if v, ok := r.CurateOverrides["size"].(string); ok && v != "" {
		size = v
	}

	entry := map[string]interface{}{
		"id":          fmt.Sprintf("entry-%s-%s", r.ScanID[:6], r.ID[:6]),
		"type":        "link",
		"name":        name,
		"url":         url,
		"description": desc,
		"openMode":    openMode,
		"size":        size,
		"order":       order,
	}
	switch {
	case icon == "":
		// no icon — Entry.svelte falls back to mdi:application
	case strings.Contains(icon, ":"):
		entry["icon"] = icon
	default:
		entry["iconUrl"] = "/api/icons/dashboard/" + icon + ".svg"
	}
	return entry
}

// newScanID is a thin wrapper so the API and the orchestrator both go
// through the same routine. The actual implementation lives in the
// discovery package.
func newScanID() string {
	return discovery.NewID()
}
