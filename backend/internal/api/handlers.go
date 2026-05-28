package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "image/gif"
	_ "image/jpeg"

	"github.com/weaversgrainthorpe/HOPS/internal/assets"
	"github.com/weaversgrainthorpe/HOPS/internal/converters"
	"github.com/weaversgrainthorpe/HOPS/internal/database"
	"github.com/weaversgrainthorpe/HOPS/internal/settings"
	"github.com/weaversgrainthorpe/HOPS/internal/version"
	"golang.org/x/image/draw"
	"gopkg.in/yaml.v3"
	_ "golang.org/x/image/webp"
)

const bearerPrefix = "Bearer "

// extractSessionID extracts the session ID from the request.
// Checks the HttpOnly cookie first, then falls back to the Authorization header.
func extractSessionID(req *http.Request) string {
	if cookie, err := req.Cookie("hops_session"); err == nil && cookie.Value != "" {
		return cookie.Value
	}
	sessionID := req.Header.Get("Authorization")
	if strings.HasPrefix(sessionID, bearerPrefix) {
		return sessionID[len(bearerPrefix):]
	}
	return sessionID
}

// handleGetVersion returns version information
func (r *Router) handleGetVersion(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	writeJSON(w, map[string]interface{}{
		"version": version.String(),
		"major":   version.Major,
		"minor":   version.Minor,
		"patch":   version.Patch,
	})
}

// handleGetHealth returns application health status
func (r *Router) handleGetHealth(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(req.Context(), 3*time.Second)
	defer cancel()
	dbConnected := r.db.PingContext(ctx) == nil
	status := "ok"
	if !dbConnected {
		status = "degraded"
	}

	writeJSON(w, map[string]interface{}{
		"status":  status,
		"version": version.String(),
		"uptime":  time.Since(r.startTime).Seconds(),
		"database": map[string]interface{}{
			"connected": dbConnected,
		},
	})
}

