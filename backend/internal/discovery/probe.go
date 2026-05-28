package discovery

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"
)

// httpBodyReadCap is the maximum body bytes captured for fingerprinting.
// Detectors that need to match strings should fit within this window;
// anything longer is silently truncated.
const httpBodyReadCap = 64 * 1024

// portsForIntensity returns the TCP allowlist to probe at the given
// intensity. Passive doesn't probe TCP at all (the orchestrator skips
// the active loop for it); light is the curated detector-port list;
// full extends light with a wider set of well-known web/admin ports
// that no bundled detector matches but where a generic HTTP fingerprint
// might still find something useful.
func portsForIntensity(intensity string) []int {
	switch intensity {
	case IntensityFull:
		return fullActivePorts
	case IntensityPassive:
		return nil
	default:
		return lightActivePorts
	}
}

// lightActivePorts is the TCP allowlist for the "light active" scan
// intensity. Every port here is the default for at least one common
// homelab service the bundled detectors recognise. Probing more ports
// finds more services but inflates worst-case scan time linearly — keep
// the list tight and only add ports that a bundled detector actually
// consumes.
var lightActivePorts = []int{
	80,    // generic HTTP — Pi-hole, NPM (admin alt), Vaultwarden, TrueNAS, …
	81,    // Nginx Proxy Manager admin
	443,   // generic HTTPS
	2283,  // Immich
	3000,  // Grafana, Uptime Kuma, AdGuard Home (and many others — body match disambiguates)
	3001,  // Uptime Kuma (alt)
	3100,  // Loki / Grafana Loki
	5000,  // Synology DSM / Frigate
	5001,  // Synology DSM (HTTPS)
	5050,  // pgAdmin default
	5055,  // Overseerr / Jellyseerr
	5800,  // Tdarr / FileRun alt
	6767,  // Bazarr
	7575,  // homepage / homarr
	7878,  // Radarr
	8000,  // Paperless-ngx (also generic)
	8006,  // Proxmox VE
	8080,  // Dozzle, MinIO console alt, qBittorrent — many web UIs
	8083,  // Calibre-web default
	8090,  // qBittorrent alt
	8096,  // Jellyfin
	8123,  // Home Assistant
	8181,  // Tautulli
	8384,  // Syncthing
	8443,  // generic HTTPS alt (UniFi Controller, Portainer HTTPS, …)
	8686,  // Lidarr
	8765,  // Audiobookshelf alt
	8971,  // Frigate (https alt)
	8989,  // Sonarr
	9000,  // Portainer, MinIO (console moves to 9001 in recent builds)
	9001,  // MinIO console
	9090,  // Cockpit, Prometheus
	9091,  // Transmission
	9093,  // Alertmanager (default)
	9100,  // node_exporter (Prometheus — fingerprint via body)
	9696,  // Prowlarr
	13378, // Audiobookshelf default
	15178, // ViewPower (UPS monitoring)
	19999, // Netdata
	32400, // Plex
}

// tlsExpectedPorts is the set of ports that speak HTTPS by default
// (not just self-signed: services that flat-out refuse plain HTTP on
// this port — Proxmox 8006 returns 301, Plex 32400 errors, …).
// Adding a port here makes the active probe, favicon fetch, and
// detector URL emission all use https:// uniformly. Don't add a port
// where plain HTTP also works — the probe would lose the option to
// fall back.
var tlsExpectedPorts = map[int]bool{
	443:   true,
	8006:  true, // Proxmox VE
	8443:  true, // generic HTTPS alt (UniFi, Portainer HTTPS, …)
	8971:  true, // Frigate HTTPS
	9443:  true, // Portainer
	32400: true, // Plex
}

func isTLSExpectedPort(p int) bool { return tlsExpectedPorts[p] }

