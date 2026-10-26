package status

import (
	"net"
	"testing"
)

// An ssh:// tile is checked with a TCP connect to host:port: a listening
// port is up, a closed one is down, and the SSRF deny-list still applies.
func newBareChecker(t *testing.T) *Checker {
	t.Helper()
	c, _, _ := newTestCheckerRaw(t, `{"version":3,"dashboards":[]}`)
	return c
}

func TestCheckEntry_SSHUpWhenPortAccepts(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			conn.Close()
		}
	}()
	c := newBareChecker(t)
	res := c.checkEntry(Entry{ID: "s", URL: "ssh://admin@" + ln.Addr().String(), TimeoutSeconds: 2})
	if res.status != "up" {
		t.Fatalf("status = %q, want up", res.status)
	}
}

func TestCheckEntry_SSHDownWhenPortClosed(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close() // nothing listens there now
	c := newBareChecker(t)
	res := c.checkEntry(Entry{ID: "s", URL: "ssh://" + addr, TimeoutSeconds: 2})
	if res.status != "down" {
		t.Fatalf("status = %q, want down", res.status)
	}
}

func TestCheckEntry_SSHBlockedAddressRefused(t *testing.T) {
	c := newBareChecker(t)
	for _, u := range []string{"ssh://169.254.169.254", "ssh://[fe80::1]:22", "ssh://0.0.0.0:22"} {
		res := c.checkEntry(Entry{ID: "s", URL: u, TimeoutSeconds: 2})
		if res.status == "up" {
			t.Fatalf("%s: status = up, want refused", u)
		}
	}
}

func TestCheckEntry_SSHMalformedIsError(t *testing.T) {
	c := newBareChecker(t)
	for _, u := range []string{"ssh://", "ssh://host:0", "ssh://host:70000", "ssh://host:abc"} {
		res := c.checkEntry(Entry{ID: "s", URL: u, TimeoutSeconds: 2})
		if res.status != "error" {
			t.Fatalf("%s: status = %q, want error", u, res.status)
		}
	}
}

func TestSSHTarget_DefaultPort22(t *testing.T) {
	addr, err := sshTarget("ssh://pi@nas.lan")
	if err != nil || addr != "nas.lan:22" {
		t.Fatalf("got %q, %v", addr, err)
	}
	addr, err = sshTarget("ssh://[::1]:2222")
	if err != nil || addr != "[::1]:2222" {
		t.Fatalf("got %q, %v", addr, err)
	}
}
