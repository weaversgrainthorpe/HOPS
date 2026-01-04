package config

import (
	"os"
	"strings"
)

// Config holds the application configuration
type Config struct {
	Port               string
	DataDir            string
	FrontendDir        string
	AllowedOrigins     []string // CORS allowed origins
	LoginRateLimitPerMin int    // Rate limit login attempts per minute
}

// NewConfig creates a new configuration with defaults
func NewConfig() *Config {
	cfg := &Config{
		Port:                 "8080",
		DataDir:              "./data",
		FrontendDir:          "./frontend/build",
		LoginRateLimitPerMin: 20, // 20 login attempts per minute by default
	}

	// Load allowed origins from environment (comma-separated)
	// If not set, only same-origin requests are allowed
	if origins := os.Getenv("HOPS_ALLOWED_ORIGINS"); origins != "" {
		cfg.AllowedOrigins = strings.Split(origins, ",")
		for i, origin := range cfg.AllowedOrigins {
			cfg.AllowedOrigins[i] = strings.TrimSpace(origin)
		}
	}

	return cfg
}
