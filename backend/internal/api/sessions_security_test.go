package api

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Sessions, cookie flags and proxy trust.

const trustedProxyNet = `["10.9.0.0/16"]`

func loginReq(remote string, hdr map[string]string, cookies ...*http.Cookie) *http.Request {
	body, _ := json.Marshal(map[string]string{"username": "admin", "password": "admin"})
	req := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if remote != "" {
		req.RemoteAddr = remote
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	return req
}

func cookieNamed(w *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, c := range w.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

// sessionWorks reports whether the session id still authenticates.
func sessionWorks(t *testing.T, h http.Handler, session string) bool {
	t.Helper()
	req := httptest.NewRequest("GET", "/api/settings", nil)
	req.AddCookie(&http.Cookie{Name: "hops_session", Value: session})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	switch w.Code {
	case http.StatusOK:
		return true
	case http.StatusUnauthorized:
		return false
	}
	t.Fatalf("GET /api/settings: unexpected %d", w.Code)
	return false
}

func postJSON(h http.Handler, path string, body any, session, csrf string) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	req := httptest.NewRequest("POST", path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "hops_session", Value: session})
	req.AddCookie(&http.Cookie{Name: "hops_csrf", Value: csrf})
	req.Header.Set("X-CSRF-Token", csrf)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func TestLogoutEndsSessionServerSide(t *testing.T) {
	h, _ := setupTestRouter(t)
	s, csrf := loginTestUserWithCSRF(t, h)
	if w := postJSON(h, "/api/auth/logout", nil, s, csrf); w.Code != http.StatusOK {
		t.Fatalf("logout: %d %s", w.Code, w.Body.String())
	} else if c := cookieNamed(w, "hops_session"); c == nil || c.MaxAge >= 0 || !c.HttpOnly {
		t.Errorf("logout must clear the session cookie (HttpOnly), got %+v", c)
	} else if c := cookieNamed(w, "hops_csrf"); c == nil || c.MaxAge >= 0 {
		t.Errorf("logout must clear the CSRF cookie, got %+v", c)
	}
	if sessionWorks(t, h, s) {
		t.Fatal("the session still works after logout (cookie cleared but row kept)")
	}
}

// A failed server-side logout is reported, never a silent "logged out".
func TestLogoutFailureIsVisible(t *testing.T) {
	h, db := setupTestRouter(t)
	s, csrf := loginTestUserWithCSRF(t, h)
	// Make the DELETE fail after authentication has succeeded.
	if _, err := db.Exec(`CREATE TRIGGER no_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'boom'); END`); err != nil {
		t.Fatal(err)
	}
	w := postJSON(h, "/api/auth/logout", nil, s, csrf)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("a failed logout returned %d, want 500", w.Code)
	}
}

func TestLoginRotatesAndEndsPresentedSession(t *testing.T) {
	h, _ := setupTestRouter(t)
	first, _ := loginTestUserWithCSRF(t, h)

	w := httptest.NewRecorder()
	h.ServeHTTP(w, loginReq("", nil, &http.Cookie{Name: "hops_session", Value: first}))
	if w.Code != http.StatusOK {
		t.Fatalf("login: %d", w.Code)
	}
	second := cookieNamed(w, "hops_session").Value
	if second == "" || second == first {
		t.Fatal("login did not mint a new session id")
	}
	if sessionWorks(t, h, first) {
		t.Error("the session presented at login survived it (fixation)")
	}
	if !sessionWorks(t, h, second) {
		t.Error("the new session does not work")
	}

	// An attacker-chosen id is never adopted.
	w = httptest.NewRecorder()
	h.ServeHTTP(w, loginReq("", nil, &http.Cookie{Name: "hops_session", Value: "attacker-fixed"}))
	if got := cookieNamed(w, "hops_session").Value; got == "attacker-fixed" {
		t.Fatal("login adopted a client-supplied session id")
	}
}

