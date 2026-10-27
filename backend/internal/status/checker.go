package status

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/netguard"
	"github.com/weaversgrainthorpe/HOPS/internal/settings"
)

// tickEvery is how often the loop wakes to look for due entries. Each entry
// carries its own (per-dashboard) interval; a tick only probes those due.
const tickEvery = time.Minute

// maxRedirects bounds the redirect hops a status check follows.
const maxRedirects = 5

// SSRF policy: every outbound dial goes through netguard (link-local, cloud
// metadata, multicast, unspecified and reserved addresses are refused in any
// spelling; RFC 1918 and loopback are allowed because homelab tiles point at
// them). The dialer resolves once and connects to the vetted IP, so DNS
// rebinding can't swap in a refused address, and every redirect hop is
// re-checked (URL host in CheckRedirect, resolved IP at dial).

// Entry is one tile to probe. Whether it is probed at all is decided by
// configdoc.EffectiveStatusChecks in getEntriesFromConfig.
type Entry struct {
	ID   string `json:"id"`
	Type string `json:"type"` // "link" (default) or "note" — notes are skipped
	URL  string `json:"url"`

	// Effective settings of the owning dashboard when the pass started.
	DashboardID     string `json:"-"`
	IntervalMinutes int    `json:"-"`
	TimeoutSeconds  int    `json:"-"`
}

// StatusResult holds the result of a status check
type StatusResult struct {
	EntryID      string `json:"entryId"`
	Status       string `json:"status"`
	ResponseTime int64  `json:"responseTime,omitempty"`
	LastChecked  string `json:"lastChecked"`
}

// Checker handles HTTP status checks for entries. Interval and timeout are
// resolved per dashboard (configdoc.Resolve): a dashboard's own override
// wins, otherwise the global status.* setting applies. The on/off switch is
// layered down to the tile (configdoc.EffectiveStatusChecks).
type Checker struct {
	db       *sql.DB
	settings *settings.Service
	stopChan chan struct{}
	running  bool
	mu       sync.Mutex

	// passMu serialises check passes so a pass triggered by toggling
	// status.checks_enabled can't interleave with a ticker pass.
	passMu sync.Mutex

	// HTTP client shared by all probes. It has no Timeout of its own: each
	// request carries its dashboard's timeout through its context.
	client *http.Client

	// now is the clock; tests inject a fake one.
	now func() time.Time

	// lookup resolves hostnames for the SSRF-safe dialer; nil means the
	// system resolver. Tests inject one to simulate DNS rebinding.
	lookup netguard.LookupFunc

	// lastChecked records when each entry was last probed (in memory only; an
	// empty map means everything is due). Guarded by lastMu.
	lastMu      sync.Mutex
	lastChecked map[string]time.Time

	// backoff tracks consecutive-failure counts per entry so a
	// repeatedly-down service backs off exponentially instead of
	// hammering its endpoint every interval forever. Cleared on
	// success.
	backoffMu sync.Mutex
	backoff   map[string]*entryBackoff
}

// NewChecker creates a new status checker driven by the settings service.
func NewChecker(db *sql.DB, settingsSvc *settings.Service) *Checker {
	c := &Checker{
		db:          db,
		settings:    settingsSvc,
		stopChan:    make(chan struct{}),
		now:         time.Now,
		lastChecked: make(map[string]time.Time),
		backoff:     make(map[string]*entryBackoff),
	}
	c.client = c.buildClient()

	// Global default for every tile that inherits it. Run a pass
	// straight away so turning checks off prunes cached results of the
	// tiles that inherit it (no stale badges) and turning them on
	// doesn't leave every tile "unknown" for a whole interval.
	settingsSvc.Subscribe(settings.KeyStatusChecksEnabled, func(string) {
		slog.Info("status checks toggled", "component", "status",
			"enabled", settingsSvc.GetBool(settings.KeyStatusChecksEnabled))
		go c.checkAllEntries()
	})

	return c
}

