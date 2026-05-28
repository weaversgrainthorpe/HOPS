package discovery

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// UserDetector is an admin-defined fingerprint detector stored in
// SQLite. It implements the same Detector interface as the bundled
// httpFingerprintDetector and uses the identical matching grammar; the
// only difference is where the definition lives. Loaded fresh from the
// store on each Registry.Specific() call so admin changes take effect
// on the next scan without a restart.
//
// User detector IDs always carry the `user/` prefix to never collide
// with bundled `core/` IDs. The slug is derived from the name at
// create time and is immutable thereafter (changing it would break
// existing scan results that reference the detector ID).
type UserDetector struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Icon           string  `json:"icon"`
	Category       string  `json:"category"`
	Description    string  `json:"description"`
	Ports          []int   `json:"ports"`
	Paths          []string `json:"paths"`
	URLPath        string  `json:"urlPath"`
	BodyContains   []string `json:"bodyContains"`
	TitleContains  []string `json:"titleContains"`
	HeaderKeys     []string `json:"headerKeys"`
	// FaviconHashes are signed-int32 MurmurHash3 hashes (Shodan
	// convention) of the service's favicon. The most stable signature
	// type — favicons rarely change across versions — and matched at
	// the favicon-pass stage, AFTER body/title/header detection
	// rounds. A non-empty list satisfies the "at least one signature"
	// validation requirement on its own.
	FaviconHashes []int32 `json:"faviconHashes"`
	Confidence    string  `json:"confidence"`
	Enabled       bool    `json:"enabled"`
	CreatedAt     string  `json:"createdAt"`
	UpdatedAt     string  `json:"updatedAt"`
	CreatedBy     int     `json:"createdBy,omitempty"`
}

// ToDetector turns a stored UserDetector into a Detector usable by the
// orchestrator's probe pipeline. The conversion reuses the matching
// internals of httpFingerprintDetector by wrapping one with the same
// fields — so any future improvements to the bundled matcher (regex,
// case-insensitive body, etc.) automatically benefit user detectors.
func (u *UserDetector) ToDetector() Detector {
	return httpFingerprintDetector{
		id:            u.ID,
		name:          u.Name,
		icon:          u.Icon,
		category:      u.Category,
		description:   u.Description,
		ports:         append([]int(nil), u.Ports...),
		paths:         append([]string(nil), u.Paths...),
		urlPath:       u.URLPath,
		bodyContains:  append([]string(nil), u.BodyContains...),
		titleContains: append([]string(nil), u.TitleContains...),
		headerKeys:    append([]string(nil), u.HeaderKeys...),
		faviconHashes: append([]int32(nil), u.FaviconHashes...),
		confidence:    u.Confidence,
	}
}

// detectorIDPattern matches valid detector IDs. Always
// `<namespace>/<slug>`. Namespace is one of: user (admin-created),
// core (bundled override), dns (forward-enum override). Slug is
// kebab-case 1-64 chars starting with alphanumeric.
var detectorIDPattern = regexp.MustCompile(`^(user|core|dns)/[a-z0-9][a-z0-9-]{0,63}$`)

// isOverrideID returns true if id is a bundled namespace (anything not
// starting with "user/"). Used to distinguish "edit my custom detector"
// from "customize a bundled detector" — overrides don't count toward
// the user-detector cap and the API treats their lifecycle differently.
func isOverrideID(id string) bool {
	return id != "" && !strings.HasPrefix(id, "user/")
}

// maxUserDetectors is the cap on how many user-defined detectors an
// install can hold. Only counts `user/*` detectors — overrides of
// bundled detectors are bounded by the bundled count and shouldn't
// crowd out the admin's quota for custom detectors.
const maxUserDetectors = 200

// minSignatureLen is the minimum length of a body / title / header
// signature substring. Anything shorter is so generic it'll match
// nearly every web responder ("API", "Login") and ruin scan results.
const minSignatureLen = 4