// Password change ends ALL sessions and rotates the caller's (decision:
// rotate, so the user stays signed in on a new id; the old id is dead).
func TestPasswordChangeEndsAllSessionsAndRotatesCurrent(t *testing.T) {
	h, _ := setupTestRouter(t)
	mine, csrf := loginTestUserWithCSRF(t, h)
	other, _ := loginTestUserWithCSRF(t, h)

	// Refusals change nothing.
	for _, body := range []map[string]string{
		{"oldPassword": "wrong", "newPassword": "newpassword123"},
		{"oldPassword": "admin", "newPassword": "short"},
		{"oldPassword": "admin", "newPassword": "admin"},
	} {
		if w := postJSON(h, "/api/auth/change-password", body, mine, csrf); w.Code != http.StatusBadRequest {
			t.Errorf("change-password %v returned %d, want 400", body, w.Code)
		}
	}
	if !sessionWorks(t, h, mine) || !sessionWorks(t, h, other) {
		t.Fatal("a refused password change ended a session")
	}

	w := postJSON(h, "/api/auth/change-password", map[string]string{"oldPassword": "admin", "newPassword": "newpassword123"}, mine, csrf)
	if w.Code != http.StatusOK {
		t.Fatalf("change-password: %d %s", w.Code, w.Body.String())
	}
	rotated := cookieNamed(w, "hops_session")
	newCSRF := cookieNamed(w, "hops_csrf")
	if rotated == nil || rotated.Value == "" || rotated.Value == mine || !rotated.HttpOnly {
		t.Fatalf("expected a rotated HttpOnly session cookie, got %+v", rotated)
	}
	if newCSRF == nil || newCSRF.Value == "" || newCSRF.Value == csrf {
		t.Fatalf("expected a fresh CSRF cookie with the rotated session, got %+v", newCSRF)
	}
	if sessionWorks(t, h, mine) {
		t.Error("the caller's old session id survived the password change")
	}
	if sessionWorks(t, h, other) {
		t.Error("another session survived the password change")
	}
	if !sessionWorks(t, h, rotated.Value) {
		t.Error("the rotated session does not work")
	}
}

func TestSessionCookieLifetimeFromSetting(t *testing.T) {
	h, db := setupTestRouterWithSettingsRows(t, "", nil, map[string]string{"auth.session_lifetime_hours": "2"})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, loginReq("", nil))
	s, c := cookieNamed(w, "hops_session"), cookieNamed(w, "hops_csrf")
	if s.MaxAge != 7200 || c.MaxAge != 7200 {
		t.Fatalf("cookie MaxAge session=%d csrf=%d, want 7200", s.MaxAge, c.MaxAge)
	}
	var exp time.Time
	db.QueryRow("SELECT expires_at FROM sessions WHERE id = ?", s.Value).Scan(&exp)
	if d := time.Until(exp); d < 2*time.Hour-time.Minute || d > 2*time.Hour+time.Minute {
		t.Fatalf("server-side expiry in %v, want ~2h", d)
	}
	// Enforced server-side: past expires_at the session is refused even
	// though the browser would still send the cookie.
	db.Exec("UPDATE sessions SET expires_at = ? WHERE id = ?", time.Now().Add(-time.Second), s.Value)
	if sessionWorks(t, h, s.Value) {
		t.Fatal("an expired session was accepted")
	}
}

// Cookie flags, and Secure only for HTTPS directly or via a TRUSTED proxy.
func TestSessionAndCSRFCookieFlags(t *testing.T) {
	h, _ := setupTestRouterWithSettingsRows(t, "", nil, map[string]string{"proxy.trusted_cidrs": trustedProxyNet})
	cases := []struct {
		name       string
		remote     string
		tls        bool
		xfp        string
		wantSecure bool
	}{
		{"plain http", "192.168.1.5:5000", false, "", false},
		{"direct https", "192.168.1.5:5000", true, "", true},
		{"spoofed X-Forwarded-Proto from untrusted ip", "192.168.1.5:5000", false, "https", false},
		{"trusted proxy says https", "10.9.0.2:5000", false, "https", true},
		{"trusted proxy says http", "10.9.0.2:5000", false, "http", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			hdr := map[string]string{}
			if c.xfp != "" {
				hdr["X-Forwarded-Proto"] = c.xfp
			}
			req := loginReq(c.remote, hdr)
			if c.tls {
				req.TLS = &tls.ConnectionState{}
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			if w.Code != http.StatusOK {
				t.Fatalf("login: %d", w.Code)
			}
			s, k := cookieNamed(w, "hops_session"), cookieNamed(w, "hops_csrf")
			if s == nil || k == nil {
				t.Fatal("missing cookie")
			}
			if !s.HttpOnly || s.SameSite != http.SameSiteLaxMode || s.Path != "/" {
				t.Errorf("session cookie flags: HttpOnly=%v SameSite=%v Path=%q", s.HttpOnly, s.SameSite, s.Path)
			}
			// Double-submit: readable by the SPA, never sent cross-site.
			if k.HttpOnly || k.SameSite != http.SameSiteStrictMode || k.Path != "/" {
				t.Errorf("csrf cookie flags: HttpOnly=%v SameSite=%v Path=%q", k.HttpOnly, k.SameSite, k.Path)
			}
			if s.Secure != c.wantSecure || k.Secure != c.wantSecure {
				t.Errorf("Secure session=%v csrf=%v, want %v", s.Secure, k.Secure, c.wantSecure)
			}
		})
	}
}

