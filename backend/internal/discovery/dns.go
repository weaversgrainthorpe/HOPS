package discovery

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

// DNS-based discovery. Three sub-sources slot into the existing passive
// prelude / runScan flow:
//
//   (a) bulk PTR sweep   — enrichment only (hostnames for in-scope IPs)
//   (b) AXFR opportunistic — enrichment only (zone-wide hostname dump)
//   (c) forward enumeration — result-producing (curated subdomains under
//                              an admin-supplied internal domain)
//
// (a) and (b) feed PassiveHints via putHostname. (c) emits standalone
// Result rows even for IPs outside the scan's allowlist — the admin
// opted into the zone by typing it.

const (
	ptrPerHostTimeout      = 500 * time.Millisecond
	ptrConcurrency         = 32
	axfrTimeout            = 2 * time.Second
	axfrPort               = "53"
	axfrMaxBytes           = 4 * 1024 * 1024
	axfrMaxRecords         = 10_000
	forwardEnumPerQueryTO  = 500 * time.Millisecond
	forwardEnumConcurrency = 16
	// forwardEnumOverallBudget caps the entire enumeration —
	// `subdomain count × per-query × redirect-follow chain` could
	// otherwise unbound the goroutine if DNS or upstream HTTP hangs.
	// 60s is comfortable for 80 subdomains × 5 redirects × ~500ms.
	forwardEnumOverallBudget = 60 * time.Second
)

// enrichDNSForHosts runs the two enrichment sources. Errors are logged
// at debug and swallowed — passive sources never fail a scan.
//
// internalDomain is the optional zone the admin typed when starting the
// scan; if non-empty it's used as the preferred AXFR target. Otherwise
// the first `search` directive in /etc/resolv.conf is tried. If neither
// is available, AXFR silently skips.
func enrichDNSForHosts(ctx context.Context, allow hostAllowlist, hints *PassiveHints, internalDomain string) {
	if hints == nil || len(allow) == 0 {
		return
	}

	// PTR sweep first — fast and reliable for any host with a reverse
	// DNS record. Runs concurrently across the host list.
	bulkReverseDNS(ctx, allowHostList(allow), hints)

	// AXFR is opportunistic. Pick a resolver IP + a candidate zone; if
	// either is unavailable, skip.
	resolverIP, err := resolverFromResolvConf()
	if err != nil {
		slog.Debug("discovery: no usable resolver for AXFR",
			"component", "discovery", "error", err)
		return
	}
	if resolverIP == "" {
		return
	}
	zone := strings.TrimSpace(internalDomain)
	if zone == "" {
		zone = axfrCandidateZone()
	}
	if zone == "" {
		return
	}
	actx, acancel := context.WithTimeout(ctx, axfrTimeout)
	defer acancel()
	if err := attemptAXFR(actx, resolverIP, zone, allow, hints); err != nil {
		slog.Debug("discovery: AXFR attempt failed",
			"component", "discovery", "resolver", resolverIP, "zone", zone,
			"error", err)
	}
}

