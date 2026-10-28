package discovery

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/assets"
)

// Fingerprint fixtures for the bundled detectors. Every fixture is a
// synthetic host (TEST-NET-1, 192.0.2.0/24) serving hand-written,
// minimal responses shaped like the real app's — never captured from a
// real network.
//
// Each fixture runs EVERY bundled detector and asserts the exact set
// that fires. That one rule covers both directions: the positive case
// (the right detector fires) and the look-alike case (no neighbour on
// the same port fires too — Emby vs Jellyfin, Jellyseerr vs Overseerr,
// the many apps on 3000 / 5000 / 8080).

const fxHost = "192.0.2.10"

type fxResp struct {
	status  int
	headers map[string]string
	body    string
}

func (r fxResp) snap() *HTTPSnapshot {
	h := map[string]string{}
	for k, v := range r.headers {
		h[strings.ToLower(k)] = v
	}
	st := r.status
	if st == 0 {
		st = 200
	}
	return &HTTPSnapshot{Status: st, Headers: h, Body: []byte(r.body)}
}

type fixture struct {
	name  string
	port  int
	root  fxResp
	paths map[string]fxResp // extra paths on the same port
	want  string            // detector id that must fire, "" for none
}

// probeFor builds a Probe whose HTTP() serves the fixture's paths and a
// verbose 404 (echoing the path, like many real servers) for the rest.
func probeFor(f fixture) *Probe {
	return &Probe{
		Host:          fxHost,
		OpenPorts:     []int{f.port},
		HTTPResponses: map[int]*HTTPSnapshot{f.port: f.root.snap()},
		HTTP: func(_ context.Context, port int, path string) (*HTTPSnapshot, error) {
			if port == f.port {
				if r, ok := f.paths[path]; ok {
					return r.snap(), nil
				}
			}
			return &HTTPSnapshot{Status: 404, Headers: map[string]string{},
				Body: []byte("<html><body>404 Not Found: " + path + "</body></html>")}, nil
		},
	}
}

func firing(t *testing.T, f fixture) (ids []string, hits map[string]EmittedHit) {
	t.Helper()
	hits = map[string]EmittedHit{}
	p := probeFor(f)
	for _, d := range coreDetectors() {
		for _, h := range d.Run(context.Background(), p) {
			ids = append(ids, d.ID())
			hits[d.ID()] = h
		}
	}
	sort.Strings(ids)
	return ids, hits
}

func html(title, extra string) string {
	return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>" + title +
		"</title></head><body>" + extra + "<div id=\"app\"></div></body></html>"
}

