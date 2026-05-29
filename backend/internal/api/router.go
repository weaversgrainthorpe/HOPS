package api

import (
	"database/sql"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/assets"
	"github.com/weaversgrainthorpe/HOPS/internal/auth"
	"github.com/weaversgrainthorpe/HOPS/internal/config"
	"github.com/weaversgrainthorpe/HOPS/internal/database"
	"github.com/weaversgrainthorpe/HOPS/internal/discovery"
	"github.com/weaversgrainthorpe/HOPS/internal/settings"
)

// Router holds all dependencies for the API
type Router struct {
	db             *sql.DB
	authService    *auth.Service
	config         *config.Config
	settings       *settings.Service
	mux            *http.ServeMux
	rateLimiter    *RateLimiter
	backupManager  *database.BackupManager
	startTime      time.Time
	discoveryStore *discovery.Store
	discoveryOrch  *discovery.Orchestrator
	// shutdownReq is closed by handlers that want to trigger a graceful
	// server restart (most notably backup-restore — restoring a SQLite
	// file under an open connection leaves the running process with a
	// stale view). main.go selects on it alongside SIGTERM.
	shutdownReq    chan struct{}
	mu             sync.RWMutex // guards trustedProxies (rebuilt on settings change requires restart, but the slice itself is accessed concurrently)
	trustedProxies []*net.IPNet // parsed at construction from settings.proxy.trusted_cidrs
}

// RequestShutdown is the API-side handle for the shutdown channel.
// Idempotent — calling it twice is harmless. Used after operations
// that leave the running process with a stale DB connection.
func (r *Router) RequestShutdown() {
	r.mu.Lock()
	defer r.mu.Unlock()
	select {
	case <-r.shutdownReq:
		// already closed
	default:
		close(r.shutdownReq)
	}
}

// ShutdownRequested returns the channel main.go selects on.
func (r *Router) ShutdownRequested() <-chan struct{} { return r.shutdownReq }

// Stop tears down router-owned background goroutines. Currently just
// the rate-limiter's cleanup loop; future singletons live here too.
// Defer-friendly: callers wire `defer router.Stop()` in main alongside
// the other component teardowns.
func (r *Router) Stop() {
	if r.rateLimiter != nil {
		r.rateLimiter.Stop()
	}
}

// RateLimiter provides simple rate limiting for login attempts
type RateLimiter struct {
	mu       sync.Mutex
	attempts map[string][]time.Time
	limit    int
	window   time.Duration
	stopCh   chan struct{}
}

// NewRateLimiter creates a rate limiter with periodic cleanup of stale entries
func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{
		attempts: make(map[string][]time.Time),
		limit:    limit,
		window:   window,
		stopCh:   make(chan struct{}),
	}
	go rl.cleanupLoop()
	return rl
}

// cleanupLoop periodically removes stale IP entries to prevent unbounded memory growth
func (rl *RateLimiter) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			rl.cleanup()
		case <-rl.stopCh:
			return
		}
	}
}

// cleanup removes IPs with no recent attempts
func (rl *RateLimiter) cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	windowStart := now.Add(-rl.window)
	for ip, times := range rl.attempts {
		var recent []time.Time
		for _, t := range times {
			if t.After(windowStart) {
				recent = append(recent, t)
			}
		}
		if len(recent) == 0 {
			delete(rl.attempts, ip)
		} else {
			rl.attempts[ip] = recent
		}
	}
}

// Stop shuts down the cleanup goroutine
func (rl *RateLimiter) Stop() {
	close(rl.stopCh)
}

// SetLimit updates the per-IP attempt limit at runtime. Existing recorded
// attempts are unaffected; the new limit applies on the next Allow call.
func (rl *RateLimiter) SetLimit(limit int) {
	if limit <= 0 {
		return
	}
	rl.mu.Lock()
	defer rl.mu.Unlock()
	rl.limit = limit
}

// Allow checks if a request from the given IP should be allowed
func (rl *RateLimiter) Allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	windowStart := now.Add(-rl.window)

	// Filter out old attempts
	var recent []time.Time
	for _, t := range rl.attempts[ip] {
		if t.After(windowStart) {
			recent = append(recent, t)
		}
	}

	if len(recent) >= rl.limit {
		rl.attempts[ip] = recent
		return false
	}

	rl.attempts[ip] = append(recent, now)
	return true
}

