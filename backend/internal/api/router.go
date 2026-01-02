package api

import (
	"database/sql"
	"net/http"

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

	// Static file serving (frontend)
	fs := http.FileServer(http.Dir(r.config.FrontendDir))
	r.mux.Handle("/", fs)
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
