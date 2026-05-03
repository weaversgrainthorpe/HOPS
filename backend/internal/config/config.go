package config

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
)

// Config holds the application configuration
type Config struct {
	Port                 string
	DataDir              string
	FrontendDir          string
	AllowedOrigins       []string // CORS allowed origins
	LoginRateLimitPerMin int      // Rate limit login attempts per minute
}

// ErrInvalidConfig is returned when the configuration fails validation.
var ErrInvalidConfig = errors.New("invalid configuration")

// Validate checks that required fields are set and have sensible values.
// It returns a wrapped ErrInvalidConfig on failure so callers can use errors.Is.
func (c *Config) Validate() error {
	if c.Port == "" {
		return fmt.Errorf("%w: port is required", ErrInvalidConfig)
	}
	port, err := strconv.Atoi(c.Port)
	if err != nil {
		return fmt.Errorf("%w: port %q is not a number", ErrInvalidConfig, c.Port)
	}
	if port < 1 || port > 65535 {
		return fmt.Errorf("%w: port %d out of range (1-65535)", ErrInvalidConfig, port)
	}

	if c.DataDir == "" {
		return fmt.Errorf("%w: data directory is required", ErrInvalidConfig)
	}

	if c.FrontendDir == "" {
		return fmt.Errorf("%w: frontend directory is required", ErrInvalidConfig)
	}

	if c.LoginRateLimitPerMin < 0 {
		return fmt.Errorf("%w: login rate limit cannot be negative", ErrInvalidConfig)
	}

	for _, origin := range c.AllowedOrigins {
		if origin == "" {
			return fmt.Errorf("%w: allowed origin cannot be empty", ErrInvalidConfig)
		}
		if _, err := url.Parse(origin); err != nil {
			return fmt.Errorf("%w: allowed origin %q is not a valid URL: %v", ErrInvalidConfig, origin, err)
		}
	}

	return nil
}