var fingerprintFixtures = []fixture{
	// ---- Already-scanned ports ----
	{name: "node-red", port: 1880, want: "core/node-red",
		root: fxResp{body: html("Node-RED", `<link rel="stylesheet" href="red/style.min.css"><script src="red/red.min.js"></script>`)}},
	{name: "node-red look-alike", port: 1880,
		root: fxResp{body: html("Flow Editor", `<script src="app.js"></script>`)}},

	{name: "couchdb", port: 5984, want: "core/couchdb",
		root: fxResp{headers: map[string]string{"Server": "CouchDB/3.3.3 (Erlang OTP/25)", "Content-Type": "application/json"},
			body: `{"couchdb":"Welcome","version":"3.3.3","git_sha":"0000000","uuid":"00000000000000000000000000000000","features":["access-ready"],"vendor":{"name":"The Apache Software Foundation"}}`},
		paths: map[string]fxResp{"/_utils/": {body: html("Project Fauxton", "")}}},
	{name: "couchdb look-alike json api", port: 5984,
		root: fxResp{headers: map[string]string{"Server": "nginx"}, body: `{"status":"ok","welcome":true}`}},

	{name: "homepage", port: 3000, want: "core/homepage",
		root: fxResp{body: `<!DOCTYPE html><html><head><title>Homepage</title><meta name="description" content="A highly customizable homepage (or startpage / application dashboard) with Docker and service API integrations."/></head><body><div id="__next"></div><script src="/_next/static/chunks/main.js"></script></body></html>`}},
	{name: "homepage look-alike: generic site titled Homepage", port: 3000,
		root: fxResp{body: html("Homepage", `<script src="/_next/static/chunks/main.js"></script>`)}},
	{name: "homepage on 7575", port: 7575, want: "core/homepage",
		root: fxResp{body: `<html><head><title>My Lab</title><meta name="description" content="A highly customizable homepage (or startpage / application dashboard) with Docker and service API integrations."/></head></html>`}},

	{name: "monit", port: 2812, want: "core/monit",
		root: fxResp{status: 401, headers: map[string]string{"Server": "monit 5.33.0", "WWW-Authenticate": `Basic realm="monit"`},
			body: `<html><head><title>401 Unauthorized</title></head><body><h2>Unauthorized</h2>You are not authorized to access monit.</body></html>`}},
	{name: "monit by server header alone", port: 2812, want: "core/monit",
		root: fxResp{status: 401, headers: map[string]string{"Server": "monit 5.26.0", "WWW-Authenticate": `Basic realm="admin"`}}},
	{name: "monit by realm alone (secondary)", port: 2812, want: "core/monit",
		root: fxResp{status: 401, headers: map[string]string{"Server": "", "WWW-Authenticate": `Basic realm="monit"`}}},
	{name: "monit look-alike: other basic-auth service", port: 2812,
		root: fxResp{status: 401, headers: map[string]string{"Server": "nginx", "WWW-Authenticate": `Basic realm="Restricted"`},
			body: `<html><head><title>401 Authorization Required</title></head><body>401</body></html>`}},

	// ---- AI ----
	{name: "open webui on 8080", port: 8080, want: "core/open-webui",
		root: fxResp{body: html("Open WebUI", `<link rel="manifest" href="/manifest.json">`)}},
	{name: "open webui on 3000", port: 3000, want: "core/open-webui",
		root: fxResp{body: html("Open WebUI", "")}},
	{name: "grafana on 3000 is not open webui", port: 3000, want: "core/grafana",
		root: fxResp{headers: map[string]string{"X-Grafana-Version": "11.0.0"}, body: html("Grafana", "")}},

	{name: "open webui look-alike on 3000", port: 3000,
		root: fxResp{body: html("Open Source Web Portal", `<p>open web ui kit</p>`)}},
	{name: "localai look-alike on 3000", port: 3000,
		root: fxResp{body: html("Local AI Notes", `<p>notes about local ai</p>`)}},

	{name: "localai", port: 8080, want: "core/localai",
		root: fxResp{body: html("LocalAI API - v2.24.2", `<h1>Welcome to your LocalAI instance!</h1>`)}},
	{name: "localai look-alike: other chat ui", port: 8080,
		root: fxResp{body: html("Local Chat", `<p>Talk to your models</p>`)}},

	{name: "stable diffusion webui", port: 7860, want: "core/sd-webui",
		root: fxResp{body: `<!doctype html><html><head><title>Stable Diffusion</title></head><body><script>window.gradio_config = {"version":"3.41.2","mode":"blocks","title":"Stable Diffusion","components":[]};</script></body></html>`}},
	{name: "sd webui look-alike: other gradio app", port: 7860,
		root: fxResp{body: `<!doctype html><html><head><title>Text generation web UI</title></head><body><script>window.gradio_config = {"version":"4.26.0","mode":"blocks","title":"Text generation web UI"};</script></body></html>`}},

	{name: "comfyui", port: 8188, want: "core/comfyui",
		root: fxResp{body: html("ComfyUI", `<script type="module" src="./assets/index.js"></script>`)}},
	{name: "comfyui look-alike", port: 8188,
		root: fxResp{body: html("Node Graph Studio", "")}},

	// ---- Smart home ----
	{name: "zigbee2mqtt", port: 8080, want: "core/zigbee2mqtt",
		root: fxResp{body: html("Zigbee2MQTT", "")}},
	{name: "zigbee2mqtt look-alike on 8080", port: 8080,
		root: fxResp{body: html("MQTT Explorer", `<p>zigbee devices over mqtt</p>`)}},
	{name: "qbittorrent on 8080 is not zigbee2mqtt", port: 8080, want: "core/qbittorrent",
		root: fxResp{body: html("qBittorrent Web UI", "")}},

	{name: "esphome", port: 6052, want: "core/esphome",
		root: fxResp{body: html("Dashboard - ESPHome", `<esphome-main></esphome-main>`)}},
	{name: "esphome look-alike", port: 6052,
		root: fxResp{body: html("Dashboard", "")}},

	{name: "scrypted https", port: 10443, want: "core/scrypted",
		root:  fxResp{status: 302, headers: map[string]string{"Location": "/endpoint/@scrypted/core/public/"}},
		paths: map[string]fxResp{"/endpoint/@scrypted/core/public/": {body: html("Scrypted", "")}}},
	{name: "scrypted http", port: 11080, want: "core/scrypted",
		root:  fxResp{status: 302, headers: map[string]string{"Location": "/endpoint/@scrypted/core/public/"}},
		paths: map[string]fxResp{"/endpoint/@scrypted/core/public/": {body: html("Scrypted", "")}}},
	{name: "scrypted look-alike: other redirect", port: 10443,
		root: fxResp{status: 302, headers: map[string]string{"Location": "/login"}}},

	{name: "homebridge", port: 8581, want: "core/homebridge",
		root: fxResp{body: html("Homebridge", `<app-root></app-root>`)}},
	{name: "homebridge look-alike", port: 8581,
		root: fxResp{body: html("Bridge Admin", "")}},

	// ---- Media ----
	{name: "emby", port: 8096, want: "core/emby",
		root: fxResp{status: 302, headers: map[string]string{"Location": "/web/index.html"}},
		paths: map[string]fxResp{
			"/web/index.html":     {body: html("Emby", `<div class="skinHeader"></div>`)},
			"/System/Info/Public": {body: `{"LocalAddress":"http://192.0.2.10:8096","ServerName":"media-a","Version":"4.8.10.0","ProductName":"Emby Server","Id":"abc"}`},
		}},
	{name: "jellyfin is not emby", port: 8096, want: "core/jellyfin",
		root: fxResp{status: 302, headers: map[string]string{"Location": "web/"}},
		paths: map[string]fxResp{
			// Jellyfin's web client still uses emby-* element names.
			"/web/index.html":     {body: html("Jellyfin", `<button is="emby-button" class="emby-button"></button>`)},
			"/System/Info/Public": {body: `{"LocalAddress":"http://192.0.2.10:8096","ServerName":"media-b","Version":"10.9.11","ProductName":"Jellyfin Server","Id":"def"}`},
		}},

	{name: "jellyseerr", port: 5055, want: "core/jellyseerr",
		root: fxResp{status: 307, headers: map[string]string{"Location": "/login"}},
		paths: map[string]fxResp{
			// A fork can carry its parent's name in a credit or asset.
			"/login": {body: html("Sign In - Jellyseerr", `<span>Based on Overseerr</span>`)},
		}},
	{name: "overseerr is not jellyseerr", port: 5055, want: "core/overseerr",
		root:  fxResp{status: 307, headers: map[string]string{"Location": "/login"}},
		paths: map[string]fxResp{"/login": {body: html("Sign In - Overseerr", "")}}},

	// Vetoes are title-only: a page merely mentioning the sibling app
	// in its body still belongs to its own detector.
	{name: "emby page mentioning jellyfin", port: 8096, want: "core/emby",
		root:  fxResp{status: 302, headers: map[string]string{"Location": "/web/index.html"}},
		paths: map[string]fxResp{"/web/index.html": {body: html("Emby", `<p>Moving from Jellyfin (jellyfin)? Import your library.</p>`)}}},
	{name: "overseerr page mentioning jellyseerr", port: 5055, want: "core/overseerr",
		root:  fxResp{status: 307, headers: map[string]string{"Location": "/login"}},
		paths: map[string]fxResp{"/login": {body: html("Sign In - Overseerr", `<p>Not Jellyseerr — see the docs.</p>`)}}},

	{name: "readarr", port: 8787, want: "core/readarr",
		root:  fxResp{body: html("Readarr", "")},
		paths: map[string]fxResp{"/login": {body: html("Login - Readarr", "")}}},
	{name: "readarr look-alike", port: 8787,
		root: fxResp{body: html("Book Shelf", "")}},

	{name: "kavita", port: 5000, want: "core/kavita",
		root: fxResp{body: html("Kavita", `<app-root></app-root>`)}},
	{name: "synology on 5000 is not kavita", port: 5000, want: "core/synology",
		root: fxResp{body: html("Synology DiskStation", "")}},

	{name: "komga", port: 25600, want: "core/komga",
		root: fxResp{body: html("Komga", "")}},
	{name: "komga look-alike", port: 25600,
		root: fxResp{body: html("Comic Reader", "")}},

	{name: "stash", port: 9999, want: "core/stash",
		root: fxResp{body: html("Stash", `<script src="/assets/index.js"></script>`)}},
	{name: "stash look-alike: title merely containing stash", port: 9999,
		root: fxResp{body: html("Filestash", "")}},

	{name: "tdarr", port: 8265, want: "core/tdarr",
		root: fxResp{body: html("Tdarr", "")}},
	{name: "tdarr look-alike", port: 8265,
		root: fxResp{body: html("Transcode Queue", "")}},

	{name: "unmanic", port: 8888, want: "core/unmanic",
		root: fxResp{body: html("Unmanic", "")}},
	{name: "unmanic look-alike: jupyter on 8888", port: 8888,
		root: fxResp{body: html("Home Page - Select or create a notebook", "")}},

	// ---- Network ----
	{name: "technitium", port: 5380, want: "core/technitium",
		root: fxResp{body: html("Technitium DNS Server", "")}},
	{name: "technitium look-alike", port: 5380,
		root: fxResp{body: html("DNS Admin", "")}},

	{name: "wg-easy", port: 51821, want: "core/wg-easy",
		root: fxResp{body: html("WireGuard", `<a href="https://github.com/wg-easy/wg-easy">GitHub</a>`)}},
	{name: "wg-easy look-alike: other wireguard page", port: 51821,
		root: fxResp{body: html("WireGuard", "")}},

	{name: "openwrt root", port: 80, want: "core/openwrt",
		root: fxResp{body: `<?xml version="1.0" encoding="utf-8"?><html><head><meta http-equiv="refresh" content="0; URL=cgi-bin/luci/" /></head><body><a href="cgi-bin/luci/">LuCI - Lua Configuration Interface</a></body></html>`}},
	{name: "openwrt login page", port: 443, want: "core/openwrt",
		root: fxResp{status: 302, headers: map[string]string{"Location": "/cgi-bin/luci/"}},
		paths: map[string]fxResp{"/cgi-bin/luci/": {status: 403,
			body: html("router-a - LuCI", `<link rel="stylesheet" href="/luci-static/bootstrap/cascade.css">`)}}},
	{name: "openwrt look-alike: 403 echoing the luci path", port: 80,
		root:  fxResp{body: html("Router", "")},
		paths: map[string]fxResp{"/cgi-bin/luci/": {status: 403, body: "<html><body>Forbidden: /cgi-bin/luci/</body></html>"}}},

	{name: "mikrotik", port: 80, want: "core/mikrotik",
		root: fxResp{body: html("RouterOS router configuration page", `<a href="/webfig/">Webfig</a>`)}},
	{name: "mikrotik look-alike", port: 80,
		root: fxResp{body: html("Router configuration", "")}},

	{name: "omada", port: 8043, want: "core/omada",
		root: fxResp{status: 302, headers: map[string]string{"Location": "/0123456789abcdef/login"}},
		paths: map[string]fxResp{"/api/info": {headers: map[string]string{"Content-Type": "application/json"},
			body: `{"errorCode":0,"msg":"Success.","result":{"controllerVer":"5.14.26.1","apiVer":"3","configured":true,"type":1,"supportApp":true,"omadacId":"0123456789abcdef0123456789abcdef"}}`}}},
	{name: "omada look-alike json", port: 8043,
		root:  fxResp{status: 302, headers: map[string]string{"Location": "/login"}},
		paths: map[string]fxResp{"/api/info": {body: `{"errorCode":0,"msg":"Success."}`}}},
}

