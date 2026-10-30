package netguard

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

// Every spelling of the metadata address normalises to it and is
// refused; private and loopback stay allowed.
func TestParseIPNormalisesEdgeForms(t *testing.T) {
	cases := map[string]string{
		"169.254.169.254":          "169.254.169.254",
		"::ffff:169.254.169.254":   "169.254.169.254",
		"[::ffff:a9fe:a9fe]":       "169.254.169.254",
		"64:ff9b::169.254.169.254": "169.254.169.254",
		"::169.254.169.254":        "169.254.169.254",
		"0251.0376.0251.0376":      "169.254.169.254",
		"0xa9fea9fe":               "169.254.169.254",
		"0xA9.0xFE.0xA9.0xFE":      "169.254.169.254",
		"2852039166":               "169.254.169.254",
		"169.254.43518":            "169.254.169.254",
		"fe80::1%eth0":             "fe80::1",
		"0.0.0.0":                  "0.0.0.0",
		"0":                        "0.0.0.0",
		"::":                       "::",
		"127.1":                    "127.0.0.1",
		"::1":                      "::1",
	}
	for in, want := range cases {
		got, ok := ParseIP(in)
		if !ok || got.String() != want {
			t.Errorf("ParseIP(%q) = %v,%v; want %s", in, got, ok, want)
		}
	}
	for _, host := range []string{"example.com", "nas.home.arpa", "0x", "1.2.3.4.5", "256.1.1.1", "09"} {
		if a, ok := ParseIP(host); ok {
			t.Errorf("ParseIP(%q) = %v, want not-an-IP", host, a)
		}
	}
}

func TestBlockedPolicy(t *testing.T) {
	blocked := []string{
		"169.254.169.254", "::ffff:169.254.169.254", "0251.0376.0251.0376", "0xa9fea9fe", "2852039166",
		"64:ff9b::a9fe:a9fe", "fd00:ec2::254", "100.100.100.200", "169.254.0.1", "fe80::1%eth0",
		"0.0.0.0", "::", "0.1.2.3", "224.0.0.1", "239.255.255.250", "ff02::1", "ff05::c",
		"255.255.255.255", "240.0.0.1",
	}
	for _, s := range blocked {
		a, ok := ParseIP(s)
		if !ok || !Blocked(a) {
			t.Errorf("%s: want blocked (parsed %v,%v)", s, a, ok)
		}
		if err := CheckHost(s); !errors.Is(err, ErrBlocked) {
			t.Errorf("CheckHost(%s) = %v, want ErrBlocked", s, err)
		}
	}
	allowed := []string{
		"10.0.0.1", "172.16.5.4", "192.168.1.1", "127.0.0.1", "127.1", "::1", "::ffff:192.168.1.1",
		"fd12:3456::1", "100.64.0.1", "8.8.8.8", "2001:db8::1",
	}
	for _, s := range allowed {
		a, ok := ParseIP(s)
		if !ok || Blocked(a) {
			t.Errorf("%s: want allowed (parsed %v,%v)", s, a, ok)
		}
	}
	if !Blocked(netip.Addr{}) || !BlockedIP(nil) {
		t.Error("invalid address must be blocked")
	}
	if err := Control("tcp", "[::ffff:169.254.169.254]:80", nil); !errors.Is(err, ErrBlocked) {
		t.Errorf("Control mapped metadata = %v", err)
	}
	if err := Control("tcp", "127.0.0.1:80", nil); err != nil {
		t.Errorf("Control loopback = %v", err)
	}
}

// DNS rebinding. The resolver answers "safe" first and the
// metadata address next; the second dial is refused because the address
// checked is the one dialled. A mixed answer (one safe, one blocked) is
// refused outright rather than round-robined.
func TestDialerPinsAndRefusesRebinding(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer srv.Close()
	_, port, _ := net.SplitHostPort(srv.Listener.Addr().String())

	answers := [][]netip.Addr{
		{netip.MustParseAddr("127.0.0.1")},
		{netip.MustParseAddr("169.254.169.254")},
		{netip.MustParseAddr("127.0.0.1"), netip.MustParseAddr("::ffff:169.254.169.254")},
		{netip.MustParseAddr("fd00:ec2::254")},
	}
	calls := 0
	d := &Dialer{Lookup: func(context.Context, string) ([]netip.Addr, error) {
		a := answers[calls]
		calls++
		return a, nil
	}}
	conn, err := d.DialContext(context.Background(), "tcp", net.JoinHostPort("rebind.test", port))
	if err != nil {
		t.Fatalf("first (safe) dial: %v", err)
	}
	if got := conn.RemoteAddr().(*net.TCPAddr).IP.String(); got != "127.0.0.1" {
		t.Errorf("dialled %s, want the vetted 127.0.0.1", got)
	}
	conn.Close()
	for i := 1; i < len(answers); i++ {
		if _, err := d.DialContext(context.Background(), "tcp", net.JoinHostPort("rebind.test", port)); !errors.Is(err, ErrBlocked) {
			t.Errorf("answer %d: dial err = %v, want ErrBlocked", i, err)
		}
	}
	// IP literals in any spelling are refused without a lookup.
	for _, h := range []string{"0xa9fea9fe", "2852039166", "0251.0376.0251.0376", "::ffff:169.254.169.254", "0.0.0.0", "::"} {
		if _, err := d.DialContext(context.Background(), "tcp", net.JoinHostPort(h, "80")); !errors.Is(err, ErrBlocked) {
			t.Errorf("dial %s: %v, want ErrBlocked", h, err)
		}
	}
	if calls != len(answers) {
		t.Errorf("lookup calls = %d", calls)
	}
}
