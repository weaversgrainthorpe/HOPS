package api

import (
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/logbuf"
)

// handleLogs serves GET /api/logs (admin-only, read-only): the most recent
// buffered log lines plus what the page needs to be honest about what's
// missing — when the buffer begins (process start), how many older lines were
// dropped, its capacity, and the log level in effect (lower levels were never
// recorded).
//
// Query: limit = 1..capacity or "all" (default all); level = debug | info |
// warn | error, the lowest level returned (default debug = everything
// buffered). limit applies after the level filter and keeps the newest lines.
// Records are oldest first. Values are already redacted by the logger.
func (r *Router) handleLogs(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	snap := logbuf.Shared().Snapshot()

	q := req.URL.Query()
	limit := snap.Capacity
	if s := q.Get("limit"); s != "" && s != "all" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > snap.Capacity {
			writeJSONError(w, "limit must be a number from 1 to "+strconv.Itoa(snap.Capacity)+", or all", http.StatusBadRequest)
			return
		}
		limit = n
	}
	min := slog.LevelDebug
	if s := q.Get("level"); s != "" {
		l, ok := logbuf.ParseLevel(s)
		if !ok {
			writeJSONError(w, "level must be debug, info, warn or error", http.StatusBadRequest)
			return
		}
		min = l
	}

	matching := make([]logbuf.Record, 0, len(snap.Records))
	for _, rec := range snap.Records {
		if rec.AtLeast(min) {
			matching = append(matching, rec)
		}
	}
	out := matching
	if len(out) > limit {
		out = out[len(out)-limit:]
	}

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, map[string]interface{}{
		"startedAt": snap.StartedAt,
		"fetchedAt": time.Now(),
		"capacity":  snap.Capacity,
		"dropped":   snap.Dropped,
		"buffered":  len(snap.Records),
		"matching":  len(matching),
		"level":     logbuf.LevelName(logbuf.Level()),
		"records":   out,
	})
}
