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
	"github.com/weaversgrainthorpe/HOPS/internal/discovery"
	"github.com/weaversgrainthorpe/HOPS/internal/settings"
	"github.com/weaversgrainthorpe/HOPS/internal/status"
	"github.com/weaversgrainthorpe/HOPS/internal/version"
)

// setLogLevel (re)installs the global slog logger at the given level.
// Accepts: debug, info, warn, error (default on unknown: info).
//
// HOPS calls this twice: once at startup with "info" before the DB is open,
// then again after the settings service loads with the persisted value from
// `log.level`. It's also wired as a subscriber so admin changes take effect
// immediately.
func setLogLevel(name string) {
	level := slog.LevelInfo
	switch strings.ToLower(name) {
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

func main() {
	// Start with INFO; the level is reset to the persisted value once the
	// settings service has loaded (a few lines below).
	setLogLevel("info")

	// Command line flags — only bootstrap-level options are CLI flags.
	// Everything user-configurable (port, log level, rate limit, trusted
	// proxies, timeouts, upload caps, etc.) is set in the admin GUI under
	// /api/settings. --host is a flag because restricting the bind
	// interface is an operator security decision, not a user preference,
	// and it must be settable without first being able to reach the GUI.
	dataDir := flag.String("data", "../data", "Data directory for SQLite database")
	frontendDir := flag.String("frontend", "../frontend/build", "Frontend build directory")
	host := flag.String("host", "", "Interface to bind to (e.g. 127.0.0.1 for loopback-only). Empty (default) binds all interfaces.")
	flag.Parse()

	// Initialize configuration
	cfg := &config.Config{
		BindHost:    *host,
		DataDir:     *dataDir,
		FrontendDir: *frontendDir,
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

	// Create automatic backup on startup. Run async so a large DB or
	// slow filesystem doesn't block server boot — the backup is a
	// safety net, not a prerequisite. Failures stay best-effort with
	// a slog warning; success is logged at INFO so admins can confirm
	// the rotation worked.
	backupManager := database.NewBackupManager(dbPath)
	go func() {
		path, err := backupManager.CreateBackupWithDB(db, "startup")
		if err != nil {
			slog.Warn("failed to create startup backup", "component", "backup", "error", err)
			return
		}
		slog.Info("startup backup created", "component", "backup", "path", path)
	}()

	// Initialize the settings service (seeds defaults, loads into cache).
	settingsSvc, err := settings.New(db)
	if err != nil {
		slog.Error("failed to initialize settings", "error", err)
		os.Exit(1)
	}

	// Apply the persisted log level and subscribe to live changes.
	setLogLevel(settingsSvc.Get(settings.KeyLogLevel))
	settingsSvc.Subscribe(settings.KeyLogLevel, func(value string) {
		setLogLevel(value)
		slog.Info("log level updated", "component", "settings", "level", value)
	})

	// Initialize auth service
	authService := auth.NewService(db)

	// Start session cleanup routine (every hour). The returned `wait`
	// blocks until the goroutine actually exits — defer it AFTER the
	// stop-channel close so an in-flight cleanup tick can finish
	// before the deferred db.Close() above runs.
	sessionCleanupStop := make(chan struct{})
	waitSessionCleanup := authService.StartCleanupRoutine(1*time.Hour, sessionCleanupStop)
	defer waitSessionCleanup()
	defer close(sessionCleanupStop)

	// Initialize status checker — interval/timeout come from settings, with
	// live updates wired so changes apply without a restart.
	statusChecker := status.NewChecker(db, settingsSvc)
	statusChecker.Start()
	defer statusChecker.Stop()

	// Initialize the discovery orchestrator. Start() runs the one-time
	// startup recovery pass (orphaned "running" scans → "failed"); Stop()
	// signals every in-flight scan to abort and waits for clean exit.
	discoveryStore := discovery.NewStore(db)
	discoveryOrch := discovery.NewOrchestrator(discoveryStore, settingsSvc)
	discoveryOrch.Start()
	defer discoveryOrch.Stop()

	// Validate frontend directory
	indexPath := filepath.Join(cfg.FrontendDir, "index.html")
	if _, err := os.Stat(indexPath); os.IsNotExist(err) {
		slog.Warn("frontend not found, UI will not be served", "path", cfg.FrontendDir)
	}

	// Initialize API router
	startTime := time.Now()
	apiRouter, router := api.NewRouter(db, authService, cfg, settingsSvc, startTime, discoveryStore, discoveryOrch)
	defer apiRouter.Stop()

	// Configure HTTP server. Port + timeouts come from settings — changing
	// them in the GUI requires a server restart (the server has already
	// bound by the time a setting change would arrive). The bind host comes
	// from the --host flag; empty means "all interfaces".
	addr := fmt.Sprintf("%s:%d", cfg.BindHost, settingsSvc.GetInt(settings.KeyServerPort))
	srv := &http.Server{
		Addr:              addr,
		Handler:           router,
		ReadHeaderTimeout: time.Duration(settingsSvc.GetInt(settings.KeyHTTPReadHeaderTimeoutSeconds)) * time.Second,
		ReadTimeout:       time.Duration(settingsSvc.GetInt(settings.KeyHTTPReadTimeoutSeconds)) * time.Second,
		WriteTimeout:      time.Duration(settingsSvc.GetInt(settings.KeyHTTPWriteTimeoutSeconds)) * time.Second,
		IdleTimeout:       time.Duration(settingsSvc.GetInt(settings.KeyHTTPIdleTimeoutSeconds)) * time.Second,
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

	// Wait for interrupt signal, server error, or API-initiated
	// shutdown request (issued by handlers like backup-restore that
	// need the process to recycle so the new on-disk DB takes effect).
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	restartRequested := false
	select {
	case err := <-serverErr:
		slog.Error("server failed to start", "error", err)
		os.Exit(1)
	case sig := <-stop:
		slog.Info("received shutdown signal", "signal", sig.String())
	case <-apiRouter.ShutdownRequested():
		restartRequested = true
		slog.Info("API requested shutdown — exiting so the service manager can restart us")
	}

	// Graceful shutdown: stop accepting new requests, wait up to 30s for in-flight requests
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("graceful shutdown failed", "error", err)
	} else {
		slog.Info("server shut down cleanly")
	}

	// Exit with a non-zero code when the shutdown came from an API
	// restart request, so that systemd units with either Restart=always
	// or the more conservative Restart=on-failure both bring us back.
	// 75 = EX_TEMPFAIL — the Unix convention for "transient failure,
	// please retry".
	//
	// os.Exit skips the deferred statusChecker.Stop() / discoveryOrch.Stop()
	// calls. That's acceptable: the discovery orchestrator's Start()
	// runs MarkOrphanedRunning() on every boot, which transitions any
	// leftover "running" scans to "failed" with an explanatory message.
	// The status checker is stateless mid-cycle and resumes cleanly on
	// the next boot. SIGTERM still gets full graceful cleanup via the
	// normal main-return path.
	if restartRequested {
		os.Exit(75)
	}
}
