package config

// Config holds the application configuration
type Config struct {
	Port        string
	DataDir     string
	FrontendDir string
	JWTSecret   string
}

// NewConfig creates a new configuration with defaults
func NewConfig() *Config {
	return &Config{
		Port:        "8080",
		DataDir:     "./data",
		FrontendDir: "./frontend/build",
		JWTSecret:   "change-me-in-production", // TODO: Load from environment
	}
}