// bulkReverseDNS resolves every IP in hosts to a hostname via the
// system resolver, capped at ptrConcurrency in-flight queries. Cheap;
// runs through the OS so /etc/resolv.conf + systemd-resolved routing
// domains "just work". Results land in hints via putHostname (which
// sanitises annotation noise like "name [mac]").
func bulkReverseDNS(ctx context.Context, hosts []string, hints *PassiveHints) {
	if len(hosts) == 0 {
		return
	}
	sem := make(chan struct{}, ptrConcurrency)
	var wg sync.WaitGroup
	for _, h := range hosts {
		if ctx.Err() != nil {
			break
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(host string) {
			defer wg.Done()
			defer func() { <-sem }()
			rctx, rcancel := context.WithTimeout(ctx, ptrPerHostTimeout)
			defer rcancel()
			names, err := (&net.Resolver{}).LookupAddr(rctx, host)
			if err != nil || len(names) == 0 {
				return
			}
			hints.putHostname(host, names[0])
		}(h)
	}
	wg.Wait()
}

// attemptAXFR opens a TCP connection to resolverIP:53 (via the SSRF-
// safe dialer), sends an AXFR query for `zone`, and parses the streamed
// answer records. Hostnames for A records whose IP is in the scan's
// allowlist get stashed in hints. Out-of-allowlist records are silently
// dropped; we never expose hostnames for IPs the scan didn't ask about.
//
// Returns nil on any "AXFR was refused" outcome (most resolvers refuse
// by policy) — the caller logs at debug. Errors only for genuine
// programming issues like dial failures from SSRF guard.
func attemptAXFR(ctx context.Context, resolverIP, zone string, allow hostAllowlist, hints *PassiveHints) error {
	d := dialer(axfrTimeout)
	conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(resolverIP, axfrPort))
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(axfrTimeout))

	// Build the AXFR query: a single QUESTION with type=AXFR (252) for
	// the zone, in a standard DNS message. TCP framing prepends a
	// 2-byte length.
	zoneName, err := dnsmessage.NewName(strings.TrimSuffix(zone, ".") + ".")
	if err != nil {
		return fmt.Errorf("zone: %w", err)
	}
	msg := dnsmessage.Message{
		Header: dnsmessage.Header{RecursionDesired: false, ID: 0},
		Questions: []dnsmessage.Question{{
			Name:  zoneName,
			Type:  dnsmessage.TypeAXFR,
			Class: dnsmessage.ClassINET,
		}},
	}
	pkt, err := msg.Pack()
	if err != nil {
		return fmt.Errorf("pack: %w", err)
	}
	frame := make([]byte, 2+len(pkt))
	frame[0] = byte(len(pkt) >> 8)
	frame[1] = byte(len(pkt))
	copy(frame[2:], pkt)
	if _, err := conn.Write(frame); err != nil {
		return fmt.Errorf("write: %w", err)
	}

	reader := io.LimitReader(conn, axfrMaxBytes)
	records := 0
	for records < axfrMaxRecords {
		// Read the 2-byte length prefix for each TCP DNS message.
		var lenBuf [2]byte
		if _, err := io.ReadFull(reader, lenBuf[:]); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				return nil // clean end of stream
			}
			return nil // treat any read error as "AXFR done / refused"
		}
		msgLen := int(lenBuf[0])<<8 | int(lenBuf[1])
		if msgLen == 0 || msgLen > axfrMaxBytes {
			return nil
		}
		buf := make([]byte, msgLen)
		if _, err := io.ReadFull(reader, buf); err != nil {
			return nil
		}
		var p dnsmessage.Parser
		if _, err := p.Start(buf); err != nil {
			return nil
		}
		_ = p.SkipAllQuestions()

		// AXFR responses stream answers. The first record is a SOA, the
		// last is another SOA — but we don't care about that structure;
		// we just consume A records.
		for records < axfrMaxRecords {
			hdr, err := p.AnswerHeader()
			if err != nil {
				break
			}
			records++
			switch hdr.Type {
			case dnsmessage.TypeA:
				r, err := p.AResource()
				if err != nil {
					_ = p.SkipAnswer()
					continue
				}
				ip := net.IP(r.A[:]).String()
				if !allow.contains(ip) {
					continue
				}
				name := strings.TrimSuffix(hdr.Name.String(), ".")
				if name == "" {
					continue
				}
				hints.putHostname(ip, name)
			default:
				_ = p.SkipAnswer()
			}
		}
	}
	return nil
}

// resolverFromResolvConf returns the first non-loopback nameserver line
// from /etc/resolv.conf. Returns "" with a nil error if none is found
// — the AXFR sub-source then silently skips. systemd-resolved's
// 127.0.0.53 is skipped because that stub doesn't forward AXFR
// upstream; the operator would have to configure HOPS with a direct
// resolver IP to make AXFR work in that environment.
func resolverFromResolvConf() (string, error) {
	f, err := os.Open("/etc/resolv.conf")
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil // non-Unix or container with no resolv.conf — silently skip
		}
		return "", err
	}
	defer f.Close()
	sc := bufio.NewScanner(io.LimitReader(f, 16*1024))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if !strings.HasPrefix(line, "nameserver ") && !strings.HasPrefix(line, "nameserver\t") {
			continue
		}
		val := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(line, "nameserver "), "\t"))
		// Strip trailing comment if any.
		if i := strings.IndexAny(val, "#;"); i >= 0 {
			val = strings.TrimSpace(val[:i])
		}
		ip := net.ParseIP(val)
		if ip == nil {
			continue
		}
		if ip.IsLoopback() {
			continue
		}
		v4 := ip.To4()
		if v4 == nil {
			continue // IPv6 resolvers not supported by the AXFR path yet
		}
		return v4.String(), nil
	}
	return "", sc.Err()
}

