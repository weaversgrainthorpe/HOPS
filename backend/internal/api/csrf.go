package api

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
)

// csrfCookieName is the name of the cookie that holds the CSRF token.
// This cookie is intentionally NOT HttpOnly so that JavaScript can read it
// and echo it back in the X-CSRF-Token header (double-submit cookie pattern).
const csrfCookieName = "hops_csrf"

// csrfHeaderName is the header name the client must use to send the CSRF token.
const csrfHeaderName = "X-CSRF-Token"

// generateCSRFToken returns a cryptographically random hex-encoded token.
func generateCSRFToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// setCSRFCookie writes a fresh CSRF token cookie. The cookie must be readable
// by JavaScript so the SPA can echo it back in the X-CSRF-Token header. The
// secure flag is set when the request arrived over HTTPS (see isSecureRequest).
func setCSRFCookie(w http.ResponseWriter, token string, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     csrfCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: false, // intentionally readable by JS for double-submit pattern
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   86400, // matches session lifetime
	})
}

// clearCSRFCookie removes the CSRF cookie (paired with logout).
func clearCSRFCookie(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     csrfCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: false,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
	})
}

// csrfMiddleware enforces the double-submit cookie pattern for state-changing
// requests. Safe methods (GET, HEAD, OPTIONS) bypass the check. For mutation
// methods (POST, PUT, PATCH, DELETE), the X-CSRF-Token header must be present
// and equal (constant-time) to the hops_csrf cookie value.
//
// This protects authenticated users from CSRF attacks: a malicious cross-origin
// page can trigger requests with the session cookie attached, but the Same-Origin
// Policy prevents it from reading the CSRF cookie to forge the header.
func (r *Router) csrfMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		// Safe methods don't need CSRF protection
		switch req.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next(w, req)
			return
		}

		cookie, err := req.Cookie(csrfCookieName)
		if err != nil || cookie.Value == "" {
			writeJSONError(w, "CSRF token missing", http.StatusForbidden)
			return
		}

		header := req.Header.Get(csrfHeaderName)
		if header == "" {
			writeJSONError(w, "CSRF token missing", http.StatusForbidden)
			return
		}

		// Constant-time comparison to prevent timing attacks
		if subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(header)) != 1 {
			writeJSONError(w, "CSRF token mismatch", http.StatusForbidden)
			return
		}

		next(w, req)
	}
}
