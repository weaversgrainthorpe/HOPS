package status

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// A tile whose address answers 500 until told otherwise.
func flakyServer(t *testing.T) (*httptest.Server, *atomic.Bool) {
	t.Helper()
	var up atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if up.Load() {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)
	return srv, &up
}

func oneTileConfig(base string) string {
	return `{"dashboards":[{"id":"d1","name":"D","path":"/d1","tabs":[{"groups":[{"entries":[
		{"id":"on","url":"` + base + `/on","statusCheck":{"type":"http","enabled":true,"interval":60}}
	]}]}]}]}`
}

func failingRow(t *testing.T, db *sql.DB, id string) (since, lastErr string, ok bool) {
	t.Helper()
	err := db.QueryRow("SELECT since, last_error FROM status_failing WHERE entry_id = ?", id).Scan(&since, &lastErr)
	if err == sql.ErrNoRows {
		return "", "", false
	}
	if err != nil {
		t.Fatalf("query status_failing: %v", err)
	}
	return since, lastErr, true
}

// The "failing since" clock lives in the DB: a new checker (a restart) keeps
// the original start time instead of silently starting over.
func TestFailingSince_PersistsAcrossCheckerRestart(t *testing.T) {
	srv, _ := flakyServer(t)
	c, db, svc := newTestChecker(t, oneTileConfig(srv.URL))
	t0 := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	c.now = func() time.Time { return t0 }
	c.checkAllEntries()

	since, lastErr, ok := failingRow(t, db, "on")
	if !ok {
		t.Fatal("a failing tile has no failing-since row")
	}
	if since != t0.Format(time.RFC3339) {
		t.Fatalf("since = %q, want %q", since, t0.Format(time.RFC3339))
	}
	if lastErr != "HTTP 500" {
		t.Fatalf("last error = %q, want HTTP 500", lastErr)
	}

	// Restart: a fresh checker over the same DB, two days later.
	c2 := NewChecker(db, svc)
	t1 := t0.Add(48 * time.Hour)
	c2.now = func() time.Time { return t1 }
	c2.checkAllEntries()
	since2, _, ok := failingRow(t, db, "on")
	if !ok || since2 != since {
		t.Fatalf("after restart since = %q (present %v), want the original %q", since2, ok, since)
	}
}

func TestFailingSince_ClearsOnFirstSuccess(t *testing.T) {
	srv, up := flakyServer(t)
	c, db, _ := newTestChecker(t, oneTileConfig(srv.URL))
	clock := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	c.now = func() time.Time { return clock }
	c.checkAllEntries()
	if _, _, ok := failingRow(t, db, "on"); !ok {
		t.Fatal("expected a failing row")
	}
	up.Store(true)
	clock = clock.Add(24 * time.Hour) // past interval and backoff
	c.checkAllEntries()
	if _, _, ok := failingRow(t, db, "on"); ok {
		t.Fatal("a success left the failing-since row in place")
	}
}

// A result that is neither up nor a failure (unknown / checking) neither
// starts nor clears the clock.
func TestFailingSince_UnknownIsIgnored(t *testing.T) {
	c, db, _ := newTestChecker(t, oneTileConfig("http://127.0.0.1:1"))
	t0 := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	c.saveResults([]statusCheckResult{{entryID: "on", status: "unknown"}}, t0)
	if _, _, ok := failingRow(t, db, "on"); ok {
		t.Fatal("an unknown result started the clock")
	}
	c.saveResults([]statusCheckResult{{entryID: "on", status: "down", detail: "refused"}}, t0)
	c.saveResults([]statusCheckResult{{entryID: "on", status: "checking"}}, t0.Add(time.Hour))
	since, lastErr, ok := failingRow(t, db, "on")
	if !ok || since != t0.Format(time.RFC3339) || lastErr != "refused" {
		t.Fatalf("a checking result changed the clock: since=%q err=%q present=%v", since, lastErr, ok)
	}
}

// Tiles no longer checked (checks off, deleted) lose their row, like the cache.
func TestFailingSince_DroppedWhenTileNoLongerChecked(t *testing.T) {
	c, db, _ := newTestChecker(t, oneTileConfig("http://127.0.0.1:1"))
	t0 := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	c.saveResults([]statusCheckResult{{entryID: "gone", status: "down", detail: "x"}}, t0)
	c.now = func() time.Time { return t0 }
	c.checkAllEntries()
	if _, _, ok := failingRow(t, db, "gone"); ok {
		t.Fatal("an unchecked tile kept its failing row")
	}
}
