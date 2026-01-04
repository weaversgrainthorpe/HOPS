package status

import (
	"database/sql"
	"encoding/json"
	"log"
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
	log.Printf("Status checker started with interval: %v", c.checkInterval)
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
	log.Println("Status checker stopped")
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

func (c *Checker) checkAllEntries() {
	entries, err := c.getEntriesFromConfig()
	if err != nil {
		log.Printf("Failed to get entries for status check: %v", err)
		return
	}

	log.Printf("Checking status for %d entries...", len(entries))

	// Use a semaphore to limit concurrent requests
	sem := make(chan struct{}, 5)
	var wg sync.WaitGroup

	for _, entry := range entries {
		wg.Add(1)
		go func(e Entry) {
			defer wg.Done()
			sem <- struct{}{}        // acquire
			defer func() { <-sem }() // release

			c.checkEntry(e)
		}(entry)
	}

	wg.Wait()
}

func (c *Checker) checkEntry(entry Entry) {
	start := time.Now()
	status := "up"
	var responseTime int64

	req, err := http.NewRequest("HEAD", entry.URL, nil)
	if err != nil {
		status = "error"
	} else {
		req.Header.Set("User-Agent", "HOPS-StatusChecker/1.0")

		resp, err := c.client.Do(req)
		if err != nil {
			status = "down"
		} else {
			defer resp.Body.Close()
			responseTime = time.Since(start).Milliseconds()

			if resp.StatusCode >= 200 && resp.StatusCode < 400 {
				status = "up"
			} else if resp.StatusCode >= 400 && resp.StatusCode < 500 {
				status = "error"
			} else {
				status = "down"
			}
		}
	}

	// Update the cache
	_, err = c.db.Exec(`
		INSERT OR REPLACE INTO status_cache (entry_id, status, response_time, last_checked)
		VALUES (?, ?, ?, datetime('now'))
	`, entry.ID, status, responseTime)

	if err != nil {
		log.Printf("Failed to update status cache for %s: %v", entry.ID, err)
	}
}

// CheckSingle performs an immediate check on a single entry
func (c *Checker) CheckSingle(entryID string, url string) StatusResult {
	entry := Entry{ID: entryID, URL: url}
	c.checkEntry(entry)

	// Fetch the result
	var result StatusResult
	var responseTime sql.NullInt64

	err := c.db.QueryRow(`
		SELECT entry_id, status, response_time, last_checked
		FROM status_cache WHERE entry_id = ?
	`, entryID).Scan(&result.EntryID, &result.Status, &responseTime, &result.LastChecked)

	if err != nil {
		return StatusResult{
			EntryID: entryID,
			Status:  "unknown",
		}
	}

	if responseTime.Valid {
		result.ResponseTime = responseTime.Int64
	}

	return result
}
