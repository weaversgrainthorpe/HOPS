package status

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/settings"
	_ "modernc.org/sqlite"
)

// newTestChecker builds a Checker over an in-memory DB holding the given
// dashboard config JSON. Schema mirrors internal/database (duplicated to
// avoid importing it).
func newTestChecker(t *testing.T, configJSON string) (*Checker, *sql.DB, *settings.Service) {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(1) // keep the single in-memory DB shared
	t.Cleanup(func() { db.Close() })
	for _, stmt := range []string{
		`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE config (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE status_cache (entry_id TEXT PRIMARY KEY, status TEXT NOT NULL, response_time INTEGER, last_checked DATETIME DEFAULT CURRENT_TIMESTAMP)`,
	} {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("schema: %v", err)
		}
	}
	if _, err := db.Exec("INSERT INTO config (id, data) VALUES (1, ?)", configJSON); err != nil {
		t.Fatalf("insert config: %v", err)
	}
	svc, err := settings.New(db)
	if err != nil {
		t.Fatalf("settings.New: %v", err)
	}
	return NewChecker(db, svc), db, svc
}

// hitCounter is an httptest server that records which paths were requested.
type hitCounter struct {
	mu   sync.Mutex
	hits map[string]int
	srv  *httptest.Server
}

func newHitCounter(t *testing.T) *hitCounter {
	h := &hitCounter{hits: map[string]int{}}
	h.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.mu.Lock()
		h.hits[r.URL.Path]++
		h.mu.Unlock()
	}))
	t.Cleanup(h.srv.Close)
	return h
}

func (h *hitCounter) count(path string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.hits[path]
}

func configWith(base string) string {
	return `{"dashboards":[{"tabs":[{"groups":[{"entries":[
		{"id":"on","url":"` + base + `/on","statusCheck":{"type":"http","enabled":true,"interval":60}},
		{"id":"off","url":"` + base + `/off","statusCheck":{"type":"http","enabled":false,"interval":60}},
		{"id":"none","url":"` + base + `/none"},
		{"id":"note","type":"note","url":"` + base + `/note","statusCheck":{"enabled":true}}
	]}]}]}]}`
}

func cachedIDs(t *testing.T, db *sql.DB) map[string]bool {
	t.Helper()
	rows, err := db.Query("SELECT entry_id FROM status_cache")
	if err != nil {
		t.Fatalf("query status_cache: %v", err)
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		out[id] = true
	}
	return out
}

// Tiles without "Enable Status Check" ticked must never be probed.
func TestCheckAllEntries_OnlyChecksTilesWithStatusCheckEnabled(t *testing.T) {
	h := newHitCounter(t)
	c, db, _ := newTestChecker(t, configWith(h.srv.URL))

	c.checkAllEntries()

	if got := h.count("/on"); got != 1 {
		t.Errorf("enabled tile: want 1 request, got %d", got)
	}
	for _, p := range []string{"/off", "/none", "/note"} {
		if got := h.count(p); got != 0 {
			t.Errorf("tile %s has status check disabled/absent but was probed %d time(s)", p, got)
		}
	}
	if ids := cachedIDs(t, db); !ids["on"] || len(ids) != 1 {
		t.Errorf("status_cache should hold only the enabled tile, got %v", ids)
	}
}

// A tile whose check was switched off must not keep showing its old result.
func TestCheckAllEntries_DropsCacheRowsForTilesNoLongerChecked(t *testing.T) {
	h := newHitCounter(t)
	c, db, _ := newTestChecker(t, configWith(h.srv.URL))
	if _, err := db.Exec(`INSERT INTO status_cache (entry_id, status) VALUES ('off','up'), ('gone','down')`); err != nil {
		t.Fatal(err)
	}

	c.checkAllEntries()

	ids := cachedIDs(t, db)
	if ids["off"] || ids["gone"] {
		t.Errorf("stale rows for unchecked/deleted tiles survived: %v", ids)
	}
}

// The global switch off means no probes at all and no stale results left.
func TestCheckAllEntries_GlobalSwitchOffChecksNothing(t *testing.T) {
	h := newHitCounter(t)
	c, db, svc := newTestChecker(t, configWith(h.srv.URL))
	if _, err := db.Exec(`INSERT INTO status_cache (entry_id, status) VALUES ('on','up')`); err != nil {
		t.Fatal(err)
	}
	if err := svc.Set(settings.KeyStatusChecksEnabled, "false"); err != nil {
		t.Fatalf("Set: %v", err)
	}

	c.checkAllEntries()

	if got := h.count("/on"); got != 0 {
		t.Errorf("global checks disabled but enabled tile was probed %d time(s)", got)
	}
	if ids := cachedIDs(t, db); len(ids) != 0 {
		t.Errorf("status_cache should be empty when checks are globally off, got %v", ids)
	}
}
