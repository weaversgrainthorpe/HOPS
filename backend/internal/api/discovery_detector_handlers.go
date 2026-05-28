package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/weaversgrainthorpe/HOPS/internal/discovery"
)

// API for admin-defined detectors (Phase 4 of network discovery).
//
//   GET    /api/discovery/detectors                  list all detectors (bundled + user)
//   POST   /api/discovery/detectors                  create a new user detector
//   GET    /api/discovery/detectors/{id}             read one detector
//   PATCH  /api/discovery/detectors/{id}             update one user detector
//   DELETE /api/discovery/detectors/{id}             delete one user detector
//
// Bundled detector IDs (core/*, dns/*) are read-only — PATCH/DELETE
// against them returns 403.
//
// All endpoints require auth + CSRF (mutations) via r.protected.

// detectorWire is the JSON shape used on the wire for both responses and
// create/update bodies. `source` is server-derived and distinguishes
// bundled vs user-defined. `overridden` is true when a bundled detector
// has a saved override (so the row's fields reflect the override, not
// the original bundled definition).
type detectorWire struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Icon          string   `json:"icon"`
	Category      string   `json:"category"`
	Description   string   `json:"description"`
	Ports         []int    `json:"ports"`
	Paths         []string `json:"paths"`
	URLPath       string   `json:"urlPath"`
	BodyContains  []string `json:"bodyContains"`
	TitleContains []string `json:"titleContains"`
	HeaderKeys    []string `json:"headerKeys"`
	FaviconHashes []int32  `json:"faviconHashes"`
	Confidence    string   `json:"confidence"`
	Enabled       bool     `json:"enabled"`
	Source        string   `json:"source"`     // "bundled" | "user"
	Overridden    bool     `json:"overridden"` // bundled-only: true when an override exists
	CreatedAt     string   `json:"createdAt,omitempty"`
	UpdatedAt     string   `json:"updatedAt,omitempty"`
}