// axfrCandidateZone picks the most-likely-useful zone to attempt AXFR
// against. Preference: the scan's InternalDomain if set (passed in
// separately by the orchestrator — see attemptAXFR wrapper inside
// enrichDNSForHosts); otherwise the first `search` directive in
// /etc/resolv.conf. Returns "" when no candidate is available.
func axfrCandidateZone() string {
	f, err := os.Open("/etc/resolv.conf")
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(io.LimitReader(f, 16*1024))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if strings.HasPrefix(line, "search ") || strings.HasPrefix(line, "search\t") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				z := strings.TrimSuffix(fields[1], ".")
				if z != "" && z != "." {
					return z
				}
			}
		}
	}
	return ""
}

// allowHostList unwraps the hostAllowlist map into a slice for callers
// that need to iterate (PTR sweep, mainly).
func allowHostList(allow hostAllowlist) []string {
	out := make([]string, 0, len(allow))
	for h := range allow {
		out = append(out, h)
	}
	return out
}

// enumerateForwardDomain queries each curated subdomain under `domain`
// against the system resolver, probes each that resolves, and returns
// the candidate Results. **Does not persist anything** — the caller is
// expected to dedup against active-loop / mDNS results in memory and
// then bulk-insert the survivors, so the curate UI never sees a
// transient duplicate state while the scan is still running.
//
// Designed to run in its own goroutine alongside the active host-probe
// loop; the work overlaps with active probing but emission deliberately
// doesn't.
func enumerateForwardDomain(
	ctx context.Context,
	scanID, domain string,
	registry *Registry,
) (candidates []*Result, err error) {
	domain = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(domain)), ".")
	if domain == "" || registry == nil {
		return nil, nil
	}
	// Overall budget so the goroutine can't wedge if DNS or upstream
	// HTTP hangs. Per-query timeouts still apply inside this.
	ctx, cancel := context.WithTimeout(ctx, forwardEnumOverallBudget)
	defer cancel()

	subs := curatedForwardSubdomains()
	type job struct {
		sub        string
		detectorID string
	}
	jobs := make(chan job)
	var wg sync.WaitGroup

	var (
		candMu sync.Mutex
		out    []*Result
	)
	for w := 0; w < forwardEnumConcurrency; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				if ctx.Err() != nil {
					return
				}
				fqdn := j.sub + "." + domain
				lctx, lcancel := context.WithTimeout(ctx, forwardEnumPerQueryTO)
				ips, err := (&net.Resolver{}).LookupHost(lctx, fqdn)
				lcancel()
				if err != nil || len(ips) == 0 {
					continue
				}
				var resolved string
				for _, ipStr := range ips {
					ip := net.ParseIP(ipStr)
					if ip == nil {
						continue
					}
					v4 := ip.To4()
					if v4 == nil {
						continue
					}
					if isBlockedIP(v4) {
						continue
					}
					resolved = v4.String()
					break
				}
				if resolved == "" {
					continue
				}
				// Probe the resolved URL to filter wildcard-DNS / dead-
				// upstream false positives (NPM/Traefik proxy hosts
				// pointing at services that don't exist or aren't
				// running). See isForwardEnumNoise for the criteria.
				probed := probeForwardEnumURL(ctx, fqdn)
				if probed.skip {
					continue
				}
				// Run the bundled detectors against the probed response.
				// If one matches, it OVERRIDES the curated subdomain
				// hint — actual content always beats a name guess.
				// Example: books.<domain> is mapped to core/calibre-web
				// in the curated map, but if the user actually runs
				// Audiobookshelf there, the probe body matches
				// core/audiobookshelf and that wins.
				detectorID := j.detectorID
				if probed.snap != nil {
					if id := matchForwardEnumDetector(probed.snap, registry); id != "" {
						detectorID = id
					}
				}
				r := buildForwardEnumResult(scanID, j.sub, domain, detectorID, resolved, registry)
				if probed.confirmed {
					r.Confidence = ConfidenceHigh
				}
				// If the probe ended at a different URL than the bare
				// FQDN (e.g. /audiobookshelf/login after a redirect),
				// strip back to the parent directory and use THAT as
				// the tile URL. Better than landing the user on
				// /login.
				if probed.finalURL != "" {
					if better := tileURLFromFinalURL(probed.finalURL); better != "" {
						r.SuggestedURL = better
					}
				}
				candMu.Lock()
				out = append(out, r)
				candMu.Unlock()
			}
		}()
	}

	for sub, detectorID := range subs {
		if ctx.Err() != nil {
			break
		}
		jobs <- job{sub: sub, detectorID: detectorID}
	}
	close(jobs)
	wg.Wait()
	return out, nil
}

