package api

import (
	"database/sql"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/converters"
	"github.com/weaversgrainthorpe/HOPS/internal/settings"
	_ "modernc.org/sqlite"
)

func warningRouter(t *testing.T) *Router {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	if _, err := db.Exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`); err != nil {
		t.Fatal(err)
	}
	svc, err := settings.New(db)
	if err != nil {
		t.Fatal(err)
	}
	return &Router{settings: svc}
}

func importWarning(t *testing.T, r *Router, data []byte) string {
	t.Helper()
	w := httptest.NewRecorder()
	r.setImportWarning(w, data)
	s, err := url.PathUnescape(w.Header().Get(ImportWarningHeader))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// An export HOPS couldn't import back says so (the page shows it) and names
// Backups, which move a setup of any size.
func TestExportImportWarning(t *testing.T) {
	r := warningRouter(t)
	if got := importWarning(t, r, []byte(`{"format":"hops-export","config":{"dashboards":[]}}`)); got != "" {
		t.Fatalf("a small export warned: %q", got)
	}

	many := "[" + strings.Repeat("1,", converters.MaxImportNodes) + "1]"
	got := importWarning(t, r, []byte(many))
	if !strings.Contains(got, "can't be imported back into HOPS as it is: it has more than 250000 entries.") || !strings.Contains(got, "Settings › Backups") {
		t.Fatalf("too many entries: %q", got)
	}

	if err := r.settings.Set(settings.KeyUploadMaxBytesImport, strconv.Itoa(settings.MB)); err != nil {
		t.Fatal(err)
	}
	big := []byte(`"` + strings.Repeat("x", 2*settings.MB) + `"`)
	got = importWarning(t, r, big)
	if !strings.Contains(got, "This export is 2 MB, bigger than the largest file HOPS imports (1 MB") || !strings.Contains(got, "Settings › Backups") {
		t.Fatalf("over the size limit: %q", got)
	}
}
