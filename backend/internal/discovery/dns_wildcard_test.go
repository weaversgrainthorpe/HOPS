package discovery

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestIsForwardEnumNoise_EmptyBody(t *testing.T) {
	cases := []struct {
		name string
		snap *HTTPSnapshot
		want bool
	}{
		{"200 empty", &HTTPSnapshot{Status: 200}, true},
		{"204 empty", &HTTPSnapshot{Status: 204}, true},
		{"200 whitespace", &HTTPSnapshot{Status: 200, Body: []byte(" \r\n\t ")}, true},
		{"200 real", &HTTPSnapshot{Status: 200, Body: []byte("<html><title>App</title></html>")}, false},
		{"401 empty", &HTTPSnapshot{Status: 401}, false},
	}
	for _, c := range cases {
		if got := isForwardEnumNoise(c.snap); got != c.want {
			t.Errorf("%s: noise = %v, want %v", c.name, got, c.want)
		}
	}
}

// stubForward points forward enumeration at a local server: every fetch is
// sent to srv with the Host header of the requested name, and DNS answers
// come from resolves.
func stubForward(t *testing.T, srv *httptest.Server, resolves func(host string) bool, fetchErr func(host string) bool) {
	t.Helper()
	oldL, oldF := forwardLookupHost, forwardEnumFetch
	t.Cleanup(func() { forwardLookupHost, forwardEnumFetch = oldL, oldF })
	forwardLookupHost = func(_ context.Context, host string) ([]string, error) {
		if resolves(host) {
			return []string{"10.9.9.9"}, nil
		}
		return nil, &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}
	}
	forwardEnumFetch = func(ctx context.Context, startURL string, _ bool, _ time.Duration, _ int) (*HTTPSnapshot, string, error) {
		u, _ := url.Parse(startURL)
		if fetchErr(u.Hostname()) {
			return nil, startURL, errors.New("timeout")
		}
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+u.Path, nil)
		req.Host = u.Hostname()
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, startURL, err
		}
		defer resp.Body.Close()
		buf := make([]byte, 64<<10)
		n, _ := resp.Body.Read(buf)
		return &HTTPSnapshot{Status: resp.StatusCode, Headers: map[string]string{}, Body: buf[:n]}, startURL, nil
	}
}

func TestEnumerateForwardDomain_WildcardCanary(t *testing.T) {
	const domain = "home.example"
	realPage := "<html><head><title>Home Assistant</title></head><body>" + strings.Repeat("x", 9000) + "</body></html>"
	otherPage := "<html><head><title>Wildcard landing</title></head><body>hello</body></html>"

	never := func(string) bool { return false }
	isCanary := func(h string) bool { return strings.HasPrefix(h, "hops-probe-") }
	curated := func(h string) bool { return h == "ha."+domain || h == "grafana."+domain }

	cases := []struct {
		name        string
		body        func(host string) string // "" means empty 200
		resolves    func(string) bool
		fetchErr    func(string) bool
		wantNames   []string
		wantConf    string
		wantWarning string // substring, "" means no warning
	}{
		{
			name:        "wildcard and empty 200 for everything",
			body:        func(string) string { return "" },
			resolves:    func(string) bool { return true },
			fetchErr:    never,
			wantNames:   nil,
			wantWarning: "answers every name (wildcard DNS), so HOPS only kept names whose page differs",
		},
		{
			name: "wildcard, one real page differs",
			body: func(h string) string {
				if h == "ha."+domain {
					return realPage
				}
				return ""
			},
			resolves:    func(string) bool { return true },
			fetchErr:    never,
			wantNames:   []string{"ha.home.example"},
			wantConf:    ConfidenceHigh,
			wantWarning: "so HOPS only kept names whose page differs",
		},
		{
			name: "wildcard serving a non-empty identical page drops those names",
			body: func(h string) string {
				if h == "ha."+domain {
					return realPage
				}
				return otherPage
			},
			resolves:    func(string) bool { return true },
			fetchErr:    never,
			wantNames:   []string{"ha.home.example"},
			wantConf:    ConfidenceHigh,
			wantWarning: "wildcard DNS",
		},
		{
			name:      "no wildcard: unchanged",
			body:      func(string) string { return realPage },
			resolves:  curated,
			fetchErr:  never,
			wantNames: []string{"ha.home.example", "grafana.home.example"},
			wantConf:  ConfidenceHigh,
		},
		{
			name:        "canary probe fails: kept at lower confidence",
			body:        func(string) string { return realPage },
			resolves:    func(h string) bool { return isCanary(h) || curated(h) },
			fetchErr:    isCanary,
			wantNames:   []string{"ha.home.example", "grafana.home.example"},
			wantConf:    ConfidenceMedium,
			wantWarning: "couldn't load a made-up name's page to compare",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(200)
				_, _ = w.Write([]byte(c.body(r.Host)))
			}))
			defer srv.Close()
			stubForward(t, srv, c.resolves, c.fetchErr)

			res, warns, err := enumerateForwardDomain(context.Background(), "scan1", domain, NewRegistry(nil))
			if err != nil {
				t.Fatal(err)
			}
			got := map[string]*Result{}
			for _, r := range res {
				got[r.Hostname] = r
			}
			if len(got) != len(c.wantNames) {
				t.Fatalf("got %d results %v, want %v", len(got), keysOf(got), c.wantNames)
			}
			for _, n := range c.wantNames {
				r, ok := got[n]
				if !ok {
					t.Fatalf("missing %s in %v", n, keysOf(got))
				}
				if r.Confidence != c.wantConf {
					t.Errorf("%s confidence = %s, want %s", n, r.Confidence, c.wantConf)
				}
			}
			joined := strings.Join(warns, "\n")
			if c.wantWarning == "" && len(warns) != 0 {
				t.Errorf("unexpected warnings: %v", warns)
			}
			if c.wantWarning != "" && !strings.Contains(joined, c.wantWarning) {
				t.Errorf("warnings %q missing %q", joined, c.wantWarning)
			}
			if c.wantWarning != "" && !strings.Contains(joined, domain+" answers every name") {
				t.Errorf("warning should name the domain: %q", joined)
			}
		})
	}
}

func keysOf(m map[string]*Result) []string {
	var k []string
	for n := range m {
		k = append(k, n)
	}
	return k
}