// buildClient constructs the shared HTTP client. Per-request timeouts come
// from context (each entry's dashboard setting), not from the client.
func (c *Checker) buildClient() *http.Client {
	return &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > maxRedirects {
				return fmt.Errorf("status check: more than %d redirects", maxRedirects)
			}
			if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
				return fmt.Errorf("status check: redirect to non-http(s) address refused")
			}
			// The hop's IP literal (any spelling) is refused here; a
			// hostname is judged on its resolved IP at dial time.
			return netguard.CheckHost(req.URL.Hostname())
		},
		Transport: &http.Transport{
			Proxy:       nil, // never via an environment proxy: the guard must see the real target
			DialContext: c.dialer(30 * time.Second).DialContext,
		},
	}
}

// dialer is the SSRF-safe dialer used by HTTP and TCP checks.
func (c *Checker) dialer(timeout time.Duration) *netguard.Dialer {
	return &netguard.Dialer{Timeout: timeout, Lookup: c.lookup}
}

// Start begins the background status checking loop
func (c *Checker) Start() {
	c.mu.Lock()
	if c.running {
		c.mu.Unlock()
		return
	}
	c.running = true
	c.stopChan = make(chan struct{})
	c.mu.Unlock()

	go c.runLoop()
	slog.Info("status checker started", "component", "status", "tick", tickEvery)
}

// Stop halts the status checking loop
func (c *Checker) Stop() {
	c.mu.Lock()
	if !c.running {
		c.mu.Unlock()
		return
	}
	c.running = false
	close(c.stopChan)
	c.mu.Unlock()
	slog.Info("status checker stopped", "component", "status")
}

func (c *Checker) runLoop() {
	// Run initial check
	c.checkAllEntries()

	ticker := time.NewTicker(tickEvery)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			c.checkAllEntries()
		case <-c.stopChan:
			return
		}
	}
}

// getEntriesFromConfig extracts the entries that should be status-checked:
// link tiles (at any folder depth, never note tiles) with a URL whose
// effective status-check setting is on — the most specific level that sets
// it wins (configdoc.EffectiveStatusChecks: tile, folders, tab, dashboard,
// global), the same rule GET /api/status uses for the badge. Interval and
// timeout are the owning dashboard's effective settings. It returns an error
// if the stored config cannot be loaded as a v3 document.
func (c *Checker) getEntriesFromConfig() ([]Entry, error) {
	doc, err := configdoc.Load(c.db)
	if err != nil {
		return nil, err
	}

	var entries []Entry
	eff := map[string]configdoc.Effective{}
	configdoc.Walk(doc, func(dash, tab configdoc.Obj, path []configdoc.Obj, node configdoc.Obj) bool {
		if node["kind"] != "tile" {
			return true
		}
		// Skip note tiles entirely — they have no URL to check.
		if t, _ := node["type"].(string); t == "note" {
			return true
		}
		id, _ := node["id"].(string)
		u, _ := node["url"].(string)
		if id == "" || u == "" {
			return true
		}
		if on, _, _ := configdoc.EffectiveStatusChecks(c.settings, dash, tab, path, node); !on {
			return true
		}
		dashID, _ := dash["id"].(string)
		e, ok := eff[dashID]
		if !ok {
			e = configdoc.Resolve(c.settings, dash)
			eff[dashID] = e
		}
		interval := e.StatusCheckIntervalMinutes
		if interval <= 0 {
			interval = 5
		}
		timeout := e.StatusCheckTimeoutSeconds
		if timeout <= 0 {
			timeout = 10
		}
		entries = append(entries, Entry{
			ID: id, Type: "link", URL: u,
			DashboardID: dashID, IntervalMinutes: interval, TimeoutSeconds: timeout,
		})
		return true
	})
	return entries, nil
}

// statusCheckResult holds the result of a single HTTP check
type statusCheckResult struct {
	entryID      string
	status       string
	responseTime int64
	// skipped is true when the entry was inside its backoff window
	// and the check was deliberately not performed. The previous
	// stored status (if any) stays in scan_cache; the saver skips it.
	skipped bool
	// detail says why a check failed ("HTTP 404", the dial error, …); it is
	// kept as the tile's last error in status_failing.
	detail string
}

