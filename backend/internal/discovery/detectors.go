package discovery

import (
	"bytes"
	"context"
	"fmt"
	"strings"
)

// Detector inspects what's been probed on a host and emits zero or more
// EmittedHits when it recognises a service. Detectors are stateless and
// may be called concurrently across hosts.
//
// Two kinds:
//   - **Specific** detectors recognise a single service (Pi-hole,
//     Proxmox, …). They emit high or medium confidence on match.
//   - **Fallback** detectors emit lower-confidence catch-all results so
//     the admin still sees mystery web responders. Suppressed by the
//     orchestrator on any (host, port) tuple a specific detector claimed.
//
// IsFallback() is the discriminant. Implementations default to false via
// the baseDetector embed; the generic HTTP detector overrides to true.
type Detector interface {
	ID() string                                     // stable id, e.g. "core/proxmox"
	Name() string                                   // human-readable
	IsFallback() bool                               // true → only emit when no specific hit
	Run(ctx context.Context, p *Probe) []EmittedHit // 0+ matches
}

// EmittedHit is what a Detector produces when it matches. The orchestrator
// turns each EmittedHit into a persisted Result row.
type EmittedHit struct {
	Port           int
	Confidence     string
	Category       string // category slug (see categories.go) — drives auto-grouping at promote
	SuggestedName  string
	SuggestedIcon  string
	SuggestedURL   string
	SuggestedDesc  string
	RawFingerprint map[string]interface{}
}

// Registry holds the bundled detectors and a reference to the store so
// admin-defined user detectors can be loaded fresh on each Specific()
// call. Specific detectors run first; fallback detectors run only on
// (host, port) tuples no specific detector claimed.
type Registry struct {
	bundled  []Detector
	fallback []Detector
	store    *Store // optional; nil disables user-detector loading
}

// NewRegistry returns the registry of bundled detectors. Pass the
// Store to also load admin-defined user detectors (Phase 4); pass nil
// for pure-bundled callers (e.g. tests).
func NewRegistry(store *Store) *Registry {
	r := &Registry{
		fallback: []Detector{
			httpFallbackDetector{},
		},
		store: store,
	}
	for _, d := range coreDetectors() {
		r.bundled = append(r.bundled, d)
	}
	return r
}

// Specific returns the specific detectors — bundled merged with
// admin-defined overrides + custom user detectors. Loaded fresh on
// every call so admin changes take effect on the very next scan,
// without restart or cache invalidation.
//
// Merge rules:
//   - For each bundled detector, if a `user_detectors` row exists with
//     the SAME id (e.g. `core/sonarr`), the override replaces the
//     bundled one. The override carries the admin's edited fields;
//     the bundled definition is suppressed entirely for that scan.
//   - Custom user detectors (`user/*` IDs) are appended at the end.
//   - Disabled user_detectors rows are skipped at the SQL level by
//     LoadUserDetectorsForScan, so a disabled override falls back to
//     the bundled definition automatically.
func (r *Registry) Specific() []Detector {
	out := make([]Detector, 0, len(r.bundled)+8)
	if r.store == nil {
		out = append(out, r.bundled...)
		return out
	}
	stored := r.store.LoadUserDetectorsForScan()
	overrides := make(map[string]Detector, len(stored))
	customs := make([]Detector, 0, len(stored))
	for _, ud := range stored {
		if strings.HasPrefix(ud.ID(), "user/") {
			customs = append(customs, ud)
		} else {
			overrides[ud.ID()] = ud
		}
	}
	for _, b := range r.bundled {
		if o, ok := overrides[b.ID()]; ok {
			out = append(out, o)
		} else {
			out = append(out, b)
		}
	}
	out = append(out, customs...)
	return out
}

// Fallback returns the catch-all detectors. The orchestrator runs these
// only on (host, port) tuples no specific detector claimed.
func (r *Registry) Fallback() []Detector { return r.fallback }

