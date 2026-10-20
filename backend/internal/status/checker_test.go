package status

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"

	"strings"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/settings"
	_ "modernc.org/sqlite"
)

// newTestChecker builds a Checker over an in-memory DB holding the given
// dashboard config JSON. Schema mirrors internal/database (duplicated to
// avoid importing it).
// The v2 fixture is converted with configdoc.MigrateV2 so the checker sees a
// real v3 document.
func newTestChecker(t *testing.T, configJSON string) (*Checker, *sql.DB, *settings.Service) {
	t.Helper()
	var v2 configdoc.Obj
	if err := json.Unmarshal([]byte(configJSON), &v2); err != nil {
		t.Fatalf("fixture json: %v", err)
	}
	v3, err := configdoc.MigrateV2(v2)
	if err != nil {
		t.Fatalf("MigrateV2: %v", err)
	}
	return newTestCheckerDoc(t, v3)
}

func newTestCheckerDoc(t *testing.T, doc configdoc.Obj) (*Checker, *sql.DB, *settings.Service) {
	t.Helper()
	b, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	return newTestCheckerRaw(t, string(b))
}

func newTestCheckerRaw(t *testing.T, configJSON string) (*Checker, *sql.DB, *settings.Service) {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(1) // keep the single in-memory DB shared
	t.Cleanup(func() { db.Close() })
	for _, stmt := range []string{
		`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE config (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE status_cache (entry_id TEXT PRIMARY KEY, status TEXT NOT NULL, response_time INTEGER, last_checked DATETIME DEFAULT CURRENT_TIMESTAMP)`,
	} {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("schema: %v", err)
		}
	}
	if _, err := db.Exec("INSERT INTO config (id, data) VALUES (1, ?)", configJSON); err != nil {
		t.Fatalf("insert config: %v", err)
	}
	svc, err := settings.New(db)
	if err != nil {
		t.Fatalf("settings.New: %v", err)
	}
	return NewChecker(db, svc), db, svc
}

// hitCounter is an httptest server that records which paths were requested.
type hitCounter struct {
	mu   sync.Mutex
	hits map[string]int
	srv  *httptest.Server
}

func newHitCounter(t *testing.T) *hitCounter {
	h := &hitCounter{hits: map[string]int{}}
	h.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.mu.Lock()
		h.hits[r.URL.Path]++
		h.mu.Unlock()
	}))
	t.Cleanup(h.srv.Close)
	return h
}

func (h *hitCounter) count(path string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.hits[path]
}

func configWith(base string) string {
	return `{"dashboards":[{"id":"d1","name":"D","path":"/d1","tabs":[{"groups":[{"entries":[
		{"id":"on","url":"` + base + `/on","statusCheck":{"type":"http","enabled":true,"interval":60}},
		{"id":"off","url":"` + base + `/off","statusCheck":{"type":"http","enabled":false,"interval":60}},
		{"id":"none","url":"` + base + `/none"},
		{"id":"inh","url":"` + base + `/inh","statusCheck":{"type":"http","enabled":null}},
		{"id":"note","type":"note","url":"` + base + `/note","statusCheck":{"enabled":true}}
	]}]}]}]}`
}

// newTwoDash builds two dashboards (tiles a1, b1 explicitly inheriting the
// status-check switch: enabled null) through MigrateV2 and then sets d2's
// per-dashboard overrides (MigrateV2 resets settings to all-null).
func newTwoDash(t *testing.T, base, d2Settings string) (*Checker, *sql.DB, *settings.Service) {
	t.Helper()
	var v2 configdoc.Obj
	if err := json.Unmarshal([]byte(twoDashConfig(base)), &v2); err != nil {
		t.Fatal(err)
	}
	doc, err := configdoc.MigrateV2(v2)
	if err != nil {
		t.Fatal(err)
	}
	var ov configdoc.Obj
	if err := json.Unmarshal([]byte(d2Settings), &ov); err != nil {
		t.Fatal(err)
	}
	doc["dashboards"].([]any)[1].(configdoc.Obj)["settings"] = ov
	return newTestCheckerDoc(t, doc)
}