// NewRouter creates a new API router with all routes configured. All
// admin-tunable knobs (login rate limit, trusted proxies, etc.) come from
// the settings service, not the static config — those are now configurable
// via the GUI in /api/settings.
func NewRouter(db *sql.DB, authService *auth.Service, cfg *config.Config, settingsSvc *settings.Service, startTime time.Time, discoveryStore *discovery.Store, discoveryOrch *discovery.Orchestrator) (*Router, http.Handler) {
	// Login rate limit comes from settings (default 20/min, validated by the
	// settings service so it's always sane here).
	rateLimit := settingsSvc.GetInt(settings.KeyAuthLoginRateLimitPerMin)
	if rateLimit <= 0 {
		rateLimit = 20
	}

	// Initialize backup manager
	dbPath := filepath.Join(cfg.DataDir, "hops.db")
	backupManager := database.NewBackupManager(dbPath)

	r := &Router{
		db:             db,
		authService:    authService,
		config:         cfg,
		settings:       settingsSvc,
		mux:            http.NewServeMux(),
		rateLimiter:    NewRateLimiter(rateLimit, time.Minute),
		backupManager:  backupManager,
		startTime:      startTime,
		discoveryStore: discoveryStore,
		discoveryOrch:  discoveryOrch,
		shutdownReq:    make(chan struct{}),
		trustedProxies: parseTrustedProxyCIDRs(settingsSvc.GetStringList(settings.KeyProxyTrustedCIDRs)),
	}

	// Live-update the rate limit when the admin changes it via Settings.
	settingsSvc.Subscribe(settings.KeyAuthLoginRateLimitPerMin, func(value string) {
		if n, err := strconv.Atoi(value); err == nil && n > 0 {
			r.rateLimiter.SetLimit(n)
		}
	})

	r.setupRoutes()
	return r, r.securityHeadersMiddleware(r.corsMiddleware(r.recoverMiddleware(r.loggingMiddleware(r.mux))))
}

// parseTrustedProxyCIDRs converts validated CIDR strings into IPNets. The
// settings service has already rejected malformed entries via its validator,
// so ParseCIDR is not expected to fail here.
func parseTrustedProxyCIDRs(cidrs []string) []*net.IPNet {
	var out []*net.IPNet
	for _, cidr := range cidrs {
		if _, network, err := net.ParseCIDR(cidr); err == nil {
			out = append(out, network)
		}
	}
	return out
}

// protected wraps a handler with auth + CSRF middleware. Use this for any
// route that requires an authenticated session and accepts state-changing
// HTTP methods. CSRF middleware safely skips GET/HEAD/OPTIONS so it's safe
// to use on read-only handlers too.
func (r *Router) protected(h http.HandlerFunc) http.HandlerFunc {
	return r.authMiddleware(r.csrfMiddleware(h))
}