// FailingSchema holds when each checked tile started failing (dead-link
// report). It is in the DB, not memory, so a restart doesn't silently reset
// the clock. A row exists only while the tile's checks keep failing: the
// first success deletes it. Times are RFC 3339 UTC.
const FailingSchema = `CREATE TABLE IF NOT EXISTS status_failing (
	entry_id TEXT PRIMARY KEY,
	since TEXT NOT NULL,
	last_error TEXT NOT NULL DEFAULT '',
	last_checked TEXT NOT NULL
)`

// HistorySchema records when failure tracking began (one row), so the report
// can say that older failures may be longer than shown.
const HistorySchema = `CREATE TABLE IF NOT EXISTS status_history (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	started_at TEXT NOT NULL
)`

// isFailure: down and error start (or continue) the failing clock; "up"
// clears it; anything else (unknown, checking) leaves it alone.
func isFailure(status string) bool { return status == "down" || status == "error" }

// entryBackoff tracks how many consecutive failures an entry has had
// and when it's eligible to be re-probed. Exponential backoff caps at
// 32× the base interval so a definitely-down service eventually only
// gets hit a couple of times an hour instead of every interval.
type entryBackoff struct {
	consecutiveFailures int
	skipUntil           time.Time
}

func (c *Checker) checkAllEntries() {
	c.passMu.Lock()
	defer c.passMu.Unlock()

	entries, err := c.getEntriesFromConfig()
	if err != nil {
		// The config can't be read (migration failed, unreadable, not v3).
		// Probe nothing, but leave the cache alone: pruning on an unknown
		// config would wipe results for tiles that may well still exist.
		// The stored rows keep their own last_checked so consumers can see
		// how old they are.
		slog.Error("status check pass skipped: cannot load config", "component", "status", "error", err)
		return
	}

	slog.Debug("checking status for entries", "component", "status", "count", len(entries))
	c.forget(entries)

	// Collect results from concurrent HTTP checks
	results := make([]statusCheckResult, len(entries))

	// Use a semaphore to limit concurrent requests
	sem := make(chan struct{}, 5)
	var wg sync.WaitGroup

	now := c.now()
	for i, entry := range entries {
		// Not due yet: keep the cached row, make no request.
		if !c.isDue(entry, now) {
			results[i] = statusCheckResult{entryID: entry.ID, skipped: true}
			continue
		}
		// Honour the per-entry backoff window — if a previous check
		// failed enough times in a row, we wait before retrying.
		if c.shouldSkip(entry.ID, now) {
			results[i] = statusCheckResult{entryID: entry.ID, skipped: true}
			continue
		}
		wg.Add(1)
		go func(idx int, e Entry) {
			defer wg.Done()
			sem <- struct{}{}        // acquire
			defer func() { <-sem }() // release

			res := c.checkEntry(e)
			c.markChecked(e.ID, now)
			c.recordOutcome(e, res.status, now)
			results[idx] = res
		}(i, entry)
	}

	wg.Wait()

	// Batch write all results in a single transaction to avoid contention
	c.saveResults(results, now)
}

// isDue reports whether the entry has never been probed or its own interval
// has elapsed since the last probe.
func (c *Checker) isDue(e Entry, now time.Time) bool {
	c.lastMu.Lock()
	defer c.lastMu.Unlock()
	last, ok := c.lastChecked[e.ID]
	if !ok {
		return true
	}
	return now.Sub(last) >= time.Duration(e.IntervalMinutes)*time.Minute
}

func (c *Checker) markChecked(id string, now time.Time) {
	c.lastMu.Lock()
	c.lastChecked[id] = now
	c.lastMu.Unlock()
}

// forget drops per-entry state (last-checked time, backoff) for entries that
// are no longer checked, so the maps don't grow and a re-enabled tile starts
// fresh (due immediately).
func (c *Checker) forget(entries []Entry) {
	live := make(map[string]struct{}, len(entries))
	for _, e := range entries {
		live[e.ID] = struct{}{}
	}
	c.lastMu.Lock()
	for id := range c.lastChecked {
		if _, ok := live[id]; !ok {
			delete(c.lastChecked, id)
		}
	}
	c.lastMu.Unlock()
	c.backoffMu.Lock()
	for id := range c.backoff {
		if _, ok := live[id]; !ok {
			delete(c.backoff, id)
		}
	}
	c.backoffMu.Unlock()
}

