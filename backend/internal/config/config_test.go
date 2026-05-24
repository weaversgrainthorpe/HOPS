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
		DataDir:     "/tmp/hops",
		FrontendDir: "/tmp/hops/frontend",
	}
}

func TestValidateValidConfig(t *testing.T) {
	cfg := validConfig()
	if err := cfg.Validate(); err != nil {
		t.Errorf("expected valid config to pass, got: %v", err)
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
	if !errors.Is(err, ErrInvalidConfig) {
		t.Errorf("expected ErrInvalidConfig, got %v", err)
	}
	if !strings.Contains(err.Error(), "frontend directory") {
		t.Errorf("error should mention frontend directory, got: %v", err)
	}
}
