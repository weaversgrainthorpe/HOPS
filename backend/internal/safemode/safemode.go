// Package safemode serves the page HOPS shows instead of starting when an
// interrupted restore left the data files in a state it can't resolve with
// certainty (database.UnsafeStartError). It never opens or creates the
// database: every route answers 503 with the same actionable message, and
// /api/health answers 503 with a JSON reason. The process stays up so a
// service manager doesn't restart-loop it.
package safemode

import (
	"context"
	"encoding/json"
	"errors"
	"html/template"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/database"
)

// LastPortFile (in the data directory) holds the port the server last
// listened on. The port is a database setting, and safe mode must not open
// the database, so main writes this at every normal start.
const LastPortFile = ".last-port"

// DefaultPort is used when LastPortFile is missing or unreadable.
const DefaultPort = 8080

// RememberPort records the port for safe mode (errors are returned for the
// caller to log; a missing file only means safe mode falls back to 8080).
func RememberPort(dataDir string, port int) error {
	return os.WriteFile(filepath.Join(dataDir, LastPortFile), []byte(strconv.Itoa(port)+"\n"), 0644)
}

// Port is the port to serve safe mode on: the last one HOPS used, else 8080.
func Port(dataDir string) int {
	raw, err := os.ReadFile(filepath.Join(dataDir, LastPortFile))
	if err != nil {
		return DefaultPort
	}
	p, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil || p < 1 || p > 65535 {
		return DefaultPort
	}
	return p
}

var page = template.Must(template.New("safe").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>HOPS can't start safely</title>
<style>
body{margin:0;background:#0f172a;color:#e2e8f0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:46rem;margin:0 auto;padding:2rem 1rem}
h1{color:#fde68a;font-size:1.6rem;margin:0 0 1rem}
.ok{background:#14532d;color:#dcfce7;border:1px solid #22c55e;border-radius:.5rem;padding:.6rem .9rem}
code{background:#1e293b;padding:.1rem .3rem;border-radius:.25rem;word-break:break-all}
li{margin:.35rem 0}
</style></head>
<body><main>
<h1>HOPS can't start safely</h1>
<p>A restore was interrupted and {{.What}}.</p>
<p class="ok"><strong>Nothing was deleted.</strong> HOPS has not opened its database, so nothing has changed since it stopped.</p>
<h2>Files present</h2>
<ul>{{range .Files}}<li><code>{{.}}</code></li>{{end}}</ul>
<h2>To recover</h2>
<p>Stop HOPS, then:</p>
<ol>{{range .Steps}}<li>{{.}}</li>{{end}}</ol>
<p>Every page answers like this until then.</p>
</main></body></html>
`))

// stepText drops the "1. " numbering (the page uses an ordered list).
func stepText(s string) string {
	if i := strings.Index(s, ". "); i > 0 && i < 4 {
		return s[i+2:]
	}
	return s
}

// Handler answers every request with 503: /api/health as JSON, everything
// else the help page.
func Handler(e *database.UnsafeStartError) http.Handler {
	steps := make([]string, len(e.Steps))
	for i, s := range e.Steps {
		steps[i] = stepText(s)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Retry-After", "60")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.URL.Path == "/api/health" || strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status": "unsafe-to-start",
				"reason": e.Msg,
				"files":  e.Files,
				"steps":  e.Steps,
			})
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
		w.WriteHeader(http.StatusServiceUnavailable)
		page.Execute(w, map[string]interface{}{"What": e.What, "Files": e.Files, "Steps": steps})
	})
}

// Serve serves the help page on addr until ctx is done. A listen failure
// is returned (the caller logs it and stays up).
func Serve(ctx context.Context, addr string, e *database.UnsafeStartError) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	srv := &http.Server{Handler: Handler(e), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(sctx)
	}()
	slog.Error("serving the 'HOPS can't start safely' page", "component", "safemode", "addr", ln.Addr().String())
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
