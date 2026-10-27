package discovery

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/netguard"
)

// §1 item 1: oversized, whole-internet, reserved, multicast, broadcast and
// link-local targets are refused server-side.
func TestExpandTargets_RefusesOversizedAndForbiddenRanges(t *testing.T) {
	bad := []string{
		"0.0.0.0/0", "1.0.0.0/8", "10.0.0.0/15", "192.168.0.0/1", "10.0.0.0/12",
		"1.0.0.0-255.255.255.255", "10.0.0.0-10.2.0.0",
		"169.254.0.0/16", "169.254.169.0/24", "169.254.169.254", "169.253.255.250-169.254.0.5",
		"224.0.0.0/24", "239.255.255.250", "240.0.0.0/24", "255.255.255.255", "255.255.255.0/24",
		"0.0.0.0", "0.0.0.0/24", "0.1.2.0/24", "100.100.100.0/24",
		"::ffff:169.254.169.254", "0xa9fea9fe", "2852039166", "0251.0376.0251.0376", "fe80::1%eth0", "::",
		"!10.0.0.1",
	}
	for _, in := range bad {
		if hosts, err := expandTargets(in); err == nil {
			t.Errorf("expandTargets(%q) = %d hosts, want refused", in, len(hosts))
		}
		if err := ValidateTargets(in); err == nil {
			t.Errorf("ValidateTargets(%q) accepted", in)
		}
	}
	// A blocked address can be carved out of an allowed range by exclusion.
	hosts, err := expandTargets("100.100.100.0/24, !100.100.100.200")
	if err != nil || len(hosts) != 253 {
		t.Fatalf("carve-out: %d hosts, %v", len(hosts), err)
	}
	for _, ok := range []string{"192.168.1.0/24", "172.16.0.0/16", "127.0.0.1", "10.0.0.1-50", "100.64.0.0/24"} {
		if _, err := expandTargets(ok); err != nil {
			t.Errorf("expandTargets(%q): %v", ok, err)
		}
	}
	hosts, _ = expandTargets("172.16.0.0/16")
	if len(hosts) > maxScanHosts {
		t.Errorf("/16 expands to %d > cap", len(hosts))
	}
}

// §1 items 2 and 5: no discovery fetch path (probe GET, detector redirect
// follow, favicon, TCP connect, SSDP description, SNMP) reaches metadata.
func TestDiscoveryFetchesNeverReachMetadata(t *testing.T) {
	ctx := context.Background()
	for _, h := range []string{"169.254.169.254", "::ffff:169.254.169.254", "fd00:ec2::254", "0xa9fea9fe", "2852039166", "0251.0376.0251.0376", "0.0.0.0", "::", "224.0.0.1"} {
		if _, err := httpGetProbe(ctx, h, 80, "/latest/meta-data/", false, time.Second); !errors.Is(err, netguard.ErrBlocked) {
			t.Errorf("httpGetProbe %s: %v, want ErrBlocked", h, err)
		}
		if _, _, ok := faviconFetch(ctx, h, 80, false, time.Second); ok {
			t.Errorf("faviconFetch %s succeeded", h)
		}
		if tcpConnectProbe(ctx, h, 80, time.Second) {
			t.Errorf("tcpConnectProbe %s connected", h)
		}
		if _, ok := snmpGetSysInfo(ctx, h); ok {
			t.Errorf("snmp %s answered", h)
		}
		u := "http://" + net.JoinHostPort(h, "80") + "/"
		if _, _, err := httpFollowRedirects(ctx, u, false, time.Second, 5); !errors.Is(err, netguard.ErrBlocked) {
			t.Errorf("httpFollowRedirects %s: %v, want ErrBlocked", u, err)
		}
	}
}

// §1 item 4: detector redirect-following stays on the same host, is bounded,
// and a redirect to metadata is never fetched.
func TestHTTPFollowRedirects_BoundedAndSameHost(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.URL.Path == "/meta" {
			http.Redirect(w, r, "http://169.254.169.254/latest/meta-data/", http.StatusFound)
			return
		}
		http.Redirect(w, r, "/loop"+strconv.Itoa(int(hits.Load())), http.StatusFound)
	}))
	defer srv.Close()
	if _, _, err := httpFollowRedirects(context.Background(), srv.URL+"/", false, 2*time.Second, 5); err == nil {
		t.Error("endless redirect: want error")
	}
	if n := hits.Load(); n > 6 {
		t.Errorf("made %d requests, want <= 6", n)
	}
	snap, final, err := httpFollowRedirects(context.Background(), srv.URL+"/meta", false, 2*time.Second, 5)
	if err != nil || snap == nil || snap.Status != http.StatusFound || !strings.HasSuffix(final, "/meta") {
		t.Errorf("cross-host redirect: got %v %q %v; want the redirect itself, not followed", snap, final, err)
	}
	// The plain probe client never follows redirects at all.
	snap, err = httpGetProbe(context.Background(), "127.0.0.1", srv.Listener.Addr().(*net.TCPAddr).Port, "/meta", false, 2*time.Second)
	if err != nil || snap.Status != http.StatusFound {
		t.Errorf("probe GET followed a redirect: %v %v", snap, err)
	}
}

// SSDP: a LOCATION pointing anywhere but the responder is refused BEFORE
// any request is made.
func TestSSDPLocationOffResponderNotFetched(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { hits.Add(1) }))
	defer srv.Close()
	port := strconv.Itoa(srv.Listener.Addr().(*net.TCPAddr).Port)
	for _, loc := range []string{
		"http://127.0.0.1:" + port + "/desc.xml", // responder claims to be 10.0.0.9
		"http://localhost:" + port + "/desc.xml",
		"http://169.254.169.254/latest/meta-data/",
	} {
		if _, ok := fetchSSDPDeviceDescription(context.Background(), loc, "10.0.0.9", ""); ok {
			t.Errorf("%s: fetched", loc)
		}
	}
	if hits.Load() != 0 {
		t.Errorf("off-responder LOCATION was requested %d times", hits.Load())
	}
}
