// Package netguard is HOPS's single SSRF policy for outbound connections
// to user-supplied or network-supplied targets: tile status checks (HTTP and
// TCP), discovery probes, detector fetches, favicon fetches, SSDP
// description fetches, AXFR and SNMP.
//
// Policy. HOPS is a homelab dashboard: tiles legitimately point at LAN
// services on private (RFC 1918, ULA, CGNAT/Tailscale) addresses and at the
// HOPS host itself (loopback), so those are ALLOWED. What is refused:
//
//   - link-local unicast (169.254.0.0/16, fe80::/10) — where cloud-metadata
//     endpoints such as 169.254.169.254 live;
//   - known cloud-metadata addresses outside link-local (fd00:ec2::254 on
//     AWS IPv6, 100.100.100.200 on Alibaba);
//   - multicast (all scopes), the unspecified address (0.0.0.0, ::), the
//     "this network" block 0.0.0.0/8, and the reserved 240.0.0.0/4 block
//     (which includes the limited broadcast 255.255.255.255).
//
// Every rule is applied after normalisation: IPv4-mapped IPv6
// (::ffff:a.b.c.d), NAT64 (64:ff9b::/96) and IPv4-compatible (::a.b.c.d)
// forms are judged by their embedded IPv4 address, zone ids are dropped, and
// the legacy inet_aton spellings a system resolver accepts (octal 0251.0376…,
// hex 0xa9fea9fe, a bare 32-bit integer 2852039166, short forms like 10.1)
// are parsed to the address they really mean.
//
// DNS rebinding. Dialer resolves the host itself, refuses the connection if
// ANY resolved address is blocked, and dials the vetted IP literal — so the
// address that is checked is the address that is connected to (the Control
// hook re-checks the literal at socket level as a second line). There is no
// separate "validate the URL, then let the client resolve it again" step to
// race. Each redirect hop dials anew through the same Dialer.
package netguard

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// ErrBlocked is wrapped by every refusal so callers can tell "refused by
// policy" from "could not connect".
var ErrBlocked = errors.New("blocked address (link-local, cloud metadata, multicast, unspecified or reserved)")

var (
	blockedPrefixes = []netip.Prefix{
		netip.MustParsePrefix("0.0.0.0/8"),      // "this network"; 0.0.0.0 dials the local host on Linux
		netip.MustParsePrefix("169.254.0.0/16"), // IPv4 link-local, cloud metadata
		netip.MustParsePrefix("224.0.0.0/4"),    // IPv4 multicast
		netip.MustParsePrefix("240.0.0.0/4"),    // reserved, incl. 255.255.255.255 broadcast
		netip.MustParsePrefix("fe80::/10"),      // IPv6 link-local
		netip.MustParsePrefix("ff00::/8"),       // IPv6 multicast
	}
	metadataAddrs = map[netip.Addr]bool{
		netip.MustParseAddr("fd00:ec2::254"):   true, // AWS IMDS over IPv6
		netip.MustParseAddr("100.100.100.200"): true, // Alibaba Cloud metadata
	}
	nat64Prefix = netip.MustParsePrefix("64:ff9b::/96")
	v4compat    = netip.MustParsePrefix("::/96")
)

// Normalize drops any zone and unwraps IPv4-in-IPv6 forms (mapped, NAT64,
// IPv4-compatible) to the IPv4 address they carry.
func Normalize(a netip.Addr) netip.Addr {
	a = a.WithZone("").Unmap()
	if a.Is6() && (nat64Prefix.Contains(a) || (v4compat.Contains(a) && a != netip.IPv6Loopback() && a != netip.IPv6Unspecified())) {
		b := a.As16()
		return netip.AddrFrom4([4]byte{b[12], b[13], b[14], b[15]})
	}
	return a
}

// Blocked reports whether a must never be connected to.
func Blocked(a netip.Addr) bool {
	if !a.IsValid() {
		return true
	}
	a = Normalize(a)
	if a.IsUnspecified() || a.IsLinkLocalUnicast() || a.IsLinkLocalMulticast() ||
		a.IsInterfaceLocalMulticast() || a.IsMulticast() || metadataAddrs[a] {
		return true
	}
	for _, p := range blockedPrefixes {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// BlockedIP is Blocked for a net.IP (nil or malformed is blocked).
func BlockedIP(ip net.IP) bool {
	a, ok := netip.AddrFromSlice(ip)
	if !ok {
		return true
	}
	return Blocked(a)
}

// ParseIP parses an IP literal the way a permissive system resolver would:
// standard IPv4/IPv6 (with optional zone and surrounding brackets) plus the
// legacy inet_aton IPv4 spellings. ok is false for anything that is not an
// IP literal (i.e. a hostname). The result is normalised.
func ParseIP(s string) (netip.Addr, bool) {
	s = strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(s), "["), "]")
	if s == "" {
		return netip.Addr{}, false
	}
	if a, err := netip.ParseAddr(s); err == nil {
		return Normalize(a), true
	}
	if a, ok := parseLegacyIPv4(s); ok {
		return a, true
	}
	return netip.Addr{}, false
}

