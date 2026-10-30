package api

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
)

// csrfCookieName is the name of the cookie that holds the CSRF token.
// This cookie is intentionally NOT HttpOnly so that JavaScript can read it
// and echo it back in the X-CSRF-Token header (double-submit cookie pattern).
const csrfCookieName = "hops_csrf"

// csrfHeaderName is the header name the client must use to send the CSRF token.
const csrfHeaderName = "X-CSRF-Token"

// csrfSecretName is the server_secrets row holding the HMAC key that binds a
// CSRF token to its session. It is generated once per install and
// kept in the database: never an environment variable, never hand-set.
const csrfSecretName = "csrf_hmac" // #nosec G101 -- a row name, not a secret; the key itself is random per install

// errNoSession is returned when a CSRF token is asked for without a session.
var errNoSession = errors.New("no session")

// loadCSRFKey returns the install's CSRF HMAC key, creating it on first use.
// INSERT OR IGNORE then SELECT, so two processes racing on a fresh database
// agree on one key.
func loadCSRFKey(db *sql.DB) ([]byte, error) {
	fresh := make([]byte, 32)
	if _, err := rand.Read(fresh); err != nil {
		return nil, fmt.Errorf("generate CSRF key: %w", err)
	}
	if _, err := db.Exec(`INSERT OR IGNORE INTO server_secrets (name, value) VALUES (?, ?)`, csrfSecretName, fresh); err != nil {
		return nil, fmt.Errorf("store CSRF key: %w", err)
	}
	var key []byte
	if err := db.QueryRow(`SELECT value FROM server_secrets WHERE name = ?`, csrfSecretName).Scan(&key); err != nil {
		return nil, fmt.Errorf("read CSRF key: %w", err)
	}
	if len(key) < 32 {
		return nil, fmt.Errorf("CSRF key is %d bytes, want 32", len(key))
	}
	return key, nil
}

// csrfTokenFor derives the CSRF token for a session: hex HMAC-SHA256 of the
// session id under the install's key. A token is therefore valid only with
// the session it was issued for, and it changes whenever the session id does
// (login and password change rotate the session, so they rotate the token).
// A key that cannot be loaded is an error, never a fallback token.
func (r *Router) csrfTokenFor(sessionID string) (string, error) {
	if sessionID == "" {
		return "", errNoSession
	}
	r.csrfKeyMu.Lock()
	if r.csrfKey == nil {
		key, err := loadCSRFKey(r.db)
		if err != nil {
			r.csrfKeyMu.Unlock()
			return "", err
		}
		r.csrfKey = key
	}
	key := r.csrfKey
	r.csrfKeyMu.Unlock()
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("hops-csrf-v1\x00" + sessionID)) // #nosec G104 -- hash.Hash.Write never returns an error
	return hex.EncodeToString(mac.Sum(nil)), nil
}

// setCSRFCookie writes a fresh CSRF token cookie. The cookie must be readable
// by JavaScript so the SPA can echo it back in the X-CSRF-Token header. The
// secure flag is set when the request arrived over HTTPS (see isSecureRequest).
// maxAge matches the session lifetime, taken from the auth.session_lifetime_hours
// admin setting.
func setCSRFCookie(w http.ResponseWriter, token string, secure bool, maxAge int) {
	http.SetCookie(w, &http.Cookie{ // #nosec G124 -- reviewed: session cookie HttpOnly+SameSite, Secure follows request scheme behind proxy; CSRF cookie is JS-readable by design (double-submit)
		Name:     csrfCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: false, // intentionally readable by JS for double-submit pattern
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   maxAge,
	})
}

// clearCSRFCookie removes the CSRF cookie (paired with logout).
func clearCSRFCookie(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{ // #nosec G124 -- reviewed: session cookie HttpOnly+SameSite, Secure follows request scheme behind proxy; CSRF cookie is JS-readable by design (double-submit)
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
// requests, with the token bound to the session. Safe methods
// (GET, HEAD, OPTIONS) bypass the check. For mutation methods (POST, PUT,
// PATCH, DELETE), the X-CSRF-Token header must equal (constant-time) both the
// hops_csrf cookie and the token derived from the request's session cookie,
// so a cookie planted by a sibling subdomain (cookie tossing) or a token from
// another session is refused.
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

		want, err := r.csrfTokenFor(extractSessionID(req))
		if errors.Is(err, errNoSession) {
			writeJSONError(w, "CSRF token mismatch", http.StatusForbidden)
			return
		}
		if err != nil {
			slog.Error("CSRF check: session key unavailable", "component", "auth", "error", err)
			writeJSONError(w, "The server could not check this request's CSRF token: its key is unavailable. See the server log.", http.StatusInternalServerError)
			return
		}
		if subtle.ConstantTimeCompare([]byte(want), []byte(header)) != 1 {
			writeJSONError(w, "CSRF token does not belong to this session; reload the page", http.StatusForbidden)
			return
		}

		next(w, req)
	}
}
