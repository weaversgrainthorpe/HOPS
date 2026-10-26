package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// Route audit (design/security/v3-security-assurance.md §2): the regression
// guard for every future route. Every pattern registered through Router.handle
// must be classified below, with a reason. The test fails when
//
//   - a registered route is not classified (add it to routeClasses),
//   - a classified route is no longer registered (remove or fix the row),
//   - a protected route answers an anonymous request with anything but 401,
//     for any method,
//   - a state-changing method on a protected route is accepted with a session
//     but no CSRF token (must be 403),
//   - a public route answers an anonymous state-changing request with success
//     (it must be classified csrfExempt, with a reason, to do that).

type routeClass int

const (
	// classPublic: reachable without a session. Read-only: GET (and HEAD).
	classPublic routeClass = iota
	// classProtected: wrapped by Router.protected (admin session + CSRF on
	// state-changing methods) for every method.
	classProtected
	// classCSRFExempt: reachable without a session AND accepts a
	// state-changing method without a CSRF token.
	classCSRFExempt
)

func (c routeClass) String() string {
	return [...]string{"public", "protected", "csrf-exempt"}[c]
}

type routeRule struct {
	class  routeClass
	reason string
	// protectedMethods: for a public route that also accepts admin-only
	// methods (split at registration by Router.publicRead, which sends them
	// through Router.protected), the methods that must behave as protected:
	// 401 anonymous, 403 without CSRF.
	protectedMethods []string
}

var routeClasses = map[string]routeRule{
	// ---- public ----
	"/api/health":           {class: classPublic, reason: "liveness probe for the container/monitoring; no data"},
	"/api/version":          {class: classPublic, reason: "build version shown on the login page and in the footer"},
	"/api/config":           {class: classPublic, reason: "dashboards are public to view (SECURITY.md); serves dashboard content only, GET only"},
	"/api/status/":          {class: classPublic, reason: "tile status dots for viewers on public dashboards; keyed by random entry ids"},
	"/api/auth/check":       {class: classPublic, reason: "tells the SPA whether the caller holds a session; reveals nothing else"},
	"/api/icon-categories":  {class: classPublic, reason: "icon picker data for public rendering; POST (create) goes through protected via publicRead", protectedMethods: []string{"POST"}},
	"/api/icons":            {class: classPublic, reason: "icon list needed to render tiles; POST goes through protected via publicRead", protectedMethods: []string{"POST"}},
	"/icons/":               {class: classPublic, reason: "uploaded icon files rendered in tiles (served with a sandboxing CSP)"},
	"/api/icons/dashboard/": {class: classPublic, reason: "bundled dashboard-icons set rendered in tiles (sandboxing CSP)"},
	"/api/backgrounds":      {class: classPublic, reason: "GET lists backgrounds for rendering; POST (upload) goes through protected via publicRead", protectedMethods: []string{"POST"}},
	"/backgrounds/":         {class: classPublic, reason: "uploaded background images rendered on dashboards (sandboxing CSP)"},
	"/presets/":             {class: classPublic, reason: "bundled preset background images"},
	"/":                     {class: classPublic, reason: "the embedded SPA shell and its static assets"},

	// ---- csrf-exempt ----
	"/api/auth/login": {class: classCSRFExempt, reason: "no session exists yet, so there is no CSRF token to double-submit; rate-limited"},

	// ---- protected ----
	"/api/dashboards":              {class: classProtected, reason: "dashboard create/list (admin)"},
	"/api/dashboards/":             {class: classProtected, reason: "dashboard read/save/delete and tile operations (admin)"},
	"/api/auth/logout":             {class: classProtected, reason: "ends the admin session"},
	"/api/auth/change-password":    {class: classProtected, reason: "changes the admin password"},
	"/api/config/export":           {class: classProtected, reason: "exports the full config (admin)"},
	"/api/config/import":           {class: classProtected, reason: "replaces the config (admin)"},
	"/api/config/reset":            {class: classProtected, reason: "wipes the config (admin)"},
	"/api/notices/":                {class: classProtected, reason: "dismisses one-time admin notices"},
	"/api/backups":                 {class: classProtected, reason: "list/create backups (admin)"},
	"/api/backups/":                {class: classProtected, reason: "download/restore/delete/upload/cleanup backups (admin)"},
	"/api/settings":                {class: classProtected, reason: "lists app settings (admin)"},
	"/api/upload-limits":           {class: classProtected, reason: "upload size limits for the admin UI"},
	"/api/settings/":               {class: classProtected, reason: "updates one app setting (admin)"},
	"/api/logs":                    {class: classProtected, reason: "recent server log lines (admin; may hold internal addresses)"},
	"/api/dead-links":              {class: classProtected, reason: "dead-link report: tile names, paths and addresses that keep failing (admin)"},
	"/api/discovery/scans":         {class: classProtected, reason: "network discovery scans: list/start (admin)"},
	"/api/discovery/scans/":        {class: classProtected, reason: "network discovery scan results/cancel (admin)"},
	"/api/discovery/detectors":     {class: classProtected, reason: "discovery detectors: list/create (admin)"},
	"/api/discovery/detectors/":    {class: classProtected, reason: "discovery detector read/update/delete/reset (admin)"},
	"/api/discovery/diagnostics":   {class: classProtected, reason: "discovery diagnostics (admin)"},
	"/api/discovery/suggest-cidr":  {class: classProtected, reason: "reveals the server's network layout (admin)"},
	"/api/icon-categories/":        {class: classProtected, reason: "icon category writes (admin)"},
	"/api/icons/upload":            {class: classProtected, reason: "uploads an icon (admin)"},
	"/api/icons/usage":             {class: classProtected, reason: "where each icon is used (admin)"},
	"/api/icons/packaged":          {class: classProtected, reason: "packaged icon counts (admin)"},
	"/api/icons/":                  {class: classProtected, reason: "icon update/delete (admin)"},
	"/api/backgrounds/categories":  {class: classProtected, reason: "background categories (admin)"},
	"/api/backgrounds/categories/": {class: classProtected, reason: "background category writes (admin)"},
	"/api/backgrounds/":            {class: classProtected, reason: "background update/delete (admin)"},
}

