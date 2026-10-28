//go:build realcapture

package discovery

// Capture tool for testdata/real/<app>/ (see detectors_real_test.go).
// Not part of the normal test run: it needs the app running locally.
//
//	go test -tags realcapture -run TestCaptureRealApp ./internal/discovery/ \
//	  -args -app sonarr -image lscr.io/linuxserver/sonarr:latest \
//	        -port 8989 -hostport 8989 -want core/sonarr
//
// It fetches, from 127.0.0.1:<hostport> only, exactly what a scan would on
// the app's default <port>: GET / (https when the port is a TLS-expected
// one), every extra path a bundled detector on that port asks for, the
// target of a same-host root redirect (the fallback follows it) and
// /favicon.ico — all through the scanner's own httpGetProbe. Bodies are
// kept as received (up to the probe's 64 KB cap) except for redaction of
// secret-looking values and container/LAN IPs.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

var (
	capApp      = flag.String("app", "", "fixture directory name")
	capImage    = flag.String("image", "", "image:tag captured")
	capVersion  = flag.String("version", "", "app version, if known")
	capPort     = flag.Int("port", 0, "the app's default port (what the detectors see)")
	capHostPort = flag.Int("hostport", 0, "the loopback port the container is published on")
	capWant     = flag.String("want", "", "detector id that should fire")
	capNotes    = flag.String("notes", "", "free-text notes")
)

var (
	// Values that must not land in the repo. The key/name part is kept so
	// the shape stays real; only the value is replaced.
	redactValue = []*regexp.Regexp{
		regexp.MustCompile(`(?i)((?:api_?key|csrf[a-z_-]*|xsrf[a-z_-]*|token|nonce|secret|session)["']?\s*[:=]\s*["'])([^"']{6,})(["'])`),
		regexp.MustCompile(`(?i)(name=["'][^"']*(?:csrf|token)[^"']*["'][^>]*?value=["'])([^"']+)(["'])`),
		regexp.MustCompile(`(?i)(name=["'][^"']*(?:csrf|token)[^"']*["'][^>]*?content=["'])([^"']+)(["'])`),
		regexp.MustCompile(`(?i)(nonce=["'])([^"']+)(["'])`),
	}
	privateIP = regexp.MustCompile(`\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b`)
)

func redact(b []byte) []byte {
	// The loopback port the container was published on is an artefact
	// of the capture; the app itself is on its default port.
	if *capHostPort != *capPort {
		for _, h := range []string{"127.0.0.1:", "localhost:"} {
			b = bytes.ReplaceAll(b, []byte(h+strconv.Itoa(*capHostPort)), []byte(h+strconv.Itoa(*capPort)))
		}
	}
	for _, re := range redactValue {
		b = re.ReplaceAll(b, []byte("${1}REDACTED${3}"))
	}
	return privateIP.ReplaceAll(b, []byte("192.0.2.1"))
}

func redactHeader(k, v string) string {
	switch k {
	case "set-cookie":
		name, _, _ := strings.Cut(v, "=")
		_, attrs, _ := strings.Cut(v, ";")
		if attrs != "" {
			return name + "=REDACTED;" + attrs
		}
		return name + "=REDACTED"
	case "expires", "last-modified":
		return v // harmless
	}
	return string(redact([]byte(v)))
}

// bodyFileName names a body by its content, so the many identical 404
// pages a port-80 app returns for other detectors' paths share one file.
func bodyFileName(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:6])
}

func TestCaptureRealApp(t *testing.T) {
	if *capApp == "" || *capPort == 0 || *capHostPort == 0 {
		t.Skip("needs -app, -port, -hostport")
	}
	ctx := context.Background()
	tlsOn := isTLSExpectedPort(*capPort)
	paths := map[string]bool{"/": true, "/favicon.ico": true}
	for _, d := range coreDetectors() {
		hp := d.(httpFingerprintDetector)
		for _, p := range hp.ports {
			if p == *capPort {
				for _, path := range hp.paths {
					paths[path] = true
				}
			}
		}
	}
	fetch := func(path string) (*HTTPSnapshot, error) {
		return httpGetProbe(ctx, "127.0.0.1", *capHostPort, path, tlsOn, 5*time.Second)
	}
	plain := false
	if _, err := fetch("/"); err != nil && tlsOn {
		// Same fallback as the scan's root fetch (Orchestrator.probeHost).
		tlsOn, plain = false, true
	}
	if root, err := fetch("/"); err == nil && root.Status >= 300 && root.Status < 400 {
		if loc := localRedirectPath(root.Headers["location"], "127.0.0.1", *capHostPort); loc != "" {
			paths[loc] = true
		}
	}

	dir := filepath.Join(realFixtureDir, *capApp)
	_ = os.RemoveAll(dir) // never leave an old capture standing in for a new one
	if err := os.MkdirAll(filepath.Join(dir, "bodies"), 0o755); err != nil {
		t.Fatal(err)
	}
	c := realCapture{App: *capApp, Image: *capImage, Version: *capVersion,
		Captured: time.Now().UTC().Format("2006-01-02"), Port: *capPort, Want: *capWant,
		Notes: *capNotes, PlainHTTP: plain, Paths: map[string]realResponse{}}
	keys := make([]string, 0, len(paths))
	for p := range paths {
		keys = append(keys, p)
	}
	sort.Strings(keys)
	for _, path := range keys {
		s, err := fetch(path)
		if err != nil {
			msg := err.Error()
			// The loopback port is an artefact of the capture, not the app.
			msg = strings.ReplaceAll(msg, net.JoinHostPort("127.0.0.1", strconv.Itoa(*capHostPort)), "127.0.0.1:"+strconv.Itoa(*capPort))
			c.Paths[path] = realResponse{Error: msg}
			continue
		}
		r := realResponse{Status: s.Status, Headers: map[string]string{}, TLSCN: s.TLSCertCN, TLSSANs: s.TLSCertSANs}
		for k, v := range s.Headers {
			if k == "date" {
				continue // changes every capture; no detector reads it
			}
			r.Headers[k] = redactHeader(k, v)
		}
		if len(s.Body) > 0 {
			body := s.Body
			if path != "/favicon.ico" || !strings.HasPrefix(s.Headers["content-type"], "image/") {
				body = redact(body)
			} else if s.Status == 200 && len(body) >= 32 {
				h := faviconHashOf(body[:min(len(body), faviconReadCap)])
				c.Favicon = &h
			}
			name := bodyFileName(body)
			if err := os.WriteFile(filepath.Join(dir, "bodies", name), body, 0o644); err != nil {
				t.Fatal(err)
			}
			r.Body = name
		}
		c.Paths[path] = r
		t.Logf("%s -> %d (%d bytes)", path, s.Status, len(s.Body))
	}
	out, _ := json.MarshalIndent(c, "", "  ")
	if err := os.WriteFile(filepath.Join(dir, "capture.json"), append(out, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
}
