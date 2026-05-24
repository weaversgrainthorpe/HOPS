package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/settings"
)

// putSetting is a small helper: sends an authenticated PUT to
// /api/settings/{key} with the given value and returns the response.
func putSetting(t *testing.T, router http.Handler, sessionToken, csrfToken, key, value string) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"value": value})
	req := authedRequest("PUT", "/api/settings/"+key, bytes.NewReader(body), sessionToken, csrfToken)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

// getSettings GETs the full list, decodes, and returns it.
func getSettings(t *testing.T, router http.Handler, sessionToken, csrfToken string) []settingDTO {
	t.Helper()
	req := authedRequest("GET", "/api/settings", nil, sessionToken, csrfToken)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/settings: status %d body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Settings []settingDTO `json:"settings"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return resp.Settings
}

// findSetting picks one entry from the list, or fails the test.
func findSetting(t *testing.T, list []settingDTO, key string) settingDTO {
	t.Helper()
	for _, s := range list {
		if s.Key == key {
			return s
		}
	}
	t.Fatalf("setting %q not in response", key)
	return settingDTO{}
}

// --- auth ---

func TestSettingsRequireAuth(t *testing.T) {
	router, _ := setupTestRouter(t)

	// GET without session
	req := httptest.NewRequest("GET", "/api/settings", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("unauth GET: expected 401, got %d", w.Code)
	}

	// PUT without session
	body, _ := json.Marshal(map[string]string{"value": "9000"})
	req = httptest.NewRequest("PUT", "/api/settings/"+settings.KeyServerPort, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("unauth PUT: expected 401, got %d", w.Code)
	}
}

func TestSettingsPUTRequiresCSRF(t *testing.T) {
	router, _ := setupTestRouter(t)
	sessionToken, _ := loginTestUserWithCSRF(t, router)

	// Authed but no CSRF header — must be rejected by the CSRF middleware.
	body, _ := json.Marshal(map[string]string{"value": "9000"})
	req := httptest.NewRequest("PUT", "/api/settings/"+settings.KeyServerPort, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+sessionToken)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("PUT without CSRF: expected 403, got %d", w.Code)
	}
}

// --- GET ---

func TestSettingsListReturnsFullSchema(t *testing.T) {
	router, _ := setupTestRouter(t)
	sessionToken, csrfToken := loginTestUserWithCSRF(t, router)

	list := getSettings(t, router, sessionToken, csrfToken)

	if got, want := len(list), len(settings.Definitions); got != want {
		t.Errorf("expected %d settings in response, got %d", want, got)
	}

	// Spot-check a few keys are present with expected types.
	checks := map[string]string{
		settings.KeyServerPort:                "int",
		settings.KeyLogLevel:                  "log_level",
		settings.KeyProxyTrustedCIDRs:         "cidr_list",
		settings.KeyAuthSessionLifetimeHours:  "duration_hours",
		settings.KeyStatusCheckIntervalMinutes: "duration_minutes",
		settings.KeyHTTPReadTimeoutSeconds:    "duration_seconds",
		settings.KeyUploadMaxBytesIcon:        "bytes",
	}
	for k, wantType := range checks {
		s := findSetting(t, list, k)
		if s.Type != wantType {
			t.Errorf("%s: expected type %q, got %q", k, wantType, s.Type)
		}
		if s.Default == "" {
			t.Errorf("%s: missing default", k)
		}
		if s.Description == "" {
			t.Errorf("%s: missing description", k)
		}
	}

	// log_level must carry the enum.
	logSetting := findSetting(t, list, settings.KeyLogLevel)
	if len(logSetting.Enum) == 0 {
		t.Error("log_level setting should carry an enum, got empty")
	}

	// At least one setting must be restart-required (port) and at least one
	// must not be (log_level).
	port := findSetting(t, list, settings.KeyServerPort)
	if !port.RestartRequired {
		t.Error("server.port should be restart-required")
	}
	if findSetting(t, list, settings.KeyLogLevel).RestartRequired {
		t.Error("log.level should NOT be restart-required (live)")
	}
}

// --- PUT happy paths ---

func TestSettingsPUTAccepts_int(t *testing.T) {
	router, _ := setupTestRouter(t)
	sessionToken, csrfToken := loginTestUserWithCSRF(t, router)

	w := putSetting(t, router, sessionToken, csrfToken, settings.KeyServerPort, "9090")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", w.Code, w.Body.String())
	}

	// Verify via GET that the new value is reflected.
	list := getSettings(t, router, sessionToken, csrfToken)
	if got := findSetting(t, list, settings.KeyServerPort).Value; got != "9090" {
		t.Errorf("expected port to read back as 9090, got %q", got)
	}
}

func TestSettingsPUTAccepts_logLevel(t *testing.T) {
	router, _ := setupTestRouter(t)
	sessionToken, csrfToken := loginTestUserWithCSRF(t, router)

	for _, level := range []string{"debug", "info", "warn", "error"} {
		w := putSetting(t, router, sessionToken, csrfToken, settings.KeyLogLevel, level)
		if w.Code != http.StatusOK {
			t.Errorf("PUT log.level=%q: expected 200, got %d (%s)", level, w.Code, w.Body.String())
		}
	}
}

func TestSettingsPUTAccepts_cidrList(t *testing.T) {
	router, _ := setupTestRouter(t)
	sessionToken, csrfToken := loginTestUserWithCSRF(t, router)

	tests := []string{`[]`, `["10.0.0.0/8"]`, `["10.0.0.0/8","192.168.1.5/32"]`}
	for _, value := range tests {
		w := putSetting(t, router, sessionToken, csrfToken, settings.KeyProxyTrustedCIDRs, value)
		if w.Code != http.StatusOK {
			t.Errorf("PUT trusted_cidrs=%s: expected 200, got %d (%s)", value, w.Code, w.Body.String())
		}
	}
}

// --- PUT validation errors ---

func TestSettingsPUTRejects_outOfRange(t *testing.T) {
	router, _ := setupTestRouter(t)
	sessionToken, csrfToken := loginTestUserWithCSRF(t, router)

	tests := []struct{ key, value, mustMention string }{
		{settings.KeyServerPort, "0", "minimum"},
		{settings.KeyServerPort, "70000", "maximum"},
		{settings.KeyServerPort, "abc", "integer"},
		{settings.KeyAuthLoginRateLimitPerMin, "0", "minimum"},
		{settings.KeyAuthSessionLifetimeHours, "9999", "maximum"},
		{settings.KeyHTTPReadTimeoutSeconds, "-5", "minimum"},
	}
	for _, tt := range tests {
		w := putSetting(t, router, sessionToken, csrfToken, tt.key, tt.value)
		if w.Code != http.StatusBadRequest {
			t.Errorf("PUT %s=%q: expected 400, got %d (%s)", tt.key, tt.value, w.Code, w.Body.String())
			continue
		}
		if !strings.Contains(strings.ToLower(w.Body.String()), tt.mustMention) {
			t.Errorf("PUT %s=%q: response %q should mention %q", tt.key, tt.value, w.Body.String(), tt.mustMention)
		}
	}
}

func TestSettingsPUTRejects_badEnum(t *testing.T) {
	router, _ := setupTestRouter(t)
	sessionToken, csrfToken := loginTestUserWithCSRF(t, router)

	w := putSetting(t, router, sessionToken, csrfToken, settings.KeyLogLevel, "trace")
	if w.Code != http.StatusBadRequest {
		t.Errorf("PUT log.level=trace: expected 400, got %d", w.Code)
	}
}

func TestSettingsPUTRejects_badCIDR(t *testing.T) {
	router, _ := setupTestRouter(t)
	sessionToken, csrfToken := loginTestUserWithCSRF(t, router)

	tests := []string{
		`not-json`,
		`["not-a-cidr"]`,
		`["10.0.0.0"]`,           // missing /prefix
		`{"cidr":"10.0.0.0/8"}`, // not an array
	}
	for _, value := range tests {
		w := putSetting(t, router, sessionToken, csrfToken, settings.KeyProxyTrustedCIDRs, value)
		if w.Code != http.StatusBadRequest {
			t.Errorf("PUT trusted_cidrs=%q: expected 400, got %d (%s)", value, w.Code, w.Body.String())
		}
	}
}

func TestSettingsPUTRejects_unknownKey(t *testing.T) {
	router, _ := setupTestRouter(t)
	sessionToken, csrfToken := loginTestUserWithCSRF(t, router)

	w := putSetting(t, router, sessionToken, csrfToken, "does.not.exist", "value")
	if w.Code != http.StatusNotFound {
		t.Errorf("PUT unknown key: expected 404, got %d", w.Code)
	}
}

// --- live-update wiring ---

func TestSetRateLimitUpdatesLimiterLive(t *testing.T) {
	router, _ := setupTestRouter(t)
	sessionToken, csrfToken := loginTestUserWithCSRF(t, router)

	// The Router is returned wrapped in middleware, so we can't see the
	// inner *Router directly. Instead, exercise the limiter by hitting
	// /api/auth/login with the wrong password until we hit the limit, and
	// then again after raising the limit via settings.

	// Knock the limit down to 3 so the test runs fast.
	w := putSetting(t, router, sessionToken, csrfToken, settings.KeyAuthLoginRateLimitPerMin, "3")
	if w.Code != http.StatusOK {
		t.Fatalf("set rate limit: %d %s", w.Code, w.Body.String())
	}

	hitLogin := func() int {
		body, _ := json.Marshal(map[string]string{"username": "admin", "password": "wrong"})
		req := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = "203.0.113.42:55555"
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w.Code
	}

	// Three failed attempts must return 401 (unauthorized) — they're within budget.
	for i := 0; i < 3; i++ {
		if code := hitLogin(); code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: expected 401, got %d", i+1, code)
		}
	}
	// Fourth attempt should now be 429 (rate-limited).
	if code := hitLogin(); code != http.StatusTooManyRequests {
		t.Errorf("4th attempt with limit=3: expected 429, got %d", code)
	}
}