func TestFingerprintFixtures(t *testing.T) {
	for _, f := range fingerprintFixtures {
		t.Run(f.name, func(t *testing.T) {
			ids, _ := firing(t, f)
			var want []string
			if f.want != "" {
				want = []string{f.want}
			}
			if strings.Join(ids, ",") != strings.Join(want, ",") {
				t.Fatalf("detectors fired = %v, want %v", ids, want)
			}
		})
	}
}

// The suggested URL carries the right scheme (TLS-default ports) and the
// web UI's landing path, and the hit carries the right category.
func TestFingerprintEmission(t *testing.T) {
	cases := map[string]struct{ url, cat string }{
		"couchdb":            {"http://" + fxHost + ":5984/_utils/", CategoryOther},
		"scrypted https":     {"https://" + fxHost + ":10443/", CategoryAutomation},
		"scrypted http":      {"http://" + fxHost + ":11080/", CategoryAutomation},
		"openwrt root":       {"http://" + fxHost + "/cgi-bin/luci/", CategoryNetwork},
		"omada":              {"https://" + fxHost + ":8043/", CategoryNetwork},
		"open webui on 8080": {"http://" + fxHost + ":8080/", CategoryAI},
		"comfyui":            {"http://" + fxHost + ":8188/", CategoryAI},
		"emby":               {"http://" + fxHost + ":8096/", CategoryMedia},
		"jellyseerr":         {"http://" + fxHost + ":5055/", CategoryDownloads},
	}
	seen := 0
	for _, f := range fingerprintFixtures {
		c, ok := cases[f.name]
		if !ok {
			continue
		}
		seen++
		_, hits := firing(t, f)
		h, ok := hits[f.want]
		if !ok {
			t.Fatalf("%s: %s did not fire", f.name, f.want)
		}
		if h.SuggestedURL != c.url || h.Category != c.cat {
			t.Errorf("%s: url=%q cat=%q, want url=%q cat=%q", f.name, h.SuggestedURL, h.Category, c.url, c.cat)
		}
	}
	if seen != len(cases) {
		t.Fatalf("matched %d of %d emission cases — a fixture was renamed", seen, len(cases))
	}
}

