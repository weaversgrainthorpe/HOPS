package api

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/auth"
	"github.com/weaversgrainthorpe/HOPS/internal/config"
	"github.com/weaversgrainthorpe/HOPS/internal/database"
)

// Router holds all dependencies for the API
type Router struct {
	db            *sql.DB
	authService   *auth.Service
	config        *config.Config
	mux           *http.ServeMux
	rateLimiter   *RateLimiter
	backupManager *database.BackupManager
	startTime     time.Time
}

// RateLimiter provides simple rate limiting for login attempts
type RateLimiter struct {
	mu       sync.Mutex
	attempts map[string][]time.Time
	limit    int
	window   time.Duration
}

// NewRateLimiter creates a rate limiter
func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{
		attempts: make(map[string][]time.Time),
		limit:    limit,
		window:   window,
	}
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

// NewRouter creates a new API router with all routes configured
func NewRouter(db *sql.DB, authService *auth.Service, cfg *config.Config, startTime time.Time) http.Handler {
	// Use configured rate limit or default to 20 per minute
	rateLimit := cfg.LoginRateLimitPerMin
	if rateLimit <= 0 {
		rateLimit = 20
	}

	// Initialize backup manager
	dbPath := filepath.Join(cfg.DataDir, "hops.db")
	backupManager := database.NewBackupManager(dbPath)

	r := &Router{
		db:            db,
		authService:   authService,
		config:        cfg,
		mux:           http.NewServeMux(),
		rateLimiter:   NewRateLimiter(rateLimit, time.Minute),
		backupManager: backupManager,
		startTime:     startTime,
	}

	r.setupRoutes()
	return r.securityHeadersMiddleware(r.corsMiddleware(r.loggingMiddleware(r.mux)))
}

// setupRoutes configures all API routes
func (r *Router) setupRoutes() {
	// Public API routes
	r.mux.HandleFunc("/api/health", r.handleGetHealth)
	r.mux.HandleFunc("/api/version", r.handleGetVersion)
	r.mux.HandleFunc("/api/config", r.handleGetConfig)
	r.mux.HandleFunc("/api/status/", r.handleGetStatus)
	r.mux.HandleFunc("/api/auth/login", r.handleLogin)
	r.mux.HandleFunc("/api/auth/check", r.handleAuthCheck)

	// Protected API routes (require authentication)
	r.mux.HandleFunc("/api/auth/logout", r.authMiddleware(r.handleLogout))
	r.mux.HandleFunc("/api/auth/change-password", r.authMiddleware(r.handleChangePassword))
	r.mux.HandleFunc("/api/config/update", r.authMiddleware(r.handleUpdateConfig))
	r.mux.HandleFunc("/api/config/export", r.authMiddleware(r.handleExportConfig))
	r.mux.HandleFunc("/api/config/import", r.authMiddleware(r.handleImportConfig))
	r.mux.HandleFunc("/api/config/reset", r.authMiddleware(r.handleResetConfig))

	// Backup management routes
	r.mux.HandleFunc("/api/backups", r.authMiddleware(r.handleBackups))
	r.mux.HandleFunc("/api/backups/", r.authMiddleware(r.handleBackupActions))

	// Icon management routes
	r.mux.HandleFunc("/api/icon-categories", r.handleGetIconCategories)
	r.mux.HandleFunc("/api/icon-categories/", r.handleIconCategoryActions)
	r.mux.HandleFunc("/api/icons", r.handleGetIcons)
	r.mux.HandleFunc("/api/icons/upload", r.authMiddleware(r.handleUploadIcon))
	r.mux.HandleFunc("/api/icons/", r.handleIconActions)

	// Serve uploaded icons from data directory
	r.mux.HandleFunc("/icons/", r.serveIcons)

	// Serve dashboard icons (from homarr-labs/dashboard-icons)
	r.mux.HandleFunc("/api/icons/dashboard/", r.serveDashboardIcons)

	// Background image routes
	r.mux.HandleFunc("/api/backgrounds", r.handleBackgrounds)
	r.mux.HandleFunc("/api/backgrounds/categories", r.authMiddleware(r.handleBackgroundCategories))
	r.mux.HandleFunc("/api/backgrounds/categories/", r.authMiddleware(r.handleBackgroundCategoryActions))
	r.mux.HandleFunc("/api/backgrounds/", r.authMiddleware(r.handleBackgroundActions))

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
		r.authMiddleware(r.handleUploadBackground)(w, req)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
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
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// serveBackgrounds serves uploaded background images from the data directory
func (r *Router) serveBackgrounds(w http.ResponseWriter, req *http.Request) {
	// Extract filename from path
	filename := filepath.Base(req.URL.Path)

	// Construct path to backgrounds directory
	backgroundsDir := filepath.Join(r.config.DataDir, "backgrounds")
	filePath := filepath.Join(backgroundsDir, filename)

	// Serve the file
	http.ServeFile(w, req, filePath)
}

// servePresets serves preset background images from the data/presets directory
func (r *Router) servePresets(w http.ResponseWriter, req *http.Request) {
	// Extract filename from path
	filename := filepath.Base(req.URL.Path)

	// Construct path to presets directory
	presetsDir := filepath.Join(r.config.DataDir, "presets")
	filePath := filepath.Join(presetsDir, filename)

	// Set cache headers - presets are static
	w.Header().Set("Cache-Control", "public, max-age=31536000")

	// Serve the file
	http.ServeFile(w, req, filePath)
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

	// Serve the file
	http.ServeFile(w, req, filePath)
}

// serveDashboardIcons serves SVG icons from the dashboard-icons collection
func (r *Router) serveDashboardIcons(w http.ResponseWriter, req *http.Request) {
	// Extract filename from path: /api/icons/dashboard/proxmox.svg -> proxmox.svg
	filename := filepath.Base(req.URL.Path)

	// Construct path to dashboard-icons directory
	iconsDir := filepath.Join(r.config.DataDir, "icons", "dashboard-icons")
	filePath := filepath.Join(iconsDir, filename)

	// Set appropriate content type for SVG
	if filepath.Ext(filename) == ".svg" {
		w.Header().Set("Content-Type", "image/svg+xml")
	}

	// Set long cache headers - these are static icons
	w.Header().Set("Cache-Control", "public, max-age=31536000")

	// Serve the file
	http.ServeFile(w, req, filePath)
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
		log.Printf("%s %s %d %s", req.Method, path, sw.status, time.Since(start).Round(time.Millisecond))
	})
}

// corsMiddleware adds CORS headers with proper origin validation
func (r *Router) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		origin := req.Header.Get("Origin")

		// If allowed origins are configured, validate against them
		// Otherwise, only allow same-origin requests (no CORS headers)
		if len(r.config.AllowedOrigins) > 0 && origin != "" {
			allowed := false
			for _, allowedOrigin := range r.config.AllowedOrigins {
				if origin == allowedOrigin {
					allowed = true
					break
				}
			}

			if allowed {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Vary", "Origin")
			}
		}

		if req.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, req)
	})
}

// securityHeadersMiddleware adds standard security headers to all responses
func (r *Router) securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("X-XSS-Protection", "0")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, req)
	})
}

// authMiddleware validates session token for protected routes
func (r *Router) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		sessionID := extractSessionID(req)
		if sessionID == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		_, err := r.authService.ValidateSession(sessionID)
		if err != nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		next(w, req)
	}
}
