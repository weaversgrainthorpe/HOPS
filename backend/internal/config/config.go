// Package config holds the small set of values HOPS reads from the command
// line at bootstrap. Everything else — port, log level, trusted proxies, rate
// limits, upload caps, status check intervals, HTTP timeouts, session
// lifetime — is admin-configurable at runtime via the settings package and
// the /api/settings endpoints.
//
// Only paths needed *before* the database is open survive here:
//   - DataDir:     where the SQLite DB and uploads live
//   - FrontendDir: where the SPA static files live
package config

import (
	"errors"
	"fmt"
)

// Config holds the bootstrap-time CLI configuration.
type Config struct {
	BindHost    string // --host flag (optional; empty = bind all interfaces)
	DataDir     string // --data flag
	FrontendDir string // --frontend flag
}

// ErrInvalidConfig is returned when the configuration fails validation.
var ErrInvalidConfig = errors.New("invalid configuration")

// Validate checks that required fields are set.
func (c *Config) Validate() error {
	if c.DataDir == "" {
		return fmt.Errorf("%w: data directory is required", ErrInvalidConfig)
	}
	if c.FrontendDir == "" {
		return fmt.Errorf("%w: frontend directory is required", ErrInvalidConfig)
	}
	return nil
}