// The detectors this batch added, and the ports each one needs scanned.
var batchDetectorPorts = map[string][]int{
	"core/node-red": {1880}, "core/couchdb": {5984}, "core/homepage": {3000, 7575}, "core/monit": {2812},
	"core/open-webui": {3000, 8080}, "core/localai": {8080}, "core/sd-webui": {7860}, "core/comfyui": {8188},
	"core/zigbee2mqtt": {8080}, "core/esphome": {6052}, "core/scrypted": {10443, 11080}, "core/homebridge": {8581},
	"core/emby": {8096}, "core/jellyseerr": {5055}, "core/readarr": {8787}, "core/kavita": {5000},
	"core/komga": {25600}, "core/stash": {9999}, "core/tdarr": {8265}, "core/unmanic": {8888},
	"core/technitium": {5380}, "core/wg-easy": {51821}, "core/openwrt": {80, 443}, "core/mikrotik": {80, 443},
	"core/omada": {8043, 8088},
}

func TestBatchDetectorsCoveredByFixtures(t *testing.T) {
	if len(batchDetectorPorts) != 25 {
		t.Fatalf("batch lists %d detectors, want 25", len(batchDetectorPorts))
	}
	positive := map[string]bool{}
	for _, f := range fingerprintFixtures {
		positive[f.want] = true
	}
	byID := map[string]httpFingerprintDetector{}
	for _, d := range coreDetectors() {
		if hp, ok := d.(httpFingerprintDetector); ok {
			byID[hp.id] = hp
		}
	}
	full := map[int]bool{}
	for _, p := range fullActivePorts {
		full[p] = true
	}
	for id, ports := range batchDetectorPorts {
		d, ok := byID[id]
		if !ok {
			t.Errorf("%s: not bundled", id)
			continue
		}
		if !positive[id] {
			t.Errorf("%s: no positive fixture", id)
		}
		for _, p := range ports {
			if !full[p] {
				t.Errorf("%s: port %d missing from fullActivePorts", id, p)
			}
			found := false
			for _, dp := range d.ports {
				found = found || dp == p
			}
			if !found {
				t.Errorf("%s: port %d not in the detector's ports %v", id, p, d.ports)
			}
		}
	}
}

