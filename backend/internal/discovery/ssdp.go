package discovery

import (
	"bufio"
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// SSDP / UPnP discovery. Sends a multicast M-SEARCH to
// 239.255.255.250:1900 and listens for the typically-bursty stream of
// responses for a fixed window. Each response carries a LOCATION URL
// to a device-description XML file; fetching it (through the same
// SSRF-safe dialer the rest of the scanner uses) yields manufacturer +
// friendly name + model. Useful class of devices: smart TVs, Roku,
// Sonos / Chromecast Audio, NAS UPnP servers, IGD-capable routers.
//
// Design mirrors mdns.go in shape: passive enrichment, bounded
// listening window, hostAllowlist filter on the responder IP, never
// emit Results for hosts outside the scan target set.

const (
	ssdpMulticastAddr = "239.255.255.250:1900"
	ssdpListenWindow  = 3 * time.Second
	// ssdpMX is the MX header value — instructs responders to spread
	// their replies over this many seconds. Matching our listen window
	// keeps the response burst contained.
	ssdpMX = 2
	// Per-LOCATION-fetch budget. Some devices serve their XML slowly;
	// a 2s cap is generous without letting one slow device drag out
	// the whole sweep.
	ssdpFetchTimeout = 2 * time.Second
	// Cap how many distinct LOCATION URLs we'll fetch per sweep —
	// a noisy LAN can have a flood of duplicate-ish announcements.
	ssdpMaxFetches = 64
)

// SearchTargets we send M-SEARCH for. `ssdp:all` is the catch-all;
// rootdevice catches devices that ignore the all-target. IGD and
// MediaRenderer are filtered subsets — handy for routers and TVs that
// don't always answer the broader queries reliably.
var ssdpSearchTargets = []string{
	"ssdp:all",
	"upnp:rootdevice",
	"urn:schemas-upnp-org:device:InternetGatewayDevice:1",
	"urn:schemas-upnp-org:device:MediaRenderer:1",
	"urn:schemas-upnp-org:device:MediaServer:1",
}

// ssdpDevice is one discovered UPnP device with the fields we actually
// surface as a tile suggestion. Empty strings for fields the device
// didn't advertise.
type ssdpDevice struct {
	Host         string // responder IP (filled from UDP source)
	FriendlyName string
	Manufacturer string
	ModelName    string
	DeviceType   string
	Location     string // the device-description XML URL
	Server       string // SERVER header (e.g. "Roku UPnP/1.0 Roku/12.0.0")
}

// browseSSDPForHosts performs the M-SEARCH + listen + device-description
// fetch loop and returns the deduplicated set of devices whose IP is in
// the scan's allowlist. ctx cancellation short-circuits the listen
// window and the per-device XML fetch.
func browseSSDPForHosts(ctx context.Context, allow hostAllowlist) ([]ssdpDevice, error) {
	addr, err := net.ResolveUDPAddr("udp4", ssdpMulticastAddr)
	if err != nil {
		return nil, err
	}
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	// Fire one M-SEARCH per target. Many devices only answer the
	// specific search target their handler subscribes to.
	for _, st := range ssdpSearchTargets {
		_ = sendSSDPMSearch(conn, addr, st)
	}

	deadline := time.Now().Add(ssdpListenWindow)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	_ = conn.SetReadDeadline(deadline)

	// Dedupe by LOCATION URL: many devices announce themselves under
	// multiple search targets and we don't want to fetch the same XML
	// five times.
	type pendingLocation struct {
		ip     string
		server string
	}
	pending := map[string]pendingLocation{}

	buf := make([]byte, 4096)
	for ctx.Err() == nil {
		n, src, err := conn.ReadFromUDP(buf)
		if err != nil {
			var nerr net.Error
			if errors.As(err, &nerr) && nerr.Timeout() {
				break
			}
			break
		}
		ip := src.IP.String()
		if !allow.contains(ip) {
			continue
		}
		location, server := parseSSDPResponse(buf[:n])
		if location == "" {
			continue
		}
		if _, dup := pending[location]; dup {
			continue
		}
		pending[location] = pendingLocation{ip: ip, server: server}
		if len(pending) >= ssdpMaxFetches {
			break
		}
	}

	out := make([]ssdpDevice, 0, len(pending))
	for loc, p := range pending {
		if ctx.Err() != nil {
			break
		}
		dev, ok := fetchSSDPDeviceDescription(ctx, loc, p.ip, p.server)
		if !ok {
			continue
		}
		out = append(out, dev)
	}
	return out, nil
}

// sendSSDPMSearch writes one M-SEARCH datagram to the multicast group
// with the given search target.
func sendSSDPMSearch(conn *net.UDPConn, dst *net.UDPAddr, st string) error {
	req := fmt.Sprintf(
		"M-SEARCH * HTTP/1.1\r\n"+
			"HOST: %s\r\n"+
			"MAN: \"ssdp:discover\"\r\n"+
			"MX: %d\r\n"+
			"ST: %s\r\n"+
			"USER-AGENT: HOPS-Discovery/1.0 UPnP/1.1\r\n\r\n",
		ssdpMulticastAddr, ssdpMX, st)
	_, err := conn.WriteToUDP([]byte(req), dst)
	return err
}

// parseSSDPResponse pulls LOCATION + SERVER from a UDP datagram that
// looks like an HTTP/1.1 response. Cheap line-scan — full HTTP parsing
// would be overkill for these tiny, structured payloads.
func parseSSDPResponse(raw []byte) (location, server string) {
	scanner := bufio.NewScanner(bytes.NewReader(raw))
	for scanner.Scan() {
		line := scanner.Text()
		colon := strings.IndexByte(line, ':')
		if colon < 0 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(line[:colon]))
		val := strings.TrimSpace(line[colon+1:])
		switch key {
		case "location":
			location = val
		case "server":
			server = val
		}
	}
	return location, server
}

