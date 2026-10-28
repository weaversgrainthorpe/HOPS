package discovery

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func withARP(t *testing.T, supported bool, path string) {
	t.Helper()
	oldS, oldP := arpSupported, arpTablePath
	arpSupported, arpTablePath = supported, path
	t.Cleanup(func() { arpSupported, arpTablePath = oldS, oldP })
}

func hasWarning(ws []string, sub string) bool {
	for _, w := range ws {
		if strings.Contains(w, sub) {
			return true
		}
	}
	return false
}

func TestReadARP_UnsupportedPlatformSaysSo(t *testing.T) {
	withARP(t, false, "/proc/net/arp")
	if _, err := readARPTableForHosts(newHostAllowlist(nil)); !errors.Is(err, errARPUnavailable) {
		t.Fatalf("err = %v, want errARPUnavailable", err)
	}
}

func TestReadARP_MissingTableSaysSo(t *testing.T) {
	withARP(t, true, filepath.Join(t.TempDir(), "no-arp"))
	if _, err := readARPTableForHosts(newHostAllowlist(nil)); !errors.Is(err, errARPUnavailable) {
		t.Fatalf("err = %v, want errARPUnavailable", err)
	}
}

func TestReadARP_UnreadableTableIsAnError(t *testing.T) {
	withARP(t, true, t.TempDir()) // a directory: opens, then fails to read
	_, err := readARPTableForHosts(newHostAllowlist(nil))
	if err == nil || errors.Is(err, errARPUnavailable) {
		t.Fatalf("err = %v, want a read error distinct from unavailable", err)
	}
}

func TestReadARP_ParsesInScopeEntries(t *testing.T) {
	p := filepath.Join(t.TempDir(), "arp")
	body := "IP address       HW type     Flags       HW address            Mask     Device\n" +
		"10.0.0.5         0x1         0x2         aa:bb:cc:dd:ee:ff     *        eth0\n" +
		"10.0.0.6         0x1         0x0         00:00:00:00:00:00     *        eth0\n" +
		"10.0.0.9         0x1         0x2         11:22:33:44:55:66     *        eth0\n"
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	withARP(t, true, p)
	got, err := readARPTableForHosts(newHostAllowlist([]string{"10.0.0.5", "10.0.0.6"}))
	if err != nil || len(got) != 1 || got[0].IP != "10.0.0.5" {
		t.Fatalf("got %+v, %v; want just 10.0.0.5", got, err)
	}
}

func TestCollectARP_UnavailableBecomesScanNotice(t *testing.T) {
	withARP(t, false, "/proc/net/arp")
	o := NewOrchestrator(nil, nil)
	o.collectARP("s1", newHostAllowlist([]string{"10.0.0.5"}), newPassiveHints())
	if ws := o.Warnings("s1"); !hasWarning(ws, "ARP isn't available on this system") {
		t.Fatalf("warnings = %q, want the ARP-unavailable notice", ws)
	}
}

func TestCollectARP_UnreadableBecomesScanNotice(t *testing.T) {
	withARP(t, true, t.TempDir())
	o := NewOrchestrator(nil, nil)
	o.collectARP("s2", newHostAllowlist([]string{"10.0.0.5"}), newPassiveHints())
	if ws := o.Warnings("s2"); !hasWarning(ws, "ARP table couldn't be read") {
		t.Fatalf("warnings = %q, want the ARP-unreadable notice", ws)
	}
}

