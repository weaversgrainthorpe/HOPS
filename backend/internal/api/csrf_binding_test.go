package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Pentest L3: the CSRF token is bound to its session (HMAC of the session id
// under a per-install key kept in the database).

// A token from session A, sent as both cookie and header, is refused with
// session B's cookie; B's own token works.
func TestCSRF_TokenFromAnotherSessionRefused(t *testing.T) {
	h, _ := setupTestRouter(t)
	_, csrfA := loginTestUserWithCSRF(t, h)
	sB, csrfB := loginTestUserWithCSRF(t, h)
	if csrfA == csrfB {
		t.Fatal("two sessions were given the same CSRF token")
	}
	if w := postJSON(h, "/api/auth/logout", nil, sB, csrfA); w.Code != http.StatusForbidden {
		t.Fatalf("A's token with B's session: %d %s, want 403", w.Code, w.Body.String())
	}
	if !sessionWorks(t, h, sB) {
		t.Fatal("refused request ended B's session")
	}
	// A planted cookie+header pair the attacker chose (cookie tossing) is refused too.
	if w := postJSON(h, "/api/auth/logout", nil, sB, "attacker-chosen-token"); w.Code != http.StatusForbidden {
		t.Fatalf("planted token: %d, want 403", w.Code)
	}
	if w := postJSON(h, "/api/auth/logout", nil, sB, csrfB); w.Code != http.StatusOK {
		t.Fatalf("B's own token: %d %s, want 200", w.Code, w.Body.String())
	}
}

// Login rotates the token with the session: a token from before login (the
// same browser's earlier session) does not work with the new one.
func TestCSRF_LoginRotatesToken(t *testing.T) {
	h, _ := setupTestRouter(t)
	s1, csrf1 := loginTestUserWithCSRF(t, h)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, loginReq("", nil, &http.Cookie{Name: "hops_session", Value: s1}, &http.Cookie{Name: "hops_csrf", Value: csrf1}))
	if w.Code != http.StatusOK {
		t.Fatalf("login: %d", w.Code)
	}
	s2, c2 := cookieNamed(w, "hops_session"), cookieNamed(w, "hops_csrf")
	if s2 == nil || c2 == nil || c2.Value == csrf1 || s2.Value == s1 {
		t.Fatalf("login must issue a new session and a new CSRF token, got %+v %+v", s2, c2)
	}
	if w := postJSON(h, "/api/auth/logout", nil, s2.Value, csrf1); w.Code != http.StatusForbidden {
		t.Fatalf("old token with new session: %d, want 403", w.Code)
	}
	if w := postJSON(h, "/api/auth/logout", nil, s2.Value, c2.Value); w.Code != http.StatusOK {
		t.Fatalf("new token: %d %s", w.Code, w.Body.String())
	}
}

// The auth check replaces a CSRF cookie that is not this session's (pre-binding
// or planted) with the bound one, so the SPA keeps working after the upgrade.
func TestCSRF_AuthCheckReissuesUnboundCookie(t *testing.T) {
	h, _ := setupTestRouter(t)
	s, csrf := loginTestUserWithCSRF(t, h)
	req := httptest.NewRequest("GET", "/api/auth/check", nil)
	req.AddCookie(&http.Cookie{Name: "hops_session", Value: s})
	req.AddCookie(&http.Cookie{Name: "hops_csrf", Value: "stale-random-token"})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if c := cookieNamed(w, "hops_csrf"); w.Code != 200 || c == nil || c.Value != csrf {
		t.Fatalf("auth check: %d, cookie %+v, want the session's token", w.Code, c)
	}
}
