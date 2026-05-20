package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/api"
	"github.com/weaversgrainthorpe/HOPS/internal/auth"
	"github.com/weaversgrainthorpe/HOPS/internal/config"
	"github.com/weaversgrainthorpe/HOPS/internal/database"
	"github.com/weaversgrainthorpe/HOPS/internal/status"
	"github.com/weaversgrainthorpe/HOPS/internal/version"
)

// configureLogger sets up the global slog logger with text output and configurable level.
// LOG_LEVEL env var accepts: debug, info, warn, error (default: info).
func configureLogger() {
	level := slog.LevelInfo
	switch strings.ToLower(os.Getenv("LOG_LEVEL")) {
	case "debug":
		level = slog.LevelDebug
	case "warn", "warning":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}
	handler := slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level})
	slog.SetDefault(slog.New(handler))
}

// parseTrustedProxies splits a comma-separated list of CIDR ranges from the
// HOPS_TRUSTED_PROXIES env var. Set this to your reverse proxy's address
// (e.g. "10.0.0.0/8" or "192.168.1.5/32") when running HOPS behind one, so
// that X-Forwarded-For is honoured only from that proxy. Empty by default.
func parseTrustedProxies(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var out []string
	for _, part := range strings.Split(raw, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func main() {
	configureLogger()

	// Command line flags
	port := flag.String("port", "8080", "Port to run the server on")
	dataDir := flag.String("data", "../data", "Data directory for SQLite database")
	frontendDir := flag.String("frontend", "../frontend/build", "Frontend build directory")
	flag.Parse()

	// Initialize configuration
	cfg := &config.Config{
		Port:                 *port,
		DataDir:              *dataDir,
		FrontendDir:          *frontendDir,
		LoginRateLimitPerMin: 20, // 20 login attempts per minute
		TrustedProxies:       parseTrustedProxies(os.Getenv("HOPS_TRUSTED_PROXIES")),
	}

	// Validate config before doing any work
	if err := cfg.Validate(); err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	// Ensure data directory exists
	if err := os.MkdirAll(cfg.DataDir, 0755); err != nil {
		slog.Error("failed to create data directory", "error", err)
		os.Exit(1)
	}

	// Initialize database
	dbPath := filepath.Join(cfg.DataDir, "hops.db")
	db, err := database.Initialize(dbPath)
	if err != nil {
		slog.Error("failed to initialize database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	// Create automatic backup on startup
	backupManager := database.NewBackupManager(dbPath)
	if _, err := backupManager.CreateBackupWithDB(db, "startup"); err != nil {
		slog.Warn("failed to create startup backup", "component", "backup", "error", err)
	}

	// Initialize auth service
	authService := auth.NewService(db)

	// Start session cleanup routine (every hour)
	sessionCleanupStop := make(chan struct{})
	authService.StartCleanupRoutine(1*time.Hour, sessionCleanupStop)
	defer close(sessionCleanupStop)

	// Initialize status checker (checks every 5 minutes)
	statusChecker := status.NewChecker(db, 5*time.Minute)
	statusChecker.Start()
	defer statusChecker.Stop()

	// Validate frontend directory
	indexPath := filepath.Join(cfg.FrontendDir, "index.html")
	if _, err := os.Stat(indexPath); os.IsNotExist(err) {
		slog.Warn("frontend not found, UI will not be served", "path", cfg.FrontendDir)
	}

	// Initialize API router
	startTime := time.Now()
	router := api.NewRouter(db, authService, cfg, startTime)

	// Configure HTTP server with timeouts to prevent slow-loris attacks and hung connections
	addr := fmt.Sprintf(":%s", cfg.Port)
	srv := &http.Server{
		Addr:              addr,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	slog.Info("server starting",
		"version", version.Full(),
		"addr", addr,
		"data_dir", cfg.DataDir,
		"frontend_dir", cfg.FrontendDir,
	)

	// Start server in a goroutine so we can listen for shutdown signals
	serverErr := make(chan error, 1)
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	// Wait for interrupt signal or server error
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serverErr:
		slog.Error("server failed to start", "error", err)
		os.Exit(1)
	case sig := <-stop:
		slog.Info("received shutdown signal", "signal", sig.String())
	}

	// Graceful shutdown: stop accepting new requests, wait up to 30s for in-flight requests
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("graceful shutdown failed", "error", err)
	} else {
		slog.Info("server shut down cleanly")
	}
}