// handleConfig routes /api/config requests by HTTP method:
//   GET → public config read
//   PUT → authenticated config update (requires CSRF token)
func (r *Router) handleConfig(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		r.handleGetConfig(w, req)
	case http.MethodPut:
		r.protected(r.handleUpdateConfig)(w, req)
	default:
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleGetConfig returns the dashboard configuration
func (r *Router) handleGetConfig(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var configData string
	err := r.db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&configData)
	if err != nil {
		if err == sql.ErrNoRows {
			// Return empty config
			configData = `{"dashboards":[],"theme":{"mode":"dark"},"settings":{"searchHotkey":"/","defaultView":"/"}}`
		} else {
			writeJSONError(w, "Failed to load config", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(configData))
}

// handleUpdateConfig updates the dashboard configuration (admin only)
func (r *Router) handleUpdateConfig(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPut {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var configData map[string]interface{}
	if err := json.NewDecoder(req.Body).Decode(&configData); err != nil {
		writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Create automatic backup before modifying config. If it fails,
	// don't block the update — the admin chose to save — but surface
	// the warning in the response so the UI can flag it. A silent
	// backup failure means the admin trusts a safety-net that didn't
	// fire next time they roll back.
	var backupWarning string
	if r.backupManager != nil {
		if _, err := r.backupManager.CreateBackupWithDB(r.db, "pre-config-update"); err != nil {
			slog.Warn("failed to create pre-update backup", "component", "backup", "error", err)
			backupWarning = "Pre-update backup failed: " + err.Error() + ". Config saved anyway."
		}
	}

	configJSON, err := json.Marshal(configData)
	if err != nil {
		writeJSONError(w, "Failed to encode config", http.StatusInternalServerError)
		return
	}

	_, err = r.db.Exec(
		"INSERT OR REPLACE INTO config (id, data, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)",
		string(configJSON),
	)
	if err != nil {
		writeJSONError(w, "Failed to save config", http.StatusInternalServerError)
		return
	}

	resp := map[string]interface{}{"status": "ok"}
	if backupWarning != "" {
		resp["warning"] = backupWarning
	}
	writeJSON(w, resp)
}

// handleLogin authenticates a user with rate limiting
func (r *Router) handleLogin(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get client IP for rate limiting
	clientIP := r.clientIP(req)
	if !r.rateLimiter.Allow(clientIP) {
		writeJSONError(w, "Too many login attempts. Please try again later.", http.StatusTooManyRequests)
		return
	}

	var credentials struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := json.NewDecoder(req.Body).Decode(&credentials); err != nil {
		writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	result, err := r.authService.Login(credentials.Username, credentials.Password)
	if err != nil {
		writeJSONError(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	secure := r.isSecureRequest(req)
	maxAge := r.sessionCookieMaxAge()
	http.SetCookie(w, &http.Cookie{
		Name:     "hops_session",
		Value:    result.SessionID,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   maxAge,
	})

	// Issue a fresh CSRF token paired with this session.
	csrfToken, err := generateCSRFToken()
	if err != nil {
		writeJSONError(w, "Failed to issue CSRF token", http.StatusInternalServerError)
		return
	}
	setCSRFCookie(w, csrfToken, secure, maxAge)

	writeJSON(w, map[string]interface{}{
		"sessionId":          result.SessionID,
		"mustChangePassword": result.MustChangePassword,
	})
}

// clientIP extracts the client IP address used for rate limiting.
//
// X-Forwarded-For / X-Real-IP are honoured ONLY when the direct connection
// comes from a configured trusted proxy (config.TrustedProxies). Otherwise
// the direct connection address is used — a client that is not behind a
// trusted proxy cannot spoof those headers to get a fresh rate-limit bucket
// per request and brute-force the login.
func (r *Router) clientIP(req *http.Request) string {
	remoteIP := remoteAddrIP(req.RemoteAddr)

	if r.isTrustedProxy(remoteIP) {
		// First entry of X-Forwarded-For is the original client.
		if xff := req.Header.Get("X-Forwarded-For"); xff != "" {
			first := xff
			if idx := strings.Index(xff, ","); idx != -1 {
				first = xff[:idx]
			}
			if ip := strings.TrimSpace(first); ip != "" {
				return ip
			}
		}
		if xri := strings.TrimSpace(req.Header.Get("X-Real-IP")); xri != "" {
			return xri
		}
	}

	return remoteIP
}

// remoteAddrIP strips the port from a "host:port" RemoteAddr.
func remoteAddrIP(remoteAddr string) string {
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return remoteAddr
}

// isTrustedProxy reports whether ip falls within any configured
// trusted-proxy CIDR range.
func (r *Router) isTrustedProxy(ip string) bool {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	for _, network := range r.trustedProxies {
		if network.Contains(parsed) {
			return true
		}
	}
	return false
}

// sessionCookieMaxAge returns the cookie MaxAge (in seconds) derived from the
// auth.session_lifetime_hours admin setting. New sessions and CSRF cookies
// use this value; existing cookies keep their original expiry until they're
// re-issued (on next login or via /api/auth/check).
func (r *Router) sessionCookieMaxAge() int {
	return r.settings.GetInt(settings.KeyAuthSessionLifetimeHours) * 3600
}

// isSecureRequest reports whether the request reached HOPS over HTTPS —
// either directly (req.TLS) or via a trusted reverse proxy that set
// X-Forwarded-Proto: https. Used to decide whether to mark cookies Secure;
// doing so unconditionally would break plain-HTTP LAN deployments by making
// the browser withhold the cookie.
func (r *Router) isSecureRequest(req *http.Request) bool {
	if req.TLS != nil {
		return true
	}
	if r.isTrustedProxy(remoteAddrIP(req.RemoteAddr)) {
		if strings.EqualFold(req.Header.Get("X-Forwarded-Proto"), "https") {
			return true
		}
	}
	return false
}

// handleLogout logs out a user
func (r *Router) handleLogout(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	sessionID := extractSessionID(req)
	r.authService.Logout(sessionID)

	secure := r.isSecureRequest(req)
	http.SetCookie(w, &http.Cookie{
		Name:     "hops_session",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1, // Delete cookie
	})
	clearCSRFCookie(w, secure)

	writeJSONSuccess(w)
}

// handleAuthCheck returns whether the current session is valid.
// If the session is valid but no CSRF cookie exists (e.g. after a server
// restart or upgrade), a fresh one is issued so the SPA can make mutations.
func (r *Router) handleAuthCheck(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	sessionID := extractSessionID(req)
	authenticated := false
	mustChangePassword := false
	if sessionID != "" {
		if userID, err := r.authService.ValidateSession(sessionID); err == nil {
			authenticated = true
			if mustChange, err := r.authService.MustChangePassword(userID); err == nil {
				mustChangePassword = mustChange
			}

			// Ensure the authenticated client has a CSRF token. If the cookie
			// is missing (session pre-dates CSRF, or browser cleared it),
			// issue a fresh one paired with this session.
			if cookie, err := req.Cookie(csrfCookieName); err != nil || cookie.Value == "" {
				if token, err := generateCSRFToken(); err == nil {
					setCSRFCookie(w, token, r.isSecureRequest(req), r.sessionCookieMaxAge())
				}
			}
		}
	}

	writeJSON(w, map[string]bool{
		"authenticated":      authenticated,
		"mustChangePassword": mustChangePassword,
	})
}

// handleChangePassword changes a user's password
func (r *Router) handleChangePassword(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var data struct {
		OldPassword string `json:"oldPassword"`
		NewPassword string `json:"newPassword"`
	}

	if err := json.NewDecoder(req.Body).Decode(&data); err != nil {
		writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Get userID from session (simplified - would normally come from context)
	sessionID := extractSessionID(req)
	userID, err := r.authService.ValidateSession(sessionID)
	if err != nil {
		writeJSONError(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if err := r.authService.ChangePassword(userID, data.OldPassword, data.NewPassword); err != nil {
		writeJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Revoke all other sessions for this user so a session stolen before the
	// change cannot continue to be used. The current session is kept so the
	// user stays logged in.
	if err := r.authService.InvalidateOtherSessions(userID, sessionID); err != nil {
		slog.Warn("failed to invalidate other sessions after password change",
			"component", "auth", "user_id", userID, "error", err)
	}

	writeJSONSuccess(w)
}

// handleGetStatus returns status check results
func (r *Router) handleGetStatus(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract entry ID from URL path
	entryID := req.URL.Path[len("/api/status/"):]
	if entryID == "" {
		writeJSONError(w, "Entry ID required", http.StatusBadRequest)
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
		writeJSON(w, map[string]string{
			"status": "unknown",
		})
		return
	}

	if err != nil {
		writeJSONError(w, "Database error", http.StatusInternalServerError)
		return
	}

	result := map[string]interface{}{
		"status":      status,
		"lastChecked": lastChecked,
	}
	if responseTime.Valid {
		result["responseTime"] = responseTime.Int64
	}

	writeJSON(w, result)
}

// EmbeddedAsset represents a file embedded in an export for portability
type EmbeddedAsset struct {
	ContentType string `json:"contentType"`
	Data        string `json:"data"` // base64-encoded
}

// isLocalAssetRef returns true if the URL is a local file path that should be embedded in exports.
func isLocalAssetRef(url string) bool {
	if url == "" {
		return false
	}
	if strings.HasPrefix(url, "http://") || strings.HasPrefix(url, "https://") {
		return false
	}
	return strings.HasPrefix(url, "/")
}

// readAsset reads the bytes of an asset referenced by URL path. Bundled assets
// (dashboard icons, background presets) come from the embedded filesystem; user
// uploads (icons, backgrounds) come from disk under dataDir.
// Returns (nil, "", false) if the URL pattern is not recognized.
func readAsset(urlPath string, dataDir string) ([]byte, string, bool) {
	filename := filepath.Base(urlPath)
	switch {
	case strings.HasPrefix(urlPath, "/api/icons/dashboard/"):
		data, err := assets.DashboardIcons.ReadFile("dashboard-icons/" + filename)
		if err != nil {
			return nil, "", false
		}
		return data, contentTypeFromPath(filename), true
	case strings.HasPrefix(urlPath, "/presets/"):
		data, err := assets.Presets.ReadFile("presets/" + filename)
		if err != nil {
			return nil, "", false
		}
		return data, contentTypeFromPath(filename), true
	case strings.HasPrefix(urlPath, "/icons/"):
		path := filepath.Join(dataDir, "icons", filename)
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, "", false
		}
		return data, contentTypeFromPath(path), true
	case strings.HasPrefix(urlPath, "/backgrounds/"):
		path := filepath.Join(dataDir, "backgrounds", filename)
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, "", false
		}
		return data, contentTypeFromPath(path), true
	default:
		return nil, "", false
	}
}

// userAssetWritePath returns the disk path to write a user-writable asset to
// during config import. Bundled assets (dashboard icons, presets) return
// ("", false) so the import skips them — they're already in the binary.
func userAssetWritePath(urlPath string, dataDir string) (string, bool) {
	filename := filepath.Base(urlPath)
	switch {
	case strings.HasPrefix(urlPath, "/icons/"):
		return filepath.Join(dataDir, "icons", filename), true
	case strings.HasPrefix(urlPath, "/backgrounds/"):
		return filepath.Join(dataDir, "backgrounds", filename), true
	default:
		return "", false
	}
}

// contentTypeFromPath infers MIME type from file extension.
func contentTypeFromPath(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	default:
		return "application/octet-stream"
	}
}

// collectBackgroundRefs extracts local file URLs from a background object.
func collectBackgroundRefs(bg interface{}, refs map[string]bool) {
	bgMap, ok := bg.(map[string]interface{})
	if !ok {
		return
	}
	bgType, _ := bgMap["type"].(string)
	if bgType == "image" {
		if val, ok := bgMap["value"].(string); ok && isLocalAssetRef(val) {
			refs[val] = true
		}
	} else if bgType == "slideshow" {
		if images, ok := bgMap["images"].([]interface{}); ok {
			for _, img := range images {
				if s, ok := img.(string); ok && isLocalAssetRef(s) {
					refs[s] = true
				}
			}
		}
	}
}

// collectLocalAssetRefs walks the config and returns all local file URL paths
// that need to be embedded (iconUrl fields and background image references).
func collectLocalAssetRefs(cfg map[string]interface{}) []string {
	refs := make(map[string]bool)

	dashboards, _ := cfg["dashboards"].([]interface{})
	for _, d := range dashboards {
		dashboard, ok := d.(map[string]interface{})
		if !ok {
			continue
		}

		if bg, ok := dashboard["background"]; ok {
			collectBackgroundRefs(bg, refs)
		}

		tabs, _ := dashboard["tabs"].([]interface{})
		for _, t := range tabs {
			tab, ok := t.(map[string]interface{})
			if !ok {
				continue
			}
			if iconURL, ok := tab["iconUrl"].(string); ok && isLocalAssetRef(iconURL) {
				refs[iconURL] = true
			}
			if bg, ok := tab["background"]; ok {
				collectBackgroundRefs(bg, refs)
			}

			groups, _ := tab["groups"].([]interface{})
			for _, g := range groups {
				group, ok := g.(map[string]interface{})
				if !ok {
					continue
				}
				if iconURL, ok := group["iconUrl"].(string); ok && isLocalAssetRef(iconURL) {
					refs[iconURL] = true
				}

				entries, _ := group["entries"].([]interface{})
				for _, e := range entries {
					entry, ok := e.(map[string]interface{})
					if !ok {
						continue
					}
					if iconURL, ok := entry["iconUrl"].(string); ok && isLocalAssetRef(iconURL) {
						refs[iconURL] = true
					}
				}
			}
		}
	}

	result := make([]string, 0, len(refs))
	for ref := range refs {
		result = append(result, ref)
	}
	return result
}

// embedAssets reads local files referenced in the config and adds them as base64 data
// to the cfg["assets"] map. Returns the number of assets embedded.
func (r *Router) embedAssets(cfg map[string]interface{}) int {
	refs := collectLocalAssetRefs(cfg)
	if len(refs) == 0 {
		return 0
	}

	embedded := make(map[string]EmbeddedAsset)
	for _, urlPath := range refs {
		data, contentType, ok := readAsset(urlPath, r.config.DataDir)
		if !ok {
			slog.Warn("could not read asset for export", "component", "export", "path", urlPath)
			continue
		}
		embedded[urlPath] = EmbeddedAsset{
			ContentType: contentType,
			Data:        base64.StdEncoding.EncodeToString(data),
		}
	}

	if len(embedded) > 0 {
		cfg["assets"] = embedded
	}
	return len(embedded)
}

// restoreAssets extracts embedded assets from an imported config and writes them to disk.
// Returns the number of assets restored.
func (r *Router) restoreAssets(importedConfig map[string]interface{}) int {
	assetsRaw, ok := importedConfig["assets"]
	if !ok {
		return 0
	}
	assetsMap, ok := assetsRaw.(map[string]interface{})
	if !ok {
		return 0
	}

	restored := 0
	for urlPath, assetRaw := range assetsMap {
		assetMap, ok := assetRaw.(map[string]interface{})
		if !ok {
			continue
		}
		dataStr, _ := assetMap["data"].(string)
		if dataStr == "" {
			continue
		}

		diskPath, ok := userAssetWritePath(urlPath, r.config.DataDir)
		if !ok {
			// Either an unrecognized path or a bundled asset that's already
			// in the binary — nothing to write to disk.
			continue
		}

		// Skip if file already exists
		if _, err := os.Stat(diskPath); err == nil {
			slog.Debug("asset already exists, skipping", "component", "import", "path", diskPath)
			continue
		}

		fileData, err := base64.StdEncoding.DecodeString(dataStr)
		if err != nil {
			slog.Warn("failed to decode asset", "component", "import", "path", urlPath, "error", err)
			continue
		}

		if err := os.MkdirAll(filepath.Dir(diskPath), 0755); err != nil {
			slog.Warn("failed to create directory for asset", "component", "import", "path", diskPath, "error", err)
			continue
		}

		if err := os.WriteFile(diskPath, fileData, 0644); err != nil {
			slog.Warn("failed to write asset", "component", "import", "path", diskPath, "error", err)
			continue
		}

		restored++
		slog.Debug("restored asset", "component", "import", "url", urlPath, "path", diskPath)
	}
	return restored
}

// handleExportConfig exports configuration as YAML/JSON
// Supports optional dashboardId query parameter to export a single dashboard
func (r *Router) handleExportConfig(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var configData string
	err := r.db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&configData)
	if err != nil {
		writeJSONError(w, "Failed to load config", http.StatusInternalServerError)
		return
	}

	// Parse config into a map so we can embed assets
	var cfg map[string]interface{}
	if err := json.Unmarshal([]byte(configData), &cfg); err != nil {
		writeJSONError(w, "Failed to parse config", http.StatusInternalServerError)
		return
	}

	dashboardId := req.URL.Query().Get("dashboardId")
	format := req.URL.Query().Get("format")
	filename := "hops-config"

	// If a specific dashboard is requested, filter the config
	if dashboardId != "" {
		dashboards, ok := cfg["dashboards"].([]interface{})
		if !ok {
			writeJSONError(w, "Invalid config structure", http.StatusInternalServerError)
			return
		}

		var targetDashboard interface{}
		var dashboardName string
		for _, d := range dashboards {
			dashboard, ok := d.(map[string]interface{})
			if !ok {
				continue
			}
			if id, ok := dashboard["id"].(string); ok && id == dashboardId {
				targetDashboard = dashboard
				if name, ok := dashboard["name"].(string); ok {
					dashboardName = name
				}
				break
			}
		}

		if targetDashboard == nil {
			writeJSONError(w, "Dashboard not found", http.StatusNotFound)
			return
		}

		// Replace cfg with single-dashboard export
		cfg = map[string]interface{}{
			"exportType": "single-dashboard",
			"exportedAt": time.Now().Format(time.RFC3339),
			"dashboards": []interface{}{targetDashboard},
		}

		if dashboardName != "" {
			filename = "hops-" + strings.ToLower(strings.ReplaceAll(dashboardName, " ", "-"))
		}
	}

	// Embed local asset files (icons, backgrounds) as base64 for portability
	assetCount := r.embedAssets(cfg)
	if assetCount > 0 {
		slog.Info("embedded assets in export", "component", "export", "count", assetCount)
	}

	// Serialize the final config
	exportData, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		writeJSONError(w, "Failed to serialize config", http.StatusInternalServerError)
		return
	}

	if format == "yaml" {
		var jsonObj interface{}
		if err := json.Unmarshal(exportData, &jsonObj); err != nil {
			writeJSONError(w, "Failed to parse config for YAML conversion", http.StatusInternalServerError)
			return
		}
		yamlBytes, err := yaml.Marshal(jsonObj)
		if err != nil {
			writeJSONError(w, "Failed to convert config to YAML", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/x-yaml")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s.yaml", filename))
		w.Write(yamlBytes)
	} else {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s.json", filename))
		w.Write(exportData)
	}
}

// handleResetConfig resets the configuration to factory defaults
func (r *Router) handleResetConfig(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Create a backup before resetting
	if r.backupManager != nil {
		if _, err := r.backupManager.CreateBackupWithDB(r.db, "pre-factory-reset"); err != nil {
			slog.Warn("failed to create backup before reset", "component", "backup", "error", err)
		}
	}

	if err := database.ResetConfig(r.db); err != nil {
		writeJSONError(w, "Failed to reset configuration", http.StatusInternalServerError)
		return
	}

	// Return the new default config
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(database.DefaultConfig))
}

// IconMatch holds the result of an icon lookup
type IconMatch struct {
	Icon     string
	ImageURL string
	Color    string
}

// Brand aliases - maps sub-brands or alternative names to their parent/canonical icon
var brandAliases = map[string]string{
	// TP-Link family
	"deco":   "tp-link",
	"tapo":   "tp-link",
	"kasa":   "tp-link",
	"omada":  "tp-link",
	"archer": "tp-link",
	"tplink": "tp-link",

	// Ubiquiti family
	"ubnt":       "ubiquiti",
	"edgemax":    "ubiquiti",
	"edgerouter": "ubiquiti",
	"amplifi":    "ubiquiti",

	// Netgear family
	"orbi":      "netgear",
	"nighthawk": "netgear",

	// Google family
	"nest":       "google-home",
	"chromecast": "google-chrome",

	// Amazon family
	"echo":   "alexa",
	"ring":   "amazon",
	"kindle": "amazon",
	"firetv": "amazon",

	// Home Assistant
	"hass":          "home-assistant",
	"hassio":        "home-assistant",
	"homeassistant": "home-assistant",

	// Smart displays/clocks (Ulanzi runs AWTRIX/ESPHome)
	"ulanzi": "esphome",
	"awtrix": "esphome",

	// Pi-hole / AdGuard
	"pihole":  "pi-hole",
	"adguard": "adguard-home",

	// NAS brands
	"dsm":       "synology",
	"freenas":   "truenas-core",
	"truenas":   "truenas-scale",
	"xpenology": "synology",

	// Virtualization
	"pve":     "proxmox",
	"esxi":    "vmware-esxi",
	"vcenter": "vmware",
	"vsphere": "vmware",

	// Container orchestration
	"k8s":      "kubernetes",
	"kubectl":  "kubernetes",
	"microk8s": "kubernetes",
	"swarm":    "docker",

	// Networking/Firewall
	"fortigate": "fortinet",

	// VPN
	"wg": "wireguard",

	// Password managers
	"keepass": "keepassxc",

	// Reverse proxy
	"npm": "nginx-proxy-manager",

	// Monitoring
	"influx": "influxdb",

	// Cloudflare
	"cloudflared": "cloudflare",

	// Databases
	"postgres": "postgresql",
	"mongo":    "mongodb",
}

// iconRecord holds a pre-loaded icon from the database for in-memory matching
type iconRecord struct {
	Name       string // lowercase
	ID         string // lowercase
	Normalized string // lowercase with spaces/hyphens/underscores removed
	Icon       string
	ImageURL   string
	Color      string
	HasImage   bool // true if image_url is non-empty (prioritized in matching)
}

// loadAllIcons loads all icons from the database into memory for batch matching
func (r *Router) loadAllIcons() ([]iconRecord, error) {
	rows, err := r.db.Query(`SELECT id, name, icon, COALESCE(image_url, ''), COALESCE(color, '') FROM icons`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var icons []iconRecord
	for rows.Next() {
		var id, name, icon, imageURL, color string
		if err := rows.Scan(&id, &name, &icon, &imageURL, &color); err != nil {
			return nil, err
		}
		lowerName := strings.ToLower(name)
		lowerID := strings.ToLower(id)
		normalized := strings.ReplaceAll(lowerName, " ", "")
		normalized = strings.ReplaceAll(normalized, "-", "")
		normalized = strings.ReplaceAll(normalized, "_", "")
		icons = append(icons, iconRecord{
			Name:       lowerName,
			ID:         lowerID,
			Normalized: normalized,
			Icon:       icon,
			ImageURL:   imageURL,
			Color:      color,
			HasImage:   imageURL != "",
		})
	}
	return icons, rows.Err()
}

// bestMatch returns the icon preferring those with image_url (dashboard SVGs)
func bestMatch(candidates []iconRecord) (IconMatch, bool) {
	if len(candidates) == 0 {
		return IconMatch{}, false
	}
	// Prefer icons with image_url
	for _, c := range candidates {
		if c.HasImage {
			return IconMatch{Icon: c.Icon, ImageURL: c.ImageURL, Color: c.Color}, true
		}
	}
	c := candidates[0]
	if c.Icon != "" || c.ImageURL != "" {
		return IconMatch{Icon: c.Icon, ImageURL: c.ImageURL, Color: c.Color}, true
	}
	return IconMatch{}, false
}

// matchIconForName searches pre-loaded icons for a matching icon based on the service name.
// Falls back to database query if icons is nil (backward compatibility).
func (r *Router) matchIconForName(name string) (IconMatch, bool) {
	icons, err := r.loadAllIcons()
	if err != nil {
		return IconMatch{}, false
	}
	return matchIconInMemory(name, icons)
}

// matchIconInMemory performs icon matching against a pre-loaded icon slice.
// This avoids N+1 database queries when called in a loop.
func matchIconInMemory(name string, icons []iconRecord) (IconMatch, bool) {
	if name == "" {
		return IconMatch{}, false
	}

	normalizedName := strings.ToLower(strings.TrimSpace(name))

	// Check brand aliases first
	for alias, canonical := range brandAliases {
		if strings.Contains(normalizedName, alias) {
			var candidates []iconRecord
			for _, ic := range icons {
				if ic.ID == canonical || ic.Name == canonical {
					candidates = append(candidates, ic)
				}
			}
			if m, ok := bestMatch(candidates); ok {
				return m, true
			}
		}
	}

	noSpaceName := strings.ReplaceAll(normalizedName, " ", "")
	noSpaceName = strings.ReplaceAll(noSpaceName, "-", "")
	noSpaceName = strings.ReplaceAll(noSpaceName, "_", "")

	// Try exact match on name or id
	var candidates []iconRecord
	for _, ic := range icons {
		if ic.Name == normalizedName || ic.ID == normalizedName {
			candidates = append(candidates, ic)
		}
	}
	if m, ok := bestMatch(candidates); ok {
		return m, true
	}

	// Try normalized match (without spaces/hyphens/underscores)
	candidates = nil
	for _, ic := range icons {
		if ic.Normalized == noSpaceName {
			candidates = append(candidates, ic)
		}
	}
	if m, ok := bestMatch(candidates); ok {
		return m, true
	}

	// Try partial match (name contains search term)
	candidates = nil
	for _, ic := range icons {
		if len(ic.Name) >= 4 && (strings.Contains(ic.Name, normalizedName) || strings.Contains(ic.ID, normalizedName)) {
			candidates = append(candidates, ic)
		}
	}
	// Sort by longest name first (more specific match)
	if len(candidates) > 1 {
		for i := 0; i < len(candidates)-1; i++ {
			for j := i + 1; j < len(candidates); j++ {
				if len(candidates[j].Name) > len(candidates[i].Name) {
					candidates[i], candidates[j] = candidates[j], candidates[i]
				}
			}
		}
	}
	if m, ok := bestMatch(candidates); ok {
		return m, true
	}

	// Try word-based matching
	words := strings.FieldsFunc(normalizedName, func(c rune) bool {
		return c == ' ' || c == '-' || c == '_'
	})

	for _, word := range words {
		if len(word) < 3 {
			continue
		}
		candidates = nil
		for _, ic := range icons {
			if ic.Name == word || ic.ID == word {
				candidates = append(candidates, ic)
			}
		}
		if m, ok := bestMatch(candidates); ok {
			return m, true
		}
	}

	// Try combining adjacent words
	for i := 0; i < len(words)-1; i++ {
		combined := words[i] + "-" + words[i+1]
		combinedNoHyphen := words[i] + words[i+1]

		candidates = nil
		for _, ic := range icons {
			if ic.Name == combined || ic.ID == combined || ic.Name == combinedNoHyphen || ic.ID == combinedNoHyphen || ic.Normalized == combinedNoHyphen {
				candidates = append(candidates, ic)
			}
		}
		if m, ok := bestMatch(candidates); ok {
			return m, true
		}
	}

	// Final fallback: partial match on individual words
	for _, word := range words {
		if len(word) < 4 {
			continue
		}
		candidates = nil
		for _, ic := range icons {
			if len(ic.Name) >= 4 && (strings.Contains(ic.Name, word) || strings.Contains(ic.ID, word)) {
				candidates = append(candidates, ic)
			}
		}
		if m, ok := bestMatch(candidates); ok {
			return m, true
		}
	}

	return IconMatch{}, false
}

// applyIconMatching recursively searches through the config and matches icons for entries.
// Pre-loads all icons once to avoid N+1 database queries.
func (r *Router) applyIconMatching(config map[string]interface{}) int {
	// Pre-load all icons into memory for batch matching
	icons, err := r.loadAllIcons()
	if err != nil {
		slog.Error("failed to load icons for matching", "component", "icons", "error", err)
		return 0
	}

	matchCount := 0

	dashboards, ok := config["dashboards"].([]interface{})
	if !ok {
		return 0
	}

	for _, d := range dashboards {
		dashboard, ok := d.(map[string]interface{})
		if !ok {
			continue
		}

		tabs, ok := dashboard["tabs"].([]interface{})
		if !ok {
			continue
		}

		for _, t := range tabs {
			tab, ok := t.(map[string]interface{})
			if !ok {
				continue
			}

			groups, ok := tab["groups"].([]interface{})
			if !ok {
				continue
			}

			for _, g := range groups {
				group, ok := g.(map[string]interface{})
				if !ok {
					continue
				}

				entries, ok := group["entries"].([]interface{})
				if !ok {
					continue
				}

				for _, e := range entries {
					entry, ok := e.(map[string]interface{})
					if !ok {
						continue
					}

					// Check if entry already has an icon (and it's not a generic one)
					existingIcon, _ := entry["icon"].(string)
					existingIconUrl, _ := entry["iconUrl"].(string)
					if existingIconUrl != "" || (existingIcon != "" && existingIcon != "mdi:application" && existingIcon != "mdi:link" && !strings.HasPrefix(existingIcon, "mdi:help")) {
						continue
					}

					// Try to match based on name using pre-loaded icons
					name, _ := entry["name"].(string)
					if match, found := matchIconInMemory(name, icons); found {
						// Prefer image_url (local SVG) over iconify icon
						if match.ImageURL != "" {
							entry["iconUrl"] = match.ImageURL
							entry["icon"] = "" // Clear iconify reference
						} else if match.Icon != "" {
							entry["icon"] = match.Icon
						}
						matchCount++
					}
				}
			}
		}
	}

	return matchCount
}

// handleImportConfig imports configuration from YAML/JSON (supports HOPS, Homer, Dashy formats)
func (r *Router) handleImportConfig(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Cap the request body, then parse the multipart form. Limit comes from
	// the upload.max_bytes_import admin setting.
	limit := int64(r.settings.GetInt(settings.KeyUploadMaxBytesImport))
	req.Body = http.MaxBytesReader(w, req.Body, limit)
	if err := req.ParseMultipartForm(limit); err != nil {
		writeJSONError(w, "Upload too large or malformed", http.StatusBadRequest)
		return
	}

	// Check if auto-match icons is requested
	autoMatchIcons := req.FormValue("autoMatchIcons") == "true"

	file, _, err := req.FormFile("file")
	if err != nil {
		writeJSONError(w, "No file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Read entire file into memory
	fileData, err := io.ReadAll(file)
	if err != nil {
		writeJSONError(w, "Failed to read file", http.StatusInternalServerError)
		return
	}

	var configJSON []byte
	var importFormat string

	// Detect the format
	format, err := converters.DetectFormat(fileData)
	if err != nil {
		slog.Warn("import: format detection failed", "component", "import", "error", err)
		writeJSONError(w, "Could not detect the file format. Supported: HOPS, Homer, Dashy, Heimdall.", http.StatusBadRequest)
		return
	}

	// Convert based on detected format
	switch format {
	case "hops":
		configJSON = fileData
		importFormat = "HOPS JSON"

	case "homer":
		configJSON, err = converters.ConvertFromHomer(fileData)
		if err != nil {
			slog.Warn("import: Homer conversion failed", "component", "import", "error", err)
			writeJSONError(w, "Could not convert the Homer config — the file may be malformed.", http.StatusBadRequest)
			return
		}
		importFormat = "Homer YAML"

	case "dashy":
		configJSON, err = converters.ConvertFromDashy(fileData)
		if err != nil {
			slog.Warn("import: Dashy conversion failed", "component", "import", "error", err)
			writeJSONError(w, "Could not convert the Dashy config — the file may be malformed.", http.StatusBadRequest)
			return
		}
		importFormat = "Dashy YAML"

	case "heimdall":
		configJSON, err = converters.ConvertFromHeimdall(fileData)
		if err != nil {
			slog.Warn("import: Heimdall conversion failed", "component", "import", "error", err)
			writeJSONError(w, "Could not convert the Heimdall config — the file may be malformed.", http.StatusBadRequest)
			return
		}
		importFormat = "Heimdall JSON"

	default:
		writeJSONError(w, "Unsupported file format", http.StatusBadRequest)
		return
	}

	// Validate the resulting JSON has the expected structure
	var importedConfig map[string]interface{}
	if err := json.Unmarshal(configJSON, &importedConfig); err != nil {
		writeJSONError(w, "Invalid configuration after conversion", http.StatusInternalServerError)
		return
	}

	importedDashboards, ok := importedConfig["dashboards"].([]interface{})
	if !ok {
		writeJSONError(w, "Invalid config: missing 'dashboards' field", http.StatusBadRequest)
		return
	}

	// Load existing config to merge with
	var existingJSON string
	err = r.db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&existingJSON)

	var existingConfig map[string]interface{}
	if err == nil && existingJSON != "" {
		if err := json.Unmarshal([]byte(existingJSON), &existingConfig); err != nil {
			existingConfig = make(map[string]interface{})
		}
	} else {
		existingConfig = make(map[string]interface{})
	}

	// Get existing dashboards
	existingDashboards, _ := existingConfig["dashboards"].([]interface{})

	// Build a map of existing dashboard paths to avoid duplicates
	existingPaths := make(map[string]bool)
	for _, d := range existingDashboards {
		if dashboard, ok := d.(map[string]interface{}); ok {
			if path, ok := dashboard["path"].(string); ok {
				existingPaths[path] = true
			}
		}
	}

	// Append imported dashboards, renaming paths if they conflict
	importedCount := 0
	for _, d := range importedDashboards {
		if dashboard, ok := d.(map[string]interface{}); ok {
			path, _ := dashboard["path"].(string)
			originalPath := path

			// If path already exists, add a suffix
			suffix := 1
			for existingPaths[path] {
				path = fmt.Sprintf("%s-%d", originalPath, suffix)
				suffix++
			}

			// Update the path and id if changed
			if path != originalPath {
				dashboard["path"] = path
				dashboard["id"] = strings.TrimPrefix(path, "/")
				if name, ok := dashboard["name"].(string); ok {
					dashboard["name"] = fmt.Sprintf("%s (Imported)", name)
				}
			}

			existingDashboards = append(existingDashboards, dashboard)
			existingPaths[path] = true
			importedCount++
		}
	}

	// Update the config with merged dashboards
	existingConfig["dashboards"] = existingDashboards

	// Apply icon matching if requested
	iconMatchCount := 0
	if autoMatchIcons {
		slog.Info("applying icon matching to config", "component", "import")
		iconMatchCount = r.applyIconMatching(existingConfig)
		slog.Info("icon matching complete", "component", "import", "matched", iconMatchCount)

		// Debug: Log a sample entry after matching
		if dashboards, ok := existingConfig["dashboards"].([]interface{}); ok && len(dashboards) > 0 {
			if dash, ok := dashboards[len(dashboards)-1].(map[string]interface{}); ok {
				if tabs, ok := dash["tabs"].([]interface{}); ok && len(tabs) > 0 {
					if tab, ok := tabs[0].(map[string]interface{}); ok {
						if groups, ok := tab["groups"].([]interface{}); ok && len(groups) > 0 {
							if group, ok := groups[0].(map[string]interface{}); ok {
								if entries, ok := group["entries"].([]interface{}); ok && len(entries) > 0 {
									if entry, ok := entries[0].(map[string]interface{}); ok {
										slog.Debug("sample entry after icon matching", "component", "import", "name", entry["name"], "icon", entry["icon"])
									}
								}
							}
						}
					}
				}
			}
		}
	} else {
		slog.Debug("autoMatchIcons is false, skipping icon matching", "component", "import")
	}

	// Preserve theme and settings from existing config, or use imported if not present
	if _, ok := existingConfig["theme"]; !ok {
		if theme, ok := importedConfig["theme"]; ok {
			existingConfig["theme"] = theme
		}
	}
	if _, ok := existingConfig["settings"]; !ok {
		if settings, ok := importedConfig["settings"]; ok {
			existingConfig["settings"] = settings
		}
	}

	// Restore embedded assets (icons, backgrounds) from import
	assetsRestored := r.restoreAssets(importedConfig)

	// Remove assets from config before saving — transport-only field
	delete(existingConfig, "assets")

	// Serialize merged config
	mergedJSON, err := json.Marshal(existingConfig)
	if err != nil {
		writeJSONError(w, "Failed to serialize merged config", http.StatusInternalServerError)
		return
	}

	// Save to database
	_, err = r.db.Exec(
		"INSERT OR REPLACE INTO config (id, data, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)",
		string(mergedJSON),
	)
	if err != nil {
		writeJSONError(w, "Failed to save config", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	// Build response message
	message := fmt.Sprintf("Imported %d dashboard(s) from %s format", importedCount, importFormat)
	if iconMatchCount > 0 {
		message += fmt.Sprintf(", matched %d icon(s)", iconMatchCount)
	}
	if assetsRestored > 0 {
		message += fmt.Sprintf(", restored %d asset file(s)", assetsRestored)
	}

	writeJSON(w, map[string]interface{}{
		"success":        true,
		"message":        message,
		"imported":       importedCount,
		"iconsMatched":   iconMatchCount,
		"assetsRestored": assetsRestored,
	})
}

// handleIconActions routes icon CRUD operations based on HTTP method
func (r *Router) handleIconActions(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodPut:
		r.handleUpdateIcon(w, req)
	case http.MethodDelete:
		r.handleDeleteIcon(w, req)
	default:
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleIconCategoryActions routes category CRUD operations based on HTTP method
func (r *Router) handleIconCategoryActions(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodPut:
		r.handleUpdateIconCategory(w, req)
	case http.MethodDelete:
		r.handleDeleteIconCategory(w, req)
	default:
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleGetIconCategories returns all icon categories or creates a new one
func (r *Router) handleGetIconCategories(w http.ResponseWriter, req *http.Request) {
	if req.Method == http.MethodPost {
		r.protected(r.handleCreateIconCategory)(w, req)
		return
	}

	if req.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	rows, err := r.db.Query(`
		SELECT id, name, icon, order_num, is_preset, created_at
		FROM icon_categories
		ORDER BY order_num ASC
		LIMIT 500
	`)
	if err != nil {
		writeJSONError(w, "Failed to load icon categories", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	categories := []map[string]interface{}{}
	for rows.Next() {
		var id, name, icon, createdAt string
		var orderNum int
		var isPreset bool

		if err := rows.Scan(&id, &name, &icon, &orderNum, &isPreset, &createdAt); err != nil {
			writeJSONError(w, "Failed to scan category", http.StatusInternalServerError)
			return
		}

		categories = append(categories, map[string]interface{}{
			"id":        id,
			"name":      name,
			"icon":      icon,
			"order":     orderNum,
			"isPreset":  isPreset,
			"createdAt": createdAt,
		})
	}

	writeJSON(w, categories)
}

// handleGetIcons returns all icons, optionally filtered by category, or creates a new icon
func (r *Router) handleGetIcons(w http.ResponseWriter, req *http.Request) {
	if req.Method == http.MethodPost {
		r.protected(r.handleCreateIcon)(w, req)
		return
	}

	if req.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	categoryID := req.URL.Query().Get("category")

	var rows *sql.Rows
	var err error

	if categoryID != "" {
		rows, err = r.db.Query(`
			SELECT id, name, icon, category_id, color, image_url, is_preset, created_at
			FROM icons
			WHERE category_id = ?
			ORDER BY name ASC
			LIMIT 10000
		`, categoryID)
	} else {
		rows, err = r.db.Query(`
			SELECT id, name, icon, category_id, color, image_url, is_preset, created_at
			FROM icons
			ORDER BY name ASC
			LIMIT 10000
		`)
	}

	if err != nil {
		writeJSONError(w, "Failed to load icons", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	icons := []map[string]interface{}{}
	for rows.Next() {
		var id, name, icon, categoryID, createdAt string
		var color, imageURL sql.NullString
		var isPreset bool

		if err := rows.Scan(&id, &name, &icon, &categoryID, &color, &imageURL, &isPreset, &createdAt); err != nil {
			writeJSONError(w, "Failed to scan icon", http.StatusInternalServerError)
			return
		}

		iconData := map[string]interface{}{
			"id":         id,
			"name":       name,
			"icon":       icon,
			"categoryId": categoryID,
			"isPreset":   isPreset,
			"createdAt":  createdAt,
		}

		if color.Valid {
			iconData["color"] = color.String
		}

		if imageURL.Valid {
			iconData["imageUrl"] = imageURL.String
		}

		icons = append(icons, iconData)
	}

	writeJSON(w, icons)
}

// handleCreateIcon creates a new icon (admin only)
func (r *Router) handleCreateIcon(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var iconData struct {
		ID         string  `json:"id"`
		Name       string  `json:"name"`
		Icon       string  `json:"icon"`
		CategoryID string  `json:"categoryId"`
		Color      *string `json:"color"`
		ImageURL   *string `json:"imageUrl"`
	}

	if err := json.NewDecoder(req.Body).Decode(&iconData); err != nil {
		writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate required fields - icon is optional if imageUrl is provided
	if iconData.ID == "" || iconData.Name == "" || iconData.CategoryID == "" {
		writeJSONError(w, "Missing required fields", http.StatusBadRequest)
		return
	}

	// Must have either icon or imageUrl
	if iconData.Icon == "" && (iconData.ImageURL == nil || *iconData.ImageURL == "") {
		writeJSONError(w, "Either icon or imageUrl is required", http.StatusBadRequest)
		return
	}

	var color sql.NullString
	if iconData.Color != nil && *iconData.Color != "" {
		color = sql.NullString{String: *iconData.Color, Valid: true}
	}

	var imageURL sql.NullString
	if iconData.ImageURL != nil && *iconData.ImageURL != "" {
		imageURL = sql.NullString{String: *iconData.ImageURL, Valid: true}
	}

	_, err := r.db.Exec(
		"INSERT INTO icons (id, name, icon, category_id, color, image_url, is_preset) VALUES (?, ?, ?, ?, ?, ?, 0)",
		iconData.ID, iconData.Name, iconData.Icon, iconData.CategoryID, color, imageURL,
	)
	if err != nil {
		writeJSONError(w, "Failed to create icon", http.StatusInternalServerError)
		return
	}

	writeJSONSuccess(w)
}

// handleUpdateIcon updates an existing icon (admin only)
func (r *Router) handleUpdateIcon(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPut {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	iconID := req.URL.Path[len("/api/icons/"):]
	if iconID == "" {
		writeJSONError(w, "Icon ID required", http.StatusBadRequest)
		return
	}

	var iconData struct {
		Name       string  `json:"name"`
		Icon       string  `json:"icon"`
		CategoryID string  `json:"categoryId"`
		Color      *string `json:"color"`
	}

	if err := json.NewDecoder(req.Body).Decode(&iconData); err != nil {
		writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	var color sql.NullString
	if iconData.Color != nil && *iconData.Color != "" {
		color = sql.NullString{String: *iconData.Color, Valid: true}
	}

	_, err := r.db.Exec(
		"UPDATE icons SET name = ?, icon = ?, category_id = ?, color = ? WHERE id = ?",
		iconData.Name, iconData.Icon, iconData.CategoryID, color, iconID,
	)
	if err != nil {
		writeJSONError(w, "Failed to update icon", http.StatusInternalServerError)
		return
	}

	writeJSONSuccess(w)
}

// handleDeleteIcon deletes an icon (admin only, only user-created icons)
func (r *Router) handleDeleteIcon(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodDelete {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	iconID := req.URL.Path[len("/api/icons/"):]
	if iconID == "" {
		writeJSONError(w, "Icon ID required", http.StatusBadRequest)
		return
	}

	// Only allow deletion of user-created icons (not presets)
	_, err := r.db.Exec("DELETE FROM icons WHERE id = ? AND is_preset = 0", iconID)
	if err != nil {
		writeJSONError(w, "Failed to delete icon", http.StatusInternalServerError)
		return
	}

	writeJSONSuccess(w)
}

// handleCreateIconCategory creates a new icon category (admin only)
func (r *Router) handleCreateIconCategory(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var categoryData struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Icon  string `json:"icon"`
		Order int    `json:"order"`
	}

	if err := json.NewDecoder(req.Body).Decode(&categoryData); err != nil {
		writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if categoryData.ID == "" || categoryData.Name == "" || categoryData.Icon == "" {
		writeJSONError(w, "Missing required fields", http.StatusBadRequest)
		return
	}

	_, err := r.db.Exec(
		"INSERT INTO icon_categories (id, name, icon, order_num, is_preset) VALUES (?, ?, ?, ?, 0)",
		categoryData.ID, categoryData.Name, categoryData.Icon, categoryData.Order,
	)
	if err != nil {
		writeJSONError(w, "Failed to create category", http.StatusInternalServerError)
		return
	}

	writeJSONSuccess(w)
}

// handleUpdateIconCategory updates an existing icon category (admin only)
func (r *Router) handleUpdateIconCategory(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPut {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	categoryID := req.URL.Path[len("/api/icon-categories/"):]
	if categoryID == "" {
		writeJSONError(w, "Category ID required", http.StatusBadRequest)
		return
	}

	var categoryData struct {
		Name  string `json:"name"`
		Icon  string `json:"icon"`
		Order int    `json:"order"`
	}

	if err := json.NewDecoder(req.Body).Decode(&categoryData); err != nil {
		writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	_, err := r.db.Exec(
		"UPDATE icon_categories SET name = ?, icon = ?, order_num = ? WHERE id = ?",
		categoryData.Name, categoryData.Icon, categoryData.Order, categoryID,
	)
	if err != nil {
		writeJSONError(w, "Failed to update category", http.StatusInternalServerError)
		return
	}

	writeJSONSuccess(w)
}

// handleDeleteIconCategory deletes a category (admin only, only user-created categories)
func (r *Router) handleDeleteIconCategory(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodDelete {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	categoryID := req.URL.Path[len("/api/icon-categories/"):]
	if categoryID == "" {
		writeJSONError(w, "Category ID required", http.StatusBadRequest)
		return
	}

	// Only allow deletion of user-created categories (not presets)
	// This will also cascade delete all icons in the category
	_, err := r.db.Exec("DELETE FROM icon_categories WHERE id = ? AND is_preset = 0", categoryID)
	if err != nil {
		writeJSONError(w, "Failed to delete category", http.StatusInternalServerError)
		return
	}

	writeJSONSuccess(w)
}

// writeJSONSuccess writes a standard {"success": true} response for mutations
func writeJSONSuccess(w http.ResponseWriter) {
	writeJSON(w, map[string]bool{"success": true})
}

// writeJSON writes a JSON response
func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(data); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

// writeJSONError writes a JSON error response with consistent format
func writeJSONError(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"error":  message,
		"status": statusCode,
	}); err != nil {
		slog.Error("failed to encode error response", "error", err)
	}
}

// BackgroundImage represents a background image with metadata
type BackgroundImage struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	URL      string `json:"url"`
	Category string `json:"category"`
	Source   string `json:"source"` // "preset" or "uploaded"
}

// BackgroundCategory represents a user-defined category
type BackgroundCategory struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon"`
}

// BackgroundData stores all background metadata
type BackgroundData struct {
	Categories []BackgroundCategory `json:"categories"`
	Images     []BackgroundImage    `json:"images"`
}

// Default preset categories
var defaultCategories = []BackgroundCategory{
	{ID: "network", Name: "Network", Icon: "mdi:network"},
	{ID: "servers", Name: "Servers", Icon: "mdi:server"},
	{ID: "docker", Name: "Docker", Icon: "mdi:docker"},
	{ID: "homelab", Name: "Homelab", Icon: "mdi:raspberry-pi"},
	{ID: "smarthome", Name: "Smart Home", Icon: "mdi:home-automation"},
	{ID: "apps", Name: "Applications", Icon: "mdi:application"},
	{ID: "multimedia", Name: "Multimedia", Icon: "mdi:multimedia"},
	{ID: "weather", Name: "Weather", Icon: "mdi:weather-partly-cloudy"},
	{ID: "storage", Name: "Storage", Icon: "mdi:harddisk"},
	{ID: "tech", Name: "Technology", Icon: "mdi:chip"},
	{ID: "space", Name: "Space", Icon: "mdi:space-station"},
	{ID: "minimal", Name: "Minimal", Icon: "mdi:palette-outline"},
	{ID: "uploaded", Name: "Uploaded", Icon: "mdi:folder-image"},
}

// getBackgroundDataPath returns the path to the backgrounds metadata file
func (r *Router) getBackgroundDataPath() string {
	return filepath.Join(r.config.DataDir, "backgrounds.json")
}

// loadBackgroundData loads background metadata from file
func (r *Router) loadBackgroundData() (*BackgroundData, error) {
	dataPath := r.getBackgroundDataPath()

	data, err := os.ReadFile(dataPath)
	if os.IsNotExist(err) {
		// Return default data with preset categories
		return &BackgroundData{
			Categories: defaultCategories,
			Images:     []BackgroundImage{},
		}, nil
	}
	if err != nil {
		return nil, err
	}

	var bgData BackgroundData
	if err := json.Unmarshal(data, &bgData); err != nil {
		return nil, err
	}

	return &bgData, nil
}

// saveBackgroundData saves background metadata to file
func (r *Router) saveBackgroundData(data *BackgroundData) error {
	dataPath := r.getBackgroundDataPath()

	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(dataPath, jsonData, 0644)
}

// handleUploadBackground handles background image uploads
func (r *Router) handleUploadBackground(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Cap the request body, then parse the multipart form. Limit from the
	// upload.max_bytes_background admin setting.
	limit := int64(r.settings.GetInt(settings.KeyUploadMaxBytesBackground))
	req.Body = http.MaxBytesReader(w, req.Body, limit)
	if err := req.ParseMultipartForm(limit); err != nil {
		writeJSONError(w, "Upload too large or malformed", http.StatusBadRequest)
		return
	}

	file, header, err := req.FormFile("file")
	if err != nil {
		writeJSONError(w, "No file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Get optional metadata from form
	name := req.FormValue("name")
	category := req.FormValue("category")
	if category == "" {
		category = "uploaded"
	}

	// Validate file type
	contentType := header.Header.Get("Content-Type")
	validTypes := map[string]string{
		"image/jpeg": ".jpg",
		"image/png":  ".png",
		"image/gif":  ".gif",
		"image/webp": ".webp",
	}

	ext, ok := validTypes[contentType]
	if !ok {
		writeJSONError(w, "Invalid file type. Allowed: JPEG, PNG, GIF, WebP", http.StatusBadRequest)
		return
	}

	// Create backgrounds directory if it doesn't exist
	backgroundsDir := filepath.Join(r.config.DataDir, "backgrounds")
	if err := os.MkdirAll(backgroundsDir, 0755); err != nil {
		writeJSONError(w, "Failed to create backgrounds directory", http.StatusInternalServerError)
		return
	}

	// Generate unique filename
	randomBytes := make([]byte, 16)
	if _, err := rand.Read(randomBytes); err != nil {
		writeJSONError(w, "Failed to generate filename", http.StatusInternalServerError)
		return
	}
	filename := hex.EncodeToString(randomBytes) + ext
	imageID := hex.EncodeToString(randomBytes)

	// Save file
	destPath := filepath.Join(backgroundsDir, filename)
	destFile, err := os.Create(destPath)
	if err != nil {
		writeJSONError(w, "Failed to create file", http.StatusInternalServerError)
		return
	}
	defer destFile.Close()

	if _, err := io.Copy(destFile, file); err != nil {
		writeJSONError(w, "Failed to save file", http.StatusInternalServerError)
		return
	}

	// Use original filename as name if not provided
	if name == "" {
		name = strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename))
	}

	// Return the URL path for the uploaded file
	urlPath := "/backgrounds/" + filename

	// Add to background metadata
	bgData, err := r.loadBackgroundData()
	if err != nil {
		// Log error but continue - file was uploaded successfully
		slog.Warn("failed to load background data", "component", "backgrounds", "error", err)
	} else {
		newImage := BackgroundImage{
			ID:       imageID,
			Name:     name,
			URL:      urlPath,
			Category: category,
			Source:   "uploaded",
		}
		bgData.Images = append(bgData.Images, newImage)
		if err := r.saveBackgroundData(bgData); err != nil {
			slog.Warn("failed to save background data", "component", "backgrounds", "error", err)
		}
	}

	writeJSON(w, map[string]interface{}{
		"success":  true,
		"id":       imageID,
		"url":      urlPath,
		"name":     name,
		"category": category,
		"source":   "uploaded",
	})
}

// handleUploadIcon handles icon image uploads with automatic resizing
func (r *Router) handleUploadIcon(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Cap the request body, then parse the multipart form. Limit from the
	// upload.max_bytes_icon admin setting.
	limit := int64(r.settings.GetInt(settings.KeyUploadMaxBytesIcon))
	req.Body = http.MaxBytesReader(w, req.Body, limit)
	if err := req.ParseMultipartForm(limit); err != nil {
		writeJSONError(w, "Upload too large or malformed", http.StatusBadRequest)
		return
	}

	file, header, err := req.FormFile("file")
	if err != nil {
		writeJSONError(w, "No file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Validate file type
	contentType := header.Header.Get("Content-Type")
	validTypes := map[string]bool{
		"image/jpeg": true,
		"image/png":  true,
		"image/gif":  true,
		"image/webp": true,
		"image/svg+xml": true,
	}

	if !validTypes[contentType] {
		writeJSONError(w, "Invalid file type. Allowed: JPEG, PNG, GIF, WebP, SVG", http.StatusBadRequest)
		return
	}

	// Create icons directory if it doesn't exist
	iconsDir := filepath.Join(r.config.DataDir, "icons")
	if err := os.MkdirAll(iconsDir, 0755); err != nil {
		writeJSONError(w, "Failed to create icons directory", http.StatusInternalServerError)
		return
	}

	// Generate unique filename
	randomBytes := make([]byte, 16)
	if _, err := rand.Read(randomBytes); err != nil {
		writeJSONError(w, "Failed to generate filename", http.StatusInternalServerError)
		return
	}
	iconID := hex.EncodeToString(randomBytes)

	// Read file into buffer
	fileData, err := io.ReadAll(file)
	if err != nil {
		writeJSONError(w, "Failed to read file", http.StatusInternalServerError)
		return
	}

	var filename string
	var destPath string

	// Handle SVG separately (no resizing needed)
	if contentType == "image/svg+xml" {
		filename = iconID + ".svg"
		destPath = filepath.Join(iconsDir, filename)
		if err := os.WriteFile(destPath, fileData, 0644); err != nil {
			writeJSONError(w, "Failed to save file", http.StatusInternalServerError)
			return
		}
	} else {
		// Decode and resize raster images
		img, _, err := image.Decode(bytes.NewReader(fileData))
		if err != nil {
			slog.Warn("icon upload: image decode failed", "component", "icons", "error", err)
			writeJSONError(w, "Could not decode the image file. Supported: JPEG, PNG, GIF, WebP, SVG.", http.StatusBadRequest)
			return
		}

		// Resize to 128x128 (good size for icons)
		targetSize := 128
		resized := resizeImage(img, targetSize, targetSize)

		// Save as PNG for best quality with transparency
		filename = iconID + ".png"
		destPath = filepath.Join(iconsDir, filename)
		destFile, err := os.Create(destPath)
		if err != nil {
			writeJSONError(w, "Failed to create file", http.StatusInternalServerError)
			return
		}
		defer destFile.Close()

		if err := png.Encode(destFile, resized); err != nil {
			writeJSONError(w, "Failed to encode image", http.StatusInternalServerError)
			return
		}
	}

	// Return the URL path for the uploaded icon
	urlPath := "/icons/" + filename

	writeJSON(w, map[string]interface{}{
		"success": true,
		"id":      iconID,
		"url":     urlPath,
	})
}

// resizeImage resizes an image to fit within maxWidth x maxHeight while preserving aspect ratio
func resizeImage(src image.Image, maxWidth, maxHeight int) image.Image {
	srcBounds := src.Bounds()
	srcWidth := srcBounds.Dx()
	srcHeight := srcBounds.Dy()

	// Calculate scale to fit within bounds
	scaleX := float64(maxWidth) / float64(srcWidth)
	scaleY := float64(maxHeight) / float64(srcHeight)
	scale := scaleX
	if scaleY < scaleX {
		scale = scaleY
	}

	// Don't upscale small images
	if scale > 1 {
		scale = 1
	}

	newWidth := int(float64(srcWidth) * scale)
	newHeight := int(float64(srcHeight) * scale)

	// Create destination image
	dst := image.NewRGBA(image.Rect(0, 0, newWidth, newHeight))

	// Use high-quality resampling
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, srcBounds, draw.Over, nil)

	return dst
}

// handleListBackgrounds returns all background images and categories
func (r *Router) handleListBackgrounds(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	bgData, err := r.loadBackgroundData()
	if err != nil {
		writeJSONError(w, "Failed to load background data", http.StatusInternalServerError)
		return
	}

	// Also scan the backgrounds directory for any images not in metadata
	backgroundsDir := filepath.Join(r.config.DataDir, "backgrounds")
	if err := os.MkdirAll(backgroundsDir, 0755); err == nil {
		files, err := os.ReadDir(backgroundsDir)
		if err == nil {
			// Build a map of known URLs
			knownURLs := make(map[string]bool)
			for _, img := range bgData.Images {
				knownURLs[img.URL] = true
			}

			// Add any files not in metadata
			orphanCount := 0
			for _, file := range files {
				if file.IsDir() {
					continue
				}
				filename := file.Name()
				ext := strings.ToLower(filepath.Ext(filename))
				if ext == ".jpg" || ext == ".jpeg" || ext == ".png" || ext == ".gif" || ext == ".webp" {
					url := "/backgrounds/" + filename
					if !knownURLs[url] {
						orphanCount++
						// Use a friendly display name for orphan files
						displayName := fmt.Sprintf("Uploaded Image %d", orphanCount)
						bgData.Images = append(bgData.Images, BackgroundImage{
							ID:       strings.TrimSuffix(filename, ext),
							Name:     displayName,
							URL:      url,
							Category: "uploaded",
							Source:   "uploaded",
						})
					}
				}
			}
		}
	}

	writeJSON(w, bgData)
}

// handleUpdateBackgroundImage updates metadata for a background image
func (r *Router) handleUpdateBackgroundImage(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPut {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	imageID := req.URL.Path[len("/api/backgrounds/"):]
	if imageID == "" {
		writeJSONError(w, "Image ID required", http.StatusBadRequest)
		return
	}

	var update struct {
		Name     string `json:"name"`
		Category string `json:"category"`
	}
	if err := json.NewDecoder(req.Body).Decode(&update); err != nil {
		writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	bgData, err := r.loadBackgroundData()
	if err != nil {
		writeJSONError(w, "Failed to load background data", http.StatusInternalServerError)
		return
	}

	found := false
	for i, img := range bgData.Images {
		if img.ID == imageID {
			if update.Name != "" {
				bgData.Images[i].Name = update.Name
			}
			if update.Category != "" {
				bgData.Images[i].Category = update.Category
			}
			found = true
			break
		}
	}

	if !found {
		writeJSONError(w, "Image not found", http.StatusNotFound)
		return
	}

	if err := r.saveBackgroundData(bgData); err != nil {
		writeJSONError(w, "Failed to save background data", http.StatusInternalServerError)
		return
	}

	writeJSONSuccess(w)
}

// handleDeleteBackground deletes an uploaded background image
func (r *Router) handleDeleteBackground(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodDelete {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	imageID := req.URL.Path[len("/api/backgrounds/"):]
	if imageID == "" {
		writeJSONError(w, "Image ID required", http.StatusBadRequest)
		return
	}

	bgData, err := r.loadBackgroundData()
	if err != nil {
		writeJSONError(w, "Failed to load background data", http.StatusInternalServerError)
		return
	}

	// Find the image in metadata
	var imageToDelete *BackgroundImage
	imageIndex := -1
	for i, img := range bgData.Images {
		if img.ID == imageID {
			imageToDelete = &bgData.Images[i]
			imageIndex = i
			break
		}
	}

	// If not in metadata, check for orphan file on disk (file exists but not tracked)
	if imageToDelete == nil {
		backgroundsDir := filepath.Join(r.config.DataDir, "backgrounds")
		extensions := []string{".png", ".jpg", ".jpeg", ".gif", ".webp"}
		for _, ext := range extensions {
			filePath := filepath.Join(backgroundsDir, imageID+ext)
			if _, err := os.Stat(filePath); err == nil {
				if err := os.Remove(filePath); err != nil {
					writeJSONError(w, "Failed to delete file", http.StatusInternalServerError)
					return
				}
				writeJSONSuccess(w)
				return
			}
		}
		writeJSONError(w, "Image not found", http.StatusNotFound)
		return
	}

	// Only delete uploaded images from disk
	if imageToDelete.Source == "uploaded" && strings.HasPrefix(imageToDelete.URL, "/backgrounds/") {
		filename := filepath.Base(imageToDelete.URL)
		backgroundsDir := filepath.Join(r.config.DataDir, "backgrounds")
		filePath := filepath.Join(backgroundsDir, filename)

		if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
			slog.Warn("failed to delete file", "component", "backgrounds", "path", filePath, "error", err)
		}
	}

	// Remove from metadata
	bgData.Images = append(bgData.Images[:imageIndex], bgData.Images[imageIndex+1:]...)
	if err := r.saveBackgroundData(bgData); err != nil {
		writeJSONError(w, "Failed to save background data", http.StatusInternalServerError)
		return
	}

	writeJSONSuccess(w)
}

// handleBackgroundCategories handles category CRUD operations
func (r *Router) handleBackgroundCategories(w http.ResponseWriter, req *http.Request) {
	bgData, err := r.loadBackgroundData()
	if err != nil {
		writeJSONError(w, "Failed to load background data", http.StatusInternalServerError)
		return
	}

	switch req.Method {
	case http.MethodGet:
		writeJSON(w, bgData.Categories)

	case http.MethodPost:
		var newCat BackgroundCategory
		if err := json.NewDecoder(req.Body).Decode(&newCat); err != nil {
			writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		// Generate ID if not provided
		if newCat.ID == "" {
			randomBytes := make([]byte, 8)
			if _, err := rand.Read(randomBytes); err != nil {
				writeJSONError(w, "Failed to generate ID", http.StatusInternalServerError)
				return
			}
			newCat.ID = hex.EncodeToString(randomBytes)
		}

		bgData.Categories = append(bgData.Categories, newCat)
		if err := r.saveBackgroundData(bgData); err != nil {
			writeJSONError(w, "Failed to save background data", http.StatusInternalServerError)
			return
		}

		writeJSON(w, newCat)

	default:
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleBackgroundCategoryActions handles individual category operations
func (r *Router) handleBackgroundCategoryActions(w http.ResponseWriter, req *http.Request) {
	categoryID := req.URL.Path[len("/api/backgrounds/categories/"):]
	if categoryID == "" {
		writeJSONError(w, "Category ID required", http.StatusBadRequest)
		return
	}

	bgData, err := r.loadBackgroundData()
	if err != nil {
		writeJSONError(w, "Failed to load background data", http.StatusInternalServerError)
		return
	}

	switch req.Method {
	case http.MethodPut:
		var update BackgroundCategory
		if err := json.NewDecoder(req.Body).Decode(&update); err != nil {
			writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		found := false
		for i, cat := range bgData.Categories {
			if cat.ID == categoryID {
				if update.Name != "" {
					bgData.Categories[i].Name = update.Name
				}
				if update.Icon != "" {
					bgData.Categories[i].Icon = update.Icon
				}
				found = true
				break
			}
		}

		if !found {
			writeJSONError(w, "Category not found", http.StatusNotFound)
			return
		}

		if err := r.saveBackgroundData(bgData); err != nil {
			writeJSONError(w, "Failed to save background data", http.StatusInternalServerError)
			return
		}

		writeJSONSuccess(w)

	case http.MethodDelete:
		// Don't allow deleting default categories
		defaultIDs := map[string]bool{
			"network": true, "servers": true, "docker": true, "homelab": true,
			"smarthome": true, "apps": true, "multimedia": true, "weather": true,
			"storage": true, "tech": true, "space": true, "minimal": true, "uploaded": true,
		}
		if defaultIDs[categoryID] {
			writeJSONError(w, "Cannot delete default category", http.StatusBadRequest)
			return
		}

		found := false
		for i, cat := range bgData.Categories {
			if cat.ID == categoryID {
				bgData.Categories = append(bgData.Categories[:i], bgData.Categories[i+1:]...)
				found = true
				break
			}
		}

		if !found {
			writeJSONError(w, "Category not found", http.StatusNotFound)
			return
		}

		// Move images in this category to "uploaded"
		for i, img := range bgData.Images {
			if img.Category == categoryID {
				bgData.Images[i].Category = "uploaded"
			}
		}

		if err := r.saveBackgroundData(bgData); err != nil {
			writeJSONError(w, "Failed to save background data", http.StatusInternalServerError)
			return
		}

		writeJSONSuccess(w)

	default:
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleBackups handles listing backups and creating new ones
func (r *Router) handleBackups(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		// List all backups
		backups, err := r.backupManager.ListBackups()
		if err != nil {
			slog.Error("failed to list backups", "component", "backup", "error", err)
			writeJSONError(w, "Failed to list backups", http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]interface{}{
			"backups": backups,
		})

	case http.MethodPost:
		// Create a manual backup
		var reqData struct {
			Reason string `json:"reason"`
		}
		if err := json.NewDecoder(req.Body).Decode(&reqData); err != nil {
			reqData.Reason = "manual"
		}
		if reqData.Reason == "" {
			reqData.Reason = "manual"
		}

		backupPath, err := r.backupManager.CreateBackupWithDB(r.db, reqData.Reason)
		if err != nil {
			slog.Error("failed to create backup", "component", "backup", "error", err)
			writeJSONError(w, "Failed to create backup", http.StatusInternalServerError)
			return
		}

		writeJSON(w, map[string]interface{}{
			"success": true,
			"path":    backupPath,
			"message": "Backup created successfully",
		})

	default:
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleBackupActions handles restore and delete operations on individual backups
func (r *Router) handleBackupActions(w http.ResponseWriter, req *http.Request) {
	backupName := filepath.Base(req.URL.Path)
	if backupName == "" || backupName == "backups" {
		writeJSONError(w, "Backup name required", http.StatusBadRequest)
		return
	}

	switch req.Method {
	case http.MethodPost:
		// Restore from backup
		if err := r.backupManager.RestoreBackup(backupName); err != nil {
			slog.Error("failed to restore backup", "component", "backup", "error", err)
			writeJSONError(w, "Failed to restore backup", http.StatusInternalServerError)
			return
		}

		writeJSON(w, map[string]interface{}{
			"success":    true,
			"restarting": true,
			"message":    "Backup restored. The server is restarting — it should be back in a few seconds.",
		})

		// Restoring a SQLite file under an open connection leaves the
		// running process with a stale view (the WAL/shm files no
		// longer match the new main file). Schedule a graceful
		// shutdown 1 s after the response flushes; the service manager
		// (systemd / docker compose / launchd) auto-restarts the
		// process, which re-runs runMigrations() on the now-restored
		// DB and resumes cleanly. Documented requirement: the unit /
		// compose service has Restart=on-failure or similar.
		go func() {
			time.Sleep(1 * time.Second)
			slog.Info("triggering shutdown after backup restore",
				"component", "backup", "name", backupName)
			r.RequestShutdown()
		}()

	case http.MethodDelete:
		// Delete a backup
		if err := r.backupManager.DeleteBackup(backupName); err != nil {
			if strings.Contains(err.Error(), "not found") {
				writeJSONError(w, "Backup not found", http.StatusNotFound)
			} else if strings.Contains(err.Error(), "invalid") {
				writeJSONError(w, "Invalid backup name", http.StatusBadRequest)
			} else {
				slog.Error("failed to delete backup", "component", "backup", "error", err)
				writeJSONError(w, "Failed to delete backup", http.StatusInternalServerError)
			}
			return
		}

		writeJSON(w, map[string]interface{}{
			"success": true,
			"message": "Backup deleted successfully",
		})

	default:
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
