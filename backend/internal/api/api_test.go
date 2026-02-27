package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	_ "modernc.org/sqlite"
	"github.com/weaversgrainthorpe/HOPS/internal/auth"
	"github.com/weaversgrainthorpe/HOPS/internal/config"
	"golang.org/x/crypto/bcrypt"
)

func setupTestRouter(t *testing.T) (http.Handler, *sql.DB) {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	schema := []string{
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			expires_at DATETIME NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id)
		)`,
		`CREATE TABLE config (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			data TEXT NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE status_cache (
			entry_id TEXT PRIMARY KEY,
			status TEXT NOT NULL,
			response_time INTEGER,
			last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
	}
	for _, s := range schema {
		if _, err := db.Exec(s); err != nil {
			t.Fatal(err)
		}
	}

	// Create test user
	hash, _ := bcrypt.GenerateFromPassword([]byte("admin"), bcrypt.MinCost)
	db.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", "admin", string(hash))

	// Create default config
	db.Exec(`INSERT INTO config (id, data) VALUES (1, '{"dashboards":[],"theme":{"mode":"dark"}}')`)

	cfg := &config.Config{
		Port:                 "8080",
		DataDir:              t.TempDir(),
		FrontendDir:          t.TempDir(),
		LoginRateLimitPerMin: 20,
	}

	authService := auth.NewService(db)
	router := NewRouter(db, authService, cfg, time.Now())

	return router, db
}

func loginTestUser(t *testing.T, router http.Handler) string {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"username": "admin", "password": "admin"})
	req := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("login failed with status %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]string
	json.Unmarshal(w.Body.Bytes(), &resp)
	return resp["sessionId"]
}

func TestSecurityHeaders(t *testing.T) {
	router, _ := setupTestRouter(t)

	req := httptest.NewRequest("GET", "/api/health", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	headers := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":       "SAMEORIGIN",
		"Referrer-Policy":       "strict-origin-when-cross-origin",
	}
	for name, expected := range headers {
		if got := w.Header().Get(name); got != expected {
			t.Errorf("expected %s: %q, got %q", name, expected, got)
		}
	}
}

func TestHealthEndpoint(t *testing.T) {
	router, _ := setupTestRouter(t)

	req := httptest.NewRequest("GET", "/api/health", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestVersionEndpoint(t *testing.T) {
	router, _ := setupTestRouter(t)

	req := httptest.NewRequest("GET", "/api/version", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if _, ok := resp["version"]; !ok {
		t.Fatal("expected version field in response")
	}
}

func TestGetConfig(t *testing.T) {
	router, _ := setupTestRouter(t)

	req := httptest.NewRequest("GET", "/api/config", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestLoginSuccess(t *testing.T) {
	router, _ := setupTestRouter(t)

	body, _ := json.Marshal(map[string]string{"username": "admin", "password": "admin"})
	req := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]string
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["sessionId"] == "" {
		t.Fatal("expected sessionId in response")
	}
}

func TestLoginSetsCookie(t *testing.T) {
	router, _ := setupTestRouter(t)

	body, _ := json.Marshal(map[string]string{"username": "admin", "password": "admin"})
	req := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	cookies := w.Result().Cookies()
	var sessionCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "hops_session" {
			sessionCookie = c
			break
		}
	}
	if sessionCookie == nil {
		t.Fatal("expected hops_session cookie to be set")
	}
	if !sessionCookie.HttpOnly {
		t.Fatal("expected cookie to be HttpOnly")
	}
	if sessionCookie.Value == "" {
		t.Fatal("expected cookie to have a value")
	}
}

func TestProtectedRouteWithCookie(t *testing.T) {
	router, _ := setupTestRouter(t)

	// Login and get cookie
	body, _ := json.Marshal(map[string]string{"username": "admin", "password": "admin"})
	loginReq := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(body))
	loginReq.Header.Set("Content-Type", "application/json")
	loginW := httptest.NewRecorder()
	router.ServeHTTP(loginW, loginReq)

	cookies := loginW.Result().Cookies()

	// Use cookie to access protected route
	req := httptest.NewRequest("POST", "/api/auth/logout", nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 with cookie auth, got %d", w.Code)
	}
}

func TestAuthCheckAuthenticated(t *testing.T) {
	router, _ := setupTestRouter(t)

	// Login and get cookie
	body, _ := json.Marshal(map[string]string{"username": "admin", "password": "admin"})
	loginReq := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(body))
	loginReq.Header.Set("Content-Type", "application/json")
	loginW := httptest.NewRecorder()
	router.ServeHTTP(loginW, loginReq)

	cookies := loginW.Result().Cookies()

	// Check auth with cookie
	req := httptest.NewRequest("GET", "/api/auth/check", nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]bool
	json.Unmarshal(w.Body.Bytes(), &resp)
	if !resp["authenticated"] {
		t.Fatal("expected authenticated: true")
	}
}

func TestAuthCheckUnauthenticated(t *testing.T) {
	router, _ := setupTestRouter(t)

	req := httptest.NewRequest("GET", "/api/auth/check", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]bool
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["authenticated"] {
		t.Fatal("expected authenticated: false")
	}
}

func TestLogoutClearsCookie(t *testing.T) {
	router, _ := setupTestRouter(t)

	// Login and get cookie
	body, _ := json.Marshal(map[string]string{"username": "admin", "password": "admin"})
	loginReq := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(body))
	loginReq.Header.Set("Content-Type", "application/json")
	loginW := httptest.NewRecorder()
	router.ServeHTTP(loginW, loginReq)

	cookies := loginW.Result().Cookies()

	// Logout with cookie
	req := httptest.NewRequest("POST", "/api/auth/logout", nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Check that the response clears the cookie
	logoutCookies := w.Result().Cookies()
	var cleared bool
	for _, c := range logoutCookies {
		if c.Name == "hops_session" && c.MaxAge < 0 {
			cleared = true
			break
		}
	}
	if !cleared {
		t.Fatal("expected logout to clear hops_session cookie")
	}
}

func TestLoginWrongPassword(t *testing.T) {
	router, _ := setupTestRouter(t)

	body, _ := json.Marshal(map[string]string{"username": "admin", "password": "wrong"})
	req := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestProtectedRouteWithoutAuth(t *testing.T) {
	router, _ := setupTestRouter(t)

	req := httptest.NewRequest("POST", "/api/auth/logout", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestProtectedRouteWithAuth(t *testing.T) {
	router, _ := setupTestRouter(t)

	token := loginTestUser(t, router)

	req := httptest.NewRequest("POST", "/api/auth/logout", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestUpdateConfig(t *testing.T) {
	router, _ := setupTestRouter(t)

	token := loginTestUser(t, router)

	newConfig := map[string]interface{}{
		"dashboards": []interface{}{},
		"theme":      map[string]string{"mode": "light"},
	}
	body, _ := json.Marshal(newConfig)

	req := httptest.NewRequest("PUT", "/api/config/update", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestLoginRateLimit(t *testing.T) {
	router, _ := setupTestRouter(t)

	body, _ := json.Marshal(map[string]string{"username": "admin", "password": "wrong"})

	// Exhaust rate limit (20 attempts)
	for i := 0; i < 20; i++ {
		req := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
	}

	// 21st attempt should be rate limited
	req := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", w.Code)
	}
}
