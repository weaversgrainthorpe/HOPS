package api

import (
	"database/sql"
	"net/http"
	"os"
	"path/filepath"

	"github.com/yourusername/hops/internal/auth"
	"github.com/yourusername/hops/internal/config"
)

// Router holds all dependencies for the API
type Router struct {
	db          *sql.DB
	authService *auth.Service
	config      *config.Config
	mux         *http.ServeMux
}

// NewRouter creates a new API router with all routes configured
func NewRouter(db *sql.DB, authService *auth.Service, cfg *config.Config) http.Handler {
	r := &Router{
		db:          db,
		authService: authService,
		config:      cfg,
		mux:         http.NewServeMux(),
	}

	r.setupRoutes()
	return r.corsMiddleware(r.loggingMiddleware(r.mux))
}

// setupRoutes configures all API routes
func (r *Router) setupRoutes() {
	// Public API routes
	r.mux.HandleFunc("/api/version", r.handleGetVersion)
	r.mux.HandleFunc("/api/config", r.handleGetConfig)
	r.mux.HandleFunc("/api/status/", r.handleGetStatus)
	r.mux.HandleFunc("/api/auth/login", r.handleLogin)

	// Protected API routes (require authentication)
	r.mux.HandleFunc("/api/auth/logout", r.authMiddleware(r.handleLogout))
	r.mux.HandleFunc("/api/auth/change-password", r.authMiddleware(r.handleChangePassword))
	r.mux.HandleFunc("/api/config/update", r.authMiddleware(r.handleUpdateConfig))
	r.mux.HandleFunc("/api/config/export", r.authMiddleware(r.handleExportConfig))
	r.mux.HandleFunc("/api/config/import", r.authMiddleware(r.handleImportConfig))

	// Widget/integration routes
	r.mux.HandleFunc("/api/integrations/", r.handleIntegrations)

	// Icon management routes
	r.mux.HandleFunc("/api/icon-categories", r.handleGetIconCategories)
	r.mux.HandleFunc("/api/icon-categories/", r.handleIconCategoryActions)
	r.mux.HandleFunc("/api/icons", r.handleGetIcons)
	r.mux.HandleFunc("/api/icons/", r.handleIconActions)

	// Background image routes
	r.mux.HandleFunc("/api/backgrounds", r.handleBackgrounds)
	r.mux.HandleFunc("/api/backgrounds/categories", r.authMiddleware(r.handleBackgroundCategories))
	r.mux.HandleFunc("/api/backgrounds/categories/", r.authMiddleware(r.handleBackgroundCategoryActions))
	r.mux.HandleFunc("/api/backgrounds/", r.authMiddleware(r.handleBackgroundActions))

	// Serve uploaded backgrounds from data directory
	r.mux.HandleFunc("/backgrounds/", r.serveBackgrounds)

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

// loggingMiddleware logs all HTTP requests
func (r *Router) loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		// TODO: Implement proper logging
		next.ServeHTTP(w, req)
	})
}

// corsMiddleware adds CORS headers
func (r *Router) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if req.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, req)
	})
}

// authMiddleware validates session token
func (r *Router) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		sessionID := req.Header.Get("Authorization")
		if sessionID == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// Remove "Bearer " prefix if present
		if len(sessionID) > 7 && sessionID[:7] == "Bearer " {
			sessionID = sessionID[7:]
		}

		userID, err := r.authService.ValidateSession(sessionID)
		if err != nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// Add userID to context if needed
		_ = userID

		next(w, req)
	}
}