// sentinelProbes are concrete sub-paths (sentinels and item routes) that must
// stay protected even though they match a trailing-slash pattern. Shared with
// TestSmokeUnauthenticatedRoutesReject so there is one list, not two.
var sentinelProbes = [][2]string{
	{"GET", "/api/auth/logout"},
	{"GET", "/api/auth/change-password"},
	{"GET", "/api/config/export"},
	{"GET", "/api/backups"},
	{"GET", "/api/backups/cleanup"},
	{"GET", "/api/backups/upload"},
	{"GET", "/api/backups/hops-backup-2026-01-01_00-00-00_manual.db"},
	{"GET", "/api/settings"},
	{"GET", "/api/logs"},
	{"GET", "/api/dead-links"},
	{"GET", "/api/icons/usage"},
	{"GET", "/api/icons/packaged"},
	{"GET", "/api/discovery/scans"},
	{"GET", "/api/discovery/detectors"},
	{"GET", "/api/discovery/diagnostics"},
	{"GET", "/api/notices/layered-status-checks-v4/dismiss"},
	{"DELETE", "/api/backups/pending-restore"},
	{"POST", "/api/backups/upload"},
	{"POST", "/api/backups/cleanup"},
	{"DELETE", "/api/backups/hops-backup-2026-01-01_00-00-00_manual.db"},
	{"POST", "/api/icons/upload"},
	{"PUT", "/api/icons/some-icon"},
	{"DELETE", "/api/icons/some-icon"},
	{"POST", "/api/icon-categories"},
	{"PUT", "/api/icon-categories/some-cat"},
	{"DELETE", "/api/icon-categories/some-cat"},
}

var allMethods = []string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"}

func isStateChanging(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	}
	return true
}

// concretePath turns a mux pattern into a request path that it matches.
func concretePath(pattern string) string {
	if pattern != "/" && strings.HasSuffix(pattern, "/") {
		return pattern + "audit-probe"
	}
	return pattern
}

