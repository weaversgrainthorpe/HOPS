package discovery

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"
)

// Minimal SNMPv2c GET probe — the bare slice of the protocol needed to
// pull sysDescr / sysName / sysLocation from a host using the "public"
// community string. SNMP catches a useful class of homelab gear that
// the rest of discovery misses: network printers, managed switches,
// UPS units, server out-of-band controllers (iLO / iDRAC / IPMI).
//
// "public" is the historical default community and is still configured
// on a lot of devices out of the box. If a host has SNMP off, or uses
// a non-default community, this probe gets nothing — silent failure.
//
// Why we don't pull in gosnmp: the per-discovery constraint is "no new
// third-party deps". A single SNMPv2c GET with a fixed OID set is small
// enough to inline (~150 lines including BER/ASN.1 encoding); we don't
// need SNMPv3, walks, traps, or any of gosnmp's bigger surface.

const (
	snmpPort           = 161
	snmpCommunity      = "public"
	snmpPerHostTimeout = 1500 * time.Millisecond
	snmpVersion2c      = 1 // RFC1905: SNMPv2c uses version=1 on the wire
	snmpMaxResponseLen = 4096

	// BER tags we need.
	tagInteger      = 0x02
	tagOctetString  = 0x04
	tagNull         = 0x05
	tagOID          = 0x06
	tagSequence     = 0x30
	tagGetRequest   = 0xa0
	tagGetResponse  = 0xa2
)

// snmpResult is the subset of sysX OIDs we surface as a tile. Empty
// strings for fields the device didn't answer or doesn't support.
type snmpResult struct {
	Host        string
	SysDescr    string
	SysName     string
	SysLocation string
}

