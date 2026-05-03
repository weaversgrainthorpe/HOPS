package status

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// Entry represents a minimal entry for status checking
type Entry struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

// StatusResult holds the result of a status check
type StatusResult struct {
	EntryID      string `json:"entryId"`
	Status       string `json:"status"`
	ResponseTime int64  `json:"responseTime,omitempty"`
	LastChecked  string `json:"lastChecked"`
}

// Checker handles HTTP status checks for entries
type Checker struct {
	db             *sql.DB
	client         *http.Client
	checkInterval  time.Duration
	stopChan       chan struct{}
	running        bool
	mu             sync.Mutex
}

// NewChecker creates a new status checker
func NewChecker(db *sql.DB, checkInterval time.Duration) *Checker {
	return &Checker{
		db:            db,
		client: &http.Client{
			Timeout: 10 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				// Allow redirects but cap at 10
				if len(via) >= 10 {
					return http.ErrUseLastResponse
				}
				return nil
			},
		},
		checkInterval: checkInterval,
		stopChan:      make(chan struct{}),
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
	slog.Info("status checker started", "component", "status", "interval", c.checkInterval)
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

	ticker := time.NewTicker(c.checkInterval)
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

	start := time.Now()

	req, err := http.NewRequest("HEAD", entry.URL, nil)
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

