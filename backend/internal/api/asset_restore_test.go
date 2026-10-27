package api

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/gif"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Pentest 2026-10-27 M1: an imported config's assets get the same checks as
// an upload of their kind; anything refused is listed with its reason and
// never written.
func TestRestoreAssetsAppliesTheUploadChecks(t *testing.T) {
	dir := t.TempDir()
	r, _, _ := setupTestRouterInDir(t, dir)
	b64 := func(b []byte) map[string]interface{} {
		return map[string]interface{}{"data": base64.StdEncoding.EncodeToString(b)}
	}
	big := append(pngBytes(t), bytes.Repeat([]byte{0}, 3<<20)...)
	assets := map[string]interface{}{
		"/icons/phish.html":           b64([]byte("<html><script>alert(1)</script></html>")),
		"/icons/evil.js":              b64([]byte("alert(1)")),
		"/icons/notpng.png":           b64(gifBytes(t)), // a GIF named .png
		"/icons/garbage.png":          b64([]byte("GIF89a not a png")),
		"/icons/bomb.png":             b64(pngClaiming(t, 65535, 65535)),
		"/backgrounds/../../evil.png": b64(pngBytes(t)),
		"/icons/..":                   b64(pngBytes(t)),
		"/backgrounds/bg.svg":         b64([]byte("<svg/>")),
		"/icons/ok.png":               b64(pngBytes(t)),
		"/icons/ok.svg":               b64([]byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`)),
		"/backgrounds/ok-bg.png":      b64(pngBytes(t)),
	}
	assets["/icons/huge.png"] = b64(big) // over the 2 MB default icon limit

	restored, failed := r.restoreAssets(map[string]interface{}{"assets": assets})
	if restored != 3 {
		t.Errorf("restored %d, want 3 (ok.png, ok.svg, ok-bg.png); failed=%v", restored, failed)
	}
	want := map[string]string{
		"/icons/phish.html":           "not an allowed image type",
		"/icons/evil.js":              "not an allowed image type",
		"/icons/notpng.png":           "not what .png says",
		"/icons/garbage.png":          "can't be used",
		"/icons/huge.png":             "upload limit",
		"/icons/bomb.png":             "too large",
		"/backgrounds/../../evil.png": "not a safe file name",
		"/icons/..":                   "not a safe file name",
		"/backgrounds/bg.svg":         "not an allowed image type",
	}
	joined := strings.Join(failed, "\n")
	if len(failed) != len(want) {
		t.Errorf("failed=%d, want %d:\n%s", len(failed), len(want), joined)
	}
	for path, reason := range want {
		found := false
		for _, f := range failed {
			if strings.HasPrefix(f, path+" (") && strings.Contains(f, reason) {
				found = true
			}
		}
		if !found {
			t.Errorf("%s not reported with %q:\n%s", path, reason, joined)
		}
	}
	// Nothing refused reached the disk.
	for _, p := range []string{"icons/phish.html", "icons/evil.js", "icons/notpng.png", "icons/garbage.png", "icons/huge.png", "icons/bomb.png", "evil.png", "backgrounds/evil.png", "backgrounds/bg.svg"} {
		if _, err := os.Stat(filepath.Join(dir, p)); err == nil {
			t.Errorf("%s was written", p)
		}
	}
	// The valid ones are there; the icon PNG was re-encoded (decodes as PNG).
	raw, err := os.ReadFile(filepath.Join(dir, "icons", "ok.png"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := png.Decode(bytes.NewReader(raw)); err != nil {
		t.Errorf("ok.png: %v", err)
	}
	for _, p := range []string{"icons/ok.svg", "backgrounds/ok-bg.png"} {
		if _, err := os.Stat(filepath.Join(dir, p)); err != nil {
			t.Errorf("%s not restored: %v", p, err)
		}
	}
}

// Files already on disk that aren't images are never served (e.g. planted
// by an import before the M1 fix).
func TestAssetRoutesServeOnlyImages(t *testing.T) {
	dir := t.TempDir()
	_, h, _ := setupTestRouterInDir(t, dir)
	for _, k := range []string{"icons", "backgrounds"} {
		if err := os.MkdirAll(filepath.Join(dir, k), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, k, "x.html"), []byte("<html>"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, k, "x.png"), pngBytes(t), 0o644); err != nil {
			t.Fatal(err)
		}
		if code := served(t, h, "/"+k+"/x.html"); code != 404 {
			t.Errorf("/%s/x.html: %d, want 404", k, code)
		}
		if code := served(t, h, "/"+k+"/x.png"); code != 200 {
			t.Errorf("/%s/x.png: %d, want 200", k, code)
		}
	}
}

// Pentest 2026-10-27 L2: a raster icon over the icon cap is refused with a
// clear 400 from its header alone, before any decode.
func TestIconUploadOverCapRefusedBeforeDecode(t *testing.T) {
	dir := t.TempDir()
	_, router, _ := setupTestRouterInDir(t, dir)
	c := newClient(t, router)
	// 3000×3000 is under the archive/background cap but over the icon cap.
	// The file holds only a 4×4 image's data, so a decode would fail with a
	// different error: "too large" proves the header check refused it first.
	w := uploadIconForm(t, c, "big.png", pngClaiming(t, 3000, 3000), nil)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "too large") || !strings.Contains(w.Body.String(), "2048") {
		t.Fatalf("over-cap icon: %d %s", w.Code, w.Body.String())
	}
	if _, err := checkImageHeader(pngClaiming(t, 3000, 3000)); err != nil {
		t.Fatalf("3000×3000 must still pass the background cap: %v", err)
	}
	// At the cap it is accepted (a real 2048×2048 image).
	img := image.NewGray(image.Rect(0, 0, maxIconImageSide, maxIconImageSide))
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	if w := uploadIconForm(t, c, "ok.png", b.Bytes(), nil); w.Code != 200 {
		t.Fatalf("at-cap icon: %d %s", w.Code, w.Body.String())
	}
}

func gifBytes(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := gif.Encode(&b, image.NewGray(image.Rect(0, 0, 4, 4)), nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
