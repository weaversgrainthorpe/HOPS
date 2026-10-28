package discovery

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// Real-app fingerprint fixtures. Unlike fingerprintFixtures (hand-written
// responses), every fixture under testdata/real/<app>/ was captured from
// the app's official container image running on loopback, by the same
// HTTP probe a scan uses (capture_real_test.go, build tag realcapture).
// The bytes are what the app sent, trimmed only by the probe's own 64 KB
// body cap, with secrets redacted (cookie values, API keys, CSRF tokens,
// container IPs) — never paraphrased.
//
// Each capture runs EVERY bundled detector against the app on its default
// port and asserts the exact set that fires, like fingerprintFixtures.
// A detector asking for a path that wasn't captured fails the test: the
// capture records every path any detector on that port requests, so a
// missing one means a detector changed and the capture needs a refresh.

const realFixtureDir = "testdata/real"

type realResponse struct {
	Status  int               `json:"status,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
	Body    string            `json:"body,omitempty"`  // file under bodies/, "" for an empty body
	Error   string            `json:"error,omitempty"` // the fetch failed (no HTTP response)
	TLSCN   string            `json:"tlsCertCN,omitempty"`
	TLSSANs []string          `json:"tlsCertSANs,omitempty"`
}

type realCapture struct {
	App      string `json:"app"`
	Image    string `json:"image"`
	Version  string `json:"version,omitempty"`
	Captured string `json:"captured"`
	Port     int    `json:"port"`
	Want     string `json:"want"`
	Notes    string `json:"notes,omitempty"`
	Favicon  *int32 `json:"faviconMmh3,omitempty"`
	// PlainHTTP: a TLS-expected port that only answered plain HTTP, so the
	// capture (like the scan's root-fetch fallback) used http://.
	PlainHTTP bool                    `json:"plainHTTP,omitempty"`
	Paths     map[string]realResponse `json:"responses"`
}

func loadRealCaptures(t *testing.T) []realCapture {
	t.Helper()
	dirs, err := os.ReadDir(realFixtureDir)
	if err != nil {
		t.Fatalf("read %s: %v", realFixtureDir, err)
	}
	var out []realCapture
	for _, d := range dirs {
		if !d.IsDir() {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(realFixtureDir, d.Name(), "capture.json"))
		if err != nil {
			t.Fatalf("%s: %v", d.Name(), err)
		}
		var c realCapture
		if err := json.Unmarshal(raw, &c); err != nil {
			t.Fatalf("%s/capture.json: %v", d.Name(), err)
		}
		if c.App != d.Name() {
			t.Fatalf("%s/capture.json names app %q", d.Name(), c.App)
		}
		out = append(out, c)
	}
	if len(out) == 0 {
		t.Fatalf("no real captures under %s", realFixtureDir)
	}
	return out
}

func (c realCapture) snap(t *testing.T, path string) (*HTTPSnapshot, error) {
	r, ok := c.Paths[path]
	if !ok {
		t.Errorf("%s: a detector requested %s on port %d but it wasn't captured — re-run the capture", c.App, path, c.Port)
		return nil, fmt.Errorf("not captured: %s", path)
	}
	if r.Error != "" {
		return nil, fmt.Errorf("%s", r.Error)
	}
	s := &HTTPSnapshot{Status: r.Status, Headers: map[string]string{}, TLSCertCN: r.TLSCN, TLSCertSANs: r.TLSSANs}
	for k, v := range r.Headers {
		s.Headers[strings.ToLower(k)] = v
	}
	if r.Body != "" {
		b, err := os.ReadFile(filepath.Join(realFixtureDir, c.App, "bodies", r.Body))
		if err != nil {
			t.Fatalf("%s: %v", c.App, err)
		}
		s.Body = b
	}
	return s, nil
}

func (c realCapture) probe(t *testing.T) *Probe {
	p := &Probe{Host: fxHost, OpenPorts: []int{c.Port}, HTTPResponses: map[int]*HTTPSnapshot{},
		plainHTTP: map[int]bool{c.Port: c.PlainHTTP}}
	if root, err := c.snap(t, "/"); err == nil {
		p.HTTPResponses[c.Port] = root
	}
	p.HTTP = func(_ context.Context, port int, path string) (*HTTPSnapshot, error) {
		if port != c.Port {
			return nil, fmt.Errorf("port %d closed", port)
		}
		return c.snap(t, path)
	}
	return p
}

func TestRealAppCapturesIdentified(t *testing.T) {
	for _, c := range loadRealCaptures(t) {
		t.Run(c.App, func(t *testing.T) {
			p := c.probe(t)
			var ids []string
			for _, d := range coreDetectors() {
				for _, h := range d.Run(context.Background(), p) {
					ids = append(ids, d.ID())
					if h.Port != c.Port {
						t.Errorf("%s emitted port %d, want %d", d.ID(), h.Port, c.Port)
					}
					scheme := "http://"
					if p.tlsFor(c.Port) {
						scheme = "https://"
					}
					if !strings.HasPrefix(h.SuggestedURL, scheme) {
						t.Errorf("%s suggested %s, want a %s address", d.ID(), h.SuggestedURL, scheme)
					}
				}
			}
			sort.Strings(ids)
			want := []string{}
			if c.Want != "" {
				want = []string{c.Want}
			}
			if strings.Join(ids, ",") != strings.Join(want, ",") {
				t.Errorf("%s (%s) on port %d: detectors fired %v, want %v", c.App, c.Image, c.Port, ids, want)
			}
		})
	}
}

// The recorded favicon hash is the one a scan computes from the captured
// bytes (Shodan MMH3 convention), so the favicon table can be seeded from
// these captures with confidence.
func TestRealAppCaptureFaviconHashes(t *testing.T) {
	for _, c := range loadRealCaptures(t) {
		if c.Favicon == nil {
			continue
		}
		s, err := c.snap(t, "/favicon.ico")
		if err != nil {
			t.Errorf("%s: favicon hash recorded but no favicon: %v", c.App, err)
			continue
		}
		if got := faviconHashOf(s.Body); got != *c.Favicon {
			t.Errorf("%s: favicon hash %d, capture says %d", c.App, got, *c.Favicon)
		}
	}
}

// An app answering on two of its detector's ports (Portainer on 9000 and
// 9443, captured separately from one container) is ONE result that
// claims both ports — before this, the scan listed 9443 again as an
// unidentified "HTTP service" titled Portainer.
func TestRealAppTwoPortsOneResult(t *testing.T) {
	byApp := map[string]realCapture{}
	for _, c := range loadRealCaptures(t) {
		byApp[c.App] = c
	}
	httpCap, tlsCap := byApp["portainer-http"], byApp["portainer"]
	p := &Probe{Host: fxHost, OpenPorts: []int{httpCap.Port, tlsCap.Port}, HTTPResponses: map[int]*HTTPSnapshot{}}
	for _, c := range []realCapture{httpCap, tlsCap} {
		root, err := c.snap(t, "/")
		if err != nil {
			t.Fatal(err)
		}
		p.HTTPResponses[c.Port] = root
	}
	p.HTTP = func(_ context.Context, port int, path string) (*HTTPSnapshot, error) {
		if port == tlsCap.Port {
			return tlsCap.snap(t, path)
		}
		return httpCap.snap(t, path)
	}
	var hits []EmittedHit
	for _, d := range coreDetectors() {
		if d.ID() == "core/portainer" {
			hits = d.Run(context.Background(), p)
		}
	}
	if len(hits) != 1 || hits[0].Port != 9000 || len(hits[0].AlsoPorts) != 1 || hits[0].AlsoPorts[0] != 9443 {
		t.Fatalf("hits = %+v, want one on 9000 also claiming 9443", hits)
	}
}
