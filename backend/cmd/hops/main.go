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
	"syscall"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/api"
	"github.com/weaversgrainthorpe/HOPS/internal/auth"
	"github.com/weaversgrainthorpe/HOPS/internal/config"
	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/database"
	"github.com/weaversgrainthorpe/HOPS/internal/discovery"
	"github.com/weaversgrainthorpe/HOPS/internal/logbuf"
	"github.com/weaversgrainthorpe/HOPS/internal/safemode"
	"github.com/weaversgrainthorpe/HOPS/internal/settings"
	"github.com/weaversgrainthorpe/HOPS/internal/status"
	"github.com/weaversgrainthorpe/HOPS/internal/version"
)

// setLogLevel sets the log level, installing the logger on first use.
// Accepts: debug, info, warn, error (default on unknown: info).
//
// Records go to stderr as text (journald gets everything) and are also kept
// in a small in-memory buffer for Settings › Logs; both are redacted
// (internal/logbuf). HOPS calls this once at startup with "info" before the
// DB is open, then again after the settings service loads with the persisted
// value from `log.level`. It's also wired as a subscriber so admin changes
// take effect immediately.
func setLogLevel(name string) {
	level, ok := logbuf.ParseLevel(name)
	if !ok {
		level = slog.LevelInfo
	}
	logbuf.Install(os.Stderr, level)
}

func main() {
	if !run() {
		return
	}
	// A backup restore asked for a restart: HOPS starts itself again once everything above has
	// closed (database, listeners, background work), so it never depends on a service manager.
	exitAfter, err := restartSelf()
	if err == nil && exitAfter {
		os.Exit(0)
	}
	// Exit non-zero so a service manager (systemd Restart=on-failure, Docker, NSSM) restarts us.
	// 75 = EX_TEMPFAIL, "transient failure, please retry".
	slog.Warn("could not restart HOPS in place; exiting for the service manager to restart it", "error", err)
	os.Exit(75)
}

