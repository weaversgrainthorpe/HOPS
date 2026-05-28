package discovery

import (
	"bufio"
	"net"
	"os"
	"strings"
	"sync"
)

// PassiveHints groups the results of the per-scan passive prelude:
// a fast non-network ARP-table read plus longer-running mDNS / NetBIOS
// listeners. Hints are scoped to the scan's CIDR and used to enrich the
// per-host Probe (hostname) and (for service-bearing hints like mDNS)
// to emit standalone Results for services no TCP probe would have found.
//
// Phase 3 ships ARP + mDNS. NetBIOS is wired through the same shape so
// it can land in a follow-up patch without churning callers.
type PassiveHints struct {
	// hostnameByIP maps every IP we learnt a name for to that name.
	// Sources are merged in order of trust (mDNS > NetBIOS > reverse-DNS >
	// ARP-static), but Phase 3 v1 only has ARP and mDNS so contention is
	// rare. Last-write-wins is fine.
	hostnameByIP map[string]string

	// mdnsByIP maps each IP to the service instances mDNS reported for
	// it. The orchestrator turns these into ScanResults so a host with
	// nothing on the TCP allowlist still shows up if it broadcasts via
	// mDNS (HomeKit accessories, AirPlay receivers, etc.).
	mdnsByIP map[string][]mdnsInstance

	// ssdpByIP maps each IP to UPnP/SSDP devices we discovered for it.
	// Same downstream treatment as mDNS — standalone Results for hosts
	// the active probe didn't already match.
	ssdpByIP map[string][]ssdpDevice

	// snmpByIP maps each IP to the SNMP system-info result for it.
	// Single-result-per-host because we ask for a fixed OID set.
	snmpByIP map[string]snmpResult

	mu sync.RWMutex
}

// newPassiveHints returns an empty container; callers populate it from
// each source and the orchestrator reads through Hostname() / Services().
func newPassiveHints() *PassiveHints {
	return &PassiveHints{
		hostnameByIP: make(map[string]string),
		mdnsByIP:     make(map[string][]mdnsInstance),
		ssdpByIP:     make(map[string][]ssdpDevice),
		snmpByIP:     make(map[string]snmpResult),
	}
}

func (p *PassiveHints) putHostname(ip, name string) {
	if ip == "" {
		return
	}
	name = sanitiseHostname(name)
	if name == "" {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.hostnameByIP[ip] = name
}

// sanitiseHostname cleans hostname strings that arrived via DNS / mDNS /
// ARP enrichment before storing them. Real-world LAN DNS servers (some
// DHCP-integrated ones, OpenWrt's dnsmasq with hints on, etc.) tack
// MAC-like annotations onto PTR records — e.g.
// "nas721124 [24:5e:be:72:11:24]" or "printer (aa:bb:cc:dd:ee:ff)" —
// which are noise in the curate UI. We strip trailing bracketed /
// parenthesised blocks, drop control bytes, trim whitespace and the
// trailing FQDN dot, and clip to 253 chars (RFC 1035 max).
func sanitiseHostname(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, ".")
	// Strip trailing [...] and (...) annotations, repeatedly in case
	// there's more than one. Only matches when the block is at the very
	// end so genuine "name [tag]" mDNS instance names lose only their
	// trailing junk, not embedded brackets.
	for {
		before := s
		s = strings.TrimSpace(s)
		if strings.HasSuffix(s, "]") {
			if i := strings.LastIndex(s, "["); i >= 0 {
				s = strings.TrimSpace(s[:i])
			}
		} else if strings.HasSuffix(s, ")") {
			if i := strings.LastIndex(s, "("); i >= 0 {
				s = strings.TrimSpace(s[:i])
			}
		}
		if s == before {
			break
		}
	}
	// Drop ASCII control bytes (incl. DEL); a malicious PTR could try
	// to inject these to fool the curate UI's text rendering.
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r >= 0x20 && r != 0x7f {
			b.WriteRune(r)
		}
	}
	s = b.String()
	if len(s) > 253 {
		s = s[:253]
	}
	return s
}

func (p *PassiveHints) putMDNS(ip string, inst mdnsInstance) {
	if ip == "" {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.mdnsByIP[ip] = append(p.mdnsByIP[ip], inst)
}

// Hostname returns the best name we've learnt for an IP, or "" if none.
func (p *PassiveHints) Hostname(ip string) string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.hostnameByIP[ip]
}

