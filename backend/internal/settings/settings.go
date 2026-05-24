// Package settings is the single source of truth for HOPS's admin-configurable
// runtime settings — port, log level, trusted proxies, rate limits, upload
// caps, status-check interval and timeouts, session lifetime, and HTTP server
// timeouts. Values are persisted in the app_settings DB table and exposed
// through typed accessors. Subscribers can be notified on change for settings
// that take effect live (rate limiter, status checker, etc.); other settings
// require a restart and are documented as such in their Definition.
//
// This package replaces the previous LOG_LEVEL and HOPS_TRUSTED_PROXIES
// environment variables and the --port CLI flag, which were dropped in v1.6.0
// in favour of GUI configuration via /api/settings.
package settings

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
)

// Definition describes a single setting's contract — its key, type, default,
// validation, and whether changes take effect immediately or only after a
// server restart. The Definitions slice below enumerates every setting HOPS
// exposes; adding a new setting is a matter of adding an entry and consuming
// it where appropriate.
type Definition struct {
	// Key is the dotted identifier persisted in app_settings.
	Key string

	// Type is a hint used by the API and frontend to render the right input.
	// One of: "int", "duration_seconds", "duration_minutes", "duration_hours",
	// "bytes", "log_level", "cidr_list".
	Type string

	// Default is the seeded value used when no row exists for this key.
	Default string

	// RestartRequired is true if a change only takes effect after a server
	// restart (e.g. server port, HTTP timeouts). False if the consumer reads
	// the value live or subscribes to changes.
	RestartRequired bool

	// Description is shown in the admin UI next to the setting.
	Description string

	// Min / Max bound integer settings inclusively. Zero means "unbounded".
	Min int
	Max int

	// Enum restricts string settings to a fixed set (e.g. log levels).
	Enum []string
}

// Setting keys. Keep these in sync with the Definitions slice below.
const (
	KeyServerPort                   = "server.port"
	KeyLogLevel                     = "log.level"
	KeyProxyTrustedCIDRs            = "proxy.trusted_cidrs"
	KeyAuthLoginRateLimitPerMin     = "auth.login_rate_limit_per_min"
	KeyAuthSessionLifetimeHours     = "auth.session_lifetime_hours"
	KeyStatusCheckIntervalMinutes   = "status.check_interval_minutes"
	KeyStatusCheckTimeoutSeconds    = "status.check_timeout_seconds"
	KeyUploadMaxBytesImport         = "upload.max_bytes_import"
	KeyUploadMaxBytesBackground     = "upload.max_bytes_background"
	KeyUploadMaxBytesIcon           = "upload.max_bytes_icon"
	KeyHTTPReadHeaderTimeoutSeconds = "http.read_header_timeout_seconds"
	KeyHTTPReadTimeoutSeconds       = "http.read_timeout_seconds"
	KeyHTTPWriteTimeoutSeconds      = "http.write_timeout_seconds"
	KeyHTTPIdleTimeoutSeconds       = "http.idle_timeout_seconds"
)