// fullActivePorts widens the sweep to catch services that no bundled
// detector covers but where the generic HTTP fallback might still
// produce a useful "Web service on X" entry. Order doesn't matter; the
// per-host probe loop runs them in parallel.
var fullActivePorts = []int{
	22,    // SSH banner (admin-curated note tile)
	53,    // DNS — TCP probe just confirms presence
	80, 81, 88, 110, 111, 139, 143, 389, 443, 445, 465, 514, 515, 587, 631,
	993, 995, 1080, 1194, 1433, 1521, 1880, // node-RED
	2049, 2375, 2376, 2812, // monit
	3000, 3001, 3306, 3478, 3479, // turn
	5000, 5001, 5055, 5432, 5800, 5900, 5984, // CouchDB
	6379, 6443, // Kubernetes API
	6767, 7000, 7878, 7575, // homepage
	8000, 8006, 8008, 8009, 8010, 8043, 8080, 8086, 8088, 8096, 8123, 8181,
	8200, 8443, 8500, 8686, 8765, 8800, 8888, 8989,
	9000, 9090, 9091, 9100, 9117, 9200, 9443, 9696, 9981,
	10000, 11434, // ollama
	19999, 25565, // minecraft
	27017, // mongo
	32400, 32469,
	51820, // wireguard (probably won't answer TCP but doesn't hurt)
}

// isBlockedIP mirrors the policy in internal/status/checker.go: block
// link-local (cloud metadata, IPv6 fe80::/10), multicast, and the
// unspecified address; permit RFC1918 private ranges and loopback because
// homelab dashboards legitimately point at them.
func isBlockedIP(ip net.IP) bool {
	return ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() ||
		ip.IsUnspecified() ||
		ip.IsMulticast()
}

// ssrfSafeDialControl is a net.Dialer Control hook that rejects dials to
// link-local / multicast / unspecified addresses after DNS resolution.
// Reused for every outbound connection the discovery scanner makes so the
// SSRF guard is impossible to forget on a new code path.
func ssrfSafeDialControl(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("discovery: invalid dial address %q", address)
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return fmt.Errorf("discovery: unresolved dial host %q", host)
	}
	if isBlockedIP(ip) {
		return fmt.Errorf("discovery: blocked target %s", ip)
	}
	return nil
}

// dialer returns a per-host net.Dialer with the SSRF guard and the
// configured timeout. Built per-probe so timeout settings can change live.
func dialer(timeout time.Duration) *net.Dialer {
	return &net.Dialer{
		Timeout: timeout,
		Control: ssrfSafeDialControl,
	}
}

// httpClient returns an HTTP client for probes. TLS verification is
// disabled because homelab services overwhelmingly use self-signed certs;
// the alternative would silently miss every HTTPS-on-private-IP service.
// Redirects are NOT followed — we want to see the first response, not
// chase a login page. Reuses the dialer so SSRF guard applies.
func httpClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Transport: &http.Transport{
			DialContext: dialer(timeout).DialContext,
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true, //nolint:gosec // homelab self-signed certs are the norm
			},
			ResponseHeaderTimeout: timeout,
		},
	}
}