// BundledSpecific returns just the compiled-in specific detectors —
// excluding user detectors and fallbacks. Used by the API to list
// bundled detectors for the admin's view.
func (r *Registry) BundledSpecific() []Detector {
	out := make([]Detector, len(r.bundled))
	copy(out, r.bundled)
	return out
}

// DetectorView is the introspectable shape of a fingerprint detector.
// Lets the API serialise both bundled httpFingerprintDetector and
// user-defined detectors through the same wire format without each
// package having to know about the others' internals.
type DetectorView struct {
	ID            string
	Name          string
	Icon          string
	Category      string
	Description   string
	Ports         []int
	Paths         []string
	URLPath       string
	BodyContains  []string
	TitleContains []string
	HeaderKeys    []string
	Confidence    string
}

// DetectorWireView extracts the introspectable fields from a Detector,
// or returns nil if the underlying type doesn't fit the standard
// fingerprint grammar (e.g. the HTTP fallback). The API uses this to
// build the JSON view sent to the frontend list page.
func DetectorWireView(d Detector) *DetectorView {
	hp, ok := d.(httpFingerprintDetector)
	if !ok {
		return nil
	}
	// Force non-nil slices so JSON serialises as `[]` rather than `null`
	// — the frontend reads `.length` on each and would crash on null.
	return &DetectorView{
		ID:            hp.id,
		Name:          hp.name,
		Icon:          hp.icon,
		Category:      hp.category,
		Description:   hp.description,
		Ports:         nonNilInts(hp.ports),
		Paths:         nonNilStrings(hp.paths),
		URLPath:       hp.urlPath,
		BodyContains:  nonNilStrings(hp.bodyContains),
		TitleContains: nonNilStrings(hp.titleContains),
		HeaderKeys:    nonNilStrings(hp.headerKeys),
		Confidence:    hp.confidence,
	}
}

func nonNilInts(s []int) []int {
	if s == nil {
		return []int{}
	}
	return append([]int(nil), s...)
}

func nonNilStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return append([]string(nil), s...)
}

// httpFingerprintDetector is a config-driven specific detector that
// matches a small grammar: try a path on one or more ports, look for any
// of a set of signatures (body substring, HTML title substring, or
// header presence), emit at the configured confidence. ~80 % of homelab
// apps fit this shape; the rest get bespoke Go detectors as they need
// them.
//
// Lookup priority within a single detector:
//  1. The pre-fetched GET / response on each candidate port.
//  2. (Optional) a list of additional paths fetched on demand via
//     Probe.HTTP — useful for apps whose root is a generic JS shell.
//
// A note on title matching: modern SPAs (the *arr suite, Portainer,
// Jellyfin, …) serve a tiny HTML shell as the root document — the body
// has nothing identifying because the real content loads via JS. But
// almost all of them still set <title>AppName</title> in the static
// shell. Title matching catches what body-string matching misses.
type httpFingerprintDetector struct {
	id            string
	name          string
	icon          string
	category      string   // category slug (see categories.go); blank → "other"
	description   string
	ports         []int    // candidate ports to inspect
	paths         []string // extra paths to GET if root doesn't match (optional)
	urlPath       string   // path appended to the suggested URL (defaults to /)
	bodyContains  []string // any of these in body → match (case-sensitive bytes)
	titleContains []string // any of these in <title> → match (case-insensitive)
	headerKeys    []string // any of these header keys present → match
	// faviconHashes are signed-int32 MurmurHash3 hashes (Shodan
	// convention) of the favicon. Not consulted in Run() — matched
	// separately by the orchestrator's favicon-hash pass after body/
	// title/header signatures have had a chance. Empty for most
	// bundled detectors; populated by user detectors that want a
	// version-stable signature.
	faviconHashes []int32
	confidence    string   // "high" | "medium" | "low"
}

func (d httpFingerprintDetector) ID() string       { return d.id }
func (d httpFingerprintDetector) Name() string     { return d.name }
func (d httpFingerprintDetector) IsFallback() bool { return false }

