package discovery

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"sort"
	"strings"
	"time"
)

// Store wraps the SQLite read/write helpers for scans and scan_results.
// Methods are kept narrowly task-specific — there's no general-purpose
// query interface here, just the operations the orchestrator and API
// actually need.
type Store struct {
	db *sql.DB
}

// NewStore constructs a Store. Caller owns the *sql.DB lifecycle.
func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// CreateScan inserts a new scan row in StatePending and returns the
// hydrated Scan. Caller supplies the ID (UUID-shaped string) so the API
// layer can return it without an extra round-trip.
func (s *Store) CreateScan(id, cidr, intensity, label, internalDomain string, createdBy int) (*Scan, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`
		INSERT INTO scans (id, created_at, created_by, cidr, intensity, state, label, internal_domain)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, id, now, nullableInt(createdBy), cidr, intensity, StatePending, label, internalDomain)
	if err != nil {
		return nil, fmt.Errorf("create scan: %w", err)
	}
	return s.GetScan(id)
}

// nullableInt returns nil if v == 0 so the created_by foreign key stores
// NULL rather than an invalid user reference.
func nullableInt(v int) interface{} {
	if v == 0 {
		return nil
	}
	return v
}

// GetScan loads a scan header by ID. Returns sql.ErrNoRows if not found.
func (s *Store) GetScan(id string) (*Scan, error) {
	var sc Scan
	var createdBy sql.NullInt64
	var startedAt, finishedAt sql.NullString
	err := s.db.QueryRow(`
		SELECT id, created_at, created_by, cidr, intensity, state,
		       progress_total, progress_done, started_at, finished_at,
		       error_message, label, internal_domain
		FROM scans WHERE id = ?
	`, id).Scan(
		&sc.ID, &sc.CreatedAt, &createdBy, &sc.CIDR, &sc.Intensity, &sc.State,
		&sc.ProgressTotal, &sc.ProgressDone, &startedAt, &finishedAt,
		&sc.ErrorMessage, &sc.Label, &sc.InternalDomain,
	)
	if err != nil {
		return nil, err
	}
	if createdBy.Valid {
		sc.CreatedBy = int(createdBy.Int64)
	}
	if startedAt.Valid {
		sc.StartedAt = startedAt.String
	}
	if finishedAt.Valid {
		sc.FinishedAt = finishedAt.String
	}
	return &sc, nil
}

// ListScans returns every scan, newest first. Phase 1 has no pagination
// — homelabs won't accumulate thousands of drafts.
func (s *Store) ListScans() ([]*Scan, error) {
	rows, err := s.db.Query(`
		SELECT id, created_at, created_by, cidr, intensity, state,
		       progress_total, progress_done, started_at, finished_at,
		       error_message, label, internal_domain
		FROM scans ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []*Scan{}
	for rows.Next() {
		var sc Scan
		var createdBy sql.NullInt64
		var startedAt, finishedAt sql.NullString
		if err := rows.Scan(
			&sc.ID, &sc.CreatedAt, &createdBy, &sc.CIDR, &sc.Intensity, &sc.State,
			&sc.ProgressTotal, &sc.ProgressDone, &startedAt, &finishedAt,
			&sc.ErrorMessage, &sc.Label, &sc.InternalDomain,
		); err != nil {
			return nil, err
		}
		if createdBy.Valid {
			sc.CreatedBy = int(createdBy.Int64)
		}
		if startedAt.Valid {
			sc.StartedAt = startedAt.String
		}
		if finishedAt.Valid {
			sc.FinishedAt = finishedAt.String
		}
		out = append(out, &sc)
	}
	return out, rows.Err()
}

// DeleteScan removes a scan and its results (FK cascade).
func (s *Store) DeleteScan(id string) error {
	_, err := s.db.Exec("DELETE FROM scans WHERE id = ?", id)
	return err
}

