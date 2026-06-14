package settings

import (
	"database/sql"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	_ "modernc.org/sqlite"
)

// newTestService opens an in-memory SQLite DB, creates the app_settings
// table, and returns a fresh settings.Service. The schema is duplicated here
// rather than imported from internal/database to avoid a circular dep.
func newTestService(t *testing.T) *Service {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err := db.Exec(`CREATE TABLE app_settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	s, err := New(db)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return s
}

// --- schema integrity ---

func TestEveryKeyHasADefinition(t *testing.T) {
	// Every Key* constant in this package must have a corresponding entry
	// in Definitions, otherwise consumers calling settings.Get(KeyFoo) get
	// an empty string with no error.
	keys := []string{
		KeyServerPort, KeyLogLevel, KeyProxyTrustedCIDRs,
		KeyAuthLoginRateLimitPerMin, KeyAuthSessionLifetimeHours,
		KeyEditModeIdleTimeoutMinutes,
		KeyStatusCheckIntervalMinutes, KeyStatusCheckTimeoutSeconds,
		KeyUploadMaxBytesImport, KeyUploadMaxBytesBackground, KeyUploadMaxBytesIcon,
		KeyHTTPReadHeaderTimeoutSeconds, KeyHTTPReadTimeoutSeconds,
		KeyHTTPWriteTimeoutSeconds, KeyHTTPIdleTimeoutSeconds,
		KeyDiscoveryMaxParallelProbes, KeyDiscoveryPerHostTimeoutSecs,
	}
	for _, k := range keys {
		if _, ok := defByKey[k]; !ok {
			t.Errorf("Key constant %q has no entry in Definitions", k)
		}
	}
	if len(keys) != len(Definitions) {
		t.Errorf("key-constant count (%d) != Definitions count (%d) — one drifted from the other", len(keys), len(Definitions))
	}
}

func TestDefinitionDefaultsValidate(t *testing.T) {
	// Each Definition.Default must pass its own validator, otherwise New()
	// fails to seed a fresh DB and the service won't start.
	for _, d := range Definitions {
		if err := validate(d, d.Default); err != nil {
			t.Errorf("%s: default %q fails its own validator: %v", d.Key, d.Default, err)
		}
	}
}

// --- New / seedAndLoad ---

func TestNewSeedsAllDefaults(t *testing.T) {
	s := newTestService(t)
	for _, d := range Definitions {
		if got := s.Get(d.Key); got != d.Default {
			t.Errorf("%s: after seed expected %q, got %q", d.Key, d.Default, got)
		}
	}
}

func TestNewLoadsExistingRows(t *testing.T) {
	// A pre-seeded DB row must be honoured rather than overwritten by the
	// default on next start (idempotent re-init).
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err := db.Exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO app_settings (key, value) VALUES (?, ?)`, KeyServerPort, "9090"); err != nil {
		t.Fatal(err)
	}

	s, err := New(db)
	if err != nil {
		t.Fatal(err)
	}
	if got := s.Get(KeyServerPort); got != "9090" {
		t.Errorf("expected pre-seeded value 9090 to be preserved, got %q", got)
	}
}

// --- Get / Set ---

func TestSetPersistsAndCaches(t *testing.T) {
	s := newTestService(t)
	if err := s.Set(KeyServerPort, "9000"); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if got := s.Get(KeyServerPort); got != "9000" {
		t.Errorf("cache: expected 9000, got %q", got)
	}
	// Reload from the DB to confirm persistence.
	s2, err := New(s.db)
	if err != nil {
		t.Fatal(err)
	}
	if got := s2.Get(KeyServerPort); got != "9000" {
		t.Errorf("DB: expected 9000 after reload, got %q", got)
	}
}

func TestSetRejectsUnknownKey(t *testing.T) {
	s := newTestService(t)
	err := s.Set("does.not.exist", "whatever")
	if err == nil {
		t.Fatal("expected error for unknown key")
	}
	if !strings.Contains(err.Error(), "unknown setting") {
		t.Errorf("error should mention unknown setting, got: %v", err)
	}
}

// --- Subscribe ---

func TestSubscribeFiresOnSet(t *testing.T) {
	s := newTestService(t)
	var received atomic.Value
	var calls atomic.Int32
	s.Subscribe(KeyLogLevel, func(v string) {
		received.Store(v)
		calls.Add(1)
	})

	if err := s.Set(KeyLogLevel, "debug"); err != nil {
		t.Fatal(err)
	}
	if got := received.Load(); got != "debug" {
		t.Errorf("subscriber got %v, want \"debug\"", got)
	}
	if calls.Load() != 1 {
		t.Errorf("subscriber called %d times, want 1", calls.Load())
	}

	// Subscribers for different keys must not cross-fire.
	if err := s.Set(KeyServerPort, "9000"); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Errorf("subscriber on log.level fired for server.port change (%d calls)", calls.Load())
	}
}

func TestSubscribeMultipleListeners(t *testing.T) {
	s := newTestService(t)
	var hits atomic.Int32
	for i := 0; i < 3; i++ {
		s.Subscribe(KeyLogLevel, func(string) { hits.Add(1) })
	}
	if err := s.Set(KeyLogLevel, "warn"); err != nil {
		t.Fatal(err)
	}
	if hits.Load() != 3 {
		t.Errorf("expected 3 listener invocations, got %d", hits.Load())
	}
}

