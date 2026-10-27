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
	"log/slog"
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
	// "bytes", "log_level", "enum", "cidr_list", "bool".
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

// The values of the "Animations" setting (Ruling 5).
const (
	AnimationsOn     = "on"
	AnimationsOff    = "off"
	AnimationsAlways = "always"
)

// MB is one megabyte as HOPS shows it (1,048,576 bytes).
const MB = 1 << 20

// Setting keys. Keep these in sync with the Definitions slice below.
const (
	KeyServerPort                   = "server.port"
	KeyLogLevel                     = "log.level"
	KeyProxyTrustedCIDRs            = "proxy.trusted_cidrs"
	KeyAuthLoginRateLimitPerMin     = "auth.login_rate_limit_per_min"
	KeyAuthSessionLifetimeHours     = "auth.session_lifetime_hours"
	KeyEditModeIdleTimeoutMinutes   = "editmode.idle_timeout_minutes"
	KeyStatusChecksEnabled          = "status.checks_enabled"
	KeyStatusCheckIntervalMinutes   = "status.check_interval_minutes"
	KeyStatusCheckTimeoutSeconds    = "status.check_timeout_seconds"
	KeyStatusDeadAfterHours         = "status.dead_after_hours"
	KeyUploadMaxBytesImport         = "upload.max_bytes_import"
	KeyUploadMaxBytesBackground     = "upload.max_bytes_background"
	KeyUploadMaxBytesIcon           = "upload.max_bytes_icon"
	KeyHTTPReadHeaderTimeoutSeconds = "http.read_header_timeout_seconds"
	KeyHTTPReadTimeoutSeconds       = "http.read_timeout_seconds"
	KeyHTTPWriteTimeoutSeconds      = "http.write_timeout_seconds"
	KeyHTTPIdleTimeoutSeconds       = "http.idle_timeout_seconds"
	KeyDiscoveryMaxParallelProbes   = "discovery.max_parallel_probes"
	KeyDiscoveryPerHostTimeoutSecs  = "discovery.per_host_timeout_seconds"
	KeyDiscoveryMaxScanMinutes      = "discovery.max_scan_minutes"
	KeyFoldersAnimatedBackgrounds   = "folders.animated_backgrounds"
	KeyDisplayAnimations            = "display.animations"
	KeyBackupKeepCount              = "backup.keep_count"
	KeyBackupKeepDays               = "backup.keep_days"
	KeyBackupMaxCount               = "backup.max_count"
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
		Key: KeyAuthSessionLifetimeHours, Type: "duration_hours", Default: "8760",
		Description: "How long to stay signed in after logging in (hours). Defaults to one year — HOPS keeps you signed in until you click Logout. Lower this if you want signed-in admins to re-authenticate periodically.",
		Min:         1, Max: 24 * 365 * 5,
	},
	{
		Key: KeyEditModeIdleTimeoutMinutes, Type: "duration_minutes", Default: "15",
		Description: "How long edit mode stays on without activity before it switches itself off (minutes). You stay signed in — just the edit toggle flips back to view-only so you don't accidentally make changes hours later. Set to 0 to disable the idle timeout.",
		Min:         0, Max: 60 * 24,
	},
	{
		Key: KeyStatusChecksEnabled, Type: "bool", Default: "true",
		Description: "Master switch for tile status checks. When on, HOPS checks only the tiles that have " +
			"\"Enable Status Check\" ticked — tiles without it ticked are never contacted. " +
			"When off, HOPS checks nothing at all and every status badge shows that checks are turned off.",
	},
	{
		Key: KeyStatusCheckIntervalMinutes, Type: "duration_minutes", Default: "5",
		Description: "How often HOPS checks whether each tile's service is up. " +
			"Tiles that keep failing get checked less often automatically, so a service that's stuck broken " +
			"doesn't slow everything else down. The moment a failing tile responds again, it goes back to normal.",
		Min:         1, Max: 60 * 24,
	},
	{
		Key: KeyStatusCheckTimeoutSeconds, Type: "duration_seconds", Default: "10",
		Description: "HTTP timeout for each status-check request.",
		Min:         1, Max: 120,
	},
	{
		Key: KeyStatusDeadAfterHours, Type: "duration_hours", Default: "168",
		Description: "A tile whose status check has failed without a break for longer than this is listed " +
			"as a dead link in Settings › Dashboards, so you can fix or remove it. Stored in hours; set it in hours or days.",
		Min:         1, Max: 24 * 365,
	},
	// Upload limits (M5 §10): the largest file each upload accepts. Shown and
	// typed in MB in the admin UI. The ceilings are sized for the Pi Zero
	// tenet, because import reads the whole file into memory; the floor is
	// 1 MB. A stored value outside the bounds is clamped on load (see
	// clampOnLoad) and reported through Adjustments.
	{
		Key: KeyUploadMaxBytesImport, Type: "bytes", Default: strconv.Itoa(50 * MB),
		Description: "Imports bigger than this are refused.",
		Min:         1 * MB, Max: 200 * MB,
	},
	{
		Key: KeyUploadMaxBytesBackground, Type: "bytes", Default: strconv.Itoa(25 * MB),
		Description: "Background image uploads bigger than this are refused.",
		Min:         1 * MB, Max: 100 * MB,
	},
	{
		Key: KeyUploadMaxBytesIcon, Type: "bytes", Default: strconv.Itoa(2 * MB),
		Description: "Icon uploads bigger than this are refused.",
		Min:         1 * MB, Max: 10 * MB,
	},
	// Backup retention (M6 §11). The bounds match database.RetentionPolicy;
	// max_count may never be below keep_count (crossCheck). Protected
	// backups (before an upgrade, manual, uploaded) are never deleted
	// automatically and count toward neither.
	{
		Key: KeyBackupKeepCount, Type: "int", Default: "10",
		Description: "The newest this-many automatic backups are always kept, however old they are. " +
			"Backups you create or upload, and the one taken before an upgrade, are kept until you delete them and don't count.",
		Min: 3, Max: 100,
	},
	{
		Key: KeyBackupKeepDays, Type: "int", Default: "0",
		Description: "Also keep every automatic backup newer than this many days. 0 = off: only the newest ones above are kept.",
		Min: 0, Max: 3650,
	},
	{
		Key: KeyBackupMaxCount, Type: "int", Default: "100",
		Description: "A ceiling that protects the disk: if there are still more automatic backups than this, the oldest are deleted " +
			"even if they are newer than the days above (you'll see a notice). Never fewer than the newest kept above.",
		Min: 3, Max: 1000,
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
	{
		Key: KeyDiscoveryMaxParallelProbes, Type: "int", Default: "128",
		Description: "Maximum concurrent hosts in flight during a discovery scan. Higher values finish a /24 faster but spike CPU and network use. 64–256 is sensible for homelab LANs.",
		Min:         1, Max: 1024,
	},
	{
		Key: KeyDiscoveryPerHostTimeoutSecs, Type: "duration_seconds", Default: "1",
		Description: "How long to wait for each port on each host to answer. 1 second is plenty on a normal home network — " +
			"a service that's going to respond responds almost instantly. Try 2 or 3 if you're on Wi-Fi or a slow network " +
			"and seeing things you know are running get missed. Raising this also makes scans take longer overall, " +
			"because the scanner waits this long on every host that isn't responding.",
		Min:         1, Max: 60,
	},
	{
		Key: KeyDiscoveryMaxScanMinutes, Type: "int", Default: "30",
		Description: "The longest a discovery scan may run. A scan that reaches it stops, keeps what it found, " +
			"and is marked as stopped early. A home /24 normally takes well under a minute; a /16 can take much longer.",
		Min: 1, Max: 240,
	},
	{
		Key: KeyFoldersAnimatedBackgrounds, Type: "bool", Default: "true",
		Description: "Whether folders may show animated (video/GIF) backgrounds. Individual dashboards can override this.",
	},
	// M6 §7.13 / Ruling 5: the editor's drop and merge animations. Read live
	// by the editor through each dashboard's computed display block.
	{
		Key: KeyDisplayAnimations, Type: "enum", Default: AnimationsOn,
		Enum: []string{AnimationsOn, AnimationsOff, AnimationsAlways},
		Description: "Animations in the editor: a tile dropped into a folder flies into it and the folder gulps it in; two tiles " +
			"merged into a new folder are drawn together before the folder pops out. On plays them unless your device asks " +
			"for reduced motion; Always plays them even then; Off never does. They never delay your change.",
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
	// adjusted maps a key to the out-of-range value stored for it, for each
	// setting clamped on load. The clamp is not written back, so the admin is
	// told (Adjustments) until they save the setting themselves.
	adjusted map[string]string
	// moves is what the one-time default move (Ruling 21) changed, read
	// back from settings_once on every start so the notice can be shown
	// until it is dismissed.
	moves []DefaultMove
}

// DefaultMove is a setting that was still at its previous default and was
// moved to the new one (Ruling 21). From and To are byte counts.
type DefaultMove struct {
	Key  string `json:"key"`
	From int    `json:"from"`
	To   int    `json:"to"`
}

// previousDefaults lists, per setting, the default an older build seeded
// (v2.2.1 and earlier v3 builds). A stored value exactly equal to it has
// never been changed, so it moves to the new default once (Ruling 21).
// Import stays 50 MB, so it is not listed.
var previousDefaults = []struct {
	Key  string
	From int
}{
	{KeyUploadMaxBytesBackground, 50 * MB},
	{KeyUploadMaxBytesIcon, 8 * MB},
}

// defaultMoveID marks, in settings_once, that the upload-default move has
// run on this database. It runs once: an admin who later chooses the old
// value on purpose keeps it.
const defaultMoveID = "upload-defaults-v3"

// New constructs a Service: ensures the app_settings table is seeded with
// defaults for any missing keys, then loads every value into the cache.
// runMigrations must already have created the app_settings table.
func New(db *sql.DB) (*Service, error) {
	s := &Service{
		db:        db,
		cache:     make(map[string]string, len(Definitions)),
		listeners: make(map[string][]func(string)),
		adjusted:  make(map[string]string),
	}
	if err := s.seedAndLoad(); err != nil {
		return nil, fmt.Errorf("settings init: %w", err)
	}
	return s, nil
}

func (s *Service) seedAndLoad() error {
	// Move untouched old defaults first (before seeding, so a fresh
	// install's rows are never mistaken for an old install's).
	if err := s.moveOldDefaults(); err != nil {
		return fmt.Errorf("move old defaults: %w", err)
	}
	// Ruling 5: "Animations" was a bool; keep the saved choice (true → on,
	// false → off). Idempotent, so it runs on every start.
	for from, to := range map[string]string{"true": AnimationsOn, "false": AnimationsOff} {
		if _, err := s.db.Exec(
			`UPDATE app_settings SET value = ?, updated_at = datetime('now') WHERE key = ? AND value = ?`,
			to, KeyDisplayAnimations, from,
		); err != nil {
			return fmt.Errorf("migrate %q: %w", KeyDisplayAnimations, err)
		}
	}
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
		s.cache[k] = s.clampOnLoad(k, v)
	}
	return rows.Err()
}