// ValidateUserDetector returns an error if the detector wouldn't be
// safe / useful to persist. Run before CreateDetector / UpdateDetector.
// The same rules apply server-side (here) and client-side (the form
// validates before submitting) — keep them in sync.
func ValidateUserDetector(d *UserDetector) error {
	if d == nil {
		return errors.New("nil detector")
	}
	if !detectorIDPattern.MatchString(d.ID) {
		return fmt.Errorf("invalid id %q: must match <namespace>/<slug>", d.ID)
	}
	if strings.TrimSpace(d.Name) == "" {
		return errors.New("name is required")
	}
	if len(d.Name) > 200 {
		return errors.New("name too long (max 200)")
	}
	if d.Category != "" && !IsValidCategory(d.Category) {
		return fmt.Errorf("unknown category %q", d.Category)
	}
	if len(d.Ports) == 0 {
		return errors.New("at least one port is required")
	}
	for _, p := range d.Ports {
		if p < 1 || p > 65535 {
			return fmt.Errorf("port %d out of range (1-65535)", p)
		}
	}
	for _, path := range d.Paths {
		if !strings.HasPrefix(path, "/") {
			return fmt.Errorf("path %q must start with /", path)
		}
		if strings.Contains(path, "..") {
			return fmt.Errorf("path %q must not contain '..'", path)
		}
	}
	if d.URLPath != "" && !strings.HasPrefix(d.URLPath, "/") {
		return fmt.Errorf("urlPath %q must start with /", d.URLPath)
	}
	// At least one signature category must be set. Titles can be
	// slightly shorter because they're matched case-insensitively
	// against the <title> element rather than the whole body.
	totalSigs := 0
	for _, s := range d.BodyContains {
		if len(s) < minSignatureLen {
			return fmt.Errorf("body signature %q is too short (min %d chars)", s, minSignatureLen)
		}
		totalSigs++
	}
	for _, s := range d.TitleContains {
		if len(s) < 3 {
			return fmt.Errorf("title signature %q is too short (min 3 chars)", s)
		}
		totalSigs++
	}
	for _, k := range d.HeaderKeys {
		if k == "" {
			return errors.New("header key cannot be empty")
		}
		totalSigs++
	}
	totalSigs += len(d.FaviconHashes)
	if len(d.FaviconHashes) > 100 {
		return fmt.Errorf("too many favicon hashes (max 100, got %d)", len(d.FaviconHashes))
	}
	if totalSigs == 0 {
		return errors.New("at least one body / title / header / favicon-hash signature is required")
	}
	switch d.Confidence {
	case "", "high", "medium":
		// ok; "" defaults to medium downstream
	default:
		return fmt.Errorf("confidence must be 'high' or 'medium', got %q", d.Confidence)
	}
	return nil
}