func TestTLSDefaultPorts(t *testing.T) {
	for _, p := range []int{10443, 8043} {
		if !isTLSExpectedPort(p) {
			t.Errorf("port %d should be TLS-expected", p)
		}
	}
	for _, p := range []int{11080, 8088, 51821, 5380, 1880} {
		if isTLSExpectedPort(p) {
			t.Errorf("port %d speaks plain HTTP by default", p)
		}
	}
}

func TestLightPortsStayInFullAndUnique(t *testing.T) {
	full := map[int]bool{}
	for _, p := range fullActivePorts {
		full[p] = true
	}
	seen := map[int]bool{}
	for _, p := range lightActivePorts {
		if seen[p] {
			t.Errorf("light port %d listed twice", p)
		}
		seen[p] = true
	}
	for _, p := range []int{1880, 6052, 8581} {
		if !seen[p] {
			t.Errorf("light scan should include %d", p)
		}
		if !full[p] {
			t.Errorf("light port %d missing from full", p)
		}
	}
}

func TestHeaderValueSignature(t *testing.T) {
	d := httpFingerprintDetector{headerKeys: []string{"server: CouchDB/"}}
	if !d.matches(&HTTPSnapshot{Headers: map[string]string{"server": "couchdb/3.3.3"}}) {
		t.Error("header value match should be case-insensitive")
	}
	if d.matches(&HTTPSnapshot{Headers: map[string]string{"server": "nginx"}}) {
		t.Error("header present with the wrong value must not match")
	}
	plain := httpFingerprintDetector{headerKeys: []string{"x-plex-protocol"}}
	if !plain.matches(&HTTPSnapshot{Headers: map[string]string{"x-plex-protocol": "1.0"}}) {
		t.Error("a bare header key still matches on presence")
	}
}