// Definitions is the authoritative list of every setting HOPS exposes.
var Definitions = []Definition{
	{
		Key: KeyServerPort, Type: "int", Default: "8080", RestartRequired: true,
		Description: "TCP port the HTTP server listens on.",
		Min:         1, Max: 65535,
	},
	{
		Key: KeyLogLevel, Type: "log_level", Default: "info",
		Description: "Log verbosity. Changes apply on the next log emission.",
		Enum:        []string{"debug", "info", "warn", "error"},
	},
	{
		Key: KeyProxyTrustedCIDRs, Type: "cidr_list", Default: "[]", RestartRequired: true,
		Description: "Reverse-proxy IP ranges (CIDR) whose X-Forwarded-For / X-Forwarded-Proto headers are honoured. Leave empty if HOPS is not behind a proxy.",
	},
	{
		Key: KeyAuthLoginRateLimitPerMin, Type: "int", Default: "20",
		Description: "Maximum failed login attempts per IP per minute.",
		Min:         1, Max: 1000,
	},
	{
		Key: KeyAuthSessionLifetimeHours, Type: "duration_hours", Default: "24",
		Description: "How long an admin login session lasts before it must be renewed.",
		Min:         1, Max: 24 * 30,
	},
	{
		Key: KeyStatusCheckIntervalMinutes, Type: "duration_minutes", Default: "5",
		Description: "How often the status checker probes each tile.",
		Min:         1, Max: 60 * 24,
	},
	{
		Key: KeyStatusCheckTimeoutSeconds, Type: "duration_seconds", Default: "10",
		Description: "HTTP timeout for each status-check request.",
		Min:         1, Max: 120,
	},
	{
		Key: KeyUploadMaxBytesImport, Type: "bytes", Default: "52428800",
		Description: "Maximum upload size for the config import endpoint.",
		Min:         1024, Max: 1 << 30,
	},
	{
		Key: KeyUploadMaxBytesBackground, Type: "bytes", Default: "52428800",
		Description: "Maximum upload size for background images.",
		Min:         1024, Max: 1 << 30,
	},
	{
		Key: KeyUploadMaxBytesIcon, Type: "bytes", Default: "8388608",
		Description: "Maximum upload size for icon images.",
		Min:         1024, Max: 1 << 30,
	},
	{
		Key: KeyHTTPReadHeaderTimeoutSeconds, Type: "duration_seconds", Default: "10", RestartRequired: true,
		Description: "Server timeout for reading request headers.",
		Min:         1, Max: 3600,
	},
	{
		Key: KeyHTTPReadTimeoutSeconds, Type: "duration_seconds", Default: "60", RestartRequired: true,
		Description: "Server timeout for reading the full request.",
		Min:         1, Max: 3600,
	},
	{
		Key: KeyHTTPWriteTimeoutSeconds, Type: "duration_seconds", Default: "120", RestartRequired: true,
		Description: "Server timeout for writing the response.",
		Min:         1, Max: 3600,
	},
	{
		Key: KeyHTTPIdleTimeoutSeconds, Type: "duration_seconds", Default: "120", RestartRequired: true,
		Description: "Server timeout for keep-alive idle connections.",
		Min:         1, Max: 3600,
	},
}

// defByKey indexes Definitions by key for fast lookup.
var defByKey = func() map[string]Definition {
	m := make(map[string]Definition, len(Definitions))
	for _, d := range Definitions {
		m[d.Key] = d
	}
	return m
}()

// Service holds the in-memory cache of settings and notifies subscribers when
// a value changes. The cache is loaded from the DB on construction and kept in
// sync on every Set; reads are O(1) and lock-cheap.
type Service struct {
	db        *sql.DB
	mu        sync.RWMutex
	cache     map[string]string
	listeners map[string][]func(value string)
}

// New constructs a Service: ensures the app_settings table is seeded with
// defaults for any missing keys, then loads every value into the cache.
// runMigrations must already have created the app_settings table.
func New(db *sql.DB) (*Service, error) {
	s := &Service{
		db:        db,
		cache:     make(map[string]string, len(Definitions)),
		listeners: make(map[string][]func(string)),
	}
	if err := s.seedAndLoad(); err != nil {
		return nil, fmt.Errorf("settings init: %w", err)
	}
	return s, nil
}

func (s *Service) seedAndLoad() error {
	// Insert any missing defaults idempotently.
	for _, d := range Definitions {
		if _, err := s.db.Exec(
			"INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)",
			d.Key, d.Default,
		); err != nil {
			return fmt.Errorf("seed %q: %w", d.Key, err)
		}
	}
	// Load every row into the cache.
	rows, err := s.db.Query("SELECT key, value FROM app_settings")
	if err != nil {
		return fmt.Errorf("load: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return err
		}
		s.cache[k] = v
	}
	return rows.Err()
}