// SetScanState transitions a scan to a new state and stamps timestamps /
// error message as appropriate. Called from the orchestrator on
// running/complete/cancelled/failed transitions and from the API on
// cancel and promote.
func (s *Store) SetScanState(id, state, errorMessage string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	switch state {
	case StateRunning:
		_, err := s.db.Exec(
			`UPDATE scans SET state = ?, started_at = ? WHERE id = ?`,
			state, now, id,
		)
		return err
	case StateComplete, StateCancelled, StateFailed, StatePromoted:
		_, err := s.db.Exec(
			`UPDATE scans SET state = ?, finished_at = ?, error_message = ? WHERE id = ?`,
			state, now, errorMessage, id,
		)
		return err
	default:
		_, err := s.db.Exec(`UPDATE scans SET state = ? WHERE id = ?`, state, id)
		return err
	}
}

// UpdateScanProgress overwrites the progress counters. Called from the
// orchestrator after each host finishes probing.
func (s *Store) UpdateScanProgress(id string, done, total int) error {
	_, err := s.db.Exec(
		`UPDATE scans SET progress_done = ?, progress_total = ? WHERE id = ?`,
		done, total, id,
	)
	return err
}

// InsertResult writes one scan_result row. Called from the orchestrator
// for every detector emit.
func (s *Store) InsertResult(r *Result) error {
	raw := []byte("{}")
	if r.RawFingerprint != nil {
		if b, err := json.Marshal(r.RawFingerprint); err == nil {
			raw = b
		}
	}
	overrides := []byte("{}")
	if r.CurateOverrides != nil {
		if b, err := json.Marshal(r.CurateOverrides); err == nil {
			overrides = b
		}
	}
	category := r.Category
	if category == "" {
		category = CategoryOther
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`
		INSERT INTO scan_results (
			id, scan_id, host, hostname, port, detector_id, confidence, category,
			suggested_name, suggested_icon, suggested_url, suggested_desc,
			raw_fingerprint, curate_state, curate_overrides, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		r.ID, r.ScanID, r.Host, r.Hostname, r.Port, r.DetectorID, r.Confidence, category,
		r.SuggestedName, r.SuggestedIcon, r.SuggestedURL, r.SuggestedDesc,
		string(raw), r.CurateState, string(overrides), now,
	)
	return err
}

// ListResults returns every result for a scan, ordered by host then
// port. The host sort is *numeric* (10.10.0.2 before 10.10.0.100) not
// lexicographic, which SQLite would otherwise give us — IPs are
// dotted-quads, sorting by the natural integer value matches what an
// admin reading a /24 list expects to see.
func (s *Store) ListResults(scanID string) ([]*Result, error) {
	return s.ListResultsSince(scanID, "")
}

// ListResultsSince returns scan_results filtered to rows whose
// created_at is strictly greater than `since` (RFC3339). Pass an
// empty string to fetch all results (the call site that maps to
// `ListResults`).
//
// Used by the GetScan API to support cursor-based delta polling:
// the curate UI polls every 1s during a running scan, and without a
// cursor each poll re-fetches every row (including base64 favicon
// data URLs) — 100s of KB per second for big scans. With the cursor,
// each poll transfers only the new rows. Empty `since` (first call)
// still returns the full set so initial page load behaves as before.
func (s *Store) ListResultsSince(scanID, since string) ([]*Result, error) {
	var rows *sql.Rows
	var err error
	if since == "" {
		rows, err = s.db.Query(`
			SELECT id, scan_id, host, hostname, port, detector_id, confidence, category,
			       suggested_name, suggested_icon, suggested_url, suggested_desc,
			       raw_fingerprint, curate_state, curate_overrides, created_at
			FROM scan_results WHERE scan_id = ?
		`, scanID)
	} else {
		rows, err = s.db.Query(`
			SELECT id, scan_id, host, hostname, port, detector_id, confidence, category,
			       suggested_name, suggested_icon, suggested_url, suggested_desc,
			       raw_fingerprint, curate_state, curate_overrides, created_at
			FROM scan_results WHERE scan_id = ? AND created_at > ?
		`, scanID, since)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []*Result{}
	for rows.Next() {
		r := &Result{}
		var raw, overrides string
		if err := rows.Scan(
			&r.ID, &r.ScanID, &r.Host, &r.Hostname, &r.Port, &r.DetectorID, &r.Confidence, &r.Category,
			&r.SuggestedName, &r.SuggestedIcon, &r.SuggestedURL, &r.SuggestedDesc,
			&raw, &r.CurateState, &overrides, &r.CreatedAt,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(raw), &r.RawFingerprint)
		_ = json.Unmarshal([]byte(overrides), &r.CurateOverrides)
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(out, func(i, j int) bool {
		ki, kj := sortKeyForIP(out[i].Host), sortKeyForIP(out[j].Host)
		if ki != kj {
			return ki < kj
		}
		return out[i].Port < out[j].Port
	})
	return out, nil
}

// DetectionSummaryEntry is one row in the diagnostics detection summary.
type DetectionSummaryEntry struct {
	DetectorID string `json:"detectorId"`
	Count      int    `json:"count"`
	DistinctHosts int `json:"distinctHosts"`
	LastSeen   string `json:"lastSeen"`
}

// DetectionSummary aggregates how many results each detector has
// produced across all scans, plus a distinct-host count and the most
// recent observation. Surfaces in the diagnostics view so the admin
// can see at a glance which detectors are firing and which are dormant.
func (s *Store) DetectionSummary() ([]*DetectionSummaryEntry, error) {
	rows, err := s.db.Query(`
		SELECT detector_id,
		       COUNT(*) AS n,
		       COUNT(DISTINCT host) AS distinct_hosts,
		       MAX(created_at) AS last_seen
		FROM scan_results
		GROUP BY detector_id
		ORDER BY n DESC, detector_id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*DetectionSummaryEntry{}
	for rows.Next() {
		e := &DetectionSummaryEntry{}
		if err := rows.Scan(&e.DetectorID, &e.Count, &e.DistinctHosts, &e.LastSeen); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ListUnidentifiedResults returns every scan_result whose detector_id
// is the generic HTTP fallback (`core/http-80` / `core/http-443`) —
// i.e. an HTTP responder no specific detector recognized. Used by the
// diagnostics view to surface promotion candidates for new detectors.
// Deduplicated by (host, port) — keeps only the most-recent row per
// pair so the diagnostics view doesn't repeat the same service across
// every historical scan. Sorted newest-first.
func (s *Store) ListUnidentifiedResults() ([]*Result, error) {
	// Window-function approach keeps only the latest row per (host,port).
	// SQLite ≥ 3.25 supports ROW_NUMBER OVER; modernc.org/sqlite ships
	// new enough.
	rows, err := s.db.Query(`
		SELECT id, scan_id, host, hostname, port, detector_id, confidence, category,
		       suggested_name, suggested_icon, suggested_url, suggested_desc,
		       raw_fingerprint, curate_state, curate_overrides, created_at
		FROM (
			SELECT *, ROW_NUMBER() OVER (PARTITION BY host, port ORDER BY created_at DESC) AS rn
			FROM scan_results
			WHERE detector_id IN ('core/http-fallback', 'core/http-80', 'core/http-443')
		)
		WHERE rn = 1
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Result{}
	for rows.Next() {
		r := &Result{}
		var raw, overrides string
		if err := rows.Scan(
			&r.ID, &r.ScanID, &r.Host, &r.Hostname, &r.Port, &r.DetectorID, &r.Confidence, &r.Category,
			&r.SuggestedName, &r.SuggestedIcon, &r.SuggestedURL, &r.SuggestedDesc,
			&raw, &r.CurateState, &overrides, &r.CreatedAt,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(raw), &r.RawFingerprint)
		_ = json.Unmarshal([]byte(overrides), &r.CurateOverrides)
		out = append(out, r)
	}
	return out, rows.Err()
}

// sortKeyForIP turns a dotted-quad IPv4 string into the uint32 form so
// it can be compared numerically. Non-IPv4 input (shouldn't happen for
// our results, but be defensive) gets a large sentinel so it sorts to
// the end instead of crashing.
func sortKeyForIP(s string) uint32 {
	ip := net.ParseIP(s)
	if ip == nil {
		return ^uint32(0)
	}
	v4 := ip.To4()
	if v4 == nil {
		return ^uint32(0)
	}
	return uint32(v4[0])<<24 | uint32(v4[1])<<16 | uint32(v4[2])<<8 | uint32(v4[3])
}

// GetResult fetches a single result by ID, scoped to its scan to make
// the API's URL path safe (a result ID alone isn't enough).
func (s *Store) GetResult(scanID, resultID string) (*Result, error) {
	r := &Result{}
	var raw, overrides string
	err := s.db.QueryRow(`
		SELECT id, scan_id, host, hostname, port, detector_id, confidence, category,
		       suggested_name, suggested_icon, suggested_url, suggested_desc,
		       raw_fingerprint, curate_state, curate_overrides, created_at
		FROM scan_results WHERE id = ? AND scan_id = ?
	`, resultID, scanID).Scan(
		&r.ID, &r.ScanID, &r.Host, &r.Hostname, &r.Port, &r.DetectorID, &r.Confidence, &r.Category,
		&r.SuggestedName, &r.SuggestedIcon, &r.SuggestedURL, &r.SuggestedDesc,
		&raw, &r.CurateState, &overrides, &r.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(raw), &r.RawFingerprint)
	_ = json.Unmarshal([]byte(overrides), &r.CurateOverrides)
	return r, nil
}

// DeleteResult removes one result by ID, scoped to its scan. Used by
// the post-scan dedup pass that drops forward-enum duplicates when the
// same service was also detected directly.
func (s *Store) DeleteResult(scanID, resultID string) error {
	_, err := s.db.Exec(
		`DELETE FROM scan_results WHERE id = ? AND scan_id = ?`,
		resultID, scanID,
	)
	return err
}

// UpdateResultCategory changes the category slug on one result. Rejected
// on promoted rows (their tile is already on a dashboard; re-categorising
// would be misleading).
func (s *Store) UpdateResultCategory(scanID, resultID, category string) error {
	_, err := s.db.Exec(
		`UPDATE scan_results SET category = ? WHERE id = ? AND scan_id = ? AND curate_state != ?`,
		category, resultID, scanID, CuratePromoted,
	)
	return err
}

// UpdateResultCurate sets the curate state and overrides on one result.
// Called from PATCH /scans/{id}/results/{rid}. Rejects writes that would
// overwrite a promoted result — its tile is already on a dashboard and
// the curate UI shouldn't be able to retroactively change that history.
func (s *Store) UpdateResultCurate(scanID, resultID, curateState string, overrides map[string]interface{}) error {
	overridesJSON := []byte("{}")
	if overrides != nil {
		if b, err := json.Marshal(overrides); err == nil {
			overridesJSON = b
		}
	}
	_, err := s.db.Exec(
		`UPDATE scan_results
		    SET curate_state = ?, curate_overrides = ?
		  WHERE id = ? AND scan_id = ? AND curate_state != ?`,
		curateState, string(overridesJSON), resultID, scanID, CuratePromoted,
	)
	return err
}

// MarkResultsPromoted flips each given result's curate_state to
// "promoted" in a single statement inside the caller's transaction.
// Caller must validate that none of the IDs are already promoted before
// calling — this method is the side-effect, not the guard.
func (s *Store) MarkResultsPromoted(tx *sql.Tx, scanID string, resultIDs []string) error {
	if len(resultIDs) == 0 {
		return nil
	}
	placeholders := make([]string, len(resultIDs))
	args := make([]interface{}, 0, len(resultIDs)+2)
	args = append(args, CuratePromoted, scanID)
	for i, id := range resultIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}
	query := `UPDATE scan_results SET curate_state = ?
	          WHERE scan_id = ? AND id IN (` +
		strings.Join(placeholders, ",") + `)`
	_, err := tx.Exec(query, args...)
	return err
}

// MarkOrphanedRunning is called once at orchestrator startup to clean up
// scans that were StateRunning when the previous process died. They get
// transitioned to StateFailed with a clear error message so the UI shows
// something sensible instead of a forever-running spinner.
func (s *Store) MarkOrphanedRunning() error {
	_, err := s.db.Exec(
		`UPDATE scans
		   SET state = ?, finished_at = ?, error_message = ?
		 WHERE state = ?`,
		StateFailed,
		time.Now().UTC().Format(time.RFC3339),
		"scan was interrupted by a server restart",
		StateRunning,
	)
	return err
}

// MarkPendingForRequeue resets StatePending scans on startup so the
// orchestrator picks them up again (they never started). In practice
// these are rare — a scan transitions to running almost immediately
// after creation.
func (s *Store) MarkPendingForRequeue() ([]string, error) {
	rows, err := s.db.Query(`SELECT id FROM scans WHERE state = ?`, StatePending)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
