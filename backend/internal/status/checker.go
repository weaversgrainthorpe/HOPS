package status

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/settings"
)

// tickEvery is how often the loop wakes to look for due entries. Each entry
// carries its own (per-dashboard) interval; a tick only probes those due.
const tickEvery = time.Minute

// isBlockedIP reports whether an IP must not be reached by the status checker.
//
// HOPS is a homelab dashboard: tiles legitimately point at LAN services on
// private (RFC1918) addresses and at services on the HOPS host itself
// (loopback), so those are explicitly ALLOWED — blocking them would break the
// core use case. What is blocked is the link-local range (169.254.0.0/16 and
// IPv6 fe80::/10), which is where cloud-metadata endpoints such as
// 169.254.169.254 live and is never a legitimate dashboard target, plus the
// unspecified address and multicast. This keeps the high-value SSRF
// escalation path closed without crippling LAN monitoring.
func isBlockedIP(ip net.IP) bool {
	return ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() ||
		ip.IsUnspecified() ||
		ip.IsMulticast()
}

// ssrfSafeDialControl is a net.Dialer Control hook. It runs after DNS
// resolution with the concrete IP about to be dialed, so it rejects the
// connection if that IP is internal — for the initial request, for every
// redirect hop (each dials anew), and for DNS-rebinding attempts (the real
// resolved IP is checked, not a stale pre-validated one).
func ssrfSafeDialControl(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("status check: invalid dial address %q", address)
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return fmt.Errorf("status check: unresolved dial host %q", host)
	}
	if isBlockedIP(ip) {
		return fmt.Errorf("status check: blocked internal/loopback/link-local target %s", ip)
	}
	return nil
}

// Entry represents a minimal entry for status checking
type Entry struct {
	ID          string `json:"id"`
	Type        string `json:"type"` // "link" (default) or "note" — notes are skipped
	URL         string `json:"url"`
	StatusCheck *struct {
		Enabled bool `json:"enabled"`
	} `json:"statusCheck"` // nil or Enabled=false → never checked

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

// Checker handles HTTP status checks for entries. Interval, timeout and the
// on/off switch are resolved per dashboard (configdoc.Resolve): a dashboard's
// own override wins, otherwise the global status.* setting applies.
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

	// Global default for dashboards that don't override it. Run a pass
	// straight away so turning checks off prunes cached results of the
	// dashboards that inherit it (no stale badges) and turning them on
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
			// Cap redirects at 10. Each hop still dials through the
			// SSRF-safe Control hook, so a redirect to an internal
			// host is refused at connection time.
			if len(via) >= 10 {
				return http.ErrUseLastResponse
			}
			return nil
		},
		Transport: &http.Transport{
			DialContext: (&net.Dialer{
				Timeout: 30 * time.Second,
				Control: ssrfSafeDialControl,
			}).DialContext,
		},
	}
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
// link tiles (at any folder depth) with a URL whose "Enable Status Check" box
// is ticked, in a dashboard whose effective statusChecksEnabled is true. It
// returns an error if the stored config cannot be loaded as a v3 document.
func (c *Checker) getEntriesFromConfig() ([]Entry, error) {
	doc, err := configdoc.Load(c.db)
	if err != nil {
		return nil, err
	}

	var entries []Entry
	eff := map[string]configdoc.Effective{}
	configdoc.Walk(doc, func(dash, _ configdoc.Obj, _ []configdoc.Obj, node configdoc.Obj) bool {
		if node["kind"] != "tile" {
			return true
		}
		// Skip note tiles entirely — they have no URL to check.
		if t, _ := node["type"].(string); t == "note" {
			return true
		}
		sc, _ := node["statusCheck"].(configdoc.Obj)
		if on, _ := sc["enabled"].(bool); !on {
			return true
		}
		id, _ := node["id"].(string)
		u, _ := node["url"].(string)
		if id == "" || u == "" {
			return true
		}
		dashID, _ := dash["id"].(string)
		e, ok := eff[dashID]
		if !ok {
			e = configdoc.Resolve(c.settings, dash)
			eff[dashID] = e
		}
		if !e.StatusChecksEnabled {
			return true
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
}

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
	c.saveResults(results)
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

	// Only http(s) URLs are checkable. Reject other schemes (file://,
	// gopher://, etc.) outright rather than handing them to the client.
	parsed, err := url.Parse(entry.URL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		result.status = "error"
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
		return result
	}

	req.Header.Set("User-Agent", "HOPS-StatusChecker/1.0")

	resp, err := c.client.Do(req)
	if err != nil {
		result.status = "down"
		return result
	}
	defer resp.Body.Close()

	result.responseTime = time.Since(start).Milliseconds()

	if resp.StatusCode >= 200 && resp.StatusCode < 400 {
		result.status = "up"
	} else if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		result.status = "error"
	} else {
		result.status = "down"
	}

	return result
}

// saveResults writes all status check results in a single transaction
func (c *Checker) saveResults(results []statusCheckResult) {
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