// fetchSSDPDeviceDescription fetches the LOCATION URL and parses its
// XML root.device block. Bounded by ssdpFetchTimeout and the SSRF-safe
// dialer (the resolved IP must match `expectedIP` — devices sometimes
// advertise the LOCATION under a different IP they're multi-homed on,
// which we refuse to chase across hosts).
func fetchSSDPDeviceDescription(ctx context.Context, location, expectedIP, server string) (ssdpDevice, bool) {
	fctx, cancel := context.WithTimeout(ctx, ssdpFetchTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(fctx, http.MethodGet, location, nil)
	if err != nil {
		return ssdpDevice{}, false
	}
	req.Header.Set("User-Agent", "HOPS-Discovery/1.0")
	resp, err := httpClient(ssdpFetchTimeout).Do(req)
	if err != nil {
		return ssdpDevice{}, false
	}
	defer resp.Body.Close()

	// Refuse to chase a LOCATION whose host doesn't match the SSDP
	// responder. Limits the damage if a hostile responder tries to
	// point us at an arbitrary internal IP.
	if u := req.URL; u != nil {
		if host, _, err := net.SplitHostPort(u.Host); err == nil {
			if host != expectedIP {
				return ssdpDevice{}, false
			}
		}
	}

	// Cap the XML at 64 KB — device-description docs are normally
	// 1-4 KB; anything larger is either pathological or a trap.
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil || len(body) == 0 {
		return ssdpDevice{}, false
	}
	dev := parseSSDPDeviceXML(body)
	dev.Host = expectedIP
	dev.Location = location
	dev.Server = server
	return dev, true
}

// parseSSDPDeviceXML extracts the inner <device> block fields we care
// about. Unknown elements are ignored; missing fields stay empty.
func parseSSDPDeviceXML(body []byte) ssdpDevice {
	type xmlDevice struct {
		DeviceType   string `xml:"deviceType"`
		FriendlyName string `xml:"friendlyName"`
		Manufacturer string `xml:"manufacturer"`
		ModelName    string `xml:"modelName"`
	}
	type xmlRoot struct {
		XMLName xml.Name  `xml:"root"`
		Device  xmlDevice `xml:"device"`
	}
	var r xmlRoot
	dec := xml.NewDecoder(bytes.NewReader(body))
	dec.Strict = false
	if err := dec.Decode(&r); err != nil {
		return ssdpDevice{}
	}
	return ssdpDevice{
		DeviceType:   r.Device.DeviceType,
		FriendlyName: r.Device.FriendlyName,
		Manufacturer: r.Device.Manufacturer,
		ModelName:    r.Device.ModelName,
	}
}

// ssdpSuggest picks a tile name / icon / category from a discovered
// device. The deviceType URN is the main signal; manufacturer is a
// good icon hint for well-known brands.
func ssdpSuggest(dev ssdpDevice) (name, icon, category, desc string) {
	name = dev.FriendlyName
	if name == "" {
		name = strings.TrimSpace(dev.Manufacturer + " " + dev.ModelName)
	}
	if name == "" {
		name = "UPnP device"
	}
	desc = "UPnP / SSDP discovery"
	if dev.Manufacturer != "" {
		desc = dev.Manufacturer
		if dev.ModelName != "" {
			desc += " " + dev.ModelName
		}
	}

	mfg := strings.ToLower(dev.Manufacturer)
	dt := strings.ToLower(dev.DeviceType)

	// Manufacturer-specific icons first — these are reliable.
	switch {
	case strings.Contains(mfg, "roku"):
		icon = "mdi:remote-tv"
		category = CategoryMedia
		return
	case strings.Contains(mfg, "sonos"):
		icon = "mdi:speaker"
		category = CategoryMedia
		return
	case strings.Contains(mfg, "samsung"):
		icon = "mdi:television"
		category = CategoryMedia
		return
	case strings.Contains(mfg, "lg electronics"), strings.Contains(mfg, "lge"):
		icon = "mdi:television"
		category = CategoryMedia
		return
	case strings.Contains(mfg, "philips"):
		icon = "mdi:television"
		category = CategoryMedia
		return
	case strings.Contains(mfg, "google"):
		icon = "mdi:cast"
		category = CategoryMedia
		return
	}

	// Otherwise classify by device-type URN.
	switch {
	case strings.Contains(dt, "internetgatewaydevice"):
		icon = "mdi:router-network"
		category = CategoryNetwork
	case strings.Contains(dt, "mediaserver"):
		icon = "mdi:server-network"
		category = CategoryMedia
	case strings.Contains(dt, "mediarenderer"):
		icon = "mdi:cast-audio"
		category = CategoryMedia
	case strings.Contains(dt, "printer"):
		icon = "mdi:printer"
		category = CategoryDocuments
	default:
		icon = "mdi:lan-pending"
		category = CategoryOther
	}
	return
}