func twoDashConfig(base string) string {
	return `{"dashboards":[
	 {"id":"d1","name":"A","path":"/a","tabs":[{"id":"t1","groups":[{"id":"g1","entries":[
	  {"id":"a1","url":"` + base + `/a1","statusCheck":{"enabled":null}}]}]}]},
	 {"id":"d2","name":"B","path":"/b","tabs":[{"id":"t2","groups":[{"id":"g2","entries":[
	  {"id":"b1","url":"` + base + `/b1","statusCheck":{"enabled":null}}]}]}]}
	]}`
}

func cachedIDs(t *testing.T, db *sql.DB) map[string]bool {
	t.Helper()
	rows, err := db.Query("SELECT entry_id FROM status_cache")
	if err != nil {
		t.Fatalf("query status_cache: %v", err)
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		out[id] = true
	}
	return out
}

// Layered status checks (M4 §4b, Ruling 12): a tile is probed iff its
// effective setting (most specific level that sets it) is on. "on" is
// explicitly on, "inh" inherits explicitly (enabled: null) the global (on),
// "off" is explicitly off, "none" is unset and so off (v2.2.1: checks only
// go where asked); a note tile is never probed, even when ticked.
func TestCheckAllEntries_ProbesEffectivelyOnTilesOnly(t *testing.T) {
	h := newHitCounter(t)
	c, db, _ := newTestChecker(t, configWith(h.srv.URL))

	c.checkAllEntries()

	for _, p := range []string{"/on", "/inh"} {
		if got := h.count(p); got != 1 {
			t.Errorf("tile %s is effectively on: want 1 request, got %d", p, got)
		}
	}
	for _, p := range []string{"/off", "/none", "/note"} {
		if got := h.count(p); got != 0 {
			t.Errorf("tile %s is off, unset or a note but was probed %d time(s)", p, got)
		}
	}
	if ids := cachedIDs(t, db); !ids["on"] || !ids["inh"] || len(ids) != 2 {
		t.Errorf("status_cache should hold only the effectively-on tiles, got %v", ids)
	}
}

// A tile whose check was switched off must not keep showing its old result.
func TestCheckAllEntries_DropsCacheRowsForTilesNoLongerChecked(t *testing.T) {
	h := newHitCounter(t)
	c, db, _ := newTestChecker(t, configWith(h.srv.URL))
	if _, err := db.Exec(`INSERT INTO status_cache (entry_id, status) VALUES ('off','up'), ('gone','down')`); err != nil {
		t.Fatal(err)
	}

	c.checkAllEntries()

	ids := cachedIDs(t, db)
	if ids["off"] || ids["gone"] {
		t.Errorf("stale rows for unchecked/deleted tiles survived: %v", ids)
	}
}

// The global switch off turns off every tile that inherits it; a tile
// explicitly on is more specific and still probed. Stale rows of tiles now
// off are pruned.
func TestCheckAllEntries_GlobalSwitchOffChecksOnlyExplicitlyOnTiles(t *testing.T) {
	h := newHitCounter(t)
	c, db, svc := newTestChecker(t, configWith(h.srv.URL))
	if _, err := db.Exec(`INSERT INTO status_cache (entry_id, status) VALUES ('inh','up')`); err != nil {
		t.Fatal(err)
	}
	if err := svc.Set(settings.KeyStatusChecksEnabled, "false"); err != nil {
		t.Fatalf("Set: %v", err)
	}

	c.checkAllEntries()

	if got := h.count("/inh"); got != 0 {
		t.Errorf("global checks off but inheriting tile was probed %d time(s)", got)
	}
	if got := h.count("/on"); got != 1 {
		t.Errorf("explicitly-on tile: want 1 request, got %d", got)
	}
	if ids := cachedIDs(t, db); !ids["on"] || len(ids) != 1 {
		t.Errorf("status_cache should hold only the explicitly-on tile, got %v", ids)
	}
}