// setupRoutes configures all API routes
func (r *Router) setupRoutes() {
	// Public API routes
	r.mux.HandleFunc("/api/health", r.handleGetHealth)
	r.mux.HandleFunc("/api/version", r.handleGetVersion)
	r.mux.HandleFunc("/api/config", r.handleConfig)
	// Intentionally public — the SPA polls this for tile colour indicators
	// before login so a viewer landing on a public dashboard sees status
	// dots immediately. Entry IDs are random UUIDs from the user's own
	// config, so this is not a data-leak surface. Don't "tighten" it
	// without re-reading the dashboard-render path.
	r.mux.HandleFunc("/api/status/", r.handleGetStatus)
	r.mux.HandleFunc("/api/auth/login", r.handleLogin)
	r.mux.HandleFunc("/api/auth/check", r.handleAuthCheck)

	// Protected API routes (require authentication + CSRF token for mutations)
	r.mux.HandleFunc("/api/auth/logout", r.protected(r.handleLogout))
	r.mux.HandleFunc("/api/auth/change-password", r.protected(r.handleChangePassword))
	r.mux.HandleFunc("/api/config/export", r.protected(r.handleExportConfig))
	r.mux.HandleFunc("/api/config/import", r.protected(r.handleImportConfig))
	r.mux.HandleFunc("/api/config/reset", r.protected(r.handleResetConfig))

	// Backup management routes. Note the asymmetry, kept deliberately:
	//   POST /api/backups            → create a new backup
	//   POST /api/backups/{name}     → RESTORE the named backup
	// Splitting the restore into /api/backups/{name}/restore is the kind
	// of "tidy" that breaks every client. Leave it alone.
	r.mux.HandleFunc("/api/backups", r.protected(r.handleBackups))
	r.mux.HandleFunc("/api/backups/", r.protected(r.handleBackupActions))

	// App settings routes (admin-only). GET lists every setting with its
	// definition + current value; PUT /api/settings/{key} updates one.
	r.mux.HandleFunc("/api/settings", r.protected(r.handleSettingsList))
	r.mux.HandleFunc("/api/settings/", r.protected(r.handleSettingUpdate))

	// Network discovery routes (admin-only). The collection handler
	// dispatches by method; the item handler parses /{id}/... .
	//
	// Two quirks worth flagging for anyone refactoring:
	//
	// 1. GET /api/discovery/scans/{id} accepts ?resultsSince=<rfc3339>
	//    as a polling cursor. The first call should pass nothing
	//    (returns the full result set); subsequent polls pass the
	//    max createdAt the client has seen, and the server returns
	//    only newer rows. Don't replace this with a bare GET — the
	//    frontend's delta polling depends on the cursor.
	//
	// 2. POST /api/discovery/detectors/reset-bundled looks like a
	//    detector ID but isn't — it's a sentinel that resets every
	//    override at once. handleDiscoveryDetectorsItem peels off
	//    that literal before treating the path segment as an ID.
	r.mux.HandleFunc("/api/discovery/scans", r.protected(r.handleDiscoveryScansCollection))
	r.mux.HandleFunc("/api/discovery/scans/", r.protected(r.handleDiscoveryScansItem))
	r.mux.HandleFunc("/api/discovery/detectors", r.protected(r.handleDiscoveryDetectorsCollection))
	r.mux.HandleFunc("/api/discovery/detectors/", r.protected(r.handleDiscoveryDetectorsItem))
	r.mux.HandleFunc("/api/discovery/diagnostics", r.protected(r.handleDiscoveryDiagnostics))
	r.mux.HandleFunc("/api/discovery/suggest-cidr", r.protected(r.handleSuggestCIDR))

	// Icon management routes
	r.mux.HandleFunc("/api/icon-categories", r.handleGetIconCategories)
	r.mux.HandleFunc("/api/icon-categories/", r.protected(r.handleIconCategoryActions))
	r.mux.HandleFunc("/api/icons", r.handleGetIcons)
	r.mux.HandleFunc("/api/icons/upload", r.protected(r.handleUploadIcon))
	r.mux.HandleFunc("/api/icons/", r.protected(r.handleIconActions))

	// Serve uploaded icons from data directory
	r.mux.HandleFunc("/icons/", r.serveIcons)

	// Serve dashboard icons (from homarr-labs/dashboard-icons)
	r.mux.HandleFunc("/api/icons/dashboard/", r.serveDashboardIcons)

	// Background image routes (GET is public, POST/PUT/DELETE require auth inline)
	r.mux.HandleFunc("/api/backgrounds", r.handleBackgrounds)
	r.mux.HandleFunc("/api/backgrounds/categories", r.protected(r.handleBackgroundCategories))
	r.mux.HandleFunc("/api/backgrounds/categories/", r.protected(r.handleBackgroundCategoryActions))
	r.mux.HandleFunc("/api/backgrounds/", r.protected(r.handleBackgroundActions))
	// Serve uploaded backgrounds from data directory
	r.mux.HandleFunc("/backgrounds/", r.serveBackgrounds)

	// Serve preset background images from data/presets directory
	r.mux.HandleFunc("/presets/", r.servePresets)

	// Static file serving (frontend) with SPA support
	r.mux.HandleFunc("/", r.serveSPA)
}