// moveOldDefaults runs the one-time Ruling 21 move: each setting in
// previousDefaults whose stored value is exactly its previous default goes to
// the current default. The changed values and the record of what moved (for
// the notice) are written in one transaction, so a move is never made
// without its notice, nor recorded without being made. Later starts only
// read the record back.
func (s *Service) moveOldDefaults() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS settings_once (
		id         TEXT PRIMARY KEY,
		detail     TEXT NOT NULL DEFAULT '[]',
		applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		return err
	}
	var detail string
	err = tx.QueryRow(`SELECT detail FROM settings_once WHERE id = ?`, defaultMoveID).Scan(&detail)
	switch {
	case err == nil:
		if err := json.Unmarshal([]byte(detail), &s.moves); err != nil {
			return fmt.Errorf("read the record of moved defaults: %w", err)
		}
		return tx.Commit()
	case err != sql.ErrNoRows:
		return err
	}
	moves := []DefaultMove{}
	for _, p := range previousDefaults {
		to, err := strconv.Atoi(defByKey[p.Key].Default)
		if err != nil {
			return fmt.Errorf("default of %q: %w", p.Key, err)
		}
		res, err := tx.Exec(
			`UPDATE app_settings SET value = ?, updated_at = datetime('now') WHERE key = ? AND value = ?`,
			strconv.Itoa(to), p.Key, strconv.Itoa(p.From))
		if err != nil {
			return fmt.Errorf("move %q: %w", p.Key, err)
		}
		if n, err := res.RowsAffected(); err != nil {
			return err
		} else if n > 0 {
			moves = append(moves, DefaultMove{Key: p.Key, From: p.From, To: to})
		}
	}
	b, err := json.Marshal(moves)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO settings_once (id, detail) VALUES (?, ?)`, defaultMoveID, string(b)); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	for _, m := range moves {
		slog.Info("setting was at its previous default; moved to the new default",
			"component", "settings", "key", m.Key, "from", m.From, "to", m.To)
	}
	s.moves = moves
	return nil
}

// DefaultMoves returns the settings the one-time default move changed on this
// database (empty when nothing was at an old default).
func (s *Service) DefaultMoves() []DefaultMove {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]DefaultMove(nil), s.moves...)
}

// clampOnLoad brings a stored byte-size setting that is outside its bounds
// (e.g. a limit saved under an older, higher ceiling) back inside them, and
// records the stored value so the admin UI can say what was lowered or raised.
func (s *Service) clampOnLoad(key, value string) string {
	def, ok := defByKey[key]
	if !ok || def.Type != "bytes" {
		return value
	}
	v, err := strconv.Atoi(value)
	if err != nil {
		return value
	}
	clamped := v
	if def.Max != 0 && v > def.Max {
		clamped = def.Max
	} else if def.Min != 0 && v < def.Min {
		clamped = def.Min
	}
	if clamped == v {
		return value
	}
	s.adjusted[key] = value
	slog.Warn("stored setting outside its bounds; using the nearest allowed value until it is saved",
		"component", "settings", "key", key, "stored", v, "using", clamped)
	return strconv.Itoa(clamped)
}

// Adjustments returns, for each setting clamped on load, the out-of-range
// value that was stored. A key leaves the map when the setting is saved.
func (s *Service) Adjustments() map[string]string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]string, len(s.adjusted))
	for k, v := range s.adjusted {
		out[k] = v
	}
	return out
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
	if err := s.crossCheck(key, value); err != nil {
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
	delete(s.adjusted, key)
	listeners := append([]func(string){}, s.listeners[key]...)
	s.mu.Unlock()

	for _, fn := range listeners {
		fn(value)
	}
	return nil
}

// Validate checks value against the definition for key without persisting it.
// Returns an error for an unknown key or an invalid value.
func (s *Service) Validate(key, value string) error {
	def, ok := defByKey[key]
	if !ok {
		return fmt.Errorf("unknown setting key %q", key)
	}
	if err := validate(def, value); err != nil {
		return err
	}
	return s.crossCheck(key, value)
}

// crossCheck enforces rules between settings: the backup ceiling
// (backup.max_count) is never below backup.keep_count.
func (s *Service) crossCheck(key, value string) error {
	v, _ := strconv.Atoi(value) // validate already checked it is an integer
	switch key {
	case KeyBackupMaxCount:
		if keep := s.GetInt(KeyBackupKeepCount); v < keep {
			return fmt.Errorf("%s: %d is below the number of newest backups always kept (%d)", key, v, keep)
		}
	case KeyBackupKeepCount:
		if ceiling := s.GetInt(KeyBackupMaxCount); v > ceiling {
			return fmt.Errorf("%s: %d is above the backup ceiling (%d); raise that first", key, v, ceiling)
		}
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

// GetBool parses a bool setting ("true"/"false"). Returns the Definition
// default on parse failure (shouldn't happen — Set validates).
func (s *Service) GetBool(key string) bool {
	if v, err := strconv.ParseBool(s.Get(key)); err == nil {
		return v
	}
	if d, ok := defByKey[key]; ok {
		v, _ := strconv.ParseBool(d.Default)
		return v
	}
	return false
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
	case "bool":
		if value != "true" && value != "false" {
			return fmt.Errorf("%s: %q must be \"true\" or \"false\"", def.Key, value)
		}
	case "log_level":
		if !containsString(def.Enum, strings.ToLower(value)) {
			return fmt.Errorf("%s: %q is not one of %v", def.Key, value, def.Enum)
		}
	case "enum":
		// Exact match: no trimming or case folding, so "grid " and "Grid" fail.
		if !containsString(def.Enum, value) {
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