// snmpProbeHosts runs an SNMPv2c GET against every host in `hosts`,
// concurrently up to a small parallelism cap. Hosts that don't answer
// within snmpPerHostTimeout are silently skipped. Returns one result
// per responding host.
func snmpProbeHosts(ctx context.Context, hosts []string) []snmpResult {
	const parallel = 16
	sem := make(chan struct{}, parallel)
	var (
		wg  sync.WaitGroup
		mu  sync.Mutex
		out []snmpResult
	)
	for _, h := range hosts {
		if ctx.Err() != nil {
			break
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(host string) {
			defer wg.Done()
			defer func() { <-sem }()
			r, ok := snmpGetSysInfo(ctx, host)
			if !ok {
				return
			}
			r.Host = host
			mu.Lock()
			out = append(out, r)
			mu.Unlock()
		}(h)
	}
	wg.Wait()
	return out
}

// snmpGetSysInfo issues a single SNMP GetRequest for sysDescr + sysName
// + sysLocation and parses the response. Returns ok=false on any error
// (timeout, no response, malformed reply, non-string value).
func snmpGetSysInfo(ctx context.Context, host string) (snmpResult, bool) {
	// Refuse to dial blocked targets — mirrors the SSRF policy used
	// for TCP probes.
	if ip := net.ParseIP(host); ip != nil && isBlockedIP(ip) {
		return snmpResult{}, false
	}

	addr := &net.UDPAddr{IP: net.ParseIP(host), Port: snmpPort}
	if addr.IP == nil {
		return snmpResult{}, false
	}
	conn, err := net.DialUDP("udp4", nil, addr)
	if err != nil {
		return snmpResult{}, false
	}
	defer conn.Close()

	deadline := time.Now().Add(snmpPerHostTimeout)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	_ = conn.SetDeadline(deadline)

	oids := [][]int{
		{1, 3, 6, 1, 2, 1, 1, 1, 0}, // sysDescr
		{1, 3, 6, 1, 2, 1, 1, 5, 0}, // sysName
		{1, 3, 6, 1, 2, 1, 1, 6, 0}, // sysLocation
	}
	reqID := int32(randUint32() & 0x7fffffff)
	req, err := buildSNMPGetRequest(reqID, snmpCommunity, oids)
	if err != nil {
		return snmpResult{}, false
	}
	if _, err := conn.Write(req); err != nil {
		return snmpResult{}, false
	}

	buf := make([]byte, snmpMaxResponseLen)
	n, err := conn.Read(buf)
	if err != nil {
		return snmpResult{}, false
	}
	vals, err := parseSNMPResponse(buf[:n], reqID)
	if err != nil || len(vals) < 1 {
		return snmpResult{}, false
	}
	out := snmpResult{}
	if len(vals) > 0 {
		out.SysDescr = vals[0]
	}
	if len(vals) > 1 {
		out.SysName = vals[1]
	}
	if len(vals) > 2 {
		out.SysLocation = vals[2]
	}
	// Sanitise — sysDescr can be 200+ chars of vendor copy.
	out.SysDescr = clipString(out.SysDescr, 200)
	out.SysName = clipString(out.SysName, 80)
	out.SysLocation = clipString(out.SysLocation, 80)
	return out, true
}

// snmpSuggest maps an SNMP sysDescr string to a tile suggestion. The
// substring match keeps it cheap; admin can edit anything in the curate
// UI.
func snmpSuggest(r snmpResult) (name, icon, category, desc string) {
	name = r.SysName
	if name == "" {
		// Take the first short word of sysDescr.
		parts := strings.Fields(r.SysDescr)
		if len(parts) > 0 {
			name = parts[0]
		} else {
			name = r.Host
		}
	}
	desc = r.SysDescr
	if r.SysLocation != "" {
		desc += " — " + r.SysLocation
	}

	lower := strings.ToLower(r.SysDescr + " " + r.SysName)
	switch {
	case strings.Contains(lower, "printer"), strings.Contains(lower, "hp laserjet"),
		strings.Contains(lower, "jetdirect"), strings.Contains(lower, "brother"),
		strings.Contains(lower, "epson"), strings.Contains(lower, "canon ij"):
		return name, "mdi:printer", CategoryDocuments, desc
	case strings.Contains(lower, "ups "), strings.Contains(lower, "smart-ups"),
		strings.Contains(lower, "back-ups"), strings.Contains(lower, "apc "):
		return name, "mdi:battery-charging", CategoryMonitoring, desc
	case strings.Contains(lower, "switch"), strings.Contains(lower, "cisco"),
		strings.Contains(lower, "juniper"), strings.Contains(lower, "ubiquiti"),
		strings.Contains(lower, "mikrotik"), strings.Contains(lower, "edgeswitch"):
		return name, "mdi:switch", CategoryNetwork, desc
	case strings.Contains(lower, "router"), strings.Contains(lower, "openwrt"),
		strings.Contains(lower, "edgerouter"):
		return name, "mdi:router-network", CategoryNetwork, desc
	case strings.Contains(lower, "ilo"), strings.Contains(lower, "idrac"),
		strings.Contains(lower, "ipmi"), strings.Contains(lower, "bmc"):
		return name, "mdi:server", CategoryVirtualization, desc
	case strings.Contains(lower, "synology"), strings.Contains(lower, "diskstation"):
		return name, "synology", CategoryStorage, desc
	}
	return name, "mdi:lan", CategoryNetwork, desc
}

// --- BER / ASN.1 marshalling ----------------------------------------------

func buildSNMPGetRequest(reqID int32, community string, oids [][]int) ([]byte, error) {
	// VarBinds — one SEQUENCE per OID, value = NULL.
	var vbs []byte
	for _, oid := range oids {
		enc, err := encodeOID(oid)
		if err != nil {
			return nil, err
		}
		vb := append([]byte{}, enc...)
		vb = append(vb, tagNull, 0x00)
		vbs = append(vbs, wrapBER(tagSequence, vb)...)
	}
	vbsSeq := wrapBER(tagSequence, vbs)

	// PDU: INTEGER reqID, INTEGER errStatus=0, INTEGER errIndex=0, VarBinds
	var pdu []byte
	pdu = append(pdu, encodeInteger(int64(reqID))...)
	pdu = append(pdu, encodeInteger(0)...) // errStatus
	pdu = append(pdu, encodeInteger(0)...) // errIndex
	pdu = append(pdu, vbsSeq...)
	pduWrapped := wrapBER(tagGetRequest, pdu)

	// Message: INTEGER version, OCTET STRING community, PDU
	var msg []byte
	msg = append(msg, encodeInteger(int64(snmpVersion2c))...)
	msg = append(msg, encodeOctetString(community)...)
	msg = append(msg, pduWrapped...)
	return wrapBER(tagSequence, msg), nil
}

// parseSNMPResponse extracts the OCTET STRING values from each VarBind
// in a GetResponse PDU. Returns them in the same order they appear.
// Non-OCTET-STRING values (counters, INTEGERs) are returned as their
// string representations so vendor-specific OIDs don't blow up the
// caller, but we only ask for sysDescr-family OIDs which are all
// strings on every device that bothers implementing SNMPv2-MIB.
func parseSNMPResponse(data []byte, expectReqID int32) ([]string, error) {
	r := newBerReader(data)
	if err := r.expect(tagSequence); err != nil {
		return nil, err
	}
	// Body of the top sequence.
	body, err := r.takeLength()
	if err != nil {
		return nil, err
	}
	br := newBerReader(body)

	// version INTEGER
	if _, err := br.readInteger(); err != nil {
		return nil, fmt.Errorf("snmp: version: %w", err)
	}
	// community OCTET STRING
	if _, err := br.readOctetString(); err != nil {
		return nil, fmt.Errorf("snmp: community: %w", err)
	}
	// PDU — must be GetResponse for our purposes.
	if err := br.expect(tagGetResponse); err != nil {
		return nil, fmt.Errorf("snmp: expected GetResponse: %w", err)
	}
	pduBody, err := br.takeLength()
	if err != nil {
		return nil, err
	}
	pr := newBerReader(pduBody)

	reqID, err := pr.readInteger()
	if err != nil {
		return nil, fmt.Errorf("snmp: request-id: %w", err)
	}
	if int32(reqID) != expectReqID {
		return nil, fmt.Errorf("snmp: request-id mismatch: got %d want %d", reqID, expectReqID)
	}
	// errStatus, errIndex
	if _, err := pr.readInteger(); err != nil {
		return nil, err
	}
	if _, err := pr.readInteger(); err != nil {
		return nil, err
	}
	// VarBindList SEQUENCE
	if err := pr.expect(tagSequence); err != nil {
		return nil, fmt.Errorf("snmp: varbinds: %w", err)
	}
	vbsBody, err := pr.takeLength()
	if err != nil {
		return nil, err
	}
	vbr := newBerReader(vbsBody)
	var out []string
	for vbr.remaining() > 0 {
		if err := vbr.expect(tagSequence); err != nil {
			return nil, err
		}
		vbBody, err := vbr.takeLength()
		if err != nil {
			return nil, err
		}
		vr := newBerReader(vbBody)
		// Skip OID.
		if err := vr.expect(tagOID); err != nil {
			return nil, err
		}
		oidBody, err := vr.takeLength()
		if err != nil {
			return nil, err
		}
		_ = oidBody // OID bytes — not needed since order matches request

		// Value tag — accept OCTET STRING (or NoSuchObject/NoSuchInstance
		// tags, which we render as empty).
		valTag, err := vr.readTag()
		if err != nil {
			return nil, err
		}
		valBody, err := vr.takeLength()
		if err != nil {
			return nil, err
		}
		switch valTag {
		case tagOctetString:
			out = append(out, string(valBody))
		case tagInteger:
			out = append(out, fmt.Sprintf("%d", parseBerInt(valBody)))
		case 0x80, 0x81, 0x82: // noSuchObject / noSuchInstance / endOfMibView
			out = append(out, "")
		default:
			out = append(out, "")
		}
	}
	return out, nil
}

// --- BER primitives -------------------------------------------------------

type berReader struct {
	data []byte
	pos  int
}

func newBerReader(b []byte) *berReader { return &berReader{data: b} }

func (r *berReader) remaining() int { return len(r.data) - r.pos }

func (r *berReader) readByte() (byte, error) {
	if r.pos >= len(r.data) {
		return 0, errors.New("ber: unexpected EOF")
	}
	b := r.data[r.pos]
	r.pos++
	return b, nil
}

func (r *berReader) readTag() (byte, error) { return r.readByte() }

func (r *berReader) expect(tag byte) error {
	t, err := r.readByte()
	if err != nil {
		return err
	}
	if t != tag {
		return fmt.Errorf("ber: expected tag 0x%02x, got 0x%02x", tag, t)
	}
	return nil
}

// takeLength reads a BER length and returns the slice of `length` bytes
// that follows (advancing pos past them).
func (r *berReader) takeLength() ([]byte, error) {
	if r.pos >= len(r.data) {
		return nil, errors.New("ber: length: EOF")
	}
	first := r.data[r.pos]
	r.pos++
	var length int
	if first&0x80 == 0 {
		length = int(first)
	} else {
		nb := int(first & 0x7f)
		if nb == 0 || nb > 4 {
			return nil, fmt.Errorf("ber: invalid length octets %d", nb)
		}
		if r.pos+nb > len(r.data) {
			return nil, errors.New("ber: length: short read")
		}
		for i := 0; i < nb; i++ {
			length = (length << 8) | int(r.data[r.pos+i])
		}
		r.pos += nb
	}
	if r.pos+length > len(r.data) {
		return nil, errors.New("ber: body: short read")
	}
	body := r.data[r.pos : r.pos+length]
	r.pos += length
	return body, nil
}

func (r *berReader) readInteger() (int64, error) {
	if err := r.expect(tagInteger); err != nil {
		return 0, err
	}
	body, err := r.takeLength()
	if err != nil {
		return 0, err
	}
	return parseBerInt(body), nil
}

func (r *berReader) readOctetString() (string, error) {
	if err := r.expect(tagOctetString); err != nil {
		return "", err
	}
	body, err := r.takeLength()
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func parseBerInt(b []byte) int64 {
	if len(b) == 0 {
		return 0
	}
	var v int64
	if b[0]&0x80 != 0 {
		// Negative: sign-extend.
		v = -1
	}
	for _, c := range b {
		v = (v << 8) | int64(c)
	}
	return v
}

func encodeLength(n int) []byte {
	if n < 0x80 {
		return []byte{byte(n)}
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte(n & 0xff)}, b...)
		n >>= 8
	}
	return append([]byte{0x80 | byte(len(b))}, b...)
}