func (d httpFingerprintDetector) Run(ctx context.Context, p *Probe) []EmittedHit {
	for _, port := range d.ports {
		snap := p.HTTPResponses[port]
		if snap != nil && d.matches(snap) {
			return []EmittedHit{d.emit(p, port, snap)}
		}
		// Fall through to per-detector additional paths.
		for _, path := range d.paths {
			s, err := p.HTTP(ctx, port, path)
			if err != nil || s == nil {
				continue
			}
			// Reject path-based matches on 4xx (except auth-required
			// 401/403) — many web servers echo the requested URL in
			// their 404 body, which would make any verbose 404 page
			// match a detector whose path mentions the app name
			// (TP-Link Deco vs core/minio /minio/health/live, etc.).
			if s.Status >= 400 && s.Status != 401 && s.Status != 403 {
				continue
			}
			if d.matches(s) {
				return []EmittedHit{d.emit(p, port, s)}
			}
		}
	}
	return nil
}

func (d httpFingerprintDetector) matches(snap *HTTPSnapshot) bool {
	if snap == nil {
		return false
	}
	for _, needle := range d.bodyContains {
		if bytes.Contains(snap.Body, []byte(needle)) {
			return true
		}
	}
	if len(d.titleContains) > 0 {
		title := strings.ToLower(extractHTMLTitle(snap.Body))
		if title != "" {
			for _, needle := range d.titleContains {
				if strings.Contains(title, strings.ToLower(needle)) {
					return true
				}
			}
		}
	}
	for _, h := range d.headerKeys {
		if _, ok := snap.Headers[strings.ToLower(h)]; ok {
			return true
		}
	}
	return false
}

func (d httpFingerprintDetector) emit(p *Probe, port int, snap *HTTPSnapshot) EmittedHit {
	scheme := "http"
	if isTLSExpectedPort(port) {
		scheme = "https"
	}
	urlPath := d.urlPath
	if urlPath == "" {
		urlPath = "/"
	}
	url := fmt.Sprintf("%s://%s:%d%s", scheme, p.Host, port, urlPath)
	// Drop the default port from the URL for visual cleanliness.
	if (scheme == "http" && port == 80) || (scheme == "https" && port == 443) {
		url = fmt.Sprintf("%s://%s%s", scheme, p.Host, urlPath)
	}
	conf := d.confidence
	if conf == "" {
		conf = ConfidenceHigh
	}
	cat := d.category
	if cat == "" {
		cat = CategoryOther
	}
	return EmittedHit{
		Port:          port,
		Confidence:    conf,
		Category:      cat,
		SuggestedName: d.name,
		SuggestedIcon: d.icon,
		SuggestedURL:  url,
		SuggestedDesc: d.description,
		RawFingerprint: map[string]interface{}{
			"detector":   d.id,
			"httpStatus": snap.Status,
			"server":     snap.Headers["server"],
		},
	}
}

// httpFallbackDetector is the catch-all for HTTP responders no specific
// detector matched. Unlike the bundled fingerprint detectors, it isn't
// tied to a single port — Run() iterates every OpenPort with an
// HTTPResponse and emits a hit for each one (the orchestrator then
// filters out ports already claimed by a specific detector).
//
// One emission per port lets the diagnostics view surface ALL
// unidentified HTTP services, not just those on 80/443. Detector ID
// is namespaced by https-yes/no so the diagnostic UI can still group
// the two flavours of fallback.
type httpFallbackDetector struct{}

func (d httpFallbackDetector) ID() string       { return "core/http-fallback" }
func (d httpFallbackDetector) Name() string     { return "HTTP service" }
func (d httpFallbackDetector) IsFallback() bool { return true }

