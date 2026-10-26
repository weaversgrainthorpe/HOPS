package api

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// §3 security pass: normal icon and background uploads refuse decompression
// bombs from the header alone (before any full decode), with a 4xx naming the
// reason; SVG icons are served as image/svg+xml with the sandbox CSP and
// nosniff. Synthetic data only.

// pngClaiming returns a tiny valid PNG whose IHDR claims w×h (the CRC is
// fixed up so image.DecodeConfig accepts it).
func pngClaiming(t *testing.T, w, h uint32) []byte {
	t.Helper()
	b := append([]byte(nil), pngBytes(t)...)
	// 8-byte signature, then IHDR: length(4) "IHDR"(4) width(4) height(4)...
	binary.BigEndian.PutUint32(b[16:20], w)
	binary.BigEndian.PutUint32(b[20:24], h)
	crc := crc32.ChecksumIEEE(b[12:29])
	binary.BigEndian.PutUint32(b[29:33], crc)
	return b
}

func uploadPart(t *testing.T, c *apiClient, path, filename, contentType string, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="` + filename + `"`},
		"Content-Type":        {contentType},
	})
	if err != nil {
		t.Fatal(err)
	}
	fw.Write(data)
	mw.Close()
	return c.rawReq("POST", path, buf.Bytes(), mw.FormDataContentType())
}

func TestUploadsRefuseImageBombsBeforeDecode(t *testing.T) {
	dir := t.TempDir()
	_, router, _ := setupTestRouterInDir(t, dir)
	c := newClient(t, router)
	cases := []struct {
		name string
		w, h uint32
	}{
		{"too wide", 16385, 10},
		{"too tall", 10, 16385},
		{"too many pixels", 10000, 10000}, // 100 MP, each side within the cap
		{"huge", 1 << 20, 1 << 20},
	}
	for _, tc := range cases {
		for _, ep := range []string{"/api/icons/upload", "/api/backgrounds"} {
			w := uploadPart(t, c, ep, "bomb.png", "image/png", pngClaiming(t, tc.w, tc.h))
			if w.Code != 400 {
				t.Fatalf("%s %s: want 400, got %d %s", ep, tc.name, w.Code, w.Body.String())
			}
			if !strings.Contains(w.Body.String(), "too large") {
				t.Fatalf("%s %s: the reason isn't stated: %s", ep, tc.name, w.Body.String())
			}
		}
	}
	// Nothing was kept.
	for _, sub := range []string{"icons", "backgrounds"} {
		ents, _ := os.ReadDir(filepath.Join(dir, sub))
		if len(ents) != 0 {
			t.Fatalf("%s: a refused upload left %d files", sub, len(ents))
		}
	}
	// The caps themselves are allowed (header-only for a background).
	if w := uploadPart(t, c, "/api/backgrounds", "edge.png", "image/png", pngClaiming(t, 16384, 2000)); w.Code != 200 {
		t.Fatalf("a background at the side cap: %d %s", w.Code, w.Body.String())
	}
	// A background that isn't the image its type says is refused.
	if w := uploadPart(t, c, "/api/backgrounds", "x.jpg", "image/jpeg", pngBytes(t)); w.Code != 400 {
		t.Fatalf("PNG declared as JPEG: %d %s", w.Code, w.Body.String())
	}
	if w := uploadPart(t, c, "/api/backgrounds", "x.png", "image/png", []byte("not an image")); w.Code != 400 {
		t.Fatalf("garbage background: %d %s", w.Code, w.Body.String())
	}
	// A normal image still uploads.
	if w := uploadPart(t, c, "/api/icons/upload", "ok.png", "image/png", pngBytes(t)); w.Code != 200 {
		t.Fatalf("normal icon: %d %s", w.Code, w.Body.String())
	}
}

func TestUploadedSVGServedSandboxedAndNotSniffed(t *testing.T) {
	dir := t.TempDir()
	_, router, _ := setupTestRouterInDir(t, dir)
	c := newClient(t, router)
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1"/></svg>`)
	_, url := uploadedID(t, uploadPart(t, c, "/api/icons/upload", "evil.svg", "image/svg+xml", svg))
	if !strings.HasPrefix(url, "/icons/") || !strings.HasSuffix(url, ".svg") {
		t.Fatalf("url %q", url)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", url, nil))
	if w.Code != 200 {
		t.Fatalf("serve: %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "image/svg+xml" {
		t.Fatalf("Content-Type %q", ct)
	}
	if ns := w.Header().Get("X-Content-Type-Options"); ns != "nosniff" {
		t.Fatalf("X-Content-Type-Options %q", ns)
	}
	csp := w.Header().Get("Content-Security-Policy")
	for _, want := range []string{"sandbox", "default-src 'none'"} {
		if !strings.Contains(csp, want) {
			t.Fatalf("CSP %q lacks %q", csp, want)
		}
	}
	if strings.Contains(csp, "script-src") {
		t.Fatalf("CSP %q allows scripts", csp)
	}
	if cd := w.Header().Get("Content-Disposition"); strings.Contains(cd, "inline") {
		t.Fatalf("Content-Disposition %q", cd)
	}
}

func TestImportRefusesOversizedDocumentsWithTheReason(t *testing.T) {
	_, router, _ := setupTestRouterInDir(t, t.TempDir())
	c := newClient(t, router)
	var laughs strings.Builder
	laughs.WriteString("a0: &a0 [lol]\n")
	for i := 1; i <= 9; i++ {
		laughs.WriteString("a" + string(rune('0'+i)) + ": &a" + string(rune('0'+i)) + " [")
		for j := 0; j < 9; j++ {
			if j > 0 {
				laughs.WriteString(", ")
			}
			laughs.WriteString("*a" + string(rune('0'+i-1)))
		}
		laughs.WriteString("]\n")
	}
	laughs.WriteString("services: *a9\n")
	docs := map[string]string{
		"alias bomb": laughs.String(),
		"deep JSON":  `{"dashboards":` + strings.Repeat("[", 100) + strings.Repeat("]", 100) + `}`,
	}
	for name, doc := range docs {
		w := uploadPart(t, c, "/api/config/import", "x.yaml", "application/octet-stream", []byte(doc))
		if w.Code != 400 || !strings.Contains(w.Body.String(), "too deeply nested or has too many entries") {
			t.Errorf("%s: %d %s", name, w.Code, w.Body.String())
		}
	}
}