// SlugifyDetectorName turns a display name into a kebab-case slug
// suitable for the user/<slug> ID. Removes characters outside
// [a-z0-9-], collapses runs of dashes, trims leading/trailing dashes,
// and ensures non-empty output (falls back to a timestamp suffix).
func SlugifyDetectorName(name string) string {
	var b strings.Builder
	b.Grow(len(name))
	lastDash := true
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		case r == '-' || r == ' ' || r == '_' || r == '.':
			if !lastDash {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	s := strings.Trim(b.String(), "-")
	if s == "" {
		s = fmt.Sprintf("detector-%d", time.Now().Unix())
	}
	if len(s) > 64 {
		s = s[:64]
		s = strings.Trim(s, "-")
	}
	return s
}

// --- Store methods --------------------------------------------------------

// CreateDetector persists a new user detector. Caller is expected to
// have already populated d.ID, d.CreatedAt, d.UpdatedAt — typically by
// generating the ID from the name and stamping timestamps in the
// handler. Validates before INSERT.
func (s *Store) CreateDetector(d *UserDetector) error {
	if err := ValidateUserDetector(d); err != nil {
		return err
	}
	// Cap protection: refuse to create if we're already at the limit.
	// Only counts `user/*` rows — overrides of bundled detectors don't
	// crowd out the admin's quota.
	if !isOverrideID(d.ID) {
		var count int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM user_detectors WHERE id LIKE 'user/%'`).Scan(&count); err != nil {
			return fmt.Errorf("count user_detectors: %w", err)
		}
		if count >= maxUserDetectors {
			return fmt.Errorf("user detector cap reached (%d) — delete an existing one before adding more", maxUserDetectors)
		}
	}
	now := d.CreatedAt
	if now == "" {
		now = time.Now().UTC().Format(time.RFC3339)
	}
	d.UpdatedAt = now
	ports, _ := json.Marshal(d.Ports)
	paths, _ := json.Marshal(d.Paths)
	body, _ := json.Marshal(d.BodyContains)
	title, _ := json.Marshal(d.TitleContains)
	headers, _ := json.Marshal(d.HeaderKeys)
	favicons, _ := json.Marshal(d.FaviconHashes)
	_, err := s.db.Exec(`
		INSERT INTO user_detectors
		(id, name, icon, category, description, ports, paths, url_path,
		 body_contains, title_contains, header_keys, favicon_hashes,
		 confidence, enabled, created_at, updated_at, created_by)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		d.ID, d.Name, d.Icon, d.Category, d.Description,
		string(ports), string(paths), d.URLPath,
		string(body), string(title), string(headers), string(favicons),
		d.Confidence, boolToInt(d.Enabled),
		now, now, nullableInt(d.CreatedBy))
	if err != nil {
		return fmt.Errorf("insert user_detector: %w", err)
	}
	return nil
}

// GetDetector loads a single user detector by ID. Returns
// sql.ErrNoRows if not found.
func (s *Store) GetDetector(id string) (*UserDetector, error) {
	row := s.db.QueryRow(`
		SELECT id, name, icon, category, description, ports, paths, url_path,
		       body_contains, title_contains, header_keys, favicon_hashes,
		       confidence, enabled, created_at, updated_at, COALESCE(created_by, 0)
		FROM user_detectors WHERE id = ?
	`, id)
	return scanUserDetector(row.Scan)
}

// ListDetectors returns every user detector, ordered by name. Use
// LoadUserDetectorsForScan when you want them as ready-to-run Detectors
// (which filters out disabled ones).
func (s *Store) ListDetectors() ([]*UserDetector, error) {
	rows, err := s.db.Query(`
		SELECT id, name, icon, category, description, ports, paths, url_path,
		       body_contains, title_contains, header_keys, favicon_hashes,
		       confidence, enabled, created_at, updated_at, COALESCE(created_by, 0)
		FROM user_detectors ORDER BY name COLLATE NOCASE
	`)
	if err != nil {
		return nil, fmt.Errorf("list user_detectors: %w", err)
	}
	defer rows.Close()
	var out []*UserDetector
	for rows.Next() {
		d, err := scanUserDetector(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// UpdateDetector overwrites the editable fields of an existing user
// detector. ID, created_at, and created_by are immutable. Validates
// before UPDATE. Returns sql.ErrNoRows if the ID doesn't exist.
func (s *Store) UpdateDetector(d *UserDetector) error {
	if err := ValidateUserDetector(d); err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	ports, _ := json.Marshal(d.Ports)
	paths, _ := json.Marshal(d.Paths)
	body, _ := json.Marshal(d.BodyContains)
	title, _ := json.Marshal(d.TitleContains)
	headers, _ := json.Marshal(d.HeaderKeys)
	favicons, _ := json.Marshal(d.FaviconHashes)
	res, err := s.db.Exec(`
		UPDATE user_detectors SET
		  name = ?, icon = ?, category = ?, description = ?,
		  ports = ?, paths = ?, url_path = ?,
		  body_contains = ?, title_contains = ?, header_keys = ?,
		  favicon_hashes = ?, confidence = ?, enabled = ?, updated_at = ?
		WHERE id = ?
	`,
		d.Name, d.Icon, d.Category, d.Description,
		string(ports), string(paths), d.URLPath,
		string(body), string(title), string(headers), string(favicons),
		d.Confidence, boolToInt(d.Enabled), now,
		d.ID)
	if err != nil {
		return fmt.Errorf("update user_detector: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	d.UpdatedAt = now
	return nil
}

// DeleteDetector removes a user detector. Existing scan results that
// reference its ID are left intact — they still display correctly,
// they just can't be re-matched if you re-scan.
func (s *Store) DeleteDetector(id string) error {
	res, err := s.db.Exec(`DELETE FROM user_detectors WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete user_detector: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ToggleDetector flips the enabled flag. Shortcut for the list-page
// toggle that doesn't need to round-trip the whole detector body.
func (s *Store) ToggleDetector(id string, enabled bool) error {
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := s.db.Exec(`
		UPDATE user_detectors SET enabled = ?, updated_at = ? WHERE id = ?
	`, boolToInt(enabled), now, id)
	if err != nil {
		return fmt.Errorf("toggle user_detector: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ListOverrideIDs returns the set of bundled detector IDs that have
// an override row in user_detectors (regardless of enabled state).
// Used by the API list endpoint to flag bundled rows as "modified".
func (s *Store) ListOverrideIDs() (map[string]bool, error) {
	out := map[string]bool{}
	rows, err := s.db.Query(`SELECT id FROM user_detectors WHERE id NOT LIKE 'user/%'`)
	if err != nil {
		return nil, fmt.Errorf("list override IDs: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			out[id] = true
		}
	}
	return out, rows.Err()
}

// ResetAllOverrides deletes every override row (i.e. every row whose
// ID doesn't start with `user/`). Returns the number of rows removed.
// User-defined detectors are left untouched.
func (s *Store) ResetAllOverrides() (int, error) {
	res, err := s.db.Exec(`DELETE FROM user_detectors WHERE id NOT LIKE 'user/%'`)
	if err != nil {
		return 0, fmt.Errorf("reset overrides: %w", err)
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

// LoadUserDetectorsForScan returns the enabled user detectors converted
// to Detectors ready for the probe pipeline. Disabled detectors are
// skipped at the SQL level so a scan never wastes work matching them.
// Errors return an empty slice — a corrupt row or a transient DB error
// should not kill the scan.
func (s *Store) LoadUserDetectorsForScan() []Detector {
	if s == nil || s.db == nil {
		return nil
	}
	rows, err := s.db.Query(`
		SELECT id, name, icon, category, description, ports, paths, url_path,
		       body_contains, title_contains, header_keys, favicon_hashes,
		       confidence, enabled, created_at, updated_at, COALESCE(created_by, 0)
		FROM user_detectors WHERE enabled = 1
	`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []Detector
	for rows.Next() {
		d, err := scanUserDetector(rows.Scan)
		if err != nil {
			continue
		}
		out = append(out, d.ToDetector())
	}
	return out
}

// scanUserDetector decodes one row into a UserDetector. Takes the row's
// Scan method as a callback so it can be used for both QueryRow and
// rows.Next() loops.
func scanUserDetector(scan func(dest ...any) error) (*UserDetector, error) {
	var (
		d                                                                  UserDetector
		portsRaw, pathsRaw, bodyRaw, titleRaw, headersRaw, faviconHashesRaw string
		enabled                                                            int
	)
	if err := scan(
		&d.ID, &d.Name, &d.Icon, &d.Category, &d.Description,
		&portsRaw, &pathsRaw, &d.URLPath,
		&bodyRaw, &titleRaw, &headersRaw, &faviconHashesRaw,
		&d.Confidence, &enabled,
		&d.CreatedAt, &d.UpdatedAt, &d.CreatedBy,
	); err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(portsRaw), &d.Ports)
	_ = json.Unmarshal([]byte(pathsRaw), &d.Paths)
	_ = json.Unmarshal([]byte(bodyRaw), &d.BodyContains)
	_ = json.Unmarshal([]byte(titleRaw), &d.TitleContains)
	_ = json.Unmarshal([]byte(headersRaw), &d.HeaderKeys)
	_ = json.Unmarshal([]byte(faviconHashesRaw), &d.FaviconHashes)
	d.Enabled = enabled != 0
	return &d, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