func TestRouteAudit(t *testing.T) {
	rt, h, _ := setupTestRouterInDir(t, t.TempDir())
	session, csrf := loginTestUserWithCSRF(t, h)

	registered := map[string]bool{}
	for _, p := range rt.routes {
		if registered[p] {
			t.Errorf("route %q is registered twice", p)
		}
		registered[p] = true
	}

	var unclassified, stale []string
	for p := range registered {
		if _, ok := routeClasses[p]; !ok {
			unclassified = append(unclassified, p)
		}
	}
	for p := range routeClasses {
		if !registered[p] {
			stale = append(stale, p)
		}
	}
	sort.Strings(unclassified)
	sort.Strings(stale)
	if len(unclassified) > 0 {
		t.Errorf("registered but NOT classified in routeClasses (decide public / protected / csrf-exempt, with a reason): %v", unclassified)
	}
	if len(stale) > 0 {
		t.Errorf("classified in routeClasses but no longer registered (remove or fix the row): %v", stale)
	}

	serve := func(method, path string, withSession, withCSRF bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(""))
		if withSession {
			c := "hops_session=" + session
			if withCSRF {
				c += "; hops_csrf=" + csrf
				req.Header.Set("X-CSRF-Token", csrf)
			}
			req.Header.Set("Cookie", c)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w
	}
	// checkProtected: 401 anonymously, 403 with session but no CSRF token
	// (state-changing methods only).
	checkProtected := func(t *testing.T, label, method, path string) {
		if w := serve(method, path, false, false); w.Code != http.StatusUnauthorized {
			t.Errorf("%s: %s %s without a session returned %d, want 401", label, method, path, w.Code)
		}
		if isStateChanging(method) {
			if w := serve(method, path, true, false); w.Code != http.StatusForbidden {
				t.Errorf("%s: %s %s with a session but NO CSRF token returned %d, want 403", label, method, path, w.Code)
			}
		}
	}

	counts := map[routeClass]int{}
	for p := range registered {
		rule, ok := routeClasses[p]
		if !ok {
			continue
		}
		counts[rule.class]++
		if strings.TrimSpace(rule.reason) == "" {
			t.Errorf("route %q has no reason", p)
		}
		path := concretePath(p)
		// The probe path must resolve to this very pattern, or the route is
		// shadowed and the checks below would test something else.
		if _, got := rt.mux.Handler(httptest.NewRequest("GET", path, nil)); got != p && !strings.HasPrefix(got, "GET ") {
			t.Errorf("route %q is shadowed: %s resolves to %q", p, path, got)
			continue
		}
		switch rule.class {
		case classProtected:
			for _, m := range allMethods {
				checkProtected(t, "protected "+p, m, path)
			}
		case classPublic, classCSRFExempt:
			for _, m := range rule.protectedMethods {
				checkProtected(t, "public "+p+" admin method", m, path)
			}
			if rule.class == classPublic && strings.HasPrefix(p, "/api/") {
				// Public API routes are read-only: an anonymous state-changing
				// request must not succeed (the others only serve static files).
				admin := map[string]bool{}
				for _, m := range rule.protectedMethods {
					admin[m] = true
				}
				for _, m := range allMethods {
					if !isStateChanging(m) || admin[m] {
						continue
					}
					if w := serve(m, path, false, false); w.Code < 400 {
						t.Errorf("public %s: anonymous %s returned %d; a public route must be read-only (or classify it csrf-exempt with a reason)", p, m, w.Code)
					}
				}
			}
		}
	}

	// Concrete sentinel/item paths stay protected and resolve to a protected
	// pattern.
	for _, pr := range sentinelProbes {
		_, pat := rt.mux.Handler(httptest.NewRequest(pr[0], pr[1], nil))
		r, ok := routeClasses[pat]
		splitGuarded := false
		for _, m := range r.protectedMethods {
			splitGuarded = splitGuarded || m == pr[0]
		}
		if !ok || (r.class != classProtected && !splitGuarded) {
			t.Errorf("probe %s %s resolves to %q, which is not a protected route", pr[0], pr[1], pat)
			continue
		}
		if w := serve(pr[0], pr[1], false, false); w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s anonymous request returned %d, expected 401", pr[0], pr[1], w.Code)
		}
	}

	t.Log(fmt.Sprintf("routes: %d public, %d protected, %d csrf-exempt",
		counts[classPublic], counts[classProtected], counts[classCSRFExempt]))
}

// TestRoutesRegisterThroughHandle keeps the audit honest: a route added with
// r.mux.HandleFunc/Handle directly would bypass the registry, and so the audit.
func TestRoutesRegisterThroughHandle(t *testing.T) {
	re := regexp.MustCompile(`\bmux\.(HandleFunc|Handle)\(`)
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for i, line := range strings.Split(string(src), "\n") {
			if re.MatchString(line) && !(f == "router.go" && strings.Contains(line, "r.mux.HandleFunc(pattern, h)")) {
				t.Errorf("%s:%d registers a route directly on the mux; use r.handle so the route audit sees it: %s", f, i+1, strings.TrimSpace(line))
			}
		}
	}
}
