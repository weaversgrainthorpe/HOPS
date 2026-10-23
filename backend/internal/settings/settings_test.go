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
		KeyStatusChecksEnabled, KeyStatusCheckIntervalMinutes, KeyStatusCheckTimeoutSeconds,
		KeyUploadMaxBytesImport, KeyUploadMaxBytesBackground, KeyUploadMaxBytesIcon,
		KeyHTTPReadHeaderTimeoutSeconds, KeyHTTPReadTimeoutSeconds,
		KeyHTTPWriteTimeoutSeconds, KeyHTTPIdleTimeoutSeconds,
		KeyDiscoveryMaxParallelProbes, KeyDiscoveryPerHostTimeoutSecs,
		KeyFoldersAnimatedBackgrounds,
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

func TestBoolSetting(t *testing.T) {
	s := newTestService(t)
	if !s.GetBool(KeyStatusChecksEnabled) {
		t.Fatal("status.checks_enabled should default to true")
	}
	for _, bad := range []string{"", "yes", "1", "TRUE", "on"} {
		if err := s.Set(KeyStatusChecksEnabled, bad); err == nil {
			t.Errorf("Set(%q) should be rejected", bad)
		}
	}
	if err := s.Set(KeyStatusChecksEnabled, "false"); err != nil {
		t.Fatalf("Set(false): %v", err)
	}
	if s.GetBool(KeyStatusChecksEnabled) {
		t.Error("GetBool should be false after Set(false)")
	}
}

func TestEnumSetting(t *testing.T) {
	// No current setting is an enum (layout.default_mode was the only one,
	// removed in M5); the type is still checked exactly.
	def := Definition{Key: "test.enum", Type: "enum", Default: "a", Enum: []string{"a", "b"}}
	for _, bad := range []string{"a ", "c", "", "A"} {
		if err := validate(def, bad); err == nil {
			t.Errorf("validate(%q) should be rejected", bad)
		}
	}
	if err := validate(def, "b"); err != nil {
		t.Fatalf("validate(b): %v", err)
	}
	s := newTestService(t)
	if err := s.Validate("no.such.key", "x"); err == nil {
		t.Error("Validate of unknown key should error")
	}
}

// Ruling 4: free layout is gone, so is the layout.default_mode setting.
func TestLayoutDefaultModeRemoved(t *testing.T) {
	s := newTestService(t)
	if _, ok := s.Definition("layout.default_mode"); ok {
		t.Error("layout.default_mode is still a setting")
	}
}

// --- upload limits (M5 §10) ---

func TestUploadLimitBoundsAndDefaults(t *testing.T) {
	const mb = 1 << 20
	cases := []struct {
		key           string
		def, min, max int
	}{
		{KeyUploadMaxBytesImport, 50 * mb, 1 * mb, 200 * mb},
		{KeyUploadMaxBytesBackground, 25 * mb, 1 * mb, 100 * mb},
		{KeyUploadMaxBytesIcon, 2 * mb, 1 * mb, 10 * mb},
	}
	for _, c := range cases {
		d := defByKey[c.key]
		if d.Default != strconv.Itoa(c.def) || d.Min != c.min || d.Max != c.max {
			t.Errorf("%s: default/min/max = %s/%d/%d, want %d/%d/%d", c.key, d.Default, d.Min, d.Max, c.def, c.min, c.max)
		}
		if err := validate(d, strconv.Itoa(c.max+1)); err == nil {
			t.Errorf("%s: a value above the ceiling must be refused", c.key)
		}
		if err := validate(d, strconv.Itoa(c.min-1)); err == nil {
			t.Errorf("%s: a value below 1 MB must be refused", c.key)
		}
	}
}

func newServiceWithRows(t *testing.T, rows map[string]string) (*Service, *sql.DB) {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	if _, err := db.Exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME)`); err != nil {
		t.Fatal(err)
	}
	for k, v := range rows {
		if _, err := db.Exec(`INSERT INTO app_settings (key, value) VALUES (?, ?)`, k, v); err != nil {
			t.Fatal(err)
		}
	}
	s, err := New(db)
	if err != nil {
		t.Fatal(err)
	}
	return s, db
}

func TestStoredUploadLimitAboveCeilingIsClampedOnLoad(t *testing.T) {
	s, _ := newServiceWithRows(t, map[string]string{
		KeyUploadMaxBytesImport: strconv.Itoa(1 << 30), // the old 1 GB ceiling
		KeyUploadMaxBytesIcon:   strconv.Itoa(2048),    // under the new 1 MB floor
	})
	if got := s.GetInt(KeyUploadMaxBytesImport); got != 200<<20 {
		t.Errorf("import limit = %d, want clamped to %d", got, 200<<20)
	}
	if got := s.GetInt(KeyUploadMaxBytesIcon); got != 1<<20 {
		t.Errorf("icon limit = %d, want raised to %d", got, 1<<20)
	}
	adj := s.Adjustments()
	if adj[KeyUploadMaxBytesImport] != strconv.Itoa(1<<30) {
		t.Errorf("import adjustment = %q, want the stored value %d", adj[KeyUploadMaxBytesImport], 1<<30)
	}
	if adj[KeyUploadMaxBytesIcon] != "2048" {
		t.Errorf("icon adjustment = %q, want 2048", adj[KeyUploadMaxBytesIcon])
	}
	if _, ok := adj[KeyUploadMaxBytesBackground]; ok {
		t.Errorf("background was in range and must not be reported as adjusted")
	}
}

func TestSavingAClampedSettingClearsTheNotice(t *testing.T) {
	s, db := newServiceWithRows(t, map[string]string{KeyUploadMaxBytesImport: strconv.Itoa(1 << 30)})
	if err := s.Set(KeyUploadMaxBytesImport, strconv.Itoa(200<<20)); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.Adjustments()[KeyUploadMaxBytesImport]; ok {
		t.Error("the notice must clear once the admin saves the setting")
	}
	var stored string
	if err := db.QueryRow(`SELECT value FROM app_settings WHERE key = ?`, KeyUploadMaxBytesImport).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != strconv.Itoa(200<<20) {
		t.Errorf("stored = %q after save", stored)
	}
}

func TestClampedValueStaysVisibleUntilSaved(t *testing.T) {
	// The clamp is not written back on load, so the notice survives a restart
	// until the admin has seen it and saved the setting.
	_, db := newServiceWithRows(t, map[string]string{KeyUploadMaxBytesBackground: strconv.Itoa(500 << 20)})
	s2, err := New(db)
	if err != nil {
		t.Fatal(err)
	}
	if s2.Adjustments()[KeyUploadMaxBytesBackground] != strconv.Itoa(500<<20) {
		t.Error("after a restart the clamp notice must still be reported")
	}
	if s2.GetInt(KeyUploadMaxBytesBackground) != 100<<20 {
		t.Error("after a restart the clamped value must still be in force")
	}
}
