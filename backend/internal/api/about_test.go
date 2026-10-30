package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The data folder is for the signed-in admin only: a signed-out request is
// refused and gets no path, and the public version answer carries none.
func TestAboutDataDirSignedInOnly(t *testing.T) {
	dir := t.TempDir()
	_, router, _ := setupTestRouterInDir(t, dir)

	for _, path := range []string{"/api/about", "/api/version"} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if path == "/api/about" && w.Code != http.StatusUnauthorized {
			t.Errorf("signed-out %s: status %d, want 401", path, w.Code)
		}
		if strings.Contains(w.Body.String(), "dataDir") || strings.Contains(w.Body.String(), dir) {
			t.Errorf("signed-out %s shows the data folder: %s", path, w.Body.String())
		}
	}

	token := loginTestUser(t, router)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, authedRequest("GET", "/api/about", nil, token, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("signed-in: status %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		DataDir string `json:"dataDir"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil || resp.DataDir != dir {
		t.Errorf("dataDir = %q (err %v), want %q", resp.DataDir, err, dir)
	}
}
