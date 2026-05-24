package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	_ "modernc.org/sqlite"
	"github.com/weaversgrainthorpe/HOPS/internal/auth"
	"github.com/weaversgrainthorpe/HOPS/internal/config"
	"github.com/weaversgrainthorpe/HOPS/internal/settings"
	"golang.org/x/crypto/bcrypt"
)

func setupTestRouter(t *testing.T) (http.Handler, *sql.DB) {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	// Enable foreign keys
	db.Exec("PRAGMA foreign_keys=ON")

	schema := []string{
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			must_change_password INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			expires_at DATETIME NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
		`CREATE TABLE icon_categories (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			icon TEXT NOT NULL,
			order_num INTEGER NOT NULL,
			is_preset BOOLEAN NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE icons (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			icon TEXT NOT NULL,
			category_id TEXT NOT NULL,
			color TEXT,
			image_url TEXT,
			is_preset BOOLEAN NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (category_id) REFERENCES icon_categories(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE app_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
		DataDir:     t.TempDir(),
		FrontendDir: t.TempDir(),
	}

	settingsSvc, err := settings.New(db)
	if err != nil {
		t.Fatalf("settings.New: %v", err)
	}

	authService := auth.NewService(db)
	router := NewRouter(db, authService, cfg, settingsSvc, time.Now())

	return router, db
}

// loginTestUser logs in the default test user and returns just the session token.
// Use loginTestUserWithCSRF if you also need the CSRF token (for mutations).
func loginTestUser(t *testing.T, router http.Handler) string {
	t.Helper()
	token, _ := loginTestUserWithCSRF(t, router)
	return token
}

// loginTestUserWithCSRF logs in and returns the (session token, CSRF token).
// Both must be sent on protected mutation requests.
func loginTestUserWithCSRF(t *testing.T, router http.Handler) (string, string) {
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

	// Extract CSRF token from cookies
	var csrfToken string
	for _, c := range w.Result().Cookies() {
		if c.Name == "hops_csrf" {
			csrfToken = c.Value
			break
		}
	}

	return resp["sessionId"], csrfToken
}

// authedRequest creates an authenticated, CSRF-protected request for tests.
// For mutation methods (POST/PUT/DELETE/PATCH), it adds both the Authorization
// header and X-CSRF-Token header.
func authedRequest(method, path string, body io.Reader, sessionToken, csrfToken string) *http.Request {
	req := httptest.NewRequest(method, path, body)
	req.Header.Set("Authorization", "Bearer "+sessionToken)
	if method != http.MethodGet && method != http.MethodHead && method != http.MethodOptions {
		req.Header.Set("X-CSRF-Token", csrfToken)
		// Also send the cookie so the CSRF middleware can compare against it
		req.AddCookie(&http.Cookie{Name: "hops_csrf", Value: csrfToken})
	}
	return req
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

	// Login and get cookies (session + csrf)
	body, _ := json.Marshal(map[string]string{"username": "admin", "password": "admin"})
	loginReq := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(body))
	loginReq.Header.Set("Content-Type", "application/json")
	loginW := httptest.NewRecorder()
	router.ServeHTTP(loginW, loginReq)

	cookies := loginW.Result().Cookies()
	var csrfToken string
	for _, c := range cookies {
		if c.Name == "hops_csrf" {
			csrfToken = c.Value
		}
	}

	// Use cookie + CSRF header to access protected route
	req := httptest.NewRequest("POST", "/api/auth/logout", nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	req.Header.Set("X-CSRF-Token", csrfToken)
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

	// Login and get cookies (session + csrf)
	body, _ := json.Marshal(map[string]string{"username": "admin", "password": "admin"})
	loginReq := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(body))
	loginReq.Header.Set("Content-Type", "application/json")
	loginW := httptest.NewRecorder()
	router.ServeHTTP(loginW, loginReq)

	cookies := loginW.Result().Cookies()
	var csrfToken string
	for _, c := range cookies {
		if c.Name == "hops_csrf" {
			csrfToken = c.Value
		}
	}

	// Logout with cookie + CSRF header
	req := httptest.NewRequest("POST", "/api/auth/logout", nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	req.Header.Set("X-CSRF-Token", csrfToken)
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

	token, csrf := loginTestUserWithCSRF(t, router)

	req := authedRequest("POST", "/api/auth/logout", nil, token, csrf)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestUpdateConfig(t *testing.T) {
	router, _ := setupTestRouter(t)

	token, csrf := loginTestUserWithCSRF(t, router)

	newConfig := map[string]interface{}{
		"dashboards": []interface{}{},
		"theme":      map[string]string{"mode": "light"},
	}
	body, _ := json.Marshal(newConfig)

	req := authedRequest("PUT", "/api/config", bytes.NewReader(body), token, csrf)
	req.Header.Set("Content-Type", "application/json")
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

// --- Config Export/Reset Tests ---

func TestExportConfig(t *testing.T) {
	router, _ := setupTestRouter(t)
	token := loginTestUser(t, router)

	req := httptest.NewRequest("GET", "/api/config/export", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Export should return valid JSON
	var result map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("export response is not valid JSON: %v", err)
	}
}

func TestExportConfigRequiresAuth(t *testing.T) {
	router, _ := setupTestRouter(t)

	req := httptest.NewRequest("GET", "/api/config/export", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestResetConfig(t *testing.T) {
	router, _ := setupTestRouter(t)
	token, csrf := loginTestUserWithCSRF(t, router)

	req := authedRequest("POST", "/api/config/reset", nil, token, csrf)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestResetConfigRequiresAuth(t *testing.T) {
	router, _ := setupTestRouter(t)

	req := httptest.NewRequest("POST", "/api/config/reset", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// --- Change Password Tests ---

func TestChangePassword(t *testing.T) {
	router, _ := setupTestRouter(t)
	token, csrf := loginTestUserWithCSRF(t, router)

	body, _ := json.Marshal(map[string]string{
		"oldPassword": "admin",
		"newPassword": "newpassword123",
	})
	req := authedRequest("POST", "/api/auth/change-password", bytes.NewReader(body), token, csrf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Verify new password works
	loginBody, _ := json.Marshal(map[string]string{"username": "admin", "password": "newpassword123"})
	loginReq := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	loginW := httptest.NewRecorder()
	router.ServeHTTP(loginW, loginReq)

	if loginW.Code != http.StatusOK {
		t.Fatalf("login with new password failed: expected 200, got %d", loginW.Code)
	}
}

func TestChangePasswordWrongOld(t *testing.T) {
	router, _ := setupTestRouter(t)
	token, csrf := loginTestUserWithCSRF(t, router)

	body, _ := json.Marshal(map[string]string{
		"oldPassword": "wrongpassword",
		"newPassword": "newpassword123",
	})
	req := authedRequest("POST", "/api/auth/change-password", bytes.NewReader(body), token, csrf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for wrong old password, got %d", w.Code)
	}
}

func TestLoginReturnsMustChangePasswordFlag(t *testing.T) {
	router, db := setupTestRouter(t)

	// Mark user as needing password change
	db.Exec("UPDATE users SET must_change_password = 1 WHERE id = 1")

	body, _ := json.Marshal(map[string]string{"username": "admin", "password": "admin"})
	req := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["mustChangePassword"] != true {
		t.Errorf("expected mustChangePassword: true, got %v", resp["mustChangePassword"])
	}
}

func TestAuthCheckReturnsMustChangePasswordFlag(t *testing.T) {
	router, db := setupTestRouter(t)
	token := loginTestUser(t, router)

	// Mark user as needing password change after login
	db.Exec("UPDATE users SET must_change_password = 1 WHERE id = 1")

	req := httptest.NewRequest("GET", "/api/auth/check", nil)
	req.Header.Set("Authorization", "Bearer "+token)
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
	if !resp["mustChangePassword"] {
		t.Fatal("expected mustChangePassword: true")
	}
}

func TestChangePasswordClearsMustChangeFlag(t *testing.T) {
	router, db := setupTestRouter(t)

	// Set must_change_password before login
	db.Exec("UPDATE users SET must_change_password = 1 WHERE id = 1")

	token, csrf := loginTestUserWithCSRF(t, router)

	body, _ := json.Marshal(map[string]string{
		"oldPassword": "admin",
		"newPassword": "newpassword123",
	})
	req := authedRequest("POST", "/api/auth/change-password", bytes.NewReader(body), token, csrf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Verify flag is cleared
	var mustChange int
	db.QueryRow("SELECT must_change_password FROM users WHERE id = 1").Scan(&mustChange)
	if mustChange != 0 {
		t.Errorf("expected must_change_password=0 after change, got %d", mustChange)
	}
}

func TestChangePasswordRequiresAuth(t *testing.T) {
	router, _ := setupTestRouter(t)

	body, _ := json.Marshal(map[string]string{
		"oldPassword": "admin",
		"newPassword": "newpassword123",
	})
	req := httptest.NewRequest("POST", "/api/auth/change-password", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// --- Icon Category CRUD Tests ---

func TestCreateAndGetIconCategory(t *testing.T) {
	router, _ := setupTestRouter(t)
	token, csrf := loginTestUserWithCSRF(t, router)

	// Create category
	body, _ := json.Marshal(map[string]interface{}{
		"id":    "test-cat",
		"name":  "Test Category",
		"icon":  "mdi:test",
		"order": 0,
	})
	req := authedRequest("POST", "/api/icon-categories", bytes.NewReader(body), token, csrf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("create category: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// List categories
	req = httptest.NewRequest("GET", "/api/icon-categories", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("list categories: expected 200, got %d", w.Code)
	}

	var categories []map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &categories)
	if len(categories) == 0 {
		t.Fatal("expected at least one category")
	}
}

func TestDeleteIconCategory(t *testing.T) {
	router, db := setupTestRouter(t)
	token, csrf := loginTestUserWithCSRF(t, router)

	// Insert a category directly
	db.Exec("INSERT INTO icon_categories (id, name, icon, order_num, is_preset) VALUES (?, ?, ?, ?, ?)",
		"del-cat", "Delete Me", "mdi:trash", 0, false)

	req := authedRequest("DELETE", "/api/icon-categories/del-cat", nil, token, csrf)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("delete category: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Verify deleted
	var count int
	db.QueryRow("SELECT COUNT(*) FROM icon_categories WHERE id = 'del-cat'").Scan(&count)
	if count != 0 {
		t.Fatal("category was not deleted")
	}
}

func TestDeleteIconCategoryRequiresAuth(t *testing.T) {
	router, db := setupTestRouter(t)
	db.Exec("INSERT INTO icon_categories (id, name, icon, order_num, is_preset) VALUES (?, ?, ?, ?, ?)",
		"auth-cat", "Auth Test", "mdi:lock", 0, false)

	req := httptest.NewRequest("DELETE", "/api/icon-categories/auth-cat", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// --- Icon CRUD Tests ---

func TestCreateAndGetIcon(t *testing.T) {
	router, db := setupTestRouter(t)
	token, csrf := loginTestUserWithCSRF(t, router)

	// Create category first
	db.Exec("INSERT INTO icon_categories (id, name, icon, order_num) VALUES (?, ?, ?, ?)",
		"icons-cat", "Icons", "mdi:icon", 0)

	// Create icon
	body, _ := json.Marshal(map[string]interface{}{
		"id":         "test-icon",
		"name":       "Test Icon",
		"icon":       "mdi:test",
		"categoryId": "icons-cat",
	})
	req := authedRequest("POST", "/api/icons", bytes.NewReader(body), token, csrf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("create icon: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// List icons
	req = httptest.NewRequest("GET", "/api/icons", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("list icons: expected 200, got %d", w.Code)
	}

	var icons []map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &icons)
	if len(icons) == 0 {
		t.Fatal("expected at least one icon")
	}
}

func TestDeleteIcon(t *testing.T) {
	router, db := setupTestRouter(t)
	token, csrf := loginTestUserWithCSRF(t, router)

	db.Exec("INSERT INTO icon_categories (id, name, icon, order_num) VALUES (?, ?, ?, ?)",
		"del-icon-cat", "Cat", "mdi:cat", 0)
	db.Exec("INSERT INTO icons (id, name, icon, category_id) VALUES (?, ?, ?, ?)",
		"del-icon", "Delete Me", "mdi:trash", "del-icon-cat")

	req := authedRequest("DELETE", "/api/icons/del-icon", nil, token, csrf)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("delete icon: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var count int
	db.QueryRow("SELECT COUNT(*) FROM icons WHERE id = 'del-icon'").Scan(&count)
	if count != 0 {
		t.Fatal("icon was not deleted")
	}
}

func TestDeleteIconRequiresAuth(t *testing.T) {
	router, db := setupTestRouter(t)
	db.Exec("INSERT INTO icon_categories (id, name, icon, order_num) VALUES (?, ?, ?, ?)",
		"auth-icon-cat", "Cat", "mdi:cat", 0)
	db.Exec("INSERT INTO icons (id, name, icon, category_id) VALUES (?, ?, ?, ?)",
		"auth-icon", "Auth Test", "mdi:lock", "auth-icon-cat")

	req := httptest.NewRequest("DELETE", "/api/icons/auth-icon", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// --- Foreign Key Cascade Tests ---

func TestCascadeDeleteIconsOnCategoryDelete(t *testing.T) {
	router, db := setupTestRouter(t)
	token, csrf := loginTestUserWithCSRF(t, router)

	db.Exec("INSERT INTO icon_categories (id, name, icon, order_num) VALUES (?, ?, ?, ?)",
		"cascade-cat", "Cascade", "mdi:cascade", 0)
	db.Exec("INSERT INTO icons (id, name, icon, category_id) VALUES (?, ?, ?, ?)",
		"cascade-icon-1", "Icon 1", "mdi:one", "cascade-cat")
	db.Exec("INSERT INTO icons (id, name, icon, category_id) VALUES (?, ?, ?, ?)",
		"cascade-icon-2", "Icon 2", "mdi:two", "cascade-cat")

	// Delete the category
	req := authedRequest("DELETE", "/api/icon-categories/cascade-cat", nil, token, csrf)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("delete category: expected 200, got %d", w.Code)
	}

	// Icons should be cascaded
	var count int
	db.QueryRow("SELECT COUNT(*) FROM icons WHERE category_id = 'cascade-cat'").Scan(&count)
	if count != 0 {
		t.Fatalf("expected cascade delete to remove icons, but %d remain", count)
	}
}

// --- Icon Matching Tests ---

func TestMatchIconInMemoryExact(t *testing.T) {
	icons := []iconRecord{
		{Name: "proxmox", ID: "proxmox", Normalized: "proxmox", Icon: "mdi:proxmox", HasImage: false},
		{Name: "google", ID: "google", Normalized: "google", Icon: "mdi:google", ImageURL: "/icons/google.svg", HasImage: true},
	}

	m, found := matchIconInMemory("Google", icons)
	if !found {
		t.Fatal("expected to find match for 'Google'")
	}
	if m.ImageURL != "/icons/google.svg" {
		t.Fatalf("expected image_url match, got icon=%q imageURL=%q", m.Icon, m.ImageURL)
	}
}

func TestMatchIconInMemoryNormalized(t *testing.T) {
	icons := []iconRecord{
		{Name: "home assistant", ID: "home-assistant", Normalized: "homeassistant", Icon: "mdi:home-assistant", HasImage: true, ImageURL: "/icons/ha.svg"},
	}

	m, found := matchIconInMemory("HomeAssistant", icons)
	if !found {
		t.Fatal("expected to find match for 'HomeAssistant'")
	}
	if m.ImageURL != "/icons/ha.svg" {
		t.Fatalf("expected normalized match, got %+v", m)
	}
}

func TestMatchIconInMemoryBrandAlias(t *testing.T) {
	icons := []iconRecord{
		{Name: "home-assistant", ID: "home-assistant", Normalized: "homeassistant", Icon: "mdi:home-assistant", HasImage: true, ImageURL: "/icons/ha.svg"},
	}

	// "hass" is an alias for "home-assistant"
	m, found := matchIconInMemory("hass", icons)
	if !found {
		t.Fatal("expected to find match for alias 'hass'")
	}
	if m.ImageURL != "/icons/ha.svg" {
		t.Fatalf("expected alias match, got %+v", m)
	}
}

func TestMatchIconInMemoryNoMatch(t *testing.T) {
	icons := []iconRecord{
		{Name: "proxmox", ID: "proxmox", Normalized: "proxmox", Icon: "mdi:proxmox"},
	}

	_, found := matchIconInMemory("nonexistent-service-xyz", icons)
	if found {
		t.Fatal("expected no match for unknown service")
	}
}

func TestMatchIconInMemoryEmpty(t *testing.T) {
	_, found := matchIconInMemory("", nil)
	if found {
		t.Fatal("expected no match for empty name")
	}
}

func TestMatchIconInMemoryPrefersImage(t *testing.T) {
	icons := []iconRecord{
		{Name: "nginx", ID: "nginx", Normalized: "nginx", Icon: "mdi:nginx", HasImage: false},
		{Name: "nginx", ID: "nginx-svg", Normalized: "nginx", Icon: "", ImageURL: "/icons/nginx.svg", HasImage: true},
	}

	m, found := matchIconInMemory("nginx", icons)
	if !found {
		t.Fatal("expected to find match")
	}
	if m.ImageURL != "/icons/nginx.svg" {
		t.Fatalf("expected image match to be preferred, got %+v", m)
	}
}

// --- Rate Limiter Cleanup Test ---

func TestRateLimiterCleanup(t *testing.T) {
	rl := NewRateLimiter(5, 50*time.Millisecond)
	defer rl.Stop()

	// Add some attempts
	rl.Allow("192.168.1.1")
	rl.Allow("192.168.1.2")

	// Wait for entries to expire
	time.Sleep(100 * time.Millisecond)

	// Run cleanup
	rl.cleanup()

	rl.mu.Lock()
	count := len(rl.attempts)
	rl.mu.Unlock()

	if count != 0 {
		t.Fatalf("expected cleanup to remove expired entries, got %d remaining", count)
	}
}

// --- Method Not Allowed Tests ---

func TestUpdateConfigRequiresAuth(t *testing.T) {
	router, _ := setupTestRouter(t)

	body, _ := json.Marshal(map[string]interface{}{"dashboards": []interface{}{}})
	req := httptest.NewRequest("PUT", "/api/config", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// --- CSRF Protection Tests ---

func TestLoginIssuesCSRFCookie(t *testing.T) {
	router, _ := setupTestRouter(t)

	body, _ := json.Marshal(map[string]string{"username": "admin", "password": "admin"})
	req := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	var csrfCookie *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == "hops_csrf" {
			csrfCookie = c
			break
		}
	}

	if csrfCookie == nil {
		t.Fatal("expected hops_csrf cookie to be set on login")
	}
	if csrfCookie.Value == "" {
		t.Fatal("expected hops_csrf cookie to have a value")
	}
	if csrfCookie.HttpOnly {
		t.Fatal("hops_csrf cookie must NOT be HttpOnly (JS needs to read it)")
	}
	if csrfCookie.SameSite != http.SameSiteStrictMode {
		t.Errorf("expected SameSite=Strict, got %v", csrfCookie.SameSite)
	}
	if len(csrfCookie.Value) < 32 {
		t.Errorf("expected token length >= 32 chars, got %d", len(csrfCookie.Value))
	}
}

func TestProtectedMutationWithoutCSRFFails(t *testing.T) {
	router, _ := setupTestRouter(t)
	token := loginTestUser(t, router)

	// Try to logout without sending CSRF token
	req := httptest.NewRequest("POST", "/api/auth/logout", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 without CSRF token, got %d", w.Code)
	}
}

func TestProtectedMutationWithMismatchedCSRFFails(t *testing.T) {
	router, _ := setupTestRouter(t)
	token, csrf := loginTestUserWithCSRF(t, router)

	req := httptest.NewRequest("POST", "/api/auth/logout", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	// Cookie has the real token, header has a different one
	req.AddCookie(&http.Cookie{Name: "hops_csrf", Value: csrf})
	req.Header.Set("X-CSRF-Token", "this-is-not-the-right-token")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for mismatched CSRF, got %d", w.Code)
	}
}

func TestProtectedMutationWithMissingCookieFails(t *testing.T) {
	router, _ := setupTestRouter(t)
	token, csrf := loginTestUserWithCSRF(t, router)

	// Send header but no cookie
	req := httptest.NewRequest("POST", "/api/auth/logout", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-CSRF-Token", csrf)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 with missing CSRF cookie, got %d", w.Code)
	}
}

func TestGETRequestSkipsCSRFCheck(t *testing.T) {
	router, _ := setupTestRouter(t)
	token := loginTestUser(t, router)

	// GET requests should NOT require a CSRF token
	req := httptest.NewRequest("GET", "/api/auth/check", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected GET to bypass CSRF check, got %d", w.Code)
	}
}

func TestLogoutClearsCSRFCookie(t *testing.T) {
	router, _ := setupTestRouter(t)
	token, csrf := loginTestUserWithCSRF(t, router)

	req := authedRequest("POST", "/api/auth/logout", nil, token, csrf)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	var csrfCleared bool
	for _, c := range w.Result().Cookies() {
		if c.Name == "hops_csrf" && c.MaxAge < 0 {
			csrfCleared = true
			break
		}
	}
	if !csrfCleared {
		t.Fatal("expected logout to clear hops_csrf cookie")
	}
}

func TestAuthCheckIssuesCSRFIfMissing(t *testing.T) {
	router, _ := setupTestRouter(t)

	// Login to establish a session
	body, _ := json.Marshal(map[string]string{"username": "admin", "password": "admin"})
	loginReq := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(body))
	loginReq.Header.Set("Content-Type", "application/json")
	loginW := httptest.NewRecorder()
	router.ServeHTTP(loginW, loginReq)

	// Find the session cookie
	var sessionCookie *http.Cookie
	for _, c := range loginW.Result().Cookies() {
		if c.Name == "hops_session" {
			sessionCookie = c
			break
		}
	}
	if sessionCookie == nil {
		t.Fatal("login did not set session cookie")
	}

	// Call auth-check with ONLY the session cookie (no CSRF cookie)
	req := httptest.NewRequest("GET", "/api/auth/check", nil)
	req.AddCookie(sessionCookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	// Auth-check should have issued a fresh CSRF cookie
	var csrfCookie *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == "hops_csrf" {
			csrfCookie = c
			break
		}
	}
	if csrfCookie == nil {
		t.Fatal("expected auth-check to issue CSRF cookie when missing")
	}
	if csrfCookie.Value == "" {
		t.Fatal("expected CSRF cookie to have a value")
	}
}

func TestAllMutationMethodsRequireCSRF(t *testing.T) {
	router, db := setupTestRouter(t)
	token := loginTestUser(t, router)

	// Seed an icon to test PUT/DELETE
	db.Exec("INSERT INTO icon_categories (id, name, icon, order_num) VALUES (?, ?, ?, ?)",
		"csrf-cat", "Cat", "mdi:cat", 0)
	db.Exec("INSERT INTO icons (id, name, icon, category_id) VALUES (?, ?, ?, ?)",
		"csrf-icon", "Test", "mdi:test", "csrf-cat")

	tests := []struct {
		method string
		path   string
		body   io.Reader
	}{
		{"POST", "/api/auth/logout", nil},
		{"POST", "/api/config/reset", nil},
		{"PUT", "/api/config", bytes.NewReader([]byte(`{"dashboards":[]}`))},
		{"PUT", "/api/icons/csrf-icon", bytes.NewReader([]byte(`{"name":"x"}`))},
		{"DELETE", "/api/icons/csrf-icon", nil},
	}

	for _, tt := range tests {
		req := httptest.NewRequest(tt.method, tt.path, tt.body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusForbidden {
			t.Errorf("%s %s: expected 403 without CSRF, got %d", tt.method, tt.path, w.Code)
		}
	}
}

func TestMethodNotAllowed(t *testing.T) {
	router, _ := setupTestRouter(t)

	tests := []struct {
		method string
		path   string
	}{
		{"DELETE", "/api/health"},
		{"POST", "/api/version"},
		{"DELETE", "/api/config"},
	}

	for _, tt := range tests {
		req := httptest.NewRequest(tt.method, tt.path, nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s %s: expected 405, got %d", tt.method, tt.path, w.Code)
		}
	}
}
