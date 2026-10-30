package status

import (
	"log/slog"
	"sync"
	"time"
)

// checkWorkers is how many probes run at once. A probe mostly waits on the
// network, so this is cheap even on a Pi Zero; it is a fixed pool, so the
// number of goroutines doesn't grow with the number of checked tiles.
const checkWorkers = 16

// Results are saved every saveBatch results or every saveEvery, whichever
// comes first.
const (
	saveBatch = 50
	saveEvery = 2 * time.Second
)

// Health is what the checker reports about itself, so a slow or failing
// checker is shown to the admin instead of only logged.
type Health struct {
	// Running is set while a pass is in progress.
	Running bool
	// Started, Total and Done describe the pass in progress, or the last one.
	Started time.Time
	Total   int
	Done    int
	// Took is how long the last finished pass took (zero while the first runs).
	Took time.Duration
	// Interval is the shortest check interval among the pass's tiles.
	Interval time.Duration
	// SaveError is the last failure to save results ("" once a save works).
	SaveError   string
	SaveErrorAt time.Time
}

// Behind reports whether checks can't keep up with their interval: the pass
// in progress has run longer than the interval, or the last one took longer.
func (h Health) Behind(now time.Time) bool {
	if h.Interval <= 0 {
		return false
	}
	if h.Running && now.Sub(h.Started) > h.Interval {
		return true
	}
	return !h.Running && h.Took > h.Interval
}

type healthState struct {
	mu sync.Mutex
	h  Health
}

// Health returns a snapshot of the checker's state.
func (c *Checker) Health() Health {
	c.health.mu.Lock()
	defer c.health.mu.Unlock()
	return c.health.h
}

func (c *Checker) beginPass(total, shortestMinutes int) {
	c.health.mu.Lock()
	defer c.health.mu.Unlock()
	c.health.h.Running = true
	c.health.h.Started = c.now()
	c.health.h.Total = total
	c.health.h.Done = 0
	c.health.h.Interval = time.Duration(shortestMinutes) * time.Minute
}

func (c *Checker) passProgress(n int) {
	c.health.mu.Lock()
	defer c.health.mu.Unlock()
	c.health.h.Done += n
}

func (c *Checker) endPass() {
	c.health.mu.Lock()
	defer c.health.mu.Unlock()
	h := &c.health.h
	h.Running = false
	h.Took = c.now().Sub(h.Started)
	if h.Interval > 0 && h.Took > h.Interval {
		slog.Warn("status check pass took longer than the check interval", "component", "status",
			"tiles", h.Total, "took", h.Took.Round(time.Second), "interval", h.Interval)
	}
}

// noteSave records the outcome of a save: an error is kept (and logged) until
// a later save works.
func (c *Checker) noteSave(err error) {
	c.health.mu.Lock()
	defer c.health.mu.Unlock()
	if err == nil {
		c.health.h.SaveError = ""
		return
	}
	slog.Error("failed to save status check results", "component", "status", "error", err)
	c.health.h.SaveError = err.Error()
	c.health.h.SaveErrorAt = c.now()
}