// MDNSFor returns the mDNS service instances we collected for an IP.
func (p *PassiveHints) MDNSFor(ip string) []mdnsInstance {
	p.mu.RLock()
	defer p.mu.RUnlock()
	out := make([]mdnsInstance, len(p.mdnsByIP[ip]))
	copy(out, p.mdnsByIP[ip])
	return out
}

// putSSDP records one SSDP/UPnP device discovered for an IP. If the
// device's friendly name + manufacturer also implies a hostname (e.g.
// "Living Room Roku"), seed hostnameByIP too — Roku's UDN often
// becomes the only "name" we have for that LAN host.
func (p *PassiveHints) putSSDP(ip string, dev ssdpDevice) {
	if ip == "" {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.ssdpByIP[ip] = append(p.ssdpByIP[ip], dev)
	if dev.FriendlyName != "" && p.hostnameByIP[ip] == "" {
		p.hostnameByIP[ip] = sanitiseHostname(dev.FriendlyName)
	}
}

// SSDPFor returns the SSDP/UPnP devices collected for an IP.
func (p *PassiveHints) SSDPFor(ip string) []ssdpDevice {
	p.mu.RLock()
	defer p.mu.RUnlock()
	out := make([]ssdpDevice, len(p.ssdpByIP[ip]))
	copy(out, p.ssdpByIP[ip])
	return out
}

// putSNMP records an SNMP system-info response for an IP and, if the
// device's sysName looks meaningful, seeds hostnameByIP from it.
func (p *PassiveHints) putSNMP(ip string, r snmpResult) {
	if ip == "" {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.snmpByIP[ip] = r
	if r.SysName != "" && p.hostnameByIP[ip] == "" {
		p.hostnameByIP[ip] = sanitiseHostname(r.SysName)
	}
}

// SNMPFor returns the SNMP system-info result for an IP, or the zero
// value (and ok=false) if we didn't get one.
func (p *PassiveHints) SNMPFor(ip string) (snmpResult, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	r, ok := p.snmpByIP[ip]
	return r, ok
}

// AllIPs returns every IP we've seen a hint for. Used by the
// passive-only intensity path to know which hosts to emit standalone
// Results for.
func (p *PassiveHints) AllIPs() []string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	seen := make(map[string]struct{}, len(p.hostnameByIP)+len(p.mdnsByIP)+len(p.ssdpByIP)+len(p.snmpByIP))
	for ip := range p.hostnameByIP {
		seen[ip] = struct{}{}
	}
	for ip := range p.mdnsByIP {
		seen[ip] = struct{}{}
	}
	for ip := range p.ssdpByIP {
		seen[ip] = struct{}{}
	}
	for ip := range p.snmpByIP {
		seen[ip] = struct{}{}
	}
	out := make([]string, 0, len(seen))
	for ip := range seen {
		out = append(out, ip)
	}
	return out
}

// readARPTableForHosts parses /proc/net/arp on Linux and returns the
// IP→MAC entries that fall inside the scan's allowed host set. Hosts in
// the ARP cache are guaranteed to be (or have recently been) live, so
// using these to bias probe order and skip dead-host short-circuits is
// a free speedup. Returns empty (not an error) on non-Linux hosts where
// the file doesn't exist — passive ARP enrichment is just unavailable.
func readARPTableForHosts(allow hostAllowlist) ([]arpEntry, error) {
	f, err := os.Open("/proc/net/arp")
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()

	var out []arpEntry
	sc := bufio.NewScanner(f)
	first := true
	for sc.Scan() {
		if first {
			first = false // header
			continue
		}
		fields := strings.Fields(sc.Text())
		// Expected columns: IP, HW type, Flags, HW address, Mask, Device
		if len(fields) < 4 {
			continue
		}
		ip := net.ParseIP(fields[0])
		if ip == nil {
			continue
		}
		if !allow.contains(ip.String()) {
			continue
		}
		// Flag 0x0 = incomplete entry (no MAC seen yet) — skip.
		if fields[2] == "0x0" {
			continue
		}
		out = append(out, arpEntry{IP: ip.String(), MAC: fields[3]})
	}
	return out, sc.Err()
}

type arpEntry struct {
	IP  string
	MAC string
}