func TestExcludeTitleVetoesMatch(t *testing.T) {
	d := httpFingerprintDetector{titleContains: []string{"Overseerr"}, bodyContains: []string{"Overseerr"},
		excludeTitleContains: []string{"Jellyseerr"}}
	if d.matches(&HTTPSnapshot{Body: []byte(html("Jellyseerr", "Overseerr"))}) {
		t.Error("an excluded title should veto the match")
	}
	if !d.matches(&HTTPSnapshot{Body: []byte(html("Overseerr", "migrating from Jellyseerr"))}) {
		t.Error("the excluded word in the body (not the title) must not veto")
	}
}

// ---- Catalogue invariants ----

func TestCategoryAIExistsAndSorts(t *testing.T) {
	if !IsValidCategory("ai") || CategoryAI != "ai" {
		t.Fatal("ai category missing")
	}
	info := CategoryInfoFor("ai")
	if info.DisplayName != "AI" || info.Icon != "mdi:robot" {
		t.Fatalf("ai info = %+v", info)
	}
	cat := CategoryCatalogue()
	if cat[0].Slug != CategoryAI {
		t.Errorf("AI should sort first, got %q", cat[0].DisplayName)
	}
	names := make([]string, len(cat))
	for i, c := range cat {
		names[i] = strings.ToLower(c.DisplayName)
	}
	if !sort.StringsAreSorted(names) {
		t.Errorf("catalogue not alphabetical by display name: %v", names)
	}
}

// The frontend's CATEGORY_LIST mirrors the catalogue (slug, label, icon,
// order); the server rejects slugs outside it, so drift breaks the UI.
func TestFrontendCategoryListMirrorsCatalogue(t *testing.T) {
	src, err := os.ReadFile("../../../frontend/src/lib/utils/api.ts")
	if err != nil {
		t.Fatal(err)
	}
	re := regexp.MustCompile(`\{ slug: '([a-z]+)',\s*label: '([^']+)',\s*icon: '([^']+)' \}`)
	m := re.FindAllStringSubmatch(string(src), -1)
	cat := CategoryCatalogue()
	if len(m) != len(cat) {
		t.Fatalf("frontend lists %d categories, backend %d", len(m), len(cat))
	}
	for i, c := range cat {
		if m[i][1] != c.Slug || m[i][2] != c.DisplayName || m[i][3] != c.Icon {
			t.Errorf("row %d: frontend %v, backend %+v", i, m[i][1:], c)
		}
	}
}

