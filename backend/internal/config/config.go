// Package config holds the small set of values HOPS reads from the command
// line at bootstrap. Everything else — port, log level, trusted proxies, rate
// limits, upload caps, status check intervals, HTTP timeouts, session
// lifetime — is admin-configurable at runtime via the settings package and
// the /api/settings endpoints.
//
// Only paths needed *before* the database is open survive here:
//   - DataDir:     where the SQLite DB and uploads live
//   - FrontendDir: optional dev override for the SPA location on disk; empty
//     (the default) serves the UI embedded into the binary
package config

import (
	"errors"
	"fmt"
)

// Config holds the bootstrap-time CLI configuration.
type Config struct {
	BindHost    string // --host flag (optional; empty = bind all interfaces)
	DataDir     string // --data flag
	FrontendDir string // --frontend flag (optional; empty = use embedded UI)
}

// ErrInvalidConfig is returned when the configuration fails validation.
var ErrInvalidConfig = errors.New("invalid configuration")

// Validate checks that required fields are set.
func (c *Config) Validate() error {
	if c.DataDir == "" {
		return fmt.Errorf("%w: data directory is required", ErrInvalidConfig)
	}
	// FrontendDir is optional: empty means serve the UI embedded in the binary.
	// A non-empty value is a dev override pointing at a build dir on disk.
	return nil
}