// handleBackgrounds routes GET and POST requests for backgrounds
func (r *Router) handleBackgrounds(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		r.handleListBackgrounds(w, req)
	case http.MethodPost:
		r.protected(r.handleUploadBackground)(w, req)
	default:
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleBackgroundActions routes PUT and DELETE for individual backgrounds
func (r *Router) handleBackgroundActions(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodPut:
		r.handleUpdateBackgroundImage(w, req)
	case http.MethodDelete:
		r.handleDeleteBackground(w, req)
	default:
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// setAssetCSP locks down an asset response so that an SVG (uploaded by a user
// or imported from a third-party icon set) cannot execute script even when
// navigated to directly. `<img>` embedding is unaffected — img never runs SVG
// script. `sandbox` and `default-src 'none'` together neutralize scripts and
// event handlers; inline styles are kept so icons still render correctly.
func setAssetCSP(w http.ResponseWriter) {
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
}

// serveBackgrounds serves uploaded background images from the data directory
func (r *Router) serveBackgrounds(w http.ResponseWriter, req *http.Request) {
	// Extract filename from path
	filename := filepath.Base(req.URL.Path)

	// Construct path to backgrounds directory
	backgroundsDir := filepath.Join(r.config.DataDir, "backgrounds")
	filePath := filepath.Join(backgroundsDir, filename)

	setAssetCSP(w)

	// Serve the file
	http.ServeFile(w, req, filePath)
}

// servePresets serves preset background images from the embedded filesystem
func (r *Router) servePresets(w http.ResponseWriter, req *http.Request) {
	filename := filepath.Base(req.URL.Path)

	// Set cache headers - presets are static
	w.Header().Set("Cache-Control", "public, max-age=31536000")
	setAssetCSP(w)

	http.ServeFileFS(w, req, assets.Presets, "presets/"+filename)
}

// serveIcons serves uploaded icon images from the data/icons directory
func (r *Router) serveIcons(w http.ResponseWriter, req *http.Request) {
	// Extract filename from path
	filename := filepath.Base(req.URL.Path)

	// Construct path to icons directory
	iconsDir := filepath.Join(r.config.DataDir, "icons")
	filePath := filepath.Join(iconsDir, filename)

	// Set cache headers for uploaded icons
	w.Header().Set("Cache-Control", "public, max-age=86400")
	setAssetCSP(w)

	// Serve the file
	http.ServeFile(w, req, filePath)
}

// serveDashboardIcons serves SVG icons from the embedded dashboard-icons collection
func (r *Router) serveDashboardIcons(w http.ResponseWriter, req *http.Request) {
	// Extract filename from path: /api/icons/dashboard/proxmox.svg -> proxmox.svg
	filename := filepath.Base(req.URL.Path)

	// Set appropriate content type for SVG
	if filepath.Ext(filename) == ".svg" {
		w.Header().Set("Content-Type", "image/svg+xml")
	}

	// Set long cache headers - these are static icons
	w.Header().Set("Cache-Control", "public, max-age=31536000")
	setAssetCSP(w)

	http.ServeFileFS(w, req, assets.DashboardIcons, "dashboard-icons/"+filename)
}

// serveSPA serves the Single Page Application with fallback to index.html
func (r *Router) serveSPA(w http.ResponseWriter, req *http.Request) {
	// Get the absolute path to prevent directory traversal
	path := filepath.Join(r.config.FrontendDir, req.URL.Path)

	// Check if path is a file
	fi, err := os.Stat(path)
	if err == nil && !fi.IsDir() {
		// File exists, serve it
		http.ServeFile(w, req, path)
		return
	}

	// Check if it's a directory and index.html exists
	if err == nil && fi.IsDir() {
		indexPath := filepath.Join(path, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			http.ServeFile(w, req, indexPath)
			return
		}
	}

	// File doesn't exist or it's a SPA route, serve index.html
	indexPath := filepath.Join(r.config.FrontendDir, "index.html")
	http.ServeFile(w, req, indexPath)
}

// statusWriter wraps http.ResponseWriter to capture the status code
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (sw *statusWriter) WriteHeader(code int) {
	sw.status = code
	sw.ResponseWriter.WriteHeader(code)
}

// recoverMiddleware catches panics that escape handlers and logs them
// with method + path + traceback before emitting a generic 500. Without
// this, a panic in any handler kills the goroutine, leaves the client
// hanging, and produces zero log output — the worst kind of "what
// happened?" production bug. The traceback is captured via
// runtime/debug.Stack() and logged at ERROR; the client never sees it.
//
// Ordering matters: this runs BEFORE the logging middleware so the
// 500 response still gets logged with its proper status code by the
// outer logger.
func (r *Router) recoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic in handler",
					"component", "http",
					"method", req.Method,
					"path", req.URL.Path,
					"panic", fmt.Sprintf("%v", rec),
					"stack", string(debug.Stack()),
				)
				// Use writeJSONError if response not started; otherwise
				// the client already has partial bytes and we just log.
				// http.ResponseWriter has no "headersSent" check, so
				// attempt the write and ignore "already wrote" failures
				// (the existing logging middleware records the final
				// status either way).
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte(`{"error":"Internal server error","status":500}`))
			}
		}()
		next.ServeHTTP(w, req)
	})
}

