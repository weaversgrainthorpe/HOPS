package status

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// manyConfig is one dashboard with n checked tiles: /t0 … /t(n-1).
func manyConfig(base string, n int) string {
	var es []string
	for i := 0; i < n; i++ {
		es = append(es, fmt.Sprintf(`{"id":"t%d","url":"%s/t%d","statusCheck":{"type":"http","enabled":true}}`, i, base, i))
	}
	return `{"dashboards":[{"id":"d1","name":"D","path":"/d1","tabs":[{"groups":[{"entries":[` + strings.Join(es, ",") + `]}]}]}]}`
}

func TestCheckAllEntries_FixedWorkerPool(t *testing.T) {
	var mu sync.Mutex
	inFlight, peak := 0, 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		inFlight++
		if inFlight > peak {
			peak = inFlight
		}
		mu.Unlock()
		time.Sleep(20 * time.Millisecond)
		mu.Lock()
		inFlight--
		mu.Unlock()
	}))
	t.Cleanup(srv.Close)
	c, db, _ := newTestChecker(t, manyConfig(srv.URL, 120))
	c.checkAllEntries()
	if got := len(cachedIDs(t, db)); got != 120 {
		t.Fatalf("cached %d results, want 120", got)
	}
	if peak > checkWorkers || peak < 2 {
		t.Fatalf("peak concurrent probes = %d, want 2..%d", peak, checkWorkers)
	}
	h := c.Health()
	if h.Running || h.Total != 120 || h.Done != 120 || h.Took <= 0 {
		t.Fatalf("health after the pass: %+v", h)
	}
}

// Results are saved as they come in: the tiles that answer show their badge
// while one that hangs is still being waited for.
func TestCheckAllEntries_SavesResultsBeforeThePassEnds(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/t0" {
			<-release
		}
	}))
	t.Cleanup(srv.Close)
	t.Cleanup(func() {
		select {
		case <-release:
		default:
			close(release)
		}
	})
	c, db, _ := newTestChecker(t, manyConfig(srv.URL, 30))
	done := make(chan struct{})
	go func() {
		c.checkAllEntries()
		close(done)
	}()

	deadline := time.Now().Add(5 * time.Second)
	for len(cachedIDs(t, db)) < 29 {
		if time.Now().After(deadline) {
			t.Fatalf("only %d of the 29 answered tiles saved while one hangs", len(cachedIDs(t, db)))
		}
		time.Sleep(20 * time.Millisecond)
	}
	if cachedIDs(t, db)["t0"] {
		t.Fatal("the hanging tile has a result before it answered")
	}
	if h := c.Health(); !h.Running || h.Total != 30 || h.Done != 29 {
		t.Fatalf("health mid-pass: %+v", h)
	}
	close(release)
	<-done
	if !cachedIDs(t, db)["t0"] {
		t.Fatal("the last tile's result was not saved")
	}
}

func TestHealth_Behind(t *testing.T) {
	t0 := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	five := 5 * time.Minute
	cases := []struct {
		name string
		h    Health
		now  time.Time
		want bool
	}{
		{"running, within the interval", Health{Running: true, Started: t0, Interval: five}, t0.Add(4 * time.Minute), false},
		{"running, past the interval", Health{Running: true, Started: t0, Interval: five}, t0.Add(6 * time.Minute), true},
		{"last pass quick", Health{Took: time.Minute, Interval: five}, t0, false},
		{"last pass slow", Health{Took: 22 * time.Minute, Interval: five}, t0, true},
		{"no pass yet", Health{}, t0, false},
	}
	for _, c := range cases {
		if got := c.h.Behind(c.now); got != c.want {
			t.Errorf("%s: Behind = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestHealth_SaveErrorIsKeptUntilASaveWorks(t *testing.T) {
	h := newHitCounter(t)
	c, db, _ := newTestChecker(t, configWith(h.srv.URL))
	if _, err := db.Exec("ALTER TABLE status_cache RENAME TO status_cache_gone"); err != nil {
		t.Fatal(err)
	}
	c.checkAllEntries()
	if got := c.Health().SaveError; !strings.Contains(got, "status_cache") {
		t.Fatalf("SaveError = %q, want the failure", got)
	}
	if _, err := db.Exec("ALTER TABLE status_cache_gone RENAME TO status_cache"); err != nil {
		t.Fatal(err)
	}
	c.lastChecked = map[string]time.Time{} // due again
	c.checkAllEntries()
	if got := c.Health().SaveError; got != "" {
		t.Fatalf("SaveError = %q after a good save, want none", got)
	}
}