// handleDiscoveryDetectorsCollection routes /api/discovery/detectors.
func (r *Router) handleDiscoveryDetectorsCollection(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		r.handleListDetectors(w, req)
	case http.MethodPost:
		r.handleCreateDetector(w, req)
	default:
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleDiscoveryDetectorsItem routes /api/discovery/detectors/{id}
// and the special path /api/discovery/detectors/reset-bundled (bulk
// reset of all overrides — sentinel before generic ID handling).
func (r *Router) handleDiscoveryDetectorsItem(w http.ResponseWriter, req *http.Request) {
	rest := strings.TrimPrefix(req.URL.Path, "/api/discovery/detectors/")
	if rest == "" {
		writeJSONError(w, "Detector ID required", http.StatusBadRequest)
		return
	}

	// Bulk reset is keyed on a sentinel path. Lives under the same
	// prefix to keep all detector routes in one place.
	if rest == "reset-bundled" {
		if req.Method != http.MethodPost {
			writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		r.handleResetAllOverrides(w, req)
		return
	}

	// The bundled core/foo and user/bar IDs both have one slash. The
	// trailing-slash route /api/discovery/detectors/ catches them all.
	id := rest
	switch req.Method {
	case http.MethodGet:
		r.handleGetDetector(w, req, id)
	case http.MethodPatch:
		r.handleUpdateDetector(w, req, id)
	case http.MethodDelete:
		r.handleDeleteDetector(w, req, id)
	default:
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleListDetectors: GET /api/discovery/detectors
// Returns bundled + user detectors, ordered bundled-first then by name.
// Lets the frontend's filter UI show "all/bundled/user" without two
// round-trips.
func (r *Router) handleListDetectors(w http.ResponseWriter, _ *http.Request) {
	stored, err := r.discoveryStore.ListDetectors()
	if err != nil {
		slog.Error("discovery: failed to list user detectors",
			"component", "discovery", "error", err)
		writeJSONError(w, "Failed to load detectors", http.StatusInternalServerError)
		return
	}
	// Split stored rows into overrides (keyed by bundled ID) and
	// user customs. Overrides shadow the bundled definition in the
	// wire response — admin sees their edited values, not the
	// original bundled fields.
	overrides := make(map[string]*discovery.UserDetector, len(stored))
	customs := make([]*discovery.UserDetector, 0, len(stored))
	for _, u := range stored {
		if strings.HasPrefix(u.ID, "user/") {
			customs = append(customs, u)
		} else {
			overrides[u.ID] = u
		}
	}

	out := make([]detectorWire, 0)
	for _, d := range r.discoveryOrch.Registry().BundledSpecific() {
		dw := wireFromBundled(d)
		if dw == nil {
			continue
		}
		if ov, ok := overrides[d.ID()]; ok {
			// Override exists — replace fields with override values
			// but keep source=bundled and set overridden=true so the
			// UI can show a "modified" badge and Reset button.
			merged := wireFromUser(ov)
			merged.Source = "bundled"
			merged.Overridden = true
			out = append(out, merged)
		} else {
			out = append(out, *dw)
		}
	}
	for _, u := range customs {
		out = append(out, wireFromUser(u))
	}
	writeJSON(w, map[string]interface{}{"detectors": out})
}

// handleGetDetector: GET /api/discovery/detectors/{id}
func (r *Router) handleGetDetector(w http.ResponseWriter, _ *http.Request, id string) {
	if strings.HasPrefix(id, "user/") {
		u, err := r.discoveryStore.GetDetector(id)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeJSONError(w, "Detector not found", http.StatusNotFound)
				return
			}
			slog.Error("discovery: failed to get user detector",
				"component", "discovery", "id", id, "error", err)
			writeJSONError(w, "Failed to load detector", http.StatusInternalServerError)
			return
		}
		writeJSON(w, wireFromUser(u))
		return
	}
	// Bundled lookup.
	for _, d := range r.discoveryOrch.Registry().BundledSpecific() {
		if d.ID() == id {
			if dw := wireFromBundled(d); dw != nil {
				writeJSON(w, *dw)
				return
			}
		}
	}
	writeJSONError(w, "Detector not found", http.StatusNotFound)
}

// handleCreateDetector: POST /api/discovery/detectors
// Body is a detectorWire-like payload; server generates ID from name.
func (r *Router) handleCreateDetector(w http.ResponseWriter, req *http.Request) {
	var body detectorWire
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		writeJSONError(w, "Name is required", http.StatusBadRequest)
		return
	}
	id, err := r.uniqueUserDetectorID(body.Name)
	if err != nil {
		writeJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	// Audit trail: capture creator user ID best-effort.
	createdBy := 0
	if sid := extractSessionID(req); sid != "" {
		if uid, err := r.authService.ValidateSession(sid); err == nil {
			createdBy = uid
		}
	}
	d := userDetectorFromWire(id, body)
	d.CreatedBy = createdBy
	if err := r.discoveryStore.CreateDetector(d); err != nil {
		// Validation errors get 400; storage errors get 500.
		if isValidationErr(err) {
			writeJSONError(w, err.Error(), http.StatusBadRequest)
			return
		}
		slog.Error("discovery: failed to create user detector",
			"component", "discovery", "error", err)
		writeJSONError(w, "Failed to create detector", http.StatusInternalServerError)
		return
	}
	created, err := r.discoveryStore.GetDetector(id)
	if err != nil {
		// Insert worked but read-back failed — fall back to the in-memory
		// view so the API still returns something useful.
		writeJSON(w, wireFromUser(d))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(wireFromUser(created)); err != nil {
		slog.Error("discovery: failed to encode detector response", "error", err)
	}
}

// handleUpdateDetector: PATCH /api/discovery/detectors/{id}
//
// Behaviour by ID namespace:
//   - `user/*` — edit an existing user detector. 404 if not found.
//   - `core/*` (or other bundled prefix) — UPSERT an override:
//     - If a row exists for this ID → updates it (edit existing override).
//     - If no row exists → creates a new override row (first customize).
//     The ID must match a real bundled detector; otherwise 404.
func (r *Router) handleUpdateDetector(w http.ResponseWriter, req *http.Request, id string) {
	var body detectorWire
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		writeJSONError(w, "Name is required", http.StatusBadRequest)
		return
	}

	isOverride := !strings.HasPrefix(id, "user/")
	if isOverride && !r.isBundledDetectorID(id) {
		writeJSONError(w, "Detector not found", http.StatusNotFound)
		return
	}

	// Audit trail for first-time-customize: capture creator user ID.
	createdBy := 0
	if sid := extractSessionID(req); sid != "" {
		if uid, err := r.authService.ValidateSession(sid); err == nil {
			createdBy = uid
		}
	}

	existing, err := r.discoveryStore.GetDetector(id)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		slog.Error("discovery: failed to load detector for update",
			"component", "discovery", "id", id, "error", err)
		writeJSONError(w, "Failed to load detector", http.StatusInternalServerError)
		return
	}

	d := userDetectorFromWire(id, body)
	if existing != nil {
		// Update path.
		d.CreatedAt = existing.CreatedAt
		d.CreatedBy = existing.CreatedBy
		if err := r.discoveryStore.UpdateDetector(d); err != nil {
			if isValidationErr(err) {
				writeJSONError(w, err.Error(), http.StatusBadRequest)
				return
			}
			slog.Error("discovery: failed to update detector",
				"component", "discovery", "id", id, "error", err)
			writeJSONError(w, "Failed to update detector", http.StatusInternalServerError)
			return
		}
	} else {
		// Create path — only reachable for first-time bundled override
		// (regular user/ edits 404 above because they must already exist).
		if !isOverride {
			writeJSONError(w, "Detector not found", http.StatusNotFound)
			return
		}
		d.CreatedBy = createdBy
		if err := r.discoveryStore.CreateDetector(d); err != nil {
			if isValidationErr(err) {
				writeJSONError(w, err.Error(), http.StatusBadRequest)
				return
			}
			slog.Error("discovery: failed to create override",
				"component", "discovery", "id", id, "error", err)
			writeJSONError(w, "Failed to save override", http.StatusInternalServerError)
			return
		}
	}

	updated, _ := r.discoveryStore.GetDetector(id)
	if updated != nil {
		writeJSON(w, wireFromUser(updated))
		return
	}
	writeJSON(w, wireFromUser(d))
}

// isBundledDetectorID returns true if id matches one of the
// compiled-in bundled detector IDs. Used to gate override creation —
// you can't make up arbitrary "core/" IDs.
func (r *Router) isBundledDetectorID(id string) bool {
	for _, d := range r.discoveryOrch.Registry().BundledSpecific() {
		if d.ID() == id {
			return true
		}
	}
	return false
}

// handleDeleteDetector: DELETE /api/discovery/detectors/{id}
//
// For `user/*` IDs this removes the custom detector. For bundled-prefix
// IDs it removes the override row (i.e. "reset to bundled"). In either
// case, 404 if no row exists with that ID.
func (r *Router) handleDeleteDetector(w http.ResponseWriter, _ *http.Request, id string) {
	if err := r.discoveryStore.DeleteDetector(id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSONError(w, "Detector not found", http.StatusNotFound)
			return
		}
		slog.Error("discovery: failed to delete detector",
			"component", "discovery", "id", id, "error", err)
		writeJSONError(w, "Failed to delete detector", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleResetAllOverrides: POST /api/discovery/detectors/reset-bundled
// Removes every override row; bundled detectors revert to their
// shipped definitions on the next scan. User-defined `user/*`
// detectors are untouched.
func (r *Router) handleResetAllOverrides(w http.ResponseWriter, _ *http.Request) {
	n, err := r.discoveryStore.ResetAllOverrides()
	if err != nil {
		slog.Error("discovery: failed to reset overrides",
			"component", "discovery", "error", err)
		writeJSONError(w, "Failed to reset overrides", http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{"resetCount": n})
}

// --- helpers --------------------------------------------------------------

func wireFromUser(u *discovery.UserDetector) detectorWire {
	return detectorWire{
		ID:            u.ID,
		Name:          u.Name,
		Icon:          u.Icon,
		Category:      u.Category,
		Description:   u.Description,
		Ports:         nilToEmptyInts(u.Ports),
		Paths:         nilToEmptyStrings(u.Paths),
		URLPath:       u.URLPath,
		BodyContains:  nilToEmptyStrings(u.BodyContains),
		TitleContains: nilToEmptyStrings(u.TitleContains),
		HeaderKeys:    nilToEmptyStrings(u.HeaderKeys),
		FaviconHashes: nilToEmptyInt32s(u.FaviconHashes),
		Confidence:    u.Confidence,
		Enabled:       u.Enabled,
		Source:        "user",
		CreatedAt:     u.CreatedAt,
		UpdatedAt:     u.UpdatedAt,
	}
}

// nil-safe helpers — JSON encoder turns a nil slice into `null`, which
// crashes the frontend's `.length` checks. Always send `[]` instead.
func nilToEmptyStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
func nilToEmptyInts(s []int) []int {
	if s == nil {
		return []int{}
	}
	return s
}
func nilToEmptyInt32s(s []int32) []int32 {
	if s == nil {
		return []int32{}
	}
	return s
}

// wireFromBundled introspects a bundled httpFingerprintDetector via the
// Registry's exposed accessor (BundledSpecific) and serialises the
// fields. Returns nil for detector types whose grammar doesn't fit
// the wire shape (HTTP fallback, etc.) so they don't appear in the
// list — they're not user-editable anyway.
func wireFromBundled(d discovery.Detector) *detectorWire {
	wd := discovery.DetectorWireView(d)
	if wd == nil {
		return nil
	}
	return &detectorWire{
		ID:            wd.ID,
		Name:          wd.Name,
		Icon:          wd.Icon,
		Category:      wd.Category,
		Description:   wd.Description,
		Ports:         wd.Ports,
		Paths:         wd.Paths,
		URLPath:       wd.URLPath,
		BodyContains:  wd.BodyContains,
		TitleContains: wd.TitleContains,
		HeaderKeys:    wd.HeaderKeys,
		FaviconHashes: []int32{}, // bundled detectors don't declare hashes today
		Confidence:    wd.Confidence,
		Enabled:       true, // bundled are always considered enabled
		Source:        "bundled",
	}
}

// userDetectorFromWire converts the wire payload to a UserDetector
// suitable for store CRUD. ID is supplied separately because creation
// derives it server-side from the name.
func userDetectorFromWire(id string, w detectorWire) *discovery.UserDetector {
	conf := w.Confidence
	if conf == "" {
		conf = "medium"
	}
	return &discovery.UserDetector{
		ID:            id,
		Name:          w.Name,
		Icon:          w.Icon,
		Category:      w.Category,
		Description:   w.Description,
		Ports:         w.Ports,
		Paths:         w.Paths,
		URLPath:       w.URLPath,
		BodyContains:  w.BodyContains,
		TitleContains: w.TitleContains,
		HeaderKeys:    w.HeaderKeys,
		FaviconHashes: w.FaviconHashes,
		Confidence:    conf,
		Enabled:       w.Enabled,
	}
}

// uniqueUserDetectorID slugifies the name, applies the user/ prefix,
// and appends a suffix if a detector with that ID already exists. We
// don't go higher than -99 — that's a hard error so admins can't blow
// away the system with thousands of "test"-named entries.
func (r *Router) uniqueUserDetectorID(name string) (string, error) {
	base := discovery.SlugifyDetectorName(name)
	id := "user/" + base
	if _, err := r.discoveryStore.GetDetector(id); errors.Is(err, sql.ErrNoRows) {
		return id, nil
	}
	for i := 2; i <= 99; i++ {
		candidate := fmt.Sprintf("user/%s-%d", base, i)
		if _, err := r.discoveryStore.GetDetector(candidate); errors.Is(err, sql.ErrNoRows) {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("could not generate a unique ID for name %q — pick a different name", name)
}

// isValidationErr returns true for errors that came from the store /
// validator and should be surfaced as 400 to the caller, not 500.
func isValidationErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	for _, sub := range []string{
		"invalid id", "is required", "out of range",
		"must start with", "must not contain",
		"is too short", "must be 'high'", "cap reached",
		"unknown category",
	} {
		if strings.Contains(msg, sub) {
			return true
		}
	}
	return false
}