func (d httpFallbackDetector) Run(ctx context.Context, p *Probe) []EmittedHit {
	out := make([]EmittedHit, 0)
	for _, port := range p.OpenPorts {
		snap := p.HTTPResponses[port]
		if snap == nil {
			continue
		}

		// Many real services redirect "/" to "/dashboard" or "/login" —
		// Uptime Kuma, GitLab, etc. The bare 302 has a tiny body and
		// would be filtered as noise. If we see a same-host redirect,
		// follow it once so the noise filter and naming logic both
		// see the real content.
		if snap.Status >= 300 && snap.Status < 400 {
			if loc := snap.Headers["location"]; loc != "" {
				path := localRedirectPath(loc)
				if path != "" {
					if followed, err := p.HTTP(ctx, port, path); err == nil && followed != nil {
						snap = followed
					}
				}
			}
		}

		// Noise filter: drop default web-server "I'm alive but nothing's
		// configured here" pages and bare redirects. They're technically
		// HTTP responders but they're never useful as dashboard tiles, and
		// they hide the actual interesting results in a sea of medium-
		// confidence chaff.
		if isHTTPNoise(snap) {
			continue
		}

		tlsOn := isTLSExpectedPort(port)
		confidence := ConfidenceMedium
		if snap.Status < 200 || snap.Status >= 400 {
			confidence = ConfidenceLow
		}

		scheme := "http"
		if tlsOn {
			scheme = "https"
		}
		url := fmt.Sprintf("%s://%s", scheme, p.Host)
		if (tlsOn && port != 443) || (!tlsOn && port != 80) {
			url = fmt.Sprintf("%s://%s:%d", scheme, p.Host, port)
		}

		name := extractHTMLTitle(snap.Body)
		if name == "" {
			// Prefer the HTTPS cert subject when it looks meaningful. Skip
			// generic CAs ("kubernetes", "*"), the host's own IP, and the
			// wildcard certs reverse proxies hand out. Falls back to the
			// hostname hint, then the IP-based generic name.
			if hint := tlsCertHint(snap, p.Host); hint != "" {
				name = hint
			} else if p.Hostname != "" {
				name = p.Hostname
			} else {
				name = fmt.Sprintf("Web service on %s:%d", p.Host, port)
			}
		}

		out = append(out, EmittedHit{
			Port:          port,
			Confidence:    confidence,
			Category:      CategoryOther,
			SuggestedName: name,
			SuggestedURL:  url,
			SuggestedDesc: fmt.Sprintf("HTTP %d at %s", snap.Status, url),
			RawFingerprint: map[string]interface{}{
				"detector":   d.ID(),
				"httpStatus": snap.Status,
				"server":     snap.Headers["server"],
			},
		})
	}
	return out
}

// localRedirectPath returns the path component of a Location header
// if and only if the redirect target is same-host (relative URL or
// absolute URL pointing back at the same hostname). Returns "" for
// off-host redirects (we don't follow those) and for blank Locations.
// Used by the HTTP fallback detector to land on the real content of
// services whose root path is a redirect (Uptime Kuma → /dashboard,
// GitLab → /users/sign_in, etc.).
func localRedirectPath(loc string) string {
	loc = strings.TrimSpace(loc)
	if loc == "" {
		return ""
	}
	// Relative redirect: take as-is.
	if strings.HasPrefix(loc, "/") {
		return loc
	}
	// Absolute redirect: only follow if it's HTTP(S) and same-host
	// detection lives at the caller (we don't know the original host
	// here, so refuse anything we can't classify as definitely-local).
	// Safe approach: require a leading slash. The orchestrator's
	// dialer guard would catch off-host fetches anyway, but this
	// avoids spurious off-host requests in the first place.
	return ""
}

// tlsCertHint extracts a meaningful name from a cert subject CN / SAN
// when the HTTP body offered nothing useful. Filters out junk that
// would actively mislead — the host's own IP, "*", "kubernetes" defaults,
// wildcards. Returns "" when no SAN/CN is usable.
func tlsCertHint(snap *HTTPSnapshot, hostIP string) string {
	if snap == nil {
		return ""
	}
	candidates := make([]string, 0, 1+len(snap.TLSCertSANs))
	if snap.TLSCertCN != "" {
		candidates = append(candidates, snap.TLSCertCN)
	}
	candidates = append(candidates, snap.TLSCertSANs...)
	for _, c := range candidates {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		// Drop obvious junk subjects.
		if c == hostIP || c == "*" || c == "localhost" {
			continue
		}
		// Wildcards like *.example.com — the root cert subject of many
		// reverse proxies — give us a useful domain to surface as a hint.
		if strings.HasPrefix(c, "*.") {
			c = c[2:]
		}
		// Skip Kubernetes auto-generated defaults that pollute homelabs
		// running k3s / minikube without a custom cert.
		if strings.HasPrefix(c, "kubernetes") || strings.HasPrefix(c, "kube-apiserver") {
			continue
		}
		return c
	}
	return ""
}

