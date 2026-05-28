package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestSmokeRoutesNoFiveHundred is the route-walker safety net. For each
// registered API endpoint, it sends a representative request as an
// authenticated user and asserts the response is not a 5xx. This
// catches the class of bugs unit tests miss:
//
//   - Route shadowing (a specific route eclipsed by a generic prefix).
//   - Helper return-shape mismatches (handler reads a field that
//     doesn't exist, NPEs).
//   - Forgotten imports / dependencies (handlers that compile fine but
//     panic on first call because a sub-package failed to register).
//   - Missing nil checks when a freshly-installed DB has no rows yet.
//
// The test is deliberately broad and shallow — we don't assert on body
// content, just that the response code is sane. Add a unit test if you
// care about behaviour beyond "doesn't 500".
//
// When adding a new route, list it here. If you don't, the test won't
// notice — that's by design (we can't reflect mux's internal routing
// table without taping over Go's stdlib). The cost of forgetting one
// entry is small; the benefit of explicit coverage is big.
func TestSmokeRoutesNoFiveHundred(t *testing.T) {
	router, _ := setupTestRouter(t)
	sessionToken, csrfToken := loginTestUserWithCSRF(t, router)

	type routeProbe struct {
		method string
		path   string
		body   string // request body (JSON) for mutation methods; empty for GETs
		// expectMaxStatus is the highest non-5xx response code we'll
		// accept. Defaults to 499 (any 4xx is fine — bad input / not
		// found are expected; what we're guarding against is 5xx).
		expectMaxStatus int
	}

	// Representative probes for every route registered in router.go.
	// Trailing-slash routes get a dummy ID; mutation routes get
	// minimal bodies that should fail validation (4xx) rather than
	// panic the handler (5xx).
	probes := []routeProbe{
		// Public / health.
		{method: "GET", path: "/api/health"},
		{method: "GET", path: "/api/version"},
		{method: "GET", path: "/api/auth/check"},

		// Config.
		{method: "GET", path: "/api/config"},
		{method: "POST", path: "/api/config/export"},
		{method: "POST", path: "/api/config/import", body: `{"data":{}}`},
		{method: "POST", path: "/api/config/reset"},

		// Backups.
		{method: "GET", path: "/api/backups"},
		{method: "GET", path: "/api/backups/nonexistent-backup-id"},

		// Settings.
		{method: "GET", path: "/api/settings"},
		{method: "PUT", path: "/api/settings/discovery.max_parallel_probes", body: `{"value":"64"}`},

		// Discovery — scans.
		{method: "GET", path: "/api/discovery/scans"},
		{method: "POST", path: "/api/discovery/scans", body: `{"cidr":"10.10.0.0/24","intensity":"passive"}`},
		{method: "GET", path: "/api/discovery/scans/does-not-exist"},
		{method: "GET", path: "/api/discovery/suggest-cidr"},

		// Discovery — detectors.
		{method: "GET", path: "/api/discovery/detectors"},
		{method: "GET", path: "/api/discovery/detectors/core/pihole"},
		{method: "GET", path: "/api/discovery/detectors/user/does-not-exist"},
		{method: "POST", path: "/api/discovery/detectors", body: `{"name":"smoke-test","ports":[12345],"bodyContains":["smoke"]}`},
		{method: "POST", path: "/api/discovery/detectors/reset-bundled"},

		// Discovery — diagnostics.
		{method: "GET", path: "/api/discovery/diagnostics"},

		// Icons + categories.
		{method: "GET", path: "/api/icon-categories"},
		{method: "GET", path: "/api/icons"},

		// Backgrounds.
		{method: "GET", path: "/api/backgrounds"},
		{method: "GET", path: "/api/backgrounds/categories"},

		// Static asset routes — request a non-existent file. Should
		// 404, not 500.
		{method: "GET", path: "/icons/nonexistent.svg"},
		{method: "GET", path: "/api/icons/dashboard/nonexistent.svg"},
		{method: "GET", path: "/backgrounds/nonexistent.png"},
		{method: "GET", path: "/presets/nonexistent.json"},
	}

	for _, p := range probes {
		t.Run(p.method+" "+p.path, func(t *testing.T) {
			var body *strings.Reader
			if p.body != "" {
				body = strings.NewReader(p.body)
			} else {
				body = strings.NewReader("")
			}
			req := httptest.NewRequest(p.method, p.path, body)
			req.Header.Set("Cookie", "hops_session="+sessionToken+"; hops_csrf="+csrfToken)
			req.Header.Set("X-CSRF-Token", csrfToken)
			if p.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			maxStatus := p.expectMaxStatus
			if maxStatus == 0 {
				maxStatus = 499
			}
			if w.Code > maxStatus {
				t.Fatalf("%s %s returned %d (body: %s)", p.method, p.path, w.Code, w.Body.String())
			}
		})
	}
}

// TestPanicRecoverEmits500 confirms the recoverMiddleware catches a
// panic in a handler and emits a 500 with a JSON body, rather than
// killing the goroutine and leaving the client hanging.
func TestPanicRecoverEmits500(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/boom", func(w http.ResponseWriter, _ *http.Request) {
		panic("oh no")
	})
	r := &Router{mux: mux}
	wrapped := r.recoverMiddleware(mux)
	req := httptest.NewRequest("GET", "/boom", nil)
	w := httptest.NewRecorder()
	wrapped.ServeHTTP(w, req)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 from panicking handler, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "Internal server error") {
		t.Fatalf("expected error body, got %q", w.Body.String())
	}
}

// TestSmokeUnauthenticatedRoutesReject confirms protected routes
// reject anonymous requests cleanly (401, not 500). A regression here
// would be a serious auth-bypass bug.
func TestSmokeUnauthenticatedRoutesReject(t *testing.T) {
	router, _ := setupTestRouter(t)

	// Sample of protected routes — every one should 401 without auth.
	protected := []string{
		"/api/auth/logout",
		"/api/auth/change-password",
		"/api/config/export",
		"/api/backups",
		"/api/settings",
		"/api/discovery/scans",
		"/api/discovery/detectors",
		"/api/discovery/diagnostics",
	}
	for _, path := range protected {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest("GET", path, nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if w.Code != http.StatusUnauthorized {
				t.Fatalf("%s anonymous request returned %d, expected 401", path, w.Code)
			}
		})
	}
}