// loggingMiddleware logs all HTTP requests
func (r *Router) loggingMiddleware(next http.Handler) http.Handler {
	// Static file extensions to skip logging
	staticExts := []string{".js", ".css", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".map"}

	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		// Skip logging for static assets
		path := req.URL.Path
		for _, ext := range staticExts {
			if strings.HasSuffix(path, ext) {
				next.ServeHTTP(w, req)
				return
			}
		}

		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, req)
		slog.Info("http request",
			"method", req.Method,
			"path", path,
			"status", sw.status,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

// corsMiddleware rejects cross-origin preflight requests. HOPS has no
// cross-origin clients today — the SPA is served from the same origin as the
// API — so preflight OPTIONS get a 403 and no Access-Control-* headers are
// emitted. If cross-origin access is ever needed, this is the place to surface
// it (likely as a new settings entry rather than re-introducing the dead
// AllowedOrigins config field).
func (r *Router) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Method == http.MethodOptions {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, req)
	})
}

// securityHeadersMiddleware adds standard security headers to all responses
// appContentSecurityPolicy is the CSP applied to the app's own pages and API
// responses. 'unsafe-inline' is required for script (SvelteKit's hydration
// bootstrap) and style (the app's pervasive inline `style:` theming), so this
// is not a complete XSS seal — but it still blocks loading external scripts,
// <object>/<embed> plugins, <base> hijacking, cross-origin form posts, and
// data exfiltration to hosts other than the Iconify icon CDNs. Asset routes
// (icons/backgrounds) override this with a much stricter policy via
// setAssetCSP, so an uploaded SVG cannot execute script regardless.
const appContentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self' 'unsafe-inline'; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob: http: https:; " +
	"font-src 'self' data:; " +
	"connect-src 'self' https://api.iconify.design https://api.simplesvg.com https://api.unisvg.com; " +
	"frame-src *; " +
	"object-src 'none'; " +
	"base-uri 'self'; " +
	"form-action 'self'; " +
	"frame-ancestors 'self'"

func (r *Router) securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("X-XSS-Protection", "0")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		// Default CSP for app pages and API responses. Asset handlers
		// (serveIcons/serveBackgrounds/servePresets/serveDashboardIcons)
		// overwrite this with the stricter setAssetCSP policy.
		w.Header().Set("Content-Security-Policy", appContentSecurityPolicy)
		next.ServeHTTP(w, req)
	})
}

// authMiddleware validates session token for protected routes
func (r *Router) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		sessionID := extractSessionID(req)
		if sessionID == "" {
			writeJSONError(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		userID, err := r.authService.ValidateSession(sessionID)
		if err != nil {
			writeJSONError(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// Enforce the forced-password-change gate server-side. While the
		// account still owes a password change, every protected route is
		// blocked except the ones needed to actually change it or log out —
		// the frontend redirect alone is not a security control.
		if !passwordChangeExemptPath(req.URL.Path) {
			mustChange, err := r.authService.MustChangePassword(userID)
			if err != nil {
				writeJSONError(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
			if mustChange {
				writeJSONError(w, "Password change required", http.StatusForbidden)
				return
			}
		}

		next(w, req)
	}
}

// passwordChangeExemptPath reports whether a protected route stays reachable
// while the authenticated user still owes a forced password change.
func passwordChangeExemptPath(path string) bool {
	switch path {
	case "/api/auth/change-password", "/api/auth/logout":
		return true
	default:
		return false
	}
}