// Login rate limit is per client IP and can't be dodged with forged headers.
func TestLoginRateLimitNotSpoofable(t *testing.T) {
	rows := map[string]string{"auth.login_rate_limit_per_min": "2", "proxy.trusted_cidrs": trustedProxyNet}
	attempt := func(h http.Handler, remote string, hdr map[string]string) int {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, loginReq(remote, hdr))
		return w.Code
	}

	t.Run("untrusted peer rotating X-Forwarded-For", func(t *testing.T) {
		h, _ := setupTestRouterWithSettingsRows(t, "", nil, rows)
		var last int
		for i := 0; i < 3; i++ {
			last = attempt(h, "192.168.1.5:5000", map[string]string{"X-Forwarded-For": "203.0.113." + string(rune('1'+i)), "X-Real-IP": "198.51.100." + string(rune('1'+i))})
		}
		if last != http.StatusTooManyRequests {
			t.Fatalf("3rd attempt = %d, want 429", last)
		}
	})

	t.Run("behind trusted proxy: keyed by the forwarded client", func(t *testing.T) {
		h, _ := setupTestRouterWithSettingsRows(t, "", nil, rows)
		for i := 0; i < 2; i++ {
			attempt(h, "10.9.0.2:5000", map[string]string{"X-Forwarded-For": "203.0.113.7"})
		}
		if c := attempt(h, "10.9.0.2:5000", map[string]string{"X-Forwarded-For": "203.0.113.7"}); c != http.StatusTooManyRequests {
			t.Fatalf("same client 3rd attempt = %d, want 429", c)
		}
		if c := attempt(h, "10.9.0.2:5000", map[string]string{"X-Forwarded-For": "203.0.113.8"}); c == http.StatusTooManyRequests {
			t.Fatal("a different client behind the proxy shares the bucket")
		}
	})

	t.Run("behind trusted proxy: client-forged leftmost X-Forwarded-For ignored", func(t *testing.T) {
		h, _ := setupTestRouterWithSettingsRows(t, "", nil, rows)
		var last int
		for i := 0; i < 3; i++ {
			// The client sent "X-Forwarded-For: <forged>"; the proxy appended
			// the real client address (and a second trusted hop).
			xff := "198.51.100." + string(rune('1'+i)) + ", 203.0.113.7, 10.9.0.3"
			last = attempt(h, "10.9.0.2:5000", map[string]string{"X-Forwarded-For": xff})
		}
		if last != http.StatusTooManyRequests {
			t.Fatalf("3rd attempt = %d, want 429 (forged leftmost entries picked fresh buckets)", last)
		}
	})
}

// Idle sign-out (auth.session_idle_hours) over HTTP, with a fake clock: reads
// and polls never extend a session, a state-changing request does, and an
// idle session gets the normal 401.
func TestIdleSignOutOverHTTP(t *testing.T) {
	rt, h, _ := setupTestRouterCore(t, "", nil, map[string]string{"auth.session_idle_hours": "1"}, t.TempDir())
	clk := time.Now()
	rt.authService.SetClock(func() time.Time { return clk })
	s, csrf := loginTestUserWithCSRF(t, h)

	poll := func() int {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/api/logs", nil)
		req.AddCookie(&http.Cookie{Name: "hops_session", Value: s})
		h.ServeHTTP(w, req)
		return w.Code
	}
	for i := 0; i < 59; i++ { // a log page auto-refreshing for 59 minutes
		clk = clk.Add(time.Minute)
		if c := poll(); c != http.StatusOK {
			t.Fatalf("poll at %d min = %d", i+1, c)
		}
	}
	// A change at 59 min counts as use (it reaches the handler: 400 for the bad body).
	if w := postJSON(h, "/api/dashboards", "not a dashboard", s, csrf); w.Code == http.StatusUnauthorized || w.Code == http.StatusForbidden {
		t.Fatalf("activity request refused: %d", w.Code)
	}
	clk = clk.Add(59 * time.Minute)
	if c := poll(); c != http.StatusOK {
		t.Fatalf("activity did not extend the session: %d", c)
	}
	clk = clk.Add(2 * time.Minute)
	if c := poll(); c != http.StatusUnauthorized {
		t.Fatalf("idle session = %d, want 401", c)
	}
	if sessionWorks(t, h, s) {
		t.Fatal("idle session still works")
	}
}

// Off (the default): hours of polling only, still signed in.
func TestIdleSignOutOffByDefault(t *testing.T) {
	rt, h, _ := setupTestRouterInDir(t, t.TempDir())
	clk := time.Now()
	rt.authService.SetClock(func() time.Time { return clk })
	s, _ := loginTestUserWithCSRF(t, h)
	clk = clk.Add(30 * 24 * time.Hour)
	if !sessionWorks(t, h, s) {
		t.Fatal("idle sign-out applied while off")
	}
}
