package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/logbuf"
)

type logsResp struct {
	StartedAt time.Time       `json:"startedAt"`
	FetchedAt time.Time       `json:"fetchedAt"`
	Capacity  int             `json:"capacity"`
	Dropped   uint64          `json:"dropped"`
	Buffered  int             `json:"buffered"`
	Matching  int             `json:"matching"`
	Level     string          `json:"level"`
	Records   []logbuf.Record `json:"records"`
}

func getLogs(t *testing.T, router http.Handler, c *apiClient, query string) (int, logsResp, http.Header) {
	t.Helper()
	req := httptest.NewRequest("GET", "/api/logs"+query, nil)
	req.Header.Set("Cookie", "hops_session="+c.token+"; hops_csrf="+c.csrf)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	var out logsResp
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v: %s", err, w.Body.String())
		}
	}
	return w.Code, out, w.Header()
}

// The shared buffer is process-wide; tests log into it through a tee at debug.
func logIntoShared(level slog.Level, msg string, args ...any) {
	lv := &slog.LevelVar{}
	lv.Set(slog.LevelDebug)
	slog.New(logbuf.NewHandler(slog.NewTextHandler(io.Discard, nil), logbuf.Shared(), lv)).Log(context.Background(), level, msg, args...)
}

func TestLogsRequiresAuth(t *testing.T) {
	router, _ := setupTestRouter(t)
	for _, m := range []string{"GET", "POST", "DELETE"} {
		req := httptest.NewRequest(m, "/api/logs", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("anonymous %s /api/logs: %d", m, w.Code)
		}
	}
}

func TestLogsReturnsRecordsAndMetadata(t *testing.T) {
	router, _ := setupTestRouter(t)
	c := newClient(t, router)
	logIntoShared(slog.LevelInfo, "logs-test-info", "component", "test", "password", "hunter2")
	logIntoShared(slog.LevelWarn, "logs-test-warn")
	logIntoShared(slog.LevelDebug, "logs-test-debug")
	logIntoShared(slog.LevelError, "logs-test-error")

	code, r, hdr := getLogs(t, router, c, "")
	if code != 200 {
		t.Fatalf("status %d", code)
	}
	if hdr.Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control %q", hdr.Get("Cache-Control"))
	}
	if r.Capacity != logbuf.Capacity || r.StartedAt.IsZero() || r.FetchedAt.IsZero() {
		t.Fatalf("metadata: %+v", r)
	}
	if r.Level != logbuf.LevelName(logbuf.Level()) {
		t.Errorf("level %q", r.Level)
	}
	if r.Buffered != len(r.Records) || r.Matching != r.Buffered {
		t.Errorf("counts buffered %d matching %d records %d", r.Buffered, r.Matching, len(r.Records))
	}
	idx := map[string]int{}
	for i, rec := range r.Records {
		idx[rec.Message] = i
	}
	for _, m := range []string{"logs-test-info", "logs-test-warn", "logs-test-debug", "logs-test-error"} {
		if _, ok := idx[m]; !ok {
			t.Fatalf("missing %s", m)
		}
	}
	if idx["logs-test-info"] > idx["logs-test-error"] {
		t.Error("records must be oldest first")
	}
	info := r.Records[idx["logs-test-info"]]
	for _, a := range info.Attrs {
		if a.Key == "password" && a.Value != logbuf.Redacted {
			t.Errorf("password served: %q", a.Value)
		}
	}
}

func TestLogsLevelAndLimitParams(t *testing.T) {
	router, _ := setupTestRouter(t)
	c := newClient(t, router)
	logIntoShared(slog.LevelWarn, "p-warn")
	logIntoShared(slog.LevelInfo, "p-info")
	logIntoShared(slog.LevelError, "p-error")

	_, all, _ := getLogs(t, router, c, "")
	code, r, _ := getLogs(t, router, c, "?level=warn")
	if code != 200 {
		t.Fatalf("status %d", code)
	}
	for _, rec := range r.Records {
		if rec.Level != "warn" && rec.Level != "error" {
			t.Fatalf("level=warn returned %s %q", rec.Level, rec.Message)
		}
	}
	if r.Matching != len(r.Records) || r.Buffered < r.Matching || r.Buffered < all.Buffered {
		t.Errorf("counts %+v", r)
	}

	code, r, _ = getLogs(t, router, c, "?limit=2")
	if code != 200 || len(r.Records) != 2 {
		t.Fatalf("limit=2: %d %d", code, len(r.Records))
	}
	if r.Records[0].Message != "p-info" || r.Records[1].Message != "p-error" {
		t.Errorf("limit keeps the newest, oldest first: %q %q", r.Records[0].Message, r.Records[1].Message)
	}
	if r.Matching < 3 {
		t.Errorf("matching counts before the limit: %d", r.Matching)
	}

	code, r, _ = getLogs(t, router, c, "?limit=1&level=error")
	if code != 200 || len(r.Records) != 1 || r.Records[0].Message != "p-error" {
		t.Fatalf("limit+level: %d %+v", code, r.Records)
	}
	if code, _, _ = getLogs(t, router, c, "?limit=all"); code != 200 {
		t.Errorf("limit=all: %d", code)
	}

	for _, q := range []string{"?limit=0", "?limit=-1", "?limit=abc", "?limit=2001", "?level=loud"} {
		if code, _, _ := getLogs(t, router, c, q); code != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", q, code)
		}
	}
}

func TestLogsMethodNotAllowed(t *testing.T) {
	router, _ := setupTestRouter(t)
	c := newClient(t, router)
	if code, _ := c.do("POST", "/api/logs", nil); code != http.StatusMethodNotAllowed {
		t.Errorf("POST /api/logs: %d", code)
	}
}

// The page's own polling stays out of the log at info: a GET /api/logs is
// logged at debug, other requests at info as before.
func TestLogsOwnRequestsLoggedAtDebug(t *testing.T) {
	router, _ := setupTestRouter(t)
	c := newClient(t, router)

	lv := &slog.LevelVar{}
	lv.Set(slog.LevelDebug)
	buf := logbuf.New(100, time.Now())
	prev := slog.Default()
	slog.SetDefault(slog.New(logbuf.NewHandler(slog.NewTextHandler(io.Discard, nil), buf, lv)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	if code, _, _ := getLogs(t, router, c, "?limit=10"); code != 200 {
		t.Fatalf("status %d", code)
	}
	if code, _ := c.do("GET", "/api/settings", nil); code != 200 {
		t.Fatalf("settings %d", code)
	}
	var logsInfo, logsDebug, settingsInfo int
	for _, r := range buf.Snapshot().Records {
		if r.Message != "http request" {
			continue
		}
		path := ""
		for _, a := range r.Attrs {
			if a.Key == "path" {
				path = a.Value
			}
		}
		switch {
		case path == "/api/logs" && r.Level == "info":
			logsInfo++
		case path == "/api/logs" && r.Level == "debug":
			logsDebug++
		case path == "/api/settings" && r.Level == "info":
			settingsInfo++
		}
	}
	if logsInfo != 0 || logsDebug != 1 {
		t.Errorf("GET /api/logs: %d info, %d debug records; want 0 and 1", logsInfo, logsDebug)
	}
	if settingsInfo != 1 {
		t.Errorf("other requests stay at info: %d", settingsInfo)
	}
}
