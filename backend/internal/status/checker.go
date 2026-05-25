package status

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"sync"
	"syscall"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/settings"
)

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
	ID   string `json:"id"`
	Type string `json:"type"` // "link" (default) or "note" — notes are skipped
	URL  string `json:"url"`
}

// StatusResult holds the result of a status check
type StatusResult struct {
	EntryID      string `json:"entryId"`
	Status       string `json:"status"`
	ResponseTime int64  `json:"responseTime,omitempty"`
	LastChecked  string `json:"lastChecked"`
}

// Checker handles HTTP status checks for entries. Interval and per-request
// timeout come from the settings service (status.check_interval_minutes,
// status.check_timeout_seconds) and update live when an admin changes them.
type Checker struct {
	db       *sql.DB
	settings *settings.Service
	stopChan chan struct{}
	running  bool
	mu       sync.Mutex

	// Per-request HTTP client; rebuilt when status.check_timeout_seconds
	// changes. clientMu guards swaps so concurrent checks see a coherent
	// client value.
	clientMu sync.RWMutex
	client   *http.Client

	// resetTicker signals the run loop to discard its current ticker and
	// re-create one with the latest interval. Buffered so a settings change
	// during a check isn't lost.
	resetTicker chan struct{}
}

// NewChecker creates a new status checker driven by the settings service.
func NewChecker(db *sql.DB, settingsSvc *settings.Service) *Checker {
	c := &Checker{
		db:          db,
		settings:    settingsSvc,
		stopChan:    make(chan struct{}),
		resetTicker: make(chan struct{}, 1),
	}
	c.client = c.buildClient()

	// Live-update the HTTP client (timeout) when the setting changes.
	settingsSvc.Subscribe(settings.KeyStatusCheckTimeoutSeconds, func(string) {
		newClient := c.buildClient()
		c.clientMu.Lock()
		c.client = newClient
		c.clientMu.Unlock()
		slog.Info("status checker timeout updated", "component", "status",
			"timeout_seconds", settingsSvc.GetInt(settings.KeyStatusCheckTimeoutSeconds))
	})

	// Live-update the polling interval — signal the loop to rebuild its ticker.
	settingsSvc.Subscribe(settings.KeyStatusCheckIntervalMinutes, func(string) {
		select {
		case c.resetTicker <- struct{}{}:
		default: // a reset is already pending
		}
		slog.Info("status checker interval updated", "component", "status",
			"interval_minutes", settingsSvc.GetInt(settings.KeyStatusCheckIntervalMinutes))
	})

	return c
}

// buildClient constructs an HTTP client whose timeout reflects the current
// status.check_timeout_seconds setting.
func (c *Checker) buildClient() *http.Client {
	timeout := time.Duration(c.settings.GetInt(settings.KeyStatusCheckTimeoutSeconds)) * time.Second
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &http.Client{
		Timeout: timeout,
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
				Timeout: timeout,
				Control: ssrfSafeDialControl,
			}).DialContext,
		},
	}
}

// httpClient returns the current HTTP client under a read lock.
func (c *Checker) httpClient() *http.Client {
	c.clientMu.RLock()
	defer c.clientMu.RUnlock()
	return c.client
}

// checkInterval returns the configured polling interval as a Duration.
func (c *Checker) checkInterval() time.Duration {
	mins := c.settings.GetInt(settings.KeyStatusCheckIntervalMinutes)
	if mins <= 0 {
		mins = 5
	}
	return time.Duration(mins) * time.Minute
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
	slog.Info("status checker started", "component", "status", "interval", c.checkInterval())
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

	ticker := time.NewTicker(c.checkInterval())
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			c.checkAllEntries()
		case <-c.resetTicker:
			// Settings changed — rebuild the ticker with the new interval.
			ticker.Stop()
			ticker = time.NewTicker(c.checkInterval())
		case <-c.stopChan:
			return
		}
	}
}

// getEntriesFromConfig extracts all entries from the config
func (c *Checker) getEntriesFromConfig() ([]Entry, error) {
	var configData string
	err := c.db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&configData)
	if err != nil {
		return nil, err
	}

	var config struct {
		Dashboards []struct {
			Tabs []struct {
				Groups []struct {
					Entries []Entry `json:"entries"`
				} `json:"groups"`
			} `json:"tabs"`
		} `json:"dashboards"`
	}

	if err := json.Unmarshal([]byte(configData), &config); err != nil {
		return nil, err
	}

	var entries []Entry
	for _, dashboard := range config.Dashboards {
		for _, tab := range dashboard.Tabs {
			for _, group := range tab.Groups {
				for _, entry := range group.Entries {
					// Skip note tiles entirely — they have no URL to check.
					if entry.Type == "note" {
						continue
					}
					if entry.URL != "" {
						entries = append(entries, entry)
					}
				}
			}
		}
	}

	return entries, nil
}

// statusCheckResult holds the result of a single HTTP check
type statusCheckResult struct {
	entryID      string
	status       string
	responseTime int64
}

func (c *Checker) checkAllEntries() {
	entries, err := c.getEntriesFromConfig()
	if err != nil {
		slog.Error("failed to get entries for status check", "component", "status", "error", err)
		return
	}

	slog.Debug("checking status for entries", "component", "status", "count", len(entries))

	// Collect results from concurrent HTTP checks
	results := make([]statusCheckResult, len(entries))

	// Use a semaphore to limit concurrent requests
	sem := make(chan struct{}, 5)
	var wg sync.WaitGroup

	for i, entry := range entries {
		wg.Add(1)
		go func(idx int, e Entry) {
			defer wg.Done()
			sem <- struct{}{}        // acquire
			defer func() { <-sem }() // release

			results[idx] = c.checkEntry(e)
		}(i, entry)
	}

	wg.Wait()

	// Batch write all results in a single transaction to avoid contention
	c.saveResults(results)
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

	req, err := http.NewRequest("HEAD", entry.URL, nil)
	if err != nil {
		result.status = "error"
		return result
	}

	req.Header.Set("User-Agent", "HOPS-StatusChecker/1.0")

	resp, err := c.httpClient().Do(req)
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
		if _, err := stmt.Exec(r.entryID, r.status, r.responseTime); err != nil {
			slog.Error("failed to update status cache", "component", "status", "entry_id", r.entryID, "error", err)
		}
	}

	if err := tx.Commit(); err != nil {
		slog.Error("failed to commit status cache transaction", "component", "status", "error", err)
	}
}

