//go:build dev

package api

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// With --frontend on disk (dev), index.html is hashed as served, so a UI
// rebuild while the server runs stays allowed.
func TestDiskFrontendCSPFollowsIndexHTML(t *testing.T) {
	_, h, _ := setupTestRouterInDir(t, t.TempDir())
	dir := t.TempDir()
	SetDevFrontendDir(dir)
	t.Cleanup(func() { SetDevFrontendDir("") })
	write := func(body string) {
		if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<script>"+body+"</script>"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, body := range []string{"first()", "second()"} {
		write(body)
		for _, p := range []string{"/", "/index.html", "/d/kitchen"} {
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest("GET", p, nil))
			if csp := w.Header().Get("Content-Security-Policy"); !strings.Contains(csp, cspHash(body)) {
				t.Errorf("GET %s after writing %q: CSP %q lacks its hash", p, body, csp)
			}
		}
	}
}