// shouldSkip returns true if the entry's backoff window hasn't
// expired. Called before each check pass; failures that are still
// within their cooldown are skipped without making an HTTP request.
func (c *Checker) shouldSkip(entryID string, now time.Time) bool {
	c.backoffMu.Lock()
	defer c.backoffMu.Unlock()
	b := c.backoff[entryID]
	if b == nil {
		return false
	}
	return now.Before(b.skipUntil)
}

// recordOutcome updates the per-entry backoff state after a check.
// Success clears the state. Failure (down / error) extends the cooldown
// using exponential backoff: 0, 1×, 2×, 4×, 8×, 16×, 32× the current
// check interval. Capped at 32× to avoid waits longer than ~3 hours
// at the default 5-minute interval.
func (c *Checker) recordOutcome(e Entry, status string, now time.Time) {
	entryID := e.ID
	c.backoffMu.Lock()
	defer c.backoffMu.Unlock()
	if status == "up" {
		// Recovered — drop any cooldown state.
		delete(c.backoff, entryID)
		return
	}
	b := c.backoff[entryID]
	if b == nil {
		b = &entryBackoff{}
		c.backoff[entryID] = b
	}
	b.consecutiveFailures++
	// Exponent grows with failures, capped at 5 → 32×.
	exp := b.consecutiveFailures - 1
	if exp < 0 {
		exp = 0
	}
	if exp > 5 {
		exp = 5
	}
	mult := 1 << exp
	b.skipUntil = now.Add(time.Duration(mult) * time.Duration(e.IntervalMinutes) * time.Minute)
}

func (c *Checker) checkEntry(entry Entry) statusCheckResult {
	result := statusCheckResult{entryID: entry.ID, status: "up"}

	// ssh:// tiles get a TCP connect check (an HTTP request can't work on them).
	if strings.HasPrefix(strings.ToLower(entry.URL), "ssh://") {
		return c.checkTCP(entry)
	}

	// Only http(s) URLs are checkable. Reject other schemes (file://,
	// gopher://, etc.) outright rather than handing them to the client.
	parsed, err := url.Parse(entry.URL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		result.status = "error"
		result.detail = "Not an http(s) or ssh address"
		return result
	}
	if err := netguard.CheckHost(parsed.Hostname()); err != nil {
		result.status = "error"
		result.detail = "Refused: " + err.Error()
		return result
	}

	start := time.Now()

	timeout := time.Duration(entry.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "HEAD", entry.URL, nil)
	if err != nil {
		result.status = "error"
		result.detail = "Invalid address: " + err.Error()
		return result
	}

	req.Header.Set("User-Agent", "HOPS-StatusChecker/1.0")

	resp, err := c.client.Do(req)
	if err != nil {
		result.status = "down"
		result.detail = errText(err)
		return result
	}
	defer resp.Body.Close()

	result.responseTime = time.Since(start).Milliseconds()

	if resp.StatusCode >= 200 && resp.StatusCode < 400 {
		result.status = "up"
	} else if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		result.status = "error"
		result.detail = "HTTP " + strconv.Itoa(resp.StatusCode)
	} else {
		result.status = "down"
		result.detail = "HTTP " + strconv.Itoa(resp.StatusCode)
	}

	return result
}

// sshTarget turns ssh://[user@]host[:port] into the host:port to dial; the
// port defaults to 22 and must be 1-65535.
func sshTarget(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || !strings.EqualFold(u.Scheme, "ssh") {
		return "", fmt.Errorf("status check: not an ssh URL")
	}
	host := u.Hostname()
	if host == "" {
		return "", fmt.Errorf("status check: ssh URL has no host")
	}
	port := u.Port()
	if port == "" {
		if strings.HasSuffix(u.Host, ":") {
			return "", fmt.Errorf("status check: ssh URL has an empty port")
		}
		port = "22"
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return "", fmt.Errorf("status check: ssh port %q out of range", port)
	}
	return net.JoinHostPort(host, port), nil
}