func wrapBER(tag byte, body []byte) []byte {
	out := []byte{tag}
	out = append(out, encodeLength(len(body))...)
	out = append(out, body...)
	return out
}

func encodeInteger(v int64) []byte {
	// Minimal big-endian two's-complement form.
	if v == 0 {
		return wrapBER(tagInteger, []byte{0x00})
	}
	var b []byte
	negative := v < 0
	for {
		b = append([]byte{byte(v & 0xff)}, b...)
		v >>= 8
		if (v == 0 && !negative) || (v == -1 && negative) {
			break
		}
	}
	// Ensure sign bit is correct.
	if !negative && b[0]&0x80 != 0 {
		b = append([]byte{0x00}, b...)
	}
	if negative && b[0]&0x80 == 0 {
		b = append([]byte{0xff}, b...)
	}
	return wrapBER(tagInteger, b)
}

func encodeOctetString(s string) []byte {
	return wrapBER(tagOctetString, []byte(s))
}

// encodeOID encodes an OID using the standard BER multi-byte form. The
// first two arc components are merged into a single byte (40*a + b).
func encodeOID(arcs []int) ([]byte, error) {
	if len(arcs) < 2 {
		return nil, errors.New("oid: needs at least 2 arcs")
	}
	body := []byte{byte(40*arcs[0] + arcs[1])}
	for _, a := range arcs[2:] {
		body = append(body, encodeOIDArc(a)...)
	}
	return wrapBER(tagOID, body), nil
}

func encodeOIDArc(n int) []byte {
	if n == 0 {
		return []byte{0x00}
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte(n & 0x7f)}, b...)
		n >>= 7
	}
	for i := 0; i < len(b)-1; i++ {
		b[i] |= 0x80
	}
	return b
}

func clipString(s string, max int) string {
	s = strings.TrimSpace(s)
	// Replace control bytes that would otherwise look bad in the UI.
	var bld strings.Builder
	bld.Grow(len(s))
	for _, r := range s {
		if r >= 0x20 && r != 0x7f {
			bld.WriteRune(r)
		} else if r == '\n' || r == '\r' || r == '\t' {
			bld.WriteByte(' ')
		}
	}
	s = strings.TrimSpace(bld.String())
	if len(s) > max {
		s = s[:max]
	}
	return s
}

func randUint32() uint32 {
	var b [4]byte
	_, _ = rand.Read(b[:])
	return binary.BigEndian.Uint32(b[:])
}
