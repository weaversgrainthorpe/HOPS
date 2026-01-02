package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/yourusername/hops/internal/version"
)

// handleGetVersion returns version information
func (r *Router) handleGetVersion(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"version": version.String(),
		"major":   version.Major,
		"minor":   version.Minor,
		"patch":   version.Patch,
	})
}

// handleGetConfig returns the dashboard configuration
func (r *Router) handleGetConfig(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var configData string
	err := r.db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&configData)
	if err != nil {
		if err == sql.ErrNoRows {
			// Return empty config
			configData = `{"dashboards":[],"theme":{"mode":"dark"},"settings":{"searchHotkey":"/","defaultView":"/"}}`
		} else {
			http.Error(w, "Failed to load config", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(configData))
}

// handleUpdateConfig updates the dashboard configuration (admin only)
func (r *Router) handleUpdateConfig(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPut && req.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var configData map[string]interface{}
	if err := json.NewDecoder(req.Body).Decode(&configData); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	configJSON, err := json.Marshal(configData)
	if err != nil {
		http.Error(w, "Failed to encode config", http.StatusInternalServerError)
		return
	}

	_, err = r.db.Exec(
		"INSERT OR REPLACE INTO config (id, data, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)",
		string(configJSON),
	)
	if err != nil {
		http.Error(w, "Failed to save config", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

// handleLogin authenticates a user
func (r *Router) handleLogin(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var credentials struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := json.NewDecoder(req.Body).Decode(&credentials); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	sessionID, err := r.authService.Login(credentials.Username, credentials.Password)
	if err != nil {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"sessionId": sessionID,
	})
}

// handleLogout logs out a user
func (r *Router) handleLogout(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	sessionID := req.Header.Get("Authorization")
	if len(sessionID) > 7 && sessionID[:7] == "Bearer " {
		sessionID = sessionID[7:]
	}

	r.authService.Logout(sessionID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

// handleChangePassword changes a user's password
func (r *Router) handleChangePassword(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var data struct {
		OldPassword string `json:"oldPassword"`
		NewPassword string `json:"newPassword"`
	}

	if err := json.NewDecoder(req.Body).Decode(&data); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Get userID from session (simplified - would normally come from context)
	sessionID := req.Header.Get("Authorization")
	if len(sessionID) > 7 && sessionID[:7] == "Bearer " {
		sessionID = sessionID[7:]
	}

	userID, err := r.authService.ValidateSession(sessionID)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if err := r.authService.ChangePassword(userID, data.OldPassword, data.NewPassword); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

// handleGetStatus returns status check results
func (r *Router) handleGetStatus(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract entry ID from URL path
	entryID := req.URL.Path[len("/api/status/"):]
	if entryID == "" {
		http.Error(w, "Entry ID required", http.StatusBadRequest)
		return
	}

	var status string
	var responseTime sql.NullInt64
	var lastChecked string

	err := r.db.QueryRow(
		"SELECT status, response_time, last_checked FROM status_cache WHERE entry_id = ?",
		entryID,
	).Scan(&status, &responseTime, &lastChecked)

	if err == sql.ErrNoRows {
		// No cached status
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status": "unknown",
		})
		return
	}

	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	result := map[string]interface{}{
		"status":      status,
		"lastChecked": lastChecked,
	}
	if responseTime.Valid {
		result["responseTime"] = responseTime.Int64
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// handleExportConfig exports configuration as YAML/JSON
func (r *Router) handleExportConfig(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var configData string
	err := r.db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&configData)
	if err != nil {
		http.Error(w, "Failed to load config", http.StatusInternalServerError)
		return
	}

	format := req.URL.Query().Get("format")
	if format == "yaml" {
		// TODO: Convert JSON to YAML
		w.Header().Set("Content-Type", "application/x-yaml")
		w.Header().Set("Content-Disposition", "attachment; filename=hops-config.yaml")
	} else {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", "attachment; filename=hops-config.json")
	}

	w.Write([]byte(configData))
}

// handleImportConfig imports configuration from YAML/JSON
func (r *Router) handleImportConfig(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// TODO: Implement import from Heimdall/Homer/Dashy
	http.Error(w, "Not implemented yet", http.StatusNotImplemented)
}

// handleIntegrations proxies requests to external services
func (r *Router) handleIntegrations(w http.ResponseWriter, req *http.Request) {
	// TODO: Implement service integrations (Pi-hole, Proxmox, etc.)
	http.Error(w, "Not implemented yet", http.StatusNotImplemented)
}

// Helper function to write JSON responses
func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(data); err != nil {
		http.Error(w, fmt.Sprintf("Failed to encode response: %v", err), http.StatusInternalServerError)
	}
}
