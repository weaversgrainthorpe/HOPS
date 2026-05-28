package discovery

import (
	"context"
	"errors"
	"net"
	"strings"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

// mDNS browser. Sends a small set of standard queries to the
// 224.0.0.251:5353 multicast group and listens for the typically-bursty
// stream of responses for a fixed window. Returns a flat list of
// (instance, hostname, ip, port) tuples — the caller filters by CIDR.
//
// Design notes:
//   - We send one query for `_services._dns-sd._udp.local PTR` (service
//     enumeration) and follow-up queries for ~10 well-known service
//     types that show up in homelabs. Most responders include SRV/A in
//     the additional records of a single response so we don't need a
//     stateful per-instance follow-up phase.
//   - Listening socket is a normal UDP socket bound to a random ephemeral
//     port — unprivileged, portable, and works inside Docker if the
//     container is on the host network. Containers on a bridge network
//     won't see LAN mDNS; that's a deployment concern, not our problem.
//   - 3-second listen window. mDNS responses to a query land within
//     1-2 seconds on a quiet LAN; longer waits don't materially help
//     and just slow the scan.

const (
	mdnsMulticastAddr = "224.0.0.251:5353"
	mdnsListenWindow  = 3 * time.Second
)

// servicesPTR is the special meta-service that asks "what service types
// do you advertise?" — responders reply with a PTR record per type.
const servicesPTR = "_services._dns-sd._udp.local."

// commonMDNSTypes is the explicit follow-up query set. mDNS responders
// vary in how chatty they are about _services PTR, so directly asking
// for the ones we care about catches stragglers.
var commonMDNSTypes = []string{
	"_http._tcp.local.",
	"_https._tcp.local.",
	"_homeassistant._tcp.local.",
	"_hap._tcp.local.",    // HomeKit Accessory Protocol
	"_airplay._tcp.local.", // AirPlay receivers
	"_raop._tcp.local.",    // AirPlay audio
	"_googlecast._tcp.local.",
	"_plex._tcp.local.",
	"_workstation._tcp.local.",
	"_smb._tcp.local.",
	"_ssh._tcp.local.",
	"_printer._tcp.local.",
	"_ipp._tcp.local.",
}

// mdnsInstance is one discovered service instance. Not every field will
// be populated — a host that returned a PTR but no SRV+A will only have
// Service set, and the orchestrator falls back to ignoring it.
type mdnsInstance struct {
	Instance string // mDNS instance name (free-text), e.g. "Living Room TV"
	Service  string // service type, e.g. "_googlecast._tcp.local."
	Host     string // IPv4 (filled from A records)
	Port     int    // SRV target port
	Target   string // SRV target hostname (e.g. "tv.local.")
}

// browseMDNSForHosts sends the query set, listens for the configured
// window, and returns every instance whose IP is in the scan's allowed
// host set. ctx cancellation short-circuits the listen window.
func browseMDNSForHosts(ctx context.Context, allow hostAllowlist) ([]mdnsInstance, error) {
	addr, err := net.ResolveUDPAddr("udp4", mdnsMulticastAddr)
	if err != nil {
		return nil, err
	}
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	// Send the enumeration query plus the well-known type queries.
	if err := sendMDNSQuery(conn, addr, servicesPTR, dnsmessage.TypePTR); err != nil {
		return nil, err
	}
	for _, t := range commonMDNSTypes {
		_ = sendMDNSQuery(conn, addr, t, dnsmessage.TypePTR)
	}

	deadline := time.Now().Add(mdnsListenWindow)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	_ = conn.SetReadDeadline(deadline)

	// Indexed by (instance name OR SRV target) so we can join records
	// that arrive in separate packets.
	byKey := map[string]*mdnsInstance{}

	buf := make([]byte, 4096)
	for ctx.Err() == nil {
		n, _, err := conn.ReadFromUDP(buf)
		if err != nil {
			// Read deadline hit, or socket closed — exit normally.
			var nerr net.Error
			if errors.As(err, &nerr) && nerr.Timeout() {
				break
			}
			break
		}
		parseMDNSMessage(buf[:n], byKey)
	}

	// Resolve target hostnames against A records collected by key.
	out := make([]mdnsInstance, 0, len(byKey))
	for _, inst := range byKey {
		if inst.Host == "" || !allow.contains(inst.Host) {
			continue
		}
		out = append(out, *inst)
	}
	return out, nil
}

func sendMDNSQuery(conn *net.UDPConn, dst *net.UDPAddr, name string, qtype dnsmessage.Type) error {
	q := dnsmessage.Question{
		Name:  dnsmessage.MustNewName(name),
		Type:  qtype,
		Class: dnsmessage.ClassINET,
	}
	msg := dnsmessage.Message{
		Header:    dnsmessage.Header{RecursionDesired: false},
		Questions: []dnsmessage.Question{q},
	}
	pkt, err := msg.Pack()
	if err != nil {
		return err
	}
	_, err = conn.WriteToUDP(pkt, dst)
	return err
}

// parseMDNSMessage extracts PTR / SRV / A records and stitches them
// together into mdnsInstance entries keyed first by PTR target name and
// later joined via SRV→A. Best-effort — any malformed message is
// silently dropped.
func parseMDNSMessage(raw []byte, byKey map[string]*mdnsInstance) {
	var p dnsmessage.Parser
	if _, err := p.Start(raw); err != nil {
		return
	}
	_ = p.SkipAllQuestions()

	// Buffer A records by name; SRV records get the IP attached at the
	// end if their target is in the buffer.
	aRecordsByName := map[string]string{}

	processAnswer := func() bool {
		hdr, err := p.AnswerHeader()
		if err != nil {
			return false
		}
		switch hdr.Type {
		case dnsmessage.TypePTR:
			r, err := p.PTRResource()
			if err != nil {
				_ = p.SkipAnswer()
				return true
			}
			target := strings.ToLower(r.PTR.String())
			service := strings.ToLower(hdr.Name.String())
			// PTR target is the instance name like "Living Room TV._googlecast._tcp.local."
			inst, ok := byKey[target]
			if !ok {
				inst = &mdnsInstance{}
				byKey[target] = inst
			}
			inst.Service = service
			inst.Instance = instanceLabelFrom(target, service)
		case dnsmessage.TypeSRV:
			r, err := p.SRVResource()
			if err != nil {
				_ = p.SkipAnswer()
				return true
			}
			key := strings.ToLower(hdr.Name.String())
			inst, ok := byKey[key]
			if !ok {
				inst = &mdnsInstance{}
				byKey[key] = inst
			}
			inst.Port = int(r.Port)
			inst.Target = strings.ToLower(r.Target.String())
			if ip, ok := aRecordsByName[inst.Target]; ok {
				inst.Host = ip
			}
		case dnsmessage.TypeA:
			r, err := p.AResource()
			if err != nil {
				_ = p.SkipAnswer()
				return true
			}
			name := strings.ToLower(hdr.Name.String())
			ip := net.IP(r.A[:]).String()
			aRecordsByName[name] = ip
			// Backfill any instances whose SRV target we saw earlier.
			for _, inst := range byKey {
				if inst.Target == name {
					inst.Host = ip
				}
			}
		default:
			_ = p.SkipAnswer()
		}
		return true
	}

	for processAnswer() {
	}

	// Some responders put everything in the Additional section.
	processAdditional := func() bool {
		hdr, err := p.AdditionalHeader()
		if err != nil {
			return false
		}
		switch hdr.Type {
		case dnsmessage.TypeSRV:
			r, err := p.SRVResource()
			if err != nil {
				_ = p.SkipAdditional()
				return true
			}
			key := strings.ToLower(hdr.Name.String())
			inst, ok := byKey[key]
			if !ok {
				inst = &mdnsInstance{}
				byKey[key] = inst
			}
			inst.Port = int(r.Port)
			inst.Target = strings.ToLower(r.Target.String())
			if ip, ok := aRecordsByName[inst.Target]; ok {
				inst.Host = ip
			}
		case dnsmessage.TypeA:
			r, err := p.AResource()
			if err != nil {
				_ = p.SkipAdditional()
				return true
			}
			name := strings.ToLower(hdr.Name.String())
			ip := net.IP(r.A[:]).String()
			aRecordsByName[name] = ip
			for _, inst := range byKey {
				if inst.Target == name {
					inst.Host = ip
				}
			}
		default:
			_ = p.SkipAdditional()
		}
		return true
	}

	for processAdditional() {
	}
}

// instanceLabelFrom extracts the first DNS label of the instance name
// (the user-visible bit) by stripping the service-type suffix.
//
//	"Living Room TV._googlecast._tcp.local." → "Living Room TV"
//	"laser-printer._ipp._tcp.local."        → "laser-printer"
func instanceLabelFrom(target, service string) string {
	if service != "" && strings.HasSuffix(target, "."+service) {
		return strings.TrimSuffix(target, "."+service)
	}
	// Fall back: take everything before the first dot.
	if i := strings.Index(target, "."); i > 0 {
		return target[:i]
	}
	return target
}