// probeForwardEnumDecision is the outcome of probing a forward-enum
// FQDN: skip says "don't emit this result", confirmed says "we got a
// real live response so promote the confidence to high", finalURL is
// the post-redirect URL (e.g. https://books.<domain>/audiobookshelf/login
// when the root 302'd to that), and snap is the response body the
// caller can run detectors against to override the subdomain-map hint.
type probeForwardEnumDecision struct {
	skip      bool
	confirmed bool
	finalURL  string
	snap      *HTTPSnapshot
}

// probeForwardEnumURL fetches `https://<fqdn>/` (and falls back to
// http:// if HTTPS errors hard) and decides whether the subdomain
// represents a real service or wildcard-DNS noise. Follows up to
// 5 redirects within the same host so a `books.<domain>/` → 302 →
// `/audiobookshelf/login` lands on the actual app body, letting the
// caller run detectors against it.
//
// The filter is stricter than the generic isHTTPNoise because of the
// reverse-proxy-fronted homelab case: NPM/Traefik with `*.domain` →
// proxy IP serves a response for EVERY subdomain, real or not. The
// proxy's "I don't have an upstream for that" responses (5xx Bad
// Gateway / 404 with a default error page / no Content-Type / etc.)
// must be rejected so the admin only sees actually-live services.
func probeForwardEnumURL(ctx context.Context, fqdn string) probeForwardEnumDecision {
	const probeTimeout = 2500 * time.Millisecond
	pctx, pcancel := context.WithTimeout(ctx, probeTimeout)
	defer pcancel()

	for _, attempt := range []struct {
		scheme string
		tls    bool
	}{{"https", true}, {"http", false}} {
		startURL := attempt.scheme + "://" + fqdn + "/"
		snap, finalURL, err := httpFollowRedirects(pctx, startURL, attempt.tls, probeTimeout, 5)
		if err != nil || snap == nil {
			continue
		}
		if isForwardEnumNoise(snap) {
			return probeForwardEnumDecision{skip: true}
		}
		return probeForwardEnumDecision{
			skip:      false,
			confirmed: true,
			finalURL:  finalURL,
			snap:      snap,
		}
	}
	return probeForwardEnumDecision{skip: false, confirmed: false}
}

// isForwardEnumNoise is the forward-enum-specific noise filter. Broader
// than isHTTPNoise because the wildcard-DNS-at-reverse-proxy case has
// to be filtered out by status code as well as by body content — NPM
// frequently serves branded error pages with custom HTML that no
// substring filter would catch.
//
// Rules:
//   - 5xx (any) → noise: the proxy is configured but the upstream is
//     dead/unreachable. Common case: admin set up a proxy host in NPM
//     for an app that doesn't exist or was removed.
//   - 404 with a small body (<2 KB) → noise: a default proxy 404 page,
//     not a real app's branded 404 (those tend to be much bigger).
//   - Anything else → defer to isHTTPNoise (catches the explicit "Welcome
//     to nginx!" / Apache default / NPM Default Site / etc.).
//   - 2xx / 3xx / 401 / 403 with substantial body → real service.
//     401 and 403 are kept because login-gated services (Sonarr, etc.)
//     return them legitimately as their root response.
func isForwardEnumNoise(snap *HTTPSnapshot) bool {
	if snap == nil {
		return false
	}
	// 5xx — proxy is alive but upstream isn't. Always noise.
	if snap.Status >= 500 {
		return true
	}
	// 404 with a tiny body — default proxy 404, not an app's branded
	// not-found. App-rendered 404 pages are typically full HTML shells
	// in the tens of KB.
	if snap.Status == 404 && len(snap.Body) < 2048 {
		return true
	}
	// Reuse the generic noise filter for explicit default-page
	// signatures (Apache, nginx, OpenResty, NPM Default Site, etc.).
	return isHTTPNoise(snap)
}

// matchForwardEnumDetector runs every bundled httpFingerprintDetector
// against the probed response and returns the first ID that matches —
// or "" if none. Used to override the curated subdomain-map hint when
// the actual content reveals what the service really is (e.g.
// books.<domain> resolving to Audiobookshelf, not Calibre).
func matchForwardEnumDetector(snap *HTTPSnapshot, registry *Registry) string {
	if snap == nil || registry == nil {
		return ""
	}
	for _, det := range registry.Specific() {
		hp, ok := det.(httpFingerprintDetector)
		if !ok {
			continue
		}
		if hp.matches(snap) {
			return hp.id
		}
	}
	return ""
}

