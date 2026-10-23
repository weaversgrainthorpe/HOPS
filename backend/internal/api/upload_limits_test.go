package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/settings"
)

// M5 §10: upload limits read plainly and an oversize upload is refused with a
// message that names both the limit and the file's size.

func multipartFile(t *testing.T, field, filename, contentType string, data []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	h := make(map[string][]string)
	h["Content-Disposition"] = []string{`form-data; name="` + field + `"; filename="` + filename + `"`}
	h["Content-Type"] = []string{contentType}
	fw, err := mw.CreatePart(h)
	if err != nil {
		t.Fatal(err)
	}
	fw.Write(data)
	mw.Close()
	return &buf, mw.FormDataContentType()
}

func postUpload(t *testing.T, router http.Handler, tok, csrf, path, contentType string, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	body, ct := multipartFile(t, "file", "big.png", contentType, data)
	req := authedRequest("POST", path, body, tok, csrf)
	req.Header.Set("Content-Type", ct)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func errorMessage(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var resp struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode error body %q: %v", w.Body.String(), err)
	}
	return resp.Error
}

func TestOversizeUploadsAreRefusedNamingLimitAndSize(t *testing.T) {
	router, _ := setupTestRouter(t)
	tok, csrf := loginTestUserWithCSRF(t, router)
	for _, key := range []string{settings.KeyUploadMaxBytesImport, settings.KeyUploadMaxBytesBackground, settings.KeyUploadMaxBytesIcon} {
		if w := putSetting(t, router, tok, csrf, key, strconv.Itoa(1<<20)); w.Code != http.StatusOK {
			t.Fatalf("set %s: %d %s", key, w.Code, w.Body.String())
		}
	}
	big := bytes.Repeat([]byte("x"), 3*(1<<20)/2) // 1.5 MB
	cases := []struct{ name, path, phrase string }{
		{"import", "/api/config/import", "largest file you can import"},
		{"background", "/api/backgrounds", "largest background image"},
		{"icon", "/api/icons/upload", "largest icon file"},
	}
	for _, c := range cases {
		w := postUpload(t, router, tok, csrf, c.path, "image/png", big)
		if w.Code != http.StatusRequestEntityTooLarge {
			t.Errorf("%s: status %d, want 413 (body %s)", c.name, w.Code, w.Body.String())
			continue
		}
		msg := errorMessage(t, w)
		for _, want := range []string{"1.5 MB", "1 MB", c.phrase} {
			if !strings.Contains(msg, want) {
				t.Errorf("%s: message %q does not contain %q", c.name, msg, want)
			}
		}
	}
}

func TestUploadJustUnderTheLimitIsAccepted(t *testing.T) {
	// The cap applies to the file, not the multipart envelope around it.
	router, _ := setupTestRouter(t)
	tok, csrf := loginTestUserWithCSRF(t, router)
	if w := putSetting(t, router, tok, csrf, settings.KeyUploadMaxBytesBackground, strconv.Itoa(1<<20)); w.Code != http.StatusOK {
		t.Fatal(w.Body.String())
	}
	w := postUpload(t, router, tok, csrf, "/api/backgrounds", "image/png", bytes.Repeat([]byte("x"), 1<<20))
	if w.Code != http.StatusOK {
		t.Fatalf("a file exactly at the limit must be accepted: %d %s", w.Code, w.Body.String())
	}
}

func TestUploadLimitsEndpoint(t *testing.T) {
	router, _ := setupTestRouter(t)
	tok, csrf := loginTestUserWithCSRF(t, router)
	req := authedRequest("GET", "/api/upload-limits", nil, tok, csrf)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/upload-limits: %d %s", w.Code, w.Body.String())
	}
	var got map[string]int
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]int{"import": 50 << 20, "background": 25 << 20, "icon": 2 << 20}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %d, want %d", k, got[k], v)
		}
	}

	unauth := httptest.NewRequest("GET", "/api/upload-limits", nil)
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, unauth)
	if w2.Code != http.StatusUnauthorized {
		t.Errorf("unauthenticated: %d, want 401", w2.Code)
	}
}

func TestSettingsListReportsClampedValues(t *testing.T) {
	router, _ := setupTestRouterWithSettingsRows(t, "", nil, map[string]string{
		settings.KeyUploadMaxBytesImport: strconv.Itoa(1 << 30),
	})
	tok, csrf := loginTestUserWithCSRF(t, router)
	list := getSettings(t, router, tok, csrf)
	imp := findSetting(t, list, settings.KeyUploadMaxBytesImport)
	if imp.Value != strconv.Itoa(200<<20) {
		t.Errorf("value = %s, want the 200 MB ceiling", imp.Value)
	}
	if imp.AdjustedFrom != strconv.Itoa(1<<30) {
		t.Errorf("adjustedFrom = %q, want the stored 1 GB", imp.AdjustedFrom)
	}
	if bg := findSetting(t, list, settings.KeyUploadMaxBytesBackground); bg.AdjustedFrom != "" {
		t.Errorf("background adjustedFrom = %q, want empty", bg.AdjustedFrom)
	}
	// Saving clears it.
	if w := putSetting(t, router, tok, csrf, settings.KeyUploadMaxBytesImport, strconv.Itoa(200<<20)); w.Code != http.StatusOK {
		t.Fatal(w.Body.String())
	}
	if imp := findSetting(t, getSettings(t, router, tok, csrf), settings.KeyUploadMaxBytesImport); imp.AdjustedFrom != "" {
		t.Errorf("after save adjustedFrom = %q, want empty", imp.AdjustedFrom)
	}
}