// A tile switched on under a dashboard whose checks are off is probed (the
// tile is more specific), with the dashboard's interval and timeout.
func TestCheckAllEntries_TileOnUnderDashboardOffIsProbed(t *testing.T) {
	h := newHitCounter(t)
	c, _, _ := newTwoDash(t, h.srv.URL, `{"statusChecksEnabled":false,"statusCheckIntervalMinutes":7,"statusCheckTimeoutSeconds":3}`)
	doc, err := configdoc.Load(c.db)
	if err != nil {
		t.Fatal(err)
	}
	_, tile, ok := configdoc.FindTile(doc, "b1")
	if !ok {
		t.Fatal("b1 missing")
	}
	tile["statusCheck"] = configdoc.Obj{"type": "http", "enabled": true}
	if err := configdoc.Save(c.db, doc); err != nil {
		t.Fatal(err)
	}
	entries, err := c.getEntriesFromConfig()
	if err != nil {
		t.Fatal(err)
	}
	var b1 *Entry
	for i := range entries {
		if entries[i].ID == "b1" {
			b1 = &entries[i]
		}
	}
	if b1 == nil {
		t.Fatalf("b1 (tile on, dashboard off) not scheduled: %+v", entries)
	}
	if b1.IntervalMinutes != 7 || b1.TimeoutSeconds != 3 {
		t.Errorf("b1 interval/timeout = %d/%d, want the dashboard's 7/3", b1.IntervalMinutes, b1.TimeoutSeconds)
	}
	c.checkAllEntries()
	if h.count("/b1") != 1 {
		t.Errorf("b1 probed %d time(s), want 1", h.count("/b1"))
	}
}

// A folder switched off turns off the inheriting tiles inside it (at any
// depth) even when the dashboard is on; a tile explicitly on inside it is
// still probed.
func TestCheckAllEntries_FolderOffBeatsDashboardOn(t *testing.T) {
	h := newHitCounter(t)
	var v2 configdoc.Obj
	if err := json.Unmarshal([]byte(configWith(h.srv.URL)), &v2); err != nil {
		t.Fatal(err)
	}
	doc, err := configdoc.MigrateV2(v2)
	if err != nil {
		t.Fatal(err)
	}
	dash := doc["dashboards"].([]any)[0].(configdoc.Obj)
	dash["settings"].(configdoc.Obj)["statusChecksEnabled"] = true
	tab := dash["tabs"].([]any)[0].(configdoc.Obj)
	root := tab["root"].(configdoc.Obj)
	inner := root["children"].([]any)[0].(configdoc.Obj)
	root["children"] = []any{configdoc.Obj{
		"kind": "folder", "id": "outer", "statusChecksEnabled": false,
		"content": configdoc.Obj{"columns": 12, "children": []any{inner}},
	}}
	c, _, _ := newTestCheckerDoc(t, doc)

	c.checkAllEntries()

	if got := h.count("/inh"); got != 0 {
		t.Errorf("inheriting tile under an off folder probed %d time(s)", got)
	}
	if got := h.count("/on"); got != 1 {
		t.Errorf("explicitly-on tile under an off folder: want 1 request, got %d", got)
	}
}

// A tile in a folder nested inside a folder is still found and probed.
func TestCheckAllEntries_NestedFolderTileIsChecked(t *testing.T) {
	h := newHitCounter(t)
	var v2 configdoc.Obj
	if err := json.Unmarshal([]byte(configWith(h.srv.URL)), &v2); err != nil {
		t.Fatal(err)
	}
	doc, err := configdoc.MigrateV2(v2)
	if err != nil {
		t.Fatal(err)
	}
	// Hand-edit: wrap the first group folder inside a new outer folder.
	tab := doc["dashboards"].([]any)[0].(configdoc.Obj)["tabs"].([]any)[0].(configdoc.Obj)
	root := tab["root"].(configdoc.Obj)
	inner := root["children"].([]any)[0]
	root["children"] = []any{configdoc.Obj{
		"kind": "folder", "id": "outer",
		"content": configdoc.Obj{"columns": 12, "children": []any{inner}},
	}}
	c, db, _ := newTestCheckerDoc(t, doc)

	c.checkAllEntries()

	if got := h.count("/on"); got != 1 {
		t.Errorf("nested tile: want 1 request, got %d", got)
	}
	if ids := cachedIDs(t, db); !ids["on"] {
		t.Errorf("nested tile has no cache row: %v", ids)
	}
}

