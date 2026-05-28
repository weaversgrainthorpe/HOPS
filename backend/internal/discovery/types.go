// Package discovery implements LAN network discovery for HOPS — an
// admin-initiated scan over a user-supplied CIDR that runs detectors
// against responding hosts and surfaces findings as a reviewable draft.
// The admin curates the draft and bulk-promotes selected entries to real
// dashboard tiles. Drafts persist between sessions; promotion is a one-way
// write into the existing config blob.
//
// Phase 1 ships the end-to-end loop with two hardcoded detectors
// (HTTP-200-on-80 and HTTP-200-on-443). Detectors are stateless and
// orthogonal to the scan engine; later phases add a registry, mDNS,
// YAML-defined detectors, and credentials. The Detector interface is
// designed to outlast Phase 1 unchanged.
package discovery

import "context"

// Scan states. Mirrors the SQLite enum stored in scans.state. Used in URLs
// and API responses, so the string values are part of the contract.
const (
	StatePending   = "pending"
	StateRunning   = "running"
	StateComplete  = "complete"
	StateCancelled = "cancelled"
	StateFailed    = "failed"
	StatePromoted  = "promoted"
)

// Scan intensity. Phase 1 only ever uses IntensityLight under the hood,
// but the column carries the value for forward compatibility with later
// phases that add the picker.
const (
	IntensityPassive = "passive"
	IntensityLight   = "light"
	IntensityFull    = "full"
)

// Confidence levels for a detector match. Drives default tick state in
// the curate UI (high = ticked by default, low = unticked).
const (
	ConfidenceHigh   = "high"
	ConfidenceMedium = "medium"
	ConfidenceLow    = "low"
)

// CurateState tracks per-result selection / promotion status inside a
// draft. "promoted" is terminal — once a result has been turned into a
// tile, we lock it to prevent accidental duplicates on a re-promote.
// Everything else stays editable so the admin can come back to a draft,
// promote more rows, edit names, etc.
const (
	CuratePending  = "pending"  // admin hasn't decided
	CurateSelected = "selected" // ticked for promotion
	CurateIgnored  = "ignored"  // explicitly skipped
	CuratePromoted = "promoted" // turned into a dashboard tile; locked
)

// Scan is the persisted row in the scans table — the header for one
// discovery run. Results belong to it via scan_results.scan_id.
type Scan struct {
	ID             string `json:"id"`
	CreatedAt      string `json:"createdAt"`
	CreatedBy      int    `json:"createdBy,omitempty"`
	CIDR           string `json:"cidr"`
	Intensity      string `json:"intensity"`
	State          string `json:"state"`
	ProgressTotal  int    `json:"progressTotal"`
	ProgressDone   int    `json:"progressDone"`
	StartedAt      string `json:"startedAt,omitempty"`
	FinishedAt     string `json:"finishedAt,omitempty"`
	ErrorMessage   string `json:"errorMessage,omitempty"`
	Label          string `json:"label,omitempty"`
	InternalDomain string `json:"internalDomain,omitempty"`
}

// Result is one detector match against one host:port. Multiple detectors
// can match the same host/port; each emits its own row.
type Result struct {
	ID              string                 `json:"id"`
	ScanID          string                 `json:"scanId"`
	Host            string                 `json:"host"`
	Hostname        string                 `json:"hostname,omitempty"`
	Port            int                    `json:"port"`
	DetectorID      string                 `json:"detectorId"`
	Confidence      string                 `json:"confidence"`
	Category        string                 `json:"category"` // category slug; drives auto-grouping on promote
	SuggestedName   string                 `json:"suggestedName"`
	SuggestedIcon   string                 `json:"suggestedIcon,omitempty"`
	SuggestedURL    string                 `json:"suggestedUrl"`
	SuggestedDesc   string                 `json:"suggestedDesc,omitempty"`
	RawFingerprint  map[string]interface{} `json:"rawFingerprint,omitempty"`
	CurateState     string                 `json:"curateState"`
	CurateOverrides map[string]interface{} `json:"curateOverrides,omitempty"`
	CreatedAt       string                 `json:"createdAt"`
}

// Probe is everything we already know about a host by the time detectors
// run. Phase 1 only fills in Host and the OpenPorts/HTTPResponses for the
// hardcoded TCP scan; later phases extend this with mDNS records etc.
//
// Detectors call HTTP() for any HTTP requests they need beyond the
// pre-fetched HEAD/GETs — it routes through the same SSRF-safe dialer
// and per-host timeout so detectors don't have to know about either.
type Probe struct {
	Host          string
	Hostname      string
	OpenPorts     []int
	HTTPResponses map[int]*HTTPSnapshot
	HTTP          func(ctx context.Context, port int, path string) (*HTTPSnapshot, error)
}

// HTTPSnapshot is a frozen view of an HTTP response — status code, headers
// (lowercased keys, first value only), and a length-capped body copy.
// Detectors get this instead of a live *http.Response so the body can be
// inspected multiple times and the connection is already closed.
//
// For HTTPS probes, the leaf certificate's Subject CN and SAN DNS names
// are also captured — they're often the only identifying signal when an
// app serves a generic JS shell or sits behind a reverse proxy. Empty
// strings/slices for plain HTTP or when the cert had no usable subject.
type HTTPSnapshot struct {
	Status        int
	Headers       map[string]string
	Body          []byte // truncated at httpBodyReadCap
	TLSCertCN     string
	TLSCertSANs   []string
}