// run is HOPS from start to a clean shutdown; true means a restart was requested.
func run() bool {
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
	// Dev-only flags (--frontend) exist only in `-tags dev` builds.
	applyDevFlags := registerDevFlags()
	host := flag.String("host", "", "Interface to bind to (e.g. 127.0.0.1 for loopback-only). Empty (default) binds all interfaces.")
	flag.Parse()

	// Initialize configuration
	cfg := &config.Config{
		BindHost: *host,
		DataDir:  *dataDir,
	}

	applyDevFlags()

	// Validate config before doing any work
	if err := cfg.Validate(); err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	// Ensure data directory exists
	if err := os.MkdirAll(cfg.DataDir, 0755); err != nil { // #nosec G301 -- data dir for non-secret files (icons, backgrounds); HOPS is the only service user, accepted in triage
		slog.Error("failed to create data directory", "error", err)
		os.Exit(1)
	}

	// A restore staged by the Backups page is applied now, before the
	// database is opened (never under an open WAL connection). A failure
	// leaves the current data in place and is shown to the admin as a notice.
	dbPath := filepath.Join(cfg.DataDir, "hops.db")
	backupManager := database.SharedBackupManager(dbPath)
	if err := database.SweepStaleTempFiles(dbPath); err != nil {
		slog.Warn("startup sweep", "component", "backup", "error", err)
	}
	res, err := database.RecoverAndApplyRestore(dbPath)
	var unsafe *database.UnsafeStartError
	switch {
	case errors.As(err, &unsafe):
		// Never open the database here: that would create an empty one and
		// serve it as real data. Serve the help page instead (every route
		// 503), and stay up so the service manager doesn't restart-loop.
		slog.Error("refusing to start", "component", "backup", "error", err)
		fmt.Fprintln(os.Stderr, err.Error())
		runSafeMode(cfg, unsafe)
		return false
	case err != nil:
		slog.Error("the staged restore could not be applied; running on the current data", "component", "backup", "error", err)
		backupManager.RecordRestoreFailure(err)
	}
	if res.JournalLeft != "" {
		backupManager.RecordJournalLeft(res.JournalLeft)
	}
	switch res.Outcome {
	case database.OutcomeApplied:
		slog.Info("applied the staged restore", "component", "backup")
	case database.OutcomeRecoveredApplied:
		slog.Warn("a restore interrupted by a crash or stop was completed at this start", "component", "backup")
		backupManager.RecordRestoreRecovery(res.Outcome)
	case database.OutcomeUndone:
		slog.Warn("a restore interrupted by a crash or stop was undone; running on the data from before it", "component", "backup")
		backupManager.RecordRestoreRecovery(res.Outcome, res.Detail)
	}

	// After a restore: install the uploaded backup's own images and bring
	// back from the attic what the restored data uses (M6 §12); anything
	// still missing is a visible notice. Without a restore this only clears
	// the restore's marker. Before the database is opened (read-only here).
	backupManager.AfterRestore(res.Outcome == database.OutcomeApplied || res.Outcome == database.OutcomeRecoveredApplied)

	// Initialize database
	db, err := database.Initialize(dbPath)
	if err != nil {
		slog.Error("failed to initialize database", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	backupManager.SetLiveDB(db)

	// Create automatic backup on startup. Run async (once the router is up,
	// so rotation uses the configured retention) so a large DB or slow
	// filesystem doesn't block server boot. A failure is recorded by the
	// backup manager and shown to the admin as a notice until a backup
	// succeeds; success is logged at INFO.
	startupBackup := func() error {
		path, err := backupManager.CreateBackupWithDB(db, "startup")
		if err != nil {
			return err
		}
		slog.Info("startup backup created", "component", "backup", "path", path)
		return nil
	}

	// Migrate a stored v2 config to v3 (archived + verified, all-or-nothing).
	// If the config is still v2 a "pre-v3-migration" backup is taken
	// synchronously first, so it holds the pre-migration data; rotation never
	// deletes it (it is the rollback path to v2.2.1, see DEPLOY.md). If that
	// backup fails the migration is not attempted. A bad document is NOT
	// fatal: the failure is logged at ERROR and handed to the router so the UI
	// can say so.
	preMigrationBackup := func() error {
		path, err := backupManager.CreateBackupWithDB(db, database.PreV3MigrationReason)
		if err != nil {
			return err
		}
		slog.Info("pre-v3-migration backup created (kept by rotation)", "component", "backup", "path", path)
		return nil
	}
	migration, backedUp, err := configdoc.MigrateWithBackup(db, preMigrationBackup)
	if err != nil {
		slog.Error("config migration could not run", "error", err)
		os.Exit(1)
	}

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

	// Initialize API router
	startTime := time.Now()
	apiRouter, router := api.NewRouter(db, authService, cfg, settingsSvc, startTime, discoveryStore, discoveryOrch, migration)
	defer apiRouter.Stop()

	if !backedUp {
		go func() {
			if err := startupBackup(); err != nil {
				slog.Warn("failed to create startup backup", "component", "backup", "error", err)
			}
		}()
	}

	// Configure HTTP server. Port + timeouts come from settings — changing
	// them in the GUI requires a server restart (the server has already
	// bound by the time a setting change would arrive). The bind host comes
	// from the --host flag; empty means "all interfaces".
	addr := fmt.Sprintf("%s:%d", cfg.BindHost, settingsSvc.GetInt(settings.KeyServerPort))
	// Safe mode can't read the port from the database, so remember it.
	if err := safemode.RememberPort(cfg.DataDir, settingsSvc.GetInt(settings.KeyServerPort)); err != nil {
		slog.Warn("could not remember the port for the recovery page (it would use 8080)", "error", err)
	}
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
		slog.Info("API requested a restart — shutting down, then starting again")
	}

	// Graceful shutdown: stop accepting new requests, wait up to 30s for in-flight requests
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("graceful shutdown failed", "error", err)
	} else {
		slog.Info("server shut down cleanly")
	}

	return restartRequested
}

// runSafeMode serves the "HOPS can't start safely" page on the last port
// HOPS used until SIGINT/SIGTERM. The database is never opened. If the port
// can't be bound, it logs that and still waits (no restart loop).
func runSafeMode(cfg *config.Config, unsafe *database.UnsafeStartError) {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	addr := fmt.Sprintf("%s:%d", cfg.BindHost, safemode.Port(cfg.DataDir))
	if err := safemode.Serve(ctx, addr, unsafe); err != nil {
		slog.Error("could not serve the recovery page; HOPS stays stopped until you fix the files (see the error above)", "addr", addr, "error", err)
		<-ctx.Done()
	}
	slog.Info("stopped (recovery page)")
}
