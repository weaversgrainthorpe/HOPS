package status

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
)

// §1 items 2, 4, 5: status checks (HTTP and TCP) never reach metadata or
// other refused addresses, in any spelling, directly or via a redirect.
func TestCheckEntry_RefusesMetadataInEveryForm(t *testing.T) {
	c := newBareChecker(t)
	for _, h := range []string{
		"169.254.169.254", "[::ffff:169.254.169.254]", "[fd00:ec2::254]", "0251.0376.0251.0376",
		"0xa9fea9fe", "2852039166", "[fe80::1%25eth0]", "0.0.0.0", "[::]", "255.255.255.255", "224.0.0.1",
	} {
		for _, scheme := range []string{"http", "https", "ssh"} {
			u := scheme + "://" + h + "/latest/meta-data/"
			if scheme == "ssh" {
				u = "ssh://" + h
			}
			res := c.checkEntry(Entry{ID: "m", URL: u, TimeoutSeconds: 1})
			if res.status == "up" || !strings.Contains(res.detail, "blocked") {
				t.Errorf("%s: status=%q detail=%q, want refused as blocked", u, res.status, res.detail)
			}
		}
	}
}

func TestCheckEntry_RedirectIntoRefusedRangeIsNotFollowed(t *testing.T) {
	var lookups atomic.Int32
	c := newBareChecker(t)
	c.lookup = func(_ context.Context, host string) ([]netip.Addr, error) {
		lookups.Add(1)
		return []netip.Addr{netip.MustParseAddr("169.254.169.254")}, nil
	}
	c.client = c.buildClient()
	for _, target := range []string{
		"http://169.254.169.254/latest/meta-data/",
		"http://[::ffff:a9fe:a9fe]/",
		"http://0xa9fea9fe/",
		"http://metadata.rebind.test/", // resolves to 169.254.169.254 at dial time
		"ftp://10.0.0.1/",
	} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, target, http.StatusFound)
		}))
		res := c.checkEntry(Entry{ID: "r", URL: srv.URL, TimeoutSeconds: 2})
		srv.Close()
		if res.status == "up" {
			t.Errorf("redirect to %s: status up, want refused", target)
		}
	}
	if lookups.Load() != 1 {
		t.Errorf("lookups = %d, want 1 (only the hostname hop resolves)", lookups.Load())
	}
}

func TestCheckEntry_RedirectHopsBounded(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		http.Redirect(w, r, "/again", http.StatusFound)
	}))
	defer srv.Close()
	c := newBareChecker(t)
	c.checkEntry(Entry{ID: "loop", URL: srv.URL, TimeoutSeconds: 2})
	if n := hits.Load(); n > maxRedirects+1 {
		t.Fatalf("followed %d requests, want at most %d", n, maxRedirects+1)
	}
}

// Loopback and private targets stay allowed (homelab policy).
func TestCheckEntry_LoopbackAllowed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer srv.Close()
	c := newBareChecker(t)
	if res := c.checkEntry(Entry{ID: "ok", URL: srv.URL, TimeoutSeconds: 2}); res.status != "up" {
		t.Fatalf("loopback: %q %q", res.status, res.detail)
	}
}