// A dashboard overriding statusChecksEnabled=false is not probed and its old
// cache rows are pruned; other dashboards are unaffected.
func TestCheckAllEntries_DashboardOverrideOffChecksNothingThere(t *testing.T) {
	h := newHitCounter(t)
	c, db, _ := newTwoDash(t, h.srv.URL, `{"statusChecksEnabled":false}`)
	if _, err := db.Exec(`INSERT INTO status_cache (entry_id, status) VALUES ('b1','up')`); err != nil {
		t.Fatal(err)
	}

	c.checkAllEntries()

	if got := h.count("/a1"); got != 1 {
		t.Errorf("enabled dashboard tile: want 1 request, got %d", got)
	}
	if got := h.count("/b1"); got != 0 {
		t.Errorf("disabled dashboard tile probed %d time(s)", got)
	}
	if ids := cachedIDs(t, db); !ids["a1"] || ids["b1"] {
		t.Errorf("want only a1 cached, got %v", ids)
	}
}

// A dashboard override can also turn checks ON while the global is off.
func TestCheckAllEntries_DashboardOverrideOnBeatsGlobalOff(t *testing.T) {
	h := newHitCounter(t)
	c, _, svc := newTwoDash(t, h.srv.URL, `{"statusChecksEnabled":true}`)
	if err := svc.Set(settings.KeyStatusChecksEnabled, "false"); err != nil {
		t.Fatal(err)
	}

	c.checkAllEntries()

	if h.count("/a1") != 0 || h.count("/b1") != 1 {
		t.Errorf("want only b1 probed, got a1=%d b1=%d", h.count("/a1"), h.count("/b1"))
	}
}

// Entries are due only after their dashboard's interval; not-due entries keep
// their cache rows and make no request.
func TestCheckAllEntries_RespectsPerDashboardInterval(t *testing.T) {
	h := newHitCounter(t)
	c, db, _ := newTwoDash(t, h.srv.URL, `{"statusCheckIntervalMinutes":3}`)
	clock := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	c.now = func() time.Time { return clock }

	c.checkAllEntries() // both due (never checked)
	if h.count("/a1") != 1 || h.count("/b1") != 1 {
		t.Fatalf("first pass: a1=%d b1=%d", h.count("/a1"), h.count("/b1"))
	}

	clock = clock.Add(time.Minute)
	c.checkAllEntries()
	if h.count("/a1") != 1 || h.count("/b1") != 1 {
		t.Errorf("1 minute later nothing should be due: a1=%d b1=%d", h.count("/a1"), h.count("/b1"))
	}
	if ids := cachedIDs(t, db); !ids["a1"] || !ids["b1"] {
		t.Errorf("not-due rows must be kept, got %v", ids)
	}

	clock = clock.Add(2 * time.Minute) // 3 min since first pass: d2 (3) due, d1 (default 5) not
	c.checkAllEntries()
	if h.count("/a1") != 1 || h.count("/b1") != 2 {
		t.Errorf("at 3 min only b1 is due: a1=%d b1=%d", h.count("/a1"), h.count("/b1"))
	}

	clock = clock.Add(2 * time.Minute) // 5 min since first pass; a1 due
	c.checkAllEntries()
	if h.count("/a1") != 2 {
		t.Errorf("at 5 min a1 is due: a1=%d", h.count("/a1"))
	}
}

// Per-entry last-checked state is dropped when the entry stops being checked.
func TestCheckAllEntries_ForgetsRemovedEntries(t *testing.T) {
	h := newHitCounter(t)
	c, db, _ := newTwoDash(t, h.srv.URL, `{}`)
	c.checkAllEntries()
	// Turn d2 off by rewriting its settings.
	doc, err := configdoc.Load(db)
	if err != nil {
		t.Fatal(err)
	}
	doc["dashboards"].([]any)[1].(configdoc.Obj)["settings"] = configdoc.Obj{"statusChecksEnabled": false}
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
	c.checkAllEntries()
	c.lastMu.Lock()
	_, hasB := c.lastChecked["b1"]
	_, hasA := c.lastChecked["a1"]
	c.lastMu.Unlock()
	if hasB || !hasA {
		t.Errorf("lastChecked: b1 present=%v (want false), a1 present=%v (want true)", hasB, hasA)
	}
}

