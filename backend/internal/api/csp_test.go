package api

import (
	"crypto/sha256"
	"encoding/base64"

	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Browser security headers (v3-security-assurance.md §4).

var wantSecurityHeaders = map[string]string{
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options":        "SAMEORIGIN",
	"Referrer-Policy":        "same-origin",
}

// checkAppCSP asserts the deliberate shape of the app CSP.
func checkAppCSP(t *testing.T, label, csp string) {
	t.Helper()
	dirs := map[string]string{}
	for _, d := range strings.Split(csp, ";") {
		f := strings.Fields(d)
		if len(f) > 0 {
			dirs[f[0]] = strings.Join(f[1:], " ")
		}
	}
	want := map[string]string{
		"default-src":     "'self'",
		"img-src":         "'self' data: http: https:",
		"connect-src":     "'self' https://api.iconify.design https://api.simplesvg.com https://api.unisvg.com",
		"frame-src":       "http: https:",
		"frame-ancestors": "'self'",
		"object-src":      "'none'",
		"base-uri":        "'self'",
		"form-action":     "'self'",
	}
	for k, v := range want {
		if dirs[k] != v {
			t.Errorf("%s: CSP %s = %q, want %q (full: %s)", label, k, dirs[k], v, csp)
		}
	}
	script := dirs["script-src"]
	if !regexp.MustCompile(`^'self'( 'sha256-[A-Za-z0-9+/]+=*')*$`).MatchString(script) {
		t.Errorf("%s: script-src %q must be 'self' plus inline-script hashes only (no unsafe-inline/eval)", label, script)
	}
}

func TestSecurityHeadersOnRepresentativeRoutes(t *testing.T) {
	_, h, _ := setupTestRouterInDir(t, t.TempDir())
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/health"},           // public API
		{"GET", "/api/config"},           // public API, dashboard content
		{"GET", "/api/icons"},            // public read of a split route
		{"POST", "/api/icons"},           // its guarded write (401)
		{"GET", "/api/settings"},         // protected (401)
		{"GET", "/"},                     // SPA page
		{"GET", "/some/dashboard/route"}, // SPA fallback
	} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		label := tc.method + " " + tc.path
		for name, v := range wantSecurityHeaders {
			if got := w.Header().Get(name); got != v {
				t.Errorf("%s: %s = %q, want %q", label, name, got, v)
			}
		}
		if pp := w.Header().Get("Permissions-Policy"); !strings.Contains(pp, "camera=()") || !strings.Contains(pp, "microphone=()") || !strings.Contains(pp, "geolocation=()") {
			t.Errorf("%s: Permissions-Policy = %q", label, pp)
		}
		checkAppCSP(t, label, w.Header().Get("Content-Security-Policy"))
	}
}

// Uploaded assets keep the stricter sandbox CSP.
func TestAssetRoutesKeepSandboxCSP(t *testing.T) {
	_, h, _ := setupTestRouterInDir(t, t.TempDir())
	for _, p := range []string{"/icons/x.svg", "/backgrounds/x.png", "/presets/x.png", "/api/icons/dashboard/x.svg"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", p, nil))
		csp := w.Header().Get("Content-Security-Policy")
		if !strings.Contains(csp, "sandbox") || !strings.Contains(csp, "default-src 'none'") {
			t.Errorf("%s: CSP %q, want the sandbox asset policy", p, csp)
		}
		if w.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("%s: missing nosniff", p)
		}
	}
}

func cspHash(s string) string {
	sum := sha256.Sum256([]byte(s))
	return "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
}

func TestAppCSPHashesInlineScripts(t *testing.T) {
	body := "\n\t\t\t{ boot(); }\n\t\t"
	html := `<html><head><script src="/x.js"></script><script type="module" src="/y.js"></script></head>` +
		`<body><script>` + body + `</script></body></html>`
	csp := appContentSecurityPolicy([]byte(html))
	checkAppCSP(t, "hashed", csp)
	if !strings.Contains(csp, "script-src 'self' "+cspHash(body)+";") {
		t.Errorf("CSP lacks exactly the inline script's hash: %s", csp)
	}
	if strings.Count(csp, "sha256-") != 1 {
		t.Errorf("external scripts must not be hashed: %s", csp)
	}
}

// Every write goes through the standard protected wrapper at registration:
// no handler may gate a method by calling r.protected itself.
func TestNoInlineProtectedGates(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	inline := regexp.MustCompile(`r\.protected\([^)]*\)\(w, req\)`)
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for i, line := range strings.Split(string(src), "\n") {
			if inline.MatchString(line) {
				t.Errorf("%s:%d gates a method inline; register the write through r.protected/r.publicRead instead: %s", f, i+1, strings.TrimSpace(line))
			}
		}
	}
}
