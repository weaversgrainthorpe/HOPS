package config

import (
	"errors"
	"strings"
	"testing"
)

// validConfig returns a Config that passes validation. Tests can mutate it
// to verify each individual validation rule in isolation.
func validConfig() *Config {
	return &Config{
		Port:                 "8080",
		DataDir:              "/tmp/hops",
		FrontendDir:          "/tmp/hops/frontend",
		LoginRateLimitPerMin: 20,
	}
}

func TestValidateValidConfig(t *testing.T) {
	cfg := validConfig()
	if err := cfg.Validate(); err != nil {
		t.Errorf("expected valid config to pass, got: %v", err)
	}
}

func TestValidateRequiresPort(t *testing.T) {
	cfg := validConfig()
	cfg.Port = ""
	err := cfg.Validate()
	if err == nil {
		t.Fatal("expected error for empty port")
	}
	if !errors.Is(err, ErrInvalidConfig) {
		t.Errorf("expected ErrInvalidConfig, got %v", err)
	}
	if !strings.Contains(err.Error(), "port") {
		t.Errorf("error should mention port, got: %v", err)
	}
}

func TestValidatePortMustBeNumeric(t *testing.T) {
	cfg := validConfig()
	cfg.Port = "abc"
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for non-numeric port")
	}
}

func TestValidatePortRange(t *testing.T) {
	tests := []struct {
		port    string
		wantErr bool
	}{
		{"0", true},
		{"-1", true},
		{"65536", true},
		{"99999", true},
		{"1", false},
		{"80", false},
		{"8080", false},
		{"65535", false},
	}

	for _, tt := range tests {
		cfg := validConfig()
		cfg.Port = tt.port
		err := cfg.Validate()
		if (err != nil) != tt.wantErr {
			t.Errorf("port %q: wantErr=%v, got %v", tt.port, tt.wantErr, err)
		}
	}
}

func TestValidateRequiresDataDir(t *testing.T) {
	cfg := validConfig()
	cfg.DataDir = ""
	err := cfg.Validate()
	if err == nil {
		t.Fatal("expected error for empty data dir")
	}
	if !errors.Is(err, ErrInvalidConfig) {
		t.Errorf("expected ErrInvalidConfig, got %v", err)
	}
	if !strings.Contains(err.Error(), "data directory") {
		t.Errorf("error should mention data directory, got: %v", err)
	}
}

func TestValidateRequiresFrontendDir(t *testing.T) {
	cfg := validConfig()
	cfg.FrontendDir = ""
	err := cfg.Validate()
	if err == nil {
		t.Fatal("expected error for empty frontend dir")
	}
	if !strings.Contains(err.Error(), "frontend directory") {
		t.Errorf("error should mention frontend directory, got: %v", err)
	}
}

func TestValidateRejectsNegativeRateLimit(t *testing.T) {
	cfg := validConfig()
	cfg.LoginRateLimitPerMin = -1
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for negative rate limit")
	}
}

func TestValidateAcceptsZeroRateLimit(t *testing.T) {
	// Zero means "use default"; the router applies its own fallback.
	cfg := validConfig()
	cfg.LoginRateLimitPerMin = 0
	if err := cfg.Validate(); err != nil {
		t.Errorf("zero rate limit should be allowed, got: %v", err)
	}
}

func TestValidateAllowedOrigins(t *testing.T) {
	tests := []struct {
		name    string
		origins []string
		wantErr bool
	}{
		{"empty list is fine", []string{}, false},
		{"single valid origin", []string{"https://example.com"}, false},
		{"multiple valid origins", []string{"https://a.com", "http://b.com:8080"}, false},
		{"empty string in list", []string{""}, true},
		{"empty string among valid", []string{"https://a.com", ""}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := validConfig()
			cfg.AllowedOrigins = tt.origins
			err := cfg.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("wantErr=%v, got %v", tt.wantErr, err)
			}
		})
	}
}

func TestValidateErrorsWrapErrInvalidConfig(t *testing.T) {
	// All validation errors must wrap ErrInvalidConfig so callers can use errors.Is
	tests := []struct {
		name string
		mut  func(*Config)
	}{
		{"empty port", func(c *Config) { c.Port = "" }},
		{"non-numeric port", func(c *Config) { c.Port = "abc" }},
		{"out-of-range port", func(c *Config) { c.Port = "99999" }},
		{"empty data dir", func(c *Config) { c.DataDir = "" }},
		{"empty frontend dir", func(c *Config) { c.FrontendDir = "" }},
		{"negative rate limit", func(c *Config) { c.LoginRateLimitPerMin = -1 }},
		{"empty origin", func(c *Config) { c.AllowedOrigins = []string{""} }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := validConfig()
			tt.mut(cfg)
			err := cfg.Validate()
			if err == nil {
				t.Fatal("expected error")
			}
			if !errors.Is(err, ErrInvalidConfig) {
				t.Errorf("error does not wrap ErrInvalidConfig: %v", err)
			}
		})
	}
}
