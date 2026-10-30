package api

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func gzipServe(t *testing.T, h http.HandlerFunc, hdr map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("GET", "/x", nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	gzipMiddleware(h).ServeHTTP(w, req)
	return w
}

func gunzip(t *testing.T, b []byte) string {
	t.Helper()
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		t.Fatalf("not gzip: %v", err)
	}
	out, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("bad gzip: %v", err)
	}
	return string(out)
}

func TestGzipCompressesJSONForAGzipClient(t *testing.T) {
	big := `{"dashboards":"` + strings.Repeat("tile ", 20000) + `"}`
	w := gzipServe(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Length", "999")
		_, _ = io.WriteString(w, big)
	}, map[string]string{"Accept-Encoding": "br, gzip, deflate"})
	if w.Header().Get("Content-Encoding") != "gzip" || w.Header().Get("Content-Length") != "" {
		t.Fatalf("headers %v", w.Header())
	}
	if !strings.Contains(w.Header().Get("Vary"), "Accept-Encoding") {
		t.Fatalf("no Vary: %v", w.Header())
	}
	if w.Body.Len() > len(big)/10 {
		t.Fatalf("compressed %d of %d bytes", w.Body.Len(), len(big))
	}
	if got := gunzip(t, w.Body.Bytes()); got != big {
		t.Fatal("body changed by the round trip")
	}
}

func TestGzipLeavesOtherResponsesAlone(t *testing.T) {
	jsonH := func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"ok":true}`)
	}
	cases := []struct {
		name string
		h    http.HandlerFunc
		hdr  map[string]string
	}{
		{"no Accept-Encoding", jsonH, nil},
		{"gzip refused", jsonH, map[string]string{"Accept-Encoding": "gzip;q=0, deflate"}},
		{"range request", jsonH, map[string]string{"Accept-Encoding": "gzip", "Range": "bytes=0-3"}},
		{"a zip download", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/zip")
			_, _ = io.WriteString(w, "PK\x03\x04")
		}, map[string]string{"Accept-Encoding": "gzip"}},
		{"a picture", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "image/jpeg")
			_, _ = io.WriteString(w, "\xff\xd8\xff")
		}, map[string]string{"Accept-Encoding": "gzip"}},
		{"no content", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNoContent)
		}, map[string]string{"Accept-Encoding": "gzip"}},
	}
	for _, c := range cases {
		w := gzipServe(t, c.h, c.hdr)
		if w.Header().Get("Content-Encoding") != "" {
			t.Errorf("%s: compressed (%v)", c.name, w.Header())
		}
	}
}

func TestGzipErrorBodiesAndSniffedTypesStillDecode(t *testing.T) {
	w := gzipServe(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSONError(w, "Not found", http.StatusNotFound)
	}, map[string]string{"Accept-Encoding": "gzip"})
	if w.Code != http.StatusNotFound || !strings.Contains(gunzip(t, w.Body.Bytes()), "Not found") {
		t.Fatalf("%d %v", w.Code, w.Header())
	}
	w = gzipServe(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "<!doctype html><html><body>hi</body></html>")
	}, map[string]string{"Accept-Encoding": "gzip"})
	if !strings.HasPrefix(w.Header().Get("Content-Type"), "text/html") || gunzip(t, w.Body.Bytes()) == "" {
		t.Fatalf("sniffed html: %v", w.Header())
	}
}