// Definition returns the definition for a key, or false if the key is unknown.
func (s *Service) Definition(key string) (Definition, bool) {
	d, ok := defByKey[key]
	return d, ok
}

// AllDefinitions returns the full list of setting definitions in declaration
// order. Used by the API to surface the schema to the admin UI.
func (s *Service) AllDefinitions() []Definition {
	return Definitions
}

// Get returns the cached raw string value for a key. Returns the empty string
// if the key is unknown (which shouldn't happen — keys come from Definitions).
func (s *Service) Get(key string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cache[key]
}

// All returns a snapshot of every cached setting.
func (s *Service) All() map[string]string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]string, len(s.cache))
	for k, v := range s.cache {
		out[k] = v
	}
	return out
}

// Set validates, persists, and caches a new value for a key, then notifies
// any subscribers. Returns an error if the key is unknown or the value fails
// validation.
func (s *Service) Set(key, value string) error {
	def, ok := defByKey[key]
	if !ok {
		return fmt.Errorf("unknown setting key %q", key)
	}
	if err := validate(def, value); err != nil {
		return err
	}

	s.mu.Lock()
	if _, err := s.db.Exec(
		"INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) "+
			"ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
		key, value,
	); err != nil {
		s.mu.Unlock()
		return fmt.Errorf("persist %q: %w", key, err)
	}
	s.cache[key] = value
	listeners := append([]func(string){}, s.listeners[key]...)
	s.mu.Unlock()

	for _, fn := range listeners {
		fn(value)
	}
	return nil
}

// Subscribe registers a callback that is invoked synchronously after every
// successful Set for the given key. Use this for live-applied settings (rate
// limiter, status checker, log level).
func (s *Service) Subscribe(key string, fn func(value string)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listeners[key] = append(s.listeners[key], fn)
}

// --- typed accessors ---

// GetInt parses an integer setting. Returns the Definition default on parse
// failure (shouldn't happen — Set validates).
func (s *Service) GetInt(key string) int {
	if v, err := strconv.Atoi(s.Get(key)); err == nil {
		return v
	}
	if d, ok := defByKey[key]; ok {
		v, _ := strconv.Atoi(d.Default)
		return v
	}
	return 0
}

// GetStringList parses a JSON string array setting (e.g. trusted CIDRs).
func (s *Service) GetStringList(key string) []string {
	raw := s.Get(key)
	if raw == "" {
		return nil
	}
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil
	}
	return out
}

// --- validation ---

func validate(def Definition, value string) error {
	switch def.Type {
	case "int", "duration_seconds", "duration_minutes", "duration_hours", "bytes":
		v, err := strconv.Atoi(value)
		if err != nil {
			return fmt.Errorf("%s: not an integer (%v)", def.Key, err)
		}
		if def.Min != 0 && v < def.Min {
			return fmt.Errorf("%s: %d is below minimum %d", def.Key, v, def.Min)
		}
		if def.Max != 0 && v > def.Max {
			return fmt.Errorf("%s: %d is above maximum %d", def.Key, v, def.Max)
		}
	case "log_level":
		if !containsString(def.Enum, strings.ToLower(value)) {
			return fmt.Errorf("%s: %q is not one of %v", def.Key, value, def.Enum)
		}
	case "cidr_list":
		var list []string
		if err := json.Unmarshal([]byte(value), &list); err != nil {
			return fmt.Errorf("%s: not a JSON string array (%v)", def.Key, err)
		}
		for _, cidr := range list {
			if _, _, err := net.ParseCIDR(cidr); err != nil {
				return fmt.Errorf("%s: %q is not a valid CIDR (try 10.0.0.0/8 or 192.168.1.5/32)", def.Key, cidr)
			}
		}
	default:
		return fmt.Errorf("%s: unknown setting type %q (internal bug)", def.Key, def.Type)
	}
	return nil
}

func containsString(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}