// httpNoisePatterns matches default web-server placeholder pages — the
// "Welcome to nginx!" / "It works!" / Apache default / NPM Default Site
// content that responds 200 OK but isn't actually a service. Keeping
// these out of fallback results cuts the medium-confidence noise the
// admin has to scroll past on a typical homelab scan.
var httpNoisePatterns = [][]byte{
	[]byte("Welcome to nginx!"),
	[]byte("Apache2 Ubuntu Default Page"),
	[]byte("Apache2 Debian Default Page"),
	[]byte("Test Page for the Apache HTTP Server"),
	[]byte("It works!"),
	[]byte("Welcome to Nginx Proxy Manager"),
	[]byte("Congratulations! You've successfully started the Nginx Proxy Manager"),
	[]byte("If you see this page, the nginx web server is successfully installed"),
	[]byte("This is the default web page for this server"),
	[]byte("IIS Windows Server"),
}

// isHTTPNoise returns true for responses that look like a default
// placeholder page or a bare-redirect with no real content.
func isHTTPNoise(snap *HTTPSnapshot) bool {
	if snap == nil {
		return false
	}
	// Bare redirects with no body content: status 3xx + nothing useful.
	if snap.Status >= 300 && snap.Status < 400 && len(snap.Body) < 256 {
		return true
	}
	// Substring match against known default pages.
	for _, needle := range httpNoisePatterns {
		if bytes.Contains(snap.Body, needle) {
			return true
		}
	}
	// Title is just an HTTP status reason phrase or a default-site
	// placeholder name (e.g. NPM's "Default Site", OpenResty defaults).
	switch strings.TrimSpace(extractHTMLTitle(snap.Body)) {
	case "":
		// Empty title doesn't tell us much; don't filter on its own.
	case "302 Found", "301 Moved Permanently", "303 See Other",
		"307 Temporary Redirect", "308 Permanent Redirect",
		"404 Not Found", "403 Forbidden", "401 Unauthorized",
		"500 Internal Server Error", "503 Service Unavailable":
		return true
	case "Default Site", "Welcome", "Welcome to OpenResty!",
		"Index of /", "Forbidden":
		return true
	}
	return false
}

// extractHTMLTitle pulls the contents of the first <title>...</title> out
// of an HTML body. Returns "" if no title is found, the body is binary,
// or the title is empty / huge. Deliberately tiny — we're not parsing
// HTML, just finding a substring between two tags.
func extractHTMLTitle(body []byte) string {
	const maxTitleLen = 120
	if len(body) == 0 {
		return ""
	}
	lower := bytesToLowerASCII(body)
	start := indexBytes(lower, []byte("<title"))
	if start < 0 {
		return ""
	}
	gt := indexBytes(lower[start:], []byte(">"))
	if gt < 0 {
		return ""
	}
	contentStart := start + gt + 1
	end := indexBytes(lower[contentStart:], []byte("</title"))
	if end < 0 {
		return ""
	}
	title := body[contentStart : contentStart+end]
	out := make([]byte, 0, len(title))
	skipWS := true
	for _, c := range title {
		if skipWS && (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
			continue
		}
		skipWS = false
		out = append(out, c)
		if len(out) >= maxTitleLen {
			break
		}
	}
	for len(out) > 0 {
		c := out[len(out)-1]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			out = out[:len(out)-1]
			continue
		}
		break
	}
	return string(out)
}

func bytesToLowerASCII(b []byte) []byte {
	out := make([]byte, len(b))
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		out[i] = c
	}
	return out
}

func indexBytes(haystack, needle []byte) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		match := true
		for j := range needle {
			if haystack[i+j] != needle[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}