// parseLegacyIPv4 implements inet_aton: 1–4 dot-separated parts, each
// decimal, octal (leading 0) or hex (0x); the last part fills the remaining
// bytes.
func parseLegacyIPv4(s string) (netip.Addr, bool) {
	parts := strings.Split(strings.TrimSuffix(s, "."), ".")
	if len(parts) == 0 || len(parts) > 4 {
		return netip.Addr{}, false
	}
	vals := make([]uint64, len(parts))
	for i, p := range parts {
		if p == "" {
			return netip.Addr{}, false
		}
		base := 10
		digits := p
		switch {
		case len(p) > 2 && (p[:2] == "0x" || p[:2] == "0X"):
			base, digits = 16, p[2:]
		case len(p) > 1 && p[0] == '0':
			base, digits = 8, p[1:]
		}
		v, err := strconv.ParseUint(digits, base, 32)
		if err != nil {
			return netip.Addr{}, false
		}
		vals[i] = v
	}
	var n uint64
	last := len(vals) - 1
	for i := 0; i < last; i++ {
		if vals[i] > 0xff {
			return netip.Addr{}, false
		}
		n |= vals[i] << (24 - 8*uint(i))
	}
	if vals[last] >= 1<<(8*uint(4-last)) {
		return netip.Addr{}, false
	}
	n |= vals[last]
	return netip.AddrFrom4([4]byte{byte(n >> 24), byte(n >> 16), byte(n >> 8), byte(n)}), true
}

// CheckHost refuses a host (URL hostname or dial host) that is an IP
// literal in a blocked range, in any spelling. Hostnames pass here; they are
// judged on their resolved addresses at dial time.
func CheckHost(host string) error {
	if a, ok := ParseIP(host); ok && Blocked(a) {
		return fmt.Errorf("%w: %s", ErrBlocked, a)
	}
	return nil
}

// Control is a net.Dialer Control hook: it refuses the socket if the
// concrete address about to be connected is blocked.
func Control(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("%w: invalid dial address %q", ErrBlocked, address)
	}
	a, err := netip.ParseAddr(host)
	if err != nil {
		return fmt.Errorf("%w: unresolved dial host %q", ErrBlocked, host)
	}
	if Blocked(a) {
		return fmt.Errorf("%w: %s", ErrBlocked, Normalize(a))
	}
	return nil
}

// LookupFunc resolves a hostname to its addresses.
type LookupFunc func(ctx context.Context, host string) ([]netip.Addr, error)

// Dialer dials with the SSRF policy and per-request IP pinning.
type Dialer struct {
	Timeout time.Duration
	// Lookup resolves hostnames; nil uses net.DefaultResolver. Tests
	// inject one to simulate DNS rebinding.
	Lookup LookupFunc
}

// DialContext resolves address's host once, refuses it if any resolved
// address is blocked, and connects to a vetted IP literal.
func (d *Dialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	var addrs []netip.Addr
	if a, ok := ParseIP(host); ok {
		addrs = []netip.Addr{a}
	} else {
		lookup := d.Lookup
		if lookup == nil {
			lookup = func(ctx context.Context, h string) ([]netip.Addr, error) {
				return net.DefaultResolver.LookupNetIP(ctx, "ip", h)
			}
		}
		addrs, err = lookup(ctx, host)
		if err != nil {
			return nil, err
		}
		if len(addrs) == 0 {
			return nil, fmt.Errorf("no addresses for %s", host)
		}
	}
	for _, a := range addrs {
		if Blocked(a) {
			return nil, fmt.Errorf("%w: %s resolves to %s", ErrBlocked, host, Normalize(a))
		}
	}
	nd := &net.Dialer{Timeout: d.Timeout, Control: Control}
	var lastErr error
	for _, a := range addrs {
		a = Normalize(a)
		if (strings.HasSuffix(network, "4") && !a.Is4()) || (strings.HasSuffix(network, "6") && !a.Is6()) {
			continue
		}
		conn, err := nd.DialContext(ctx, network, net.JoinHostPort(a.String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no %s address for %s", network, host)
	}
	return nil, lastErr
}