// The per-request timeout is the entry's dashboard timeout.
func TestCheckAllEntries_UsesDashboardTimeout(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/b1" {
			return // d1 (default 10s timeout) answers at once
		}
		select {
		case <-r.Context().Done():
		case <-time.After(3 * time.Second):
		}
	}))
	t.Cleanup(slow.Close)
	c, db, _ := newTwoDash(t, slow.URL, `{"statusCheckTimeoutSeconds":1}`)
	start := time.Now()
	c.checkAllEntries()
	if time.Since(start) > 2500*time.Millisecond {
		t.Errorf("pass took %v; 1s dashboard timeout not applied", time.Since(start))
	}
	var st string
	if err := db.QueryRow(`SELECT status FROM status_cache WHERE entry_id='b1'`).Scan(&st); err != nil || st != "down" {
		t.Errorf("b1 status=%q err=%v, want down", st, err)
	}
}

func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

// When the config can't be loaded: no probes, cache untouched, error logged.
func TestCheckAllEntries_ConfigLoadFailureKeepsCacheAndLogsError(t *testing.T) {
	h := newHitCounter(t)
	for name, raw := range map[string]string{
		"not v3":  configWith(h.srv.URL), // v2 document
		"garbage": `{not json`,
	} {
		t.Run(name, func(t *testing.T) {
			buf := captureLogs(t)
			c, db, _ := newTestCheckerRaw(t, raw)
			if _, err := db.Exec(`INSERT INTO status_cache (entry_id, status) VALUES ('on','up'), ('x','down')`); err != nil {
				t.Fatal(err)
			}
			c.checkAllEntries()
			if h.count("/on") != 0 {
				t.Errorf("probed despite unreadable config")
			}
			if ids := cachedIDs(t, db); !ids["on"] || !ids["x"] || len(ids) != 2 {
				t.Errorf("cache rows must be untouched, got %v", ids)
			}
			out := buf.String()
			if !strings.Contains(out, "level=ERROR") || !strings.Contains(out, "cannot load config") {
				t.Errorf("expected ERROR log, got %q", out)
			}
		})
	}
}

// Ruling 12 on real data: Jonathan's own config (39 unset tiles, 1 ticked)
// probes exactly the tiles explicitly switched on: no mass enablement.
func TestGetEntries_RealWeaversProbesOnlyExplicitlyEnabledTiles(t *testing.T) {
	raw, err := os.ReadFile("../configdoc/testdata/real_weavers.json")
	if err != nil {
		t.Fatal(err)
	}
	var v2 configdoc.Obj
	if err := json.Unmarshal(raw, &v2); err != nil {
		t.Fatal(err)
	}
	doc, err := configdoc.MigrateV2(v2)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{}
	tiles := 0
	configdoc.Walk(doc, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		if n["kind"] != "tile" {
			return true
		}
		tiles++
		if typ, _ := n["type"].(string); typ == "note" {
			return true
		}
		sc, _ := n["statusCheck"].(configdoc.Obj)
		if u, _ := n["url"].(string); u != "" && sc["enabled"] == true {
			want[n["id"].(string)] = true
		}
		return true
	})
	if len(want) == 0 || tiles <= len(want) {
		t.Fatalf("fixture no longer exercises the case: %d tiles, %d enabled", tiles, len(want))
	}
	c, _, _ := newTestCheckerDoc(t, doc)
	entries, err := c.getEntriesFromConfig()
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, e := range entries {
		got[e.ID] = true
	}
	if len(got) != len(want) {
		t.Fatalf("probed %d tiles %v, want exactly the %d explicitly enabled %v", len(got), got, len(want), want)
	}
	for id := range want {
		if !got[id] {
			t.Errorf("explicitly enabled tile %s not probed", id)
		}
	}
}