// tileURLFromFinalURL converts a probed final URL into a tile URL.
// Strips common login/auth suffixes so a redirect to
// `/audiobookshelf/login` becomes the tile URL `/audiobookshelf/` —
// the actual landing page the admin wants to open.
func tileURLFromFinalURL(finalURL string) string {
	u, err := url.Parse(finalURL)
	if err != nil {
		return ""
	}
	path := u.Path
	// Drop trailing /login, /auth/login, /accounts/login, /signin
	// — the redirect target after a session cookie miss, not the
	// app's actual home.
	for _, suffix := range []string{"/login", "/signin", "/auth/login", "/accounts/login", "/login.html", "/login.php"} {
		if strings.HasSuffix(path, suffix) {
			path = strings.TrimSuffix(path, suffix)
			break
		}
	}
	// Ensure trailing slash so the URL feels like a directory.
	if path == "" {
		path = "/"
	} else if !strings.HasSuffix(path, "/") {
		path += "/"
	}
	u.Path = path
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}

// buildForwardEnumResult turns one resolved forward-enum hit into a
// Result. When the subdomain matches a bundled detector we reuse its
// icon + name + category for a recognisable tile; otherwise the result
// is generic.
func buildForwardEnumResult(scanID, sub, domain, detectorID, resolvedIP string, registry *Registry) *Result {
	icon := "mdi:web"
	name := titleCase(sub)
	desc := fmt.Sprintf("Resolved from %s zone", domain)
	category := CategoryOther
	urlPath := "/"

	if detectorID != "" {
		for _, det := range registry.Specific() {
			if det.ID() == detectorID {
				if hp, ok := det.(httpFingerprintDetector); ok {
					if hp.icon != "" {
						icon = hp.icon
					}
					if hp.name != "" {
						name = hp.name
					}
					if hp.category != "" {
						category = hp.category
					}
					// Inherit the detector's landing path so e.g.
					// postgres.<domain> + core/pgadmin becomes
					// https://postgres.<domain>/pgadmin4/ instead of
					// the bare host (which would land on whatever the
					// reverse proxy serves at /).
					if hp.urlPath != "" {
						urlPath = hp.urlPath
					}
				}
				break
			}
		}
	}

	url := fmt.Sprintf("https://%s.%s%s", sub, domain, urlPath)
	return &Result{
		ID:            NewID(),
		ScanID:        scanID,
		Host:          resolvedIP,
		Hostname:      sub + "." + domain,
		Port:          443,
		DetectorID:    "dns/forward",
		Confidence:    ConfidenceMedium,
		Category:      category,
		SuggestedName: name,
		SuggestedIcon: icon,
		SuggestedURL:  url,
		SuggestedDesc: desc,
		RawFingerprint: map[string]interface{}{
			"source":      "dns_forward",
			"subdomain":   sub,
			"domain":      domain,
			"resolvedIp":  resolvedIP,
			"matchedCore": detectorID,
		},
		CurateState: CuratePending,
	}
}

// titleCase capitalises the first rune and leaves the rest alone — used
// when a forward-enum subdomain has no bundled-detector match.
func titleCase(s string) string {
	if s == "" {
		return s
	}
	r := []rune(s)
	if r[0] >= 'a' && r[0] <= 'z' {
		r[0] = r[0] - 'a' + 'A'
	}
	return string(r)
}