// tcpConnectProbe attempts a single TCP connection to host:port within
// the configured timeout. Returns true if the dial completed without
// error. Used as the "is anything listening here?" check that replaces a
// dedicated ICMP ping (see plan §10 for rationale).
func tcpConnectProbe(ctx context.Context, host string, port int, timeout time.Duration) bool {
	d := dialer(timeout)
	conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(host, fmt.Sprintf("%d", port)))
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// httpFollowRedirects fetches a URL and follows up to `maxRedirects`
// 3xx redirects, but ONLY to URLs whose host matches the original
// host (i.e. internal redirects within the same FQDN). Used by the
// forward-enum probe so a host that 302s `/` → `/app/login` is
// fingerprinted on the actual app body, not on the empty redirect
// stub. Same SSRF-safe dialer as httpGetProbe; TLS verification off
// because reverse-proxied homelab services overwhelmingly use
// self-signed or LE-on-private-IP certs.
//
// Returns the HTTPSnapshot of the final response plus its full URL
// string. A redirect to a different host stops the follow chain and
// returns the redirect response itself (with empty body and the
// Location intact in headers) so the caller can still inspect it.
func httpFollowRedirects(ctx context.Context, startURL string, _ bool, timeout time.Duration, maxRedirects int) (*HTTPSnapshot, string, error) {
	u, err := url.Parse(startURL)
	if err != nil {
		return nil, "", err
	}
	origHost := u.Hostname()
	currentURL := startURL
	visited := make(map[string]bool)

	transport := &http.Transport{
		DialContext: dialer(timeout).DialContext,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true, //nolint:gosec
		},
		ResponseHeaderTimeout: timeout,
	}
	client := &http.Client{
		Timeout: timeout,
		// Don't auto-follow — we want to inspect each hop manually so
		// we can refuse cross-host redirects.
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Transport: transport,
	}

	for hops := 0; hops <= maxRedirects; hops++ {
		if visited[currentURL] {
			break
		}
		visited[currentURL] = true

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, currentURL, nil)
		if err != nil {
			return nil, currentURL, err
		}
		req.Header.Set("User-Agent", "HOPS-Discovery/1.0")
		resp, err := client.Do(req)
		if err != nil {
			return nil, currentURL, err
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, httpBodyReadCap))
		resp.Body.Close()

		snap := &HTTPSnapshot{
			Status:  resp.StatusCode,
			Headers: make(map[string]string, len(resp.Header)),
			Body:    body,
		}
		for k, v := range resp.Header {
			if len(v) > 0 {
				snap.Headers[strings.ToLower(k)] = v[0]
			}
		}
		if resp.TLS != nil && len(resp.TLS.PeerCertificates) > 0 {
			leaf := resp.TLS.PeerCertificates[0]
			snap.TLSCertCN = leaf.Subject.CommonName
			if len(leaf.DNSNames) > 0 {
				snap.TLSCertSANs = append([]string(nil), leaf.DNSNames...)
			}
		}

		// Not a redirect — final response.
		if resp.StatusCode < 300 || resp.StatusCode >= 400 {
			return snap, currentURL, nil
		}
		loc := resp.Header.Get("Location")
		if loc == "" {
			return snap, currentURL, nil
		}
		next, err := url.Parse(loc)
		if err != nil {
			return snap, currentURL, nil
		}
		// Resolve relative redirects against the current URL.
		cur, _ := url.Parse(currentURL)
		next = cur.ResolveReference(next)
		// Refuse cross-host redirects — return the redirect response
		// so the caller still has something to inspect.
		if next.Hostname() != origHost {
			return snap, currentURL, nil
		}
		// SSRF guard via dialer applies to the next request too.
		currentURL = next.String()
	}
	return nil, currentURL, fmt.Errorf("redirect loop exceeded %d hops", maxRedirects)
}

// httpGetProbe issues a single HTTP GET against host:port/path and
// returns a frozen HTTPSnapshot. tls=true selects https://. Returns nil
// if the request fails for any reason (closed connection, timeout,
// non-HTTP responder, etc.) — callers treat that as "not HTTP".
func httpGetProbe(ctx context.Context, host string, port int, path string, tlsOn bool, timeout time.Duration) (*HTTPSnapshot, error) {
	scheme := "http"
	if tlsOn {
		scheme = "https"
	}
	url := fmt.Sprintf("%s://%s:%d%s", scheme, host, port, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "HOPS-Discovery/1.0")
	resp, err := httpClient(timeout).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, httpBodyReadCap))
	if err != nil {
		// Body read may fail partway through; the headers and status we
		// already have are still useful to detectors.
		body = nil
	}
	snap := &HTTPSnapshot{
		Status:  resp.StatusCode,
		Headers: make(map[string]string, len(resp.Header)),
		Body:    body,
	}
	for k, v := range resp.Header {
		if len(v) > 0 {
			snap.Headers[strings.ToLower(k)] = v[0]
		}
	}
	// Capture the leaf-cert Subject CN + SAN DNS names on HTTPS probes.
	// Many self-hosted apps put their hostname in the cert subject; for
	// apps that serve a generic JS shell, the cert is the most reliable
	// identifying signal we have. Self-signed certs land here too — that's
	// fine, we're not validating, just reading the subject text.
	if resp.TLS != nil && len(resp.TLS.PeerCertificates) > 0 {
		leaf := resp.TLS.PeerCertificates[0]
		snap.TLSCertCN = leaf.Subject.CommonName
		if len(leaf.DNSNames) > 0 {
			snap.TLSCertSANs = append([]string(nil), leaf.DNSNames...)
		}
	}
	return snap, nil
}