// mDNS / SSDP listen loops: a read deadline or a finished context ends the
// listen normally; any other socket error is a failure, not "nothing found".
func TestListenReadErr(t *testing.T) {
	timeout := &net.OpError{Op: "read", Err: os.ErrDeadlineExceeded}
	if err := listenReadErr(context.Background(), timeout); err != nil {
		t.Errorf("timeout: %v, want nil", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := listenReadErr(ctx, errors.New("closed")); err != nil {
		t.Errorf("ctx done: %v, want nil", err)
	}
	if err := listenReadErr(context.Background(), errors.New("boom")); err == nil {
		t.Error("socket error: nil, want an error")
	}
}

// Reverse DNS: "no such name" is a real answer; any other failure is counted
// and surfaced.
func TestBulkReverseDNS_ReportsFailures(t *testing.T) {
	old := lookupAddr
	t.Cleanup(func() { lookupAddr = old })
	lookupAddr = func(_ context.Context, host string) ([]string, error) {
		switch host {
		case "10.0.0.1":
			return []string{"nas.lan."}, nil
		case "10.0.0.2":
			return nil, &net.DNSError{Err: "no such host", IsNotFound: true}
		default:
			return nil, &net.DNSError{Err: "i/o timeout", IsTimeout: true}
		}
	}
	hints := newPassiveHints()
	failed, total, firstErr := bulkReverseDNS(context.Background(), []string{"10.0.0.1", "10.0.0.2", "10.0.0.3"}, hints)
	if failed != 1 || total != 3 || firstErr == nil {
		t.Fatalf("failed=%d total=%d err=%v, want 1 of 3 with an error", failed, total, firstErr)
	}
}

func TestEnrichDNS_ReverseFailuresBecomeWarning(t *testing.T) {
	oldL, oldR := lookupAddr, resolvConfPath
	t.Cleanup(func() { lookupAddr, resolvConfPath = oldL, oldR })
	lookupAddr = func(context.Context, string) ([]string, error) {
		return nil, &net.DNSError{Err: "server misbehaving"}
	}
	resolvConfPath = filepath.Join(t.TempDir(), "absent") // no AXFR attempt
	ws := enrichDNSForHosts(context.Background(), newHostAllowlist([]string{"10.0.0.7"}), newPassiveHints(), "")
	if !hasWarning(ws, "Reverse DNS failed for 1 of 1") {
		t.Fatalf("warnings = %q, want the reverse-DNS failure", ws)
	}
}

func TestEnrichDNS_UnreadableResolvConfBecomesWarning(t *testing.T) {
	oldL, oldR := lookupAddr, resolvConfPath
	t.Cleanup(func() { lookupAddr, resolvConfPath = oldL, oldR })
	lookupAddr = func(context.Context, string) ([]string, error) { return []string{"a.lan."}, nil }
	resolvConfPath = t.TempDir() // a directory: unreadable as a file
	ws := enrichDNSForHosts(context.Background(), newHostAllowlist([]string{"10.0.0.7"}), newPassiveHints(), "")
	if !hasWarning(ws, "for a DNS zone transfer") {
		t.Fatalf("warnings = %q, want the resolv.conf read failure", ws)
	}
}

// AXFR: a clean close before any answer is a refusal (most resolvers refuse
// by policy); a transfer cut off mid-message is a failure.
func TestAttemptAXFR_RefusalVsCutOff(t *testing.T) {
	old := axfrPort
	t.Cleanup(func() { axfrPort = old })
	serve := func(handle func(net.Conn)) {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { ln.Close() })
		_, axfrPort, _ = net.SplitHostPort(ln.Addr().String())
		go func() {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			handle(c)
		}()
	}
	serve(func(c net.Conn) {
		buf := make([]byte, 512)
		_, _ = c.Read(buf)
		c.Close()
	})
	if err := attemptAXFR(context.Background(), "127.0.0.1", "lan", newHostAllowlist(nil), newPassiveHints()); err != nil {
		t.Errorf("refused (clean close): %v, want nil", err)
	}
	serve(func(c net.Conn) { c.Close() }) // drops without reading: often a reset
	if err := attemptAXFR(context.Background(), "127.0.0.1", "lan", newHostAllowlist(nil), newPassiveHints()); err != nil {
		t.Errorf("refused (dropped): %v, want nil", err)
	}
	serve(func(c net.Conn) {
		buf := make([]byte, 512)
		_, _ = c.Read(buf)
		_, _ = c.Write([]byte{0x01, 0x00, 0xAB}) // claims 256 bytes, sends 1
		c.Close()
	})
	if err := attemptAXFR(context.Background(), "127.0.0.1", "lan", newHostAllowlist(nil), newPassiveHints()); err == nil {
		t.Error("cut off mid-message: nil, want an error")
	}
}

func TestAXFRWarning(t *testing.T) {
	dialErr := &axfrDialError{err: errors.New("connection refused")}
	if w := axfrWarning("lan", false, dialErr); w != "" {
		t.Errorf("auto zone, resolver refuses TCP: %q, want no warning", w)
	}
	if w := axfrWarning("home.lan", true, dialErr); !strings.Contains(w, "home.lan") {
		t.Errorf("admin-named zone, dial failure: %q, want a warning naming the zone", w)
	}
	if w := axfrWarning("lan", false, errors.New("cut off")); w == "" {
		t.Error("auto zone, transfer cut off: no warning, want one")
	}
	if w := axfrWarning("lan", true, nil); w != "" {
		t.Errorf("no error: %q, want none", w)
	}
}

// SNMP: hosts never probed (the sweep ran out of time) and local send errors
// are reported, not passed off as "no SNMP here".
func TestSNMPProbeHosts_ReportsUnprobedHosts(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := snmpProbeHosts(ctx, []string{"10.0.0.1", "10.0.0.2"})
	if err == nil || !strings.Contains(err.Error(), "2 of 2") {
		t.Fatalf("err = %v, want '2 of 2' hosts not probed", err)
	}
}

func TestSNMPProbeHosts_ReportsSendErrors(t *testing.T) {
	old := dialUDP
	t.Cleanup(func() { dialUDP = old })
	dialUDP = func(string, *net.UDPAddr, *net.UDPAddr) (*net.UDPConn, error) {
		return nil, errors.New("network is unreachable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := snmpProbeHosts(ctx, []string{"10.0.0.1"})
	if err == nil || !strings.Contains(err.Error(), "network is unreachable") {
		t.Fatalf("err = %v, want the send error", err)
	}
}

// SSDP: a device that answered but whose description couldn't be read is
// reported; readable ones are still returned.
func TestFetchSSDPDevices_ReportsUnreadable(t *testing.T) {
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<root><device><friendlyName>TV</friendlyName></device></root>`))
	}))
	defer good.Close()
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`<root><device><friendlyName>Ghost</friendlyName></device></root>`))
	}))
	defer bad.Close()
	devs, err := fetchSSDPDevices(context.Background(), map[string]pendingLocation{
		good.URL + "/desc.xml": {ip: "127.0.0.1"},
		bad.URL + "/desc.xml":  {ip: "127.0.0.1"},
	})
	if len(devs) != 1 || devs[0].FriendlyName != "TV" {
		t.Errorf("devs = %+v, want just the TV", devs)
	}
	if err == nil || !strings.Contains(err.Error(), "1 of 2") {
		t.Errorf("err = %v, want '1 of 2' unreadable", err)
	}
}
