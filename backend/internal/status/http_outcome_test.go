package status

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// Self-signed HTTPS (Proxmox, UniFi, TrueNAS, …) is reachable and answering:
// a status check reports it up rather than failing on certificate trust.
func TestCheckEntry_SelfSignedTLSIsUp(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer srv.Close()
	c := newBareChecker(t)
	if res := c.checkEntry(Entry{ID: "tls", URL: srv.URL, TimeoutSeconds: 2}); res.status != "up" {
		t.Fatalf("self-signed TLS: status=%q detail=%q, want up", res.status, res.detail)
	}
}

// A server that refuses HEAD (405 / 501) but answers GET is up via one GET retry.
func TestCheckEntry_HeadRefusedFallsBackToGet(t *testing.T) {
	for _, code := range []int{http.StatusMethodNotAllowed, http.StatusNotImplemented} {
		var heads, gets atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodHead {
				heads.Add(1)
				w.WriteHeader(code)
				return
			}
			gets.Add(1)
			_, _ = w.Write([]byte("hello"))
		}))
		c := newBareChecker(t)
		res := c.checkEntry(Entry{ID: "h", URL: srv.URL, TimeoutSeconds: 2})
		srv.Close()
		if res.status != "up" {
			t.Errorf("HEAD %d then GET 200: status=%q detail=%q, want up", code, res.status, res.detail)
		}
		if heads.Load() != 1 || gets.Load() != 1 {
			t.Errorf("HEAD %d: heads=%d gets=%d, want 1 and 1", code, heads.Load(), gets.Load())
		}
	}
}

// The GET fallback still judges the GET's answer: 405 on both is an error.
func TestCheckEntry_GetFallbackStillJudged(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusMethodNotAllowed)
	}))
	defer srv.Close()
	c := newBareChecker(t)
	res := c.checkEntry(Entry{ID: "h", URL: srv.URL, TimeoutSeconds: 2})
	if res.status != "error" || res.detail != "HTTP 405" {
		t.Fatalf("405 on HEAD and GET: status=%q detail=%q, want error / HTTP 405", res.status, res.detail)
	}
}

func TestCheckEntry_StatusCodeOutcomes(t *testing.T) {
	for _, tc := range []struct {
		code       int
		wantStatus string
		wantDetail string
	}{
		{200, "up", ""},
		{401, "up", "HTTP 401 (asks for login)"},
		{403, "up", "HTTP 403 (asks for login)"},
		{404, "error", "HTTP 404"},
		{500, "down", "HTTP 500"},
		{503, "down", "HTTP 503"},
	} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(tc.code)
		}))
		c := newBareChecker(t)
		res := c.checkEntry(Entry{ID: "s", URL: srv.URL, TimeoutSeconds: 2})
		srv.Close()
		if res.status != tc.wantStatus || res.detail != tc.wantDetail {
			t.Errorf("HTTP %d: status=%q detail=%q, want %q / %q", tc.code, res.status, res.detail, tc.wantStatus, tc.wantDetail)
		}
	}
}

// Accepting self-signed certs and the GET fallback don't loosen the SSRF
// guard: a redirect into a refused range from either path is still refused.
func TestCheckEntry_TLSAndGetFallbackKeepGuard(t *testing.T) {
	const target = "http://169.254.169.254/latest/meta-data/"
	tlsSrv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target, http.StatusFound)
	}))
	defer tlsSrv.Close()
	getSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		http.Redirect(w, r, target, http.StatusFound)
	}))
	defer getSrv.Close()
	c := newBareChecker(t)
	for _, u := range []string{tlsSrv.URL, getSrv.URL} {
		res := c.checkEntry(Entry{ID: "g", URL: u, TimeoutSeconds: 2})
		if res.status == "up" || !strings.Contains(res.detail, "blocked") {
			t.Errorf("%s: status=%q detail=%q, want refused as blocked", u, res.status, res.detail)
		}
	}
}