// curatedForwardSubdomains maps subdomain → bundled-detector ID. The
// union of (every bundled detector's likely subdomain name) ∪ (common
// homelab service names that don't map to a specific detector but show
// up everywhere). Detector IDs are matched against registry.Specific()
// in buildForwardEnumResult so the resulting tile inherits the
// detector's icon, name, and category.
//
// Phase 4 (GUI-managed detectors) will let admins extend this without a
// code change. Until then this list is the authoritative set.
func curatedForwardSubdomains() map[string]string {
	return map[string]string{
		// One-to-one with bundled detectors.
		"pihole":        "core/pihole",
		"pi-hole":       "core/pihole",
		"proxmox":       "core/proxmox",
		"pve":           "core/proxmox",
		"homeassistant": "core/homeassistant",
		"ha":            "core/homeassistant",
		"hass":          "core/homeassistant",
		"plex":          "core/plex",
		"jellyfin":      "core/jellyfin",
		"sonarr":        "core/sonarr",
		"radarr":        "core/radarr",
		"prowlarr":      "core/prowlarr",
		"lidarr":        "core/lidarr",
		"bazarr":        "core/bazarr",
		"overseerr":     "core/overseerr",
		"jellyseerr":    "core/overseerr",
		"tautulli":      "core/tautulli",
		"npm":           "core/npm",
		"proxy":         "core/npm",
		"portainer":     "core/portainer",
		"cockpit":       "core/cockpit",
		"adguard":       "core/adguard",
		"grafana":       "core/grafana",
		"uptime":        "core/uptime-kuma",
		"kuma":          "core/uptime-kuma",
		"vaultwarden":   "core/vaultwarden",
		"bitwarden":     "core/vaultwarden",
		"unifi":         "core/unifi",
		"truenas":       "core/truenas",
		"dozzle":        "core/dozzle",
		"opnsense":      "core/opnsense",
		"pfsense":       "core/pfsense",
		"ntfy":          "core/ntfy",
		"reolink":       "core/reolink",
		"deco":          "core/tplink-deco",
		"synology":      "core/synology",
		"frigate":       "core/frigate",
		"immich":        "core/immich",
		"paperless":     "core/paperless-ngx",
		"nextcloud":     "core/nextcloud",
		"gitea":         "core/gitea",
		"syncthing":     "core/syncthing",
		"qbit":          "core/qbittorrent",
		"qbittorrent":   "core/qbittorrent",
		"transmission":  "core/transmission",
		"qnap":          "core/qnap",

		// Newly-bundled HTTP detectors (Phase 3.1 expansion).
		"audiobookshelf": "core/audiobookshelf",
		"abs":            "core/audiobookshelf",
		"calibre":        "core/calibre-web",
		// "books" intentionally omitted — too ambiguous (could be
		// Calibre-web, Audiobookshelf, Kavita, Komga, BookStack, …).
		// The forward-enum probe will detect the actual service via
		// the response body and pick the right detector.
		"navidrome":      "core/navidrome",
		"music":          "core/navidrome",
		"mealie":         "core/mealie",
		"recipes":        "core/mealie",
		"linkding":       "core/linkding",
		"bookmarks":      "core/linkding",
		"freshrss":       "core/freshrss",
		"rss":            "core/freshrss",
		"miniflux":       "core/miniflux",
		"feeds":          "core/miniflux",
		"mattermost":     "core/mattermost",
		"chat":           "core/mattermost",
		"rocketchat":     "core/rocketchat",
		"seafile":        "core/seafile",
		"owncloud":       "core/owncloud",
		"vikunja":        "core/vikunja",
		"tasks":          "core/vikunja",
		"wiki":           "core/wikijs",
		"wikijs":         "core/wikijs",
		"bookstack":      "core/bookstack",
		"docs":           "core/bookstack",
		"minio":          "core/minio",
		"s3":             "core/minio",
		"prometheus":     "core/prometheus",
		"prom":           "core/prometheus",
		"alertmanager":   "core/alertmanager",
		"loki":           "core/loki",
		"traefik":        "core/traefik",
		"caddy":          "core/caddy",
		"jenkins":        "core/jenkins",
		"gitlab":         "core/gitlab",
		"woodpecker":     "core/woodpecker",
		"n8n":            "core/n8n",
		"workflow":       "core/n8n",
		"guac":           "core/guacamole",
		"guacamole":      "core/guacamole",
		"filebrowser":    "core/filebrowser",
		"files":          "core/filebrowser",

		// Database web-admin subdomains. HOPS surfaces the *web admin*
		// for a database (pgAdmin / phpMyAdmin / Adminer), not the
		// raw protocol port — protocol URLs aren't browser-clickable
		// and don't belong in a dashboard.
		"postgres":   "core/pgadmin",
		"postgresql": "core/pgadmin",
		"pgadmin":    "core/pgadmin",
		"db":         "core/pgadmin",
		"database":   "core/pgadmin",
		"mysql":      "core/phpmyadmin",
		"mariadb":    "core/phpmyadmin",
		"phpmyadmin": "core/phpmyadmin",
		"adminer":    "core/adminer",

		// Generic-but-common homelab service names (no bundled detector).
		"git":       "",
		"ci":        "",
		"drone":     "",
		"swag":      "",
		"registry":  "",
		"drive":     "",
		"photos":    "",
		"vault":     "",
		"dns":       "",
		"router":    "",
		"gateway":   "",
		"nas":       "",
		"docker":    "",
		"k8s":       "",
		"rancher":   "",
		"dashy":     "",
		"homepage":  "",
		"heimdall":  "",
		"organizr":  "",
		"home":      "",
		"hub":       "",
		"dashboard": "",
		"status":    "",
	}
}
