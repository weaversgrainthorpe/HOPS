package config

// Config holds the application configuration
type Config struct {
	Port                 string
	DataDir              string
	FrontendDir          string
	AllowedOrigins       []string // CORS allowed origins
	LoginRateLimitPerMin int      // Rate limit login attempts per minute
}