// checkTCP probes an ssh:// tile: up means host:port accepted a TCP
// connection within the dashboard's timeout. The dial goes through the same
// SSRF-safe netguard dialer as the HTTP checks (the deny-list is applied to the
// resolved IP); a refused or blocked dial is "down", a malformed URL "error".
func (c *Checker) checkTCP(entry Entry) statusCheckResult {
	result := statusCheckResult{entryID: entry.ID, status: "error"}
	addr, err := sshTarget(entry.URL)
	if err != nil {
		result.detail = err.Error()
		return result
	}
	if host, _, _ := net.SplitHostPort(addr); netguard.CheckHost(host) != nil {
		result.detail = "Refused: " + netguard.CheckHost(host).Error()
		return result
	}
	timeout := time.Duration(entry.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	start := time.Now()
	conn, err := c.dialer(timeout).DialContext(ctx, "tcp", addr)
	if err != nil {
		result.status = "down"
		result.detail = errText(err)
		return result
	}
	conn.Close()
	result.status = "up"
	result.responseTime = time.Since(start).Milliseconds()
	return result
}

// errText is a failed request's error, kept short for the report.
func errText(err error) string {
	s := err.Error()
	if len(s) > 300 {
		s = s[:300] + "…"
	}
	return s
}

// saveResults writes all status check results in a single transaction, and
// keeps the failing-since clock (status_failing) in the same transaction.
func (c *Checker) saveResults(results []statusCheckResult, now time.Time) {
	tx, err := c.db.Begin()
	if err != nil {
		slog.Error("failed to begin status cache transaction", "component", "status", "error", err)
		return
	}

	// Drop rows for tiles that are no longer checked (check switched off,
	// tile deleted) so their last result can't resurface as current.
	// Backoff-skipped entries are still in results, so they keep theirs.
	ids := make([]any, len(results))
	for i, r := range results {
		ids[i] = r.entryID
	}
	prune := "DELETE FROM status_cache"
	if len(ids) > 0 {
		prune += " WHERE entry_id NOT IN (?" + strings.Repeat(",?", len(ids)-1) + ")"
	}
	if _, err := tx.Exec(prune, ids...); err != nil {
		tx.Rollback()
		slog.Error("failed to prune status cache", "component", "status", "error", err)
		return
	}
	// The same for the failing clock: a tile whose checks are off, or that
	// is gone, isn't tracked.
	if _, err := tx.Exec(strings.Replace(prune, "status_cache", "status_failing", 1), ids...); err != nil {
		tx.Rollback()
		slog.Error("failed to prune failing-since rows", "component", "status", "error", err)
		return
	}
	at := now.UTC().Format(time.RFC3339)
	for _, r := range results {
		if r.skipped {
			continue
		}
		var err error
		switch {
		case r.status == "up":
			_, err = tx.Exec("DELETE FROM status_failing WHERE entry_id = ?", r.entryID)
		case isFailure(r.status):
			_, err = tx.Exec(`INSERT INTO status_failing (entry_id, since, last_error, last_checked) VALUES (?, ?, ?, ?)
				ON CONFLICT(entry_id) DO UPDATE SET last_error = excluded.last_error, last_checked = excluded.last_checked`,
				r.entryID, at, r.detail, at)
		}
		if err != nil {
			tx.Rollback()
			slog.Error("failed to update failing-since row", "component", "status", "entry_id", r.entryID, "error", err)
			return
		}
	}

	stmt, err := tx.Prepare(`
		INSERT OR REPLACE INTO status_cache (entry_id, status, response_time, last_checked)
		VALUES (?, ?, ?, datetime('now'))
	`)
	if err != nil {
		tx.Rollback()
		slog.Error("failed to prepare status cache statement", "component", "status", "error", err)
		return
	}
	defer stmt.Close()

	for _, r := range results {
		// Backoff-skipped entries: leave the stale row in place. The
		// dashboard keeps showing the last known status until the
		// cooldown ends and a fresh check runs.
		if r.skipped {
			continue
		}
		if _, err := stmt.Exec(r.entryID, r.status, r.responseTime); err != nil {
			slog.Error("failed to update status cache", "component", "status", "entry_id", r.entryID, "error", err)
		}
	}

	if err := tx.Commit(); err != nil {
		slog.Error("failed to commit status cache transaction", "component", "status", "error", err)
	}
}