func TestBundledDetectorsWellFormed(t *testing.T) {
	keep, err := os.ReadFile("../../../frontend/scripts/icon-keep.txt")
	if err != nil {
		t.Fatal(err)
	}
	kept := map[string]bool{}
	for _, l := range strings.Split(string(keep), "\n") {
		if l = strings.TrimSpace(l); l != "" && !strings.HasPrefix(l, "#") {
			kept[l] = true
		}
	}
	ids := map[string]bool{}
	for _, d := range coreDetectors() {
		hp := d.(httpFingerprintDetector)
		if ids[hp.id] {
			t.Errorf("duplicate detector id %s", hp.id)
		}
		ids[hp.id] = true
		if !IsValidCategory(hp.category) {
			t.Errorf("%s: unknown category %q", hp.id, hp.category)
		}
		if strings.Contains(hp.icon, ":") {
			// Iconify names must be in the offline bundle's keep-list.
			if !kept[hp.icon] {
				t.Errorf("%s: iconify icon %q not in frontend/scripts/icon-keep.txt", hp.id, hp.icon)
			}
		} else if _, err := fs.Stat(assets.DashboardIcons, "dashboard-icons/"+hp.icon+".svg"); err != nil {
			t.Errorf("%s: dashboard icon %q not bundled", hp.id, hp.icon)
		}
	}
}

// ---- Per-probe HTTP cache ----

type countingFetch struct {
	calls map[string]int
	fail  bool
}

func (c *countingFetch) fetch(_ context.Context, port int, path string, tlsOn bool) (*HTTPSnapshot, error) {
	c.calls[path]++
	if c.fail {
		return nil, errors.New("connection reset")
	}
	if path == "/web/index.html" {
		return &HTTPSnapshot{Status: 200, Headers: map[string]string{}, Body: []byte(html("Emby", ""))}, nil
	}
	return &HTTPSnapshot{Status: 404, Headers: map[string]string{}, Body: []byte("not found")}, nil
}

// Emby and Jellyfin both try /web/index.html on 8096: one fetch serves both.
func TestProbeHTTPCacheOneFetchPerPath(t *testing.T) {
	cf := &countingFetch{calls: map[string]int{}}
	p := &Probe{
		Host:      fxHost,
		OpenPorts: []int{8096},
		HTTPResponses: map[int]*HTTPSnapshot{8096: {Status: 302,
			Headers: map[string]string{"location": "/web/index.html"}}},
		HTTP: cachedProbeHTTP(cf.fetch, isTLSExpectedPort),
	}
	for _, d := range coreDetectors() {
		if d.ID() == "core/emby" || d.ID() == "core/jellyfin" {
			d.Run(context.Background(), p)
		}
	}
	if n := cf.calls["/web/index.html"]; n != 1 {
		t.Fatalf("/web/index.html fetched %d times, want 1", n)
	}
}

// A failed fetch is remembered as a failure (never as an empty success)
// and isn't retried within the same probe.
func TestProbeHTTPCacheKeepsFailure(t *testing.T) {
	cf := &countingFetch{calls: map[string]int{}, fail: true}
	get := cachedProbeHTTP(cf.fetch, isTLSExpectedPort)
	for i := 0; i < 2; i++ {
		snap, err := get(context.Background(), 8096, "/x")
		if err == nil || snap != nil {
			t.Fatalf("call %d: snap=%v err=%v, want the failure", i, snap, err)
		}
	}
	if cf.calls["/x"] != 1 {
		t.Fatalf("failed path fetched %d times, want 1", cf.calls["/x"])
	}
	// Different port or path is a different key.
	_, _ = get(context.Background(), 8097, "/x")
	_, _ = get(context.Background(), 8096, "/y")
	if cf.calls["/x"] != 2 || cf.calls["/y"] != 1 {
		t.Fatalf("calls = %v", cf.calls)
	}
	// A fresh probe (new cache) fetches again.
	_, _ = cachedProbeHTTP(cf.fetch, isTLSExpectedPort)(context.Background(), 8096, "/x")
	if cf.calls["/x"] != 3 {
		t.Fatalf("a new probe should not see the old probe's failure: %v", cf.calls)
	}
}