// --- Validation ---

func TestValidateInt(t *testing.T) {
	tests := []struct {
		name    string
		key     string
		value   string
		wantErr bool
	}{
		{"valid port", KeyServerPort, "8080", false},
		{"min boundary", KeyServerPort, "1", false},
		{"max boundary", KeyServerPort, "65535", false},
		{"below min", KeyServerPort, "0", true},
		{"above max", KeyServerPort, "65536", true},
		{"non-numeric", KeyServerPort, "abc", true},
		{"empty", KeyServerPort, "", true},
		{"rate limit valid", KeyAuthLoginRateLimitPerMin, "100", false},
		{"rate limit above max", KeyAuthLoginRateLimitPerMin, "10000", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			def := defByKey[tt.key]
			err := validate(def, tt.value)
			if (err != nil) != tt.wantErr {
				t.Errorf("validate(%s, %q): wantErr=%v, got %v", tt.key, tt.value, tt.wantErr, err)
			}
		})
	}
}

func TestValidateLogLevel(t *testing.T) {
	tests := []struct {
		value   string
		wantErr bool
	}{
		{"debug", false}, {"info", false}, {"warn", false}, {"error", false},
		{"DEBUG", false}, // case-insensitive via ToLower
		{"trace", true},
		{"", true},
	}
	for _, tt := range tests {
		def := defByKey[KeyLogLevel]
		err := validate(def, tt.value)
		if (err != nil) != tt.wantErr {
			t.Errorf("log_level %q: wantErr=%v, got %v", tt.value, tt.wantErr, err)
		}
	}
}

func TestValidateCIDRList(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		wantErr bool
	}{
		{"empty array", `[]`, false},
		{"single valid", `["10.0.0.0/8"]`, false},
		{"multiple valid", `["10.0.0.0/8","192.168.1.5/32"]`, false},
		{"ipv6", `["fd00::/8"]`, false},
		{"not JSON", `10.0.0.0/8`, true},
		{"not an array", `{"cidr":"10.0.0.0/8"}`, true},
		{"contains invalid CIDR", `["10.0.0.0/8","not-a-cidr"]`, true},
		{"missing slash", `["10.0.0.0"]`, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			def := defByKey[KeyProxyTrustedCIDRs]
			err := validate(def, tt.value)
			if (err != nil) != tt.wantErr {
				t.Errorf("cidr_list %q: wantErr=%v, got %v", tt.value, tt.wantErr, err)
			}
		})
	}
}

func TestSetRejectsInvalidValue(t *testing.T) {
	s := newTestService(t)
	if err := s.Set(KeyServerPort, "99999"); err == nil {
		t.Fatal("expected validation error for port 99999")
	}
	// The cache must not have been mutated on validation failure.
	if got := s.Get(KeyServerPort); got != "8080" {
		t.Errorf("after failed Set, cache should still be default 8080, got %q", got)
	}
}

// --- typed accessors ---

func TestGetIntReturnsParsed(t *testing.T) {
	s := newTestService(t)
	if got := s.GetInt(KeyServerPort); got != 8080 {
		t.Errorf("GetInt default: expected 8080, got %d", got)
	}
	if err := s.Set(KeyAuthLoginRateLimitPerMin, "42"); err != nil {
		t.Fatal(err)
	}
	if got := s.GetInt(KeyAuthLoginRateLimitPerMin); got != 42 {
		t.Errorf("GetInt after Set: expected 42, got %d", got)
	}
}

func TestGetStringListEmpty(t *testing.T) {
	s := newTestService(t)
	if got := s.GetStringList(KeyProxyTrustedCIDRs); len(got) != 0 {
		t.Errorf("default trusted_cidrs should be empty, got %v", got)
	}
}

func TestGetStringListPopulated(t *testing.T) {
	s := newTestService(t)
	if err := s.Set(KeyProxyTrustedCIDRs, `["10.0.0.0/8","192.168.1.5/32"]`); err != nil {
		t.Fatal(err)
	}
	got := s.GetStringList(KeyProxyTrustedCIDRs)
	want := []string{"10.0.0.0/8", "192.168.1.5/32"}
	if len(got) != len(want) {
		t.Fatalf("expected %d entries, got %d (%v)", len(want), len(got), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("[%d]: expected %q, got %q", i, want[i], got[i])
		}
	}
}

// --- concurrency ---

func TestConcurrentReadsAndWrites(t *testing.T) {
	// Stress the RWMutex on Get / Set. Race detector (run with -race) is
	// the real value here — this test just needs to exercise the paths.
	s := newTestService(t)
	const goroutines = 8
	const iterations = 200
	var wg sync.WaitGroup
	wg.Add(goroutines * 2)

	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < iterations; j++ {
				_ = s.Get(KeyServerPort)
				_ = s.All()
			}
		}()
		go func(id int) {
			defer wg.Done()
			for j := 0; j < iterations; j++ {
				// Each goroutine writes a port in the valid range, modulated
				// to vary the value.
				v := strconv.Itoa(8000 + (id*iterations+j)%1000)
				_ = s.Set(KeyServerPort, v)
			}
		}(i)
	}
	wg.Wait()
}
