package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
	"time"

	_ "image/gif"
	_ "image/jpeg"

	"github.com/weaversgrainthorpe/HOPS/internal/assets"
	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
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

// handleConfig serves GET /api/config (public). There is no whole-config
// write: dashboards are written one at a time (PUT/POST/DELETE
// /api/dashboards...), and import and restore have their own endpoints.
func (r *Router) handleConfig(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	r.handleGetConfig(w, req)
}

// handleGetConfig returns the stored v3 document as {schemaVersion,
// dashboards, migrationNotices?, notices?}. It is public (all dashboards are public,
// SECURITY.md), so it carries the dashboards' own content and nothing else
// from the stored document. Every dashboard's revision must be readable: a
// client saves against it, so an unreadable one is a visible 500, never a
// silent 0.
func (r *Router) handleGetConfig(w http.ResponseWriter, req *http.Request) {
	if !r.migrationGuard(w) {
		return
	}
	stored, err := configdoc.Load(r.db)
	if err != nil {
		writeAPIError(w, loadErr(err))
		return
	}
	for id, d := range storedDashboards(stored) {
		if _, rerr := storedRevision(id, d); rerr != nil {
			writeAPIError(w, rerr)
			return
		}
	}
	view := r.publicDoc(stored)
	if len(r.migration.Renames) > 0 {
		view["migrationNotices"] = migrationNotices(r.migration.Renames, stored)
	}
	// One-time notices (notices.go), like migrationNotices only when any;
	// backup problems first, and only for a signed-in admin (backup_notices.go).
	adminNotices := r.backupNotices(req)
	if r.isAdminRequest(req) {
		if n, ok := r.iconLeftoverNotice(); ok {
			adminNotices = append(adminNotices, n)
		}
	}
	if len(adminNotices) > 0 {
		// Admin-only content: never stored by a shared cache or the service
		// worker (which skips no-store responses), and varies by session.
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Add("Vary", "Cookie, Authorization")
	}
	if ns := append(adminNotices, r.currentNotices(stored)...); len(ns) > 0 {
		view["notices"] = ns
	}
	writeJSON(w, view)
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

	lifetimeHours := r.settings.GetInt(settings.KeyAuthSessionLifetimeHours)
	result, err := r.authService.Login(credentials.Username, credentials.Password, lifetimeHours)
	if err != nil {
		writeJSONError(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	secure := r.isSecureRequest(req)
	maxAge := lifetimeHours * 3600
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

	// Checks switched off for the tile: say so explicitly rather than
	// "unknown", so the badge shows "checks off", not "something's wrong".
	// On/off follows the same layered rule as the checker (the most
	// specific level that sets it wins) and the response names that level
	// (source, sourceId). The config must be readable to know that; if it
	// isn't, say so instead of guessing.
	doc, err := configdoc.Load(r.db)
	if err != nil {
		slog.Error("status lookup: cannot load config", "component", "api", "error", err)
		writeJSONError(w, "Config unavailable", http.StatusServiceUnavailable)
		return
	}
	// The tile's resolved settings (global values when the tile isn't in
	// the config). intervalMinutes lets the UI judge staleness against the
	// real probe interval rather than a guessed default.
	dash, tab, folders, tile, found := configdoc.FindTileWithAncestors(doc, entryID)
	eff := configdoc.Resolve(r.settings, dash)
	on, source, sourceID := configdoc.EffectiveStatusChecks(r.settings, dash, tab, folders, tile)
	if found && !on {
		writeJSON(w, map[string]string{"status": "disabled", "source": string(source), "sourceId": sourceID})
		return
	}

	var status string
	var responseTime sql.NullInt64
	var lastChecked string

	err = r.db.QueryRow(
		"SELECT status, response_time, last_checked FROM status_cache WHERE entry_id = ?",
		entryID,
	).Scan(&status, &responseTime, &lastChecked)

	if err == sql.ErrNoRows {
		// No cached status
		writeJSON(w, map[string]interface{}{
			"status":          "unknown",
			"intervalMinutes": eff.StatusCheckIntervalMinutes,
			"source":          string(source),
			"sourceId":        sourceID,
		})
		return
	}

	if err != nil {
		writeJSONError(w, "Database error", http.StatusInternalServerError)
		return
	}

	result := map[string]interface{}{
		"status":          status,
		"lastChecked":     lastChecked,
		"intervalMinutes": eff.StatusCheckIntervalMinutes,
		"source":          string(source),
		"sourceId":        sourceID,
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

	// v3 documents: folders and tiles nest arbitrarily deep.
	configdoc.Walk(cfg, func(_, _ configdoc.Obj, _ []configdoc.Obj, node configdoc.Obj) bool {
		if iconURL, ok := node["iconUrl"].(string); ok && isLocalAssetRef(iconURL) {
			refs[iconURL] = true
		}
		if bg, ok := node["background"]; ok {
			collectBackgroundRefs(bg, refs)
		}
		return true
	})

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
func (r *Router) restoreAssets(importedConfig map[string]interface{}) (int, []string) {
	assetsRaw, ok := importedConfig["assets"]
	if !ok {
		return 0, nil
	}
	assetsMap, ok := assetsRaw.(map[string]interface{})
	if !ok {
		return 0, []string{"assets: field is not an object, no assets restored"}
	}

	restored := 0
	var failed []string
	fail := func(urlPath, reason string, err error) {
		slog.Warn("failed to restore asset", "component", "import", "path", urlPath, "reason", reason, "error", err)
		if err != nil {
			reason += ": " + err.Error()
		}
		failed = append(failed, urlPath+" ("+reason+")")
	}
	keys := make([]string, 0, len(assetsMap))
	for k := range assetsMap {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, urlPath := range keys {
		assetMap, ok := assetsMap[urlPath].(map[string]interface{})
		if !ok {
			fail(urlPath, "entry is not an object", nil)
			continue
		}
		dataStr, _ := assetMap["data"].(string)
		if dataStr == "" {
			fail(urlPath, "no data", nil)
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
			fail(urlPath, "invalid base64", err)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(diskPath), 0755); err != nil {
			fail(urlPath, "could not create directory", err)
			continue
		}
		if err := os.WriteFile(diskPath, fileData, 0644); err != nil {
			fail(urlPath, "could not write file", err)
			continue
		}

		restored++
		slog.Debug("restored asset", "component", "import", "url", urlPath, "path", diskPath)
	}
	return restored, failed
}

// handleExportConfig exports configuration as YAML/JSON inside the v3 export
// envelope. The envelope has no top-level "dashboards" key on purpose, so an
// older (v2.x) HOPS rejects the file instead of misreading v3 data as v2.
// Supports optional dashboardId query parameter to export a single dashboard.
func (r *Router) handleExportConfig(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !r.migrationGuard(w) {
		return
	}

	cfg, err := configdoc.Load(r.db)
	if err != nil {
		slog.Error("export: stored config unreadable", "component", "export", "error", err)
		writeJSONError(w, "Stored configuration could not be read, so nothing was exported: "+err.Error(), http.StatusInternalServerError)
		return
	}
	stored := cfg // the whole document; cfg may be narrowed to one dashboard below

	dashboardId := req.URL.Query().Get("dashboardId")
	format := req.URL.Query().Get("format")
	filename := "hops-config"
	exportType := "full"

	// If a specific dashboard is requested, filter the config
	if dashboardId != "" {
		target, ok := storedDashboards(cfg)[dashboardId]
		if !ok {
			writeJSONError(w, "Dashboard not found", http.StatusNotFound)
			return
		}
		cfg = configdoc.Obj{"dashboards": []interface{}{target}}
		exportType = "single-dashboard"
		if name, _ := target["name"].(string); name != "" {
			filename = "hops-" + strings.ToLower(strings.ReplaceAll(name, " ", "-"))
		}
	}

	// The layout-form marker travels in config.layoutVersion (also for a
	// single-dashboard export), so an import can refuse any other form. A
	// stored document at another version would be mislabelled, so refuse
	// (start-up already blocks one; this never stamps a guess).
	if lerr := configdoc.CheckLayoutVersion(stored); lerr != nil {
		slog.Error("export: stored config is not in this build's layout form", "component", "export", "error", lerr)
		writeJSONError(w, "Stored configuration is not in this build's layout form, so nothing was exported: "+lerr.Error(), http.StatusInternalServerError)
		return
	}
	cfg[configdoc.LayoutVersionKey] = configdoc.LayoutVersion

	// Embed local asset files (icons, backgrounds) as base64 for portability
	assetCount := r.embedAssets(cfg)
	if assetCount > 0 {
		slog.Info("embedded assets in export", "component", "export", "count", assetCount)
	}

	envelope := map[string]interface{}{
		"format":        "hops-export",
		"schemaVersion": configdoc.SchemaVersion,
		"exportedAt":    time.Now().Format(time.RFC3339),
		"exportType":    exportType,
		"config":        cfg,
	}

	// Serialize the final config
	exportData, err := json.MarshalIndent(envelope, "", "  ")
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

	// A safety backup first; without one the reset is refused (nothing is
	// changed), never done regardless.
	if r.backupManager != nil {
		if _, err := r.backupManager.CreateBackupWithDB(r.db, "pre-factory-reset"); err != nil {
			slog.Error("factory reset refused: pre-factory-reset backup failed", "component", "backup", "error", err)
			writeJSONError(w, "Couldn't take a safety backup first, so nothing was reset: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	if err := database.ResetConfig(r.db); err != nil {
		slog.Error("factory reset failed; stored config left untouched", "component", "api", "error", err)
		writeJSONError(w, "Failed to reset configuration (nothing was changed): "+err.Error(), http.StatusInternalServerError)
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

// applyIconMatching matches icons for the tiles of the given (v3) dashboards.
// Pre-loads all icons once to avoid N+1 database queries.
func (r *Router) applyIconMatching(dashboards []configdoc.Obj) (int, error) {
	icons, err := r.loadAllIcons()
	if err != nil {
		slog.Error("failed to load icons for matching", "component", "icons", "error", err)
		return 0, err
	}
	list := make([]any, len(dashboards))
	for i, d := range dashboards {
		list[i] = d
	}
	matchCount := 0
	configdoc.Walk(configdoc.Obj{"dashboards": list}, func(_, _ configdoc.Obj, _ []configdoc.Obj, entry configdoc.Obj) bool {
		if entry["kind"] != "tile" {
			return true
		}
		// Skip tiles that already have a non-generic icon.
		existingIcon, _ := entry["icon"].(string)
		existingIconUrl, _ := entry["iconUrl"].(string)
		if existingIconUrl != "" || (existingIcon != "" && existingIcon != "mdi:application" && existingIcon != "mdi:link" && !strings.HasPrefix(existingIcon, "mdi:help")) {
			return true
		}
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
		return true
	})
	return matchCount, nil
}

const importUnreadableMsg = "Existing configuration could not be read — import refused so nothing is overwritten"

// decodeEnvelopeConfig decodes a v3 export envelope (JSON or YAML) and
// returns its "config" object.
func decodeEnvelopeConfig(data []byte) (configdoc.Obj, error) {
	var env struct {
		Config configdoc.Obj `json:"config"`
	}
	if err := json.Unmarshal(data, &env); err != nil {
		var generic interface{}
		if yerr := yaml.Unmarshal(data, &generic); yerr != nil {
			return nil, fmt.Errorf("could not parse the export file: %w", yerr)
		}
		b, jerr := json.Marshal(generic)
		if jerr != nil {
			return nil, fmt.Errorf("could not read the export file: %w", jerr)
		}
		env.Config = nil
		if jerr := json.Unmarshal(b, &env); jerr != nil {
			return nil, fmt.Errorf("could not read the export file: %w", jerr)
		}
	}
	if env.Config == nil {
		return nil, fmt.Errorf("the export file has no \"config\" object")
	}
	return env.Config, nil
}

// collectIDs returns every node id (dashboards, tabs, folders, tiles) in doc.
func collectIDs(doc configdoc.Obj) map[string]bool {
	used := map[string]bool{}
	note := func(o configdoc.Obj) {
		if id, ok := o["id"].(string); ok && id != "" {
			used[id] = true
		}
	}
	for _, d := range storedDashboards(doc) {
		note(d)
		tabs, _ := d["tabs"].([]any)
		for _, t := range tabs {
			if tm, ok := t.(configdoc.Obj); ok {
				note(tm)
			}
		}
	}
	configdoc.Walk(doc, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		note(n)
		return true
	})
	return used
}

// makeIDsUnique renames, with a numeric suffix, every id in dashboard d that is
// already in used (or repeats within d), and records all of d's ids in used.
// Ids are unique across the whole document, so a re-import must not collide.
func makeIDsUnique(d configdoc.Obj, used map[string]bool) {
	uniq := func(o configdoc.Obj) {
		id, ok := o["id"].(string)
		if !ok || id == "" {
			return // the final structural check reports it
		}
		cand := id
		for n := 1; used[cand]; n++ {
			cand = fmt.Sprintf("%s-%d", id, n)
		}
		o["id"] = cand
		used[cand] = true
	}
	uniq(d)
	tabs, _ := d["tabs"].([]any)
	for _, t := range tabs {
		if tm, ok := t.(configdoc.Obj); ok {
			uniq(tm)
		}
	}
	configdoc.Walk(configdoc.Obj{"dashboards": []any{d}}, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		uniq(n)
		return true
	})
}

// verifyProblems flattens a *VerifyError into one line.
func verifyProblems(err error) string {
	var ve *configdoc.VerifyError
	if errors.As(err, &ve) {
		return strings.Join(ve.Problems, "; ")
	}
	return err.Error()
}

func dashboardLabel(d configdoc.Obj) string {
	if n, _ := d["name"].(string); n != "" {
		return n
	}
	if id, _ := d["id"].(string); id != "" {
		return id
	}
	return "(unnamed)"
}

// handleImportConfig imports configuration from YAML/JSON (supports HOPS v2
// and v3 exports, Homer, Dashy and Heimdall). Imported dashboards are appended
// to the stored v3 document in one transaction.
func (r *Router) handleImportConfig(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !r.migrationGuard(w) {
		return
	}

	// Cap the upload at the upload.max_bytes_import admin setting; an
	// oversize file is refused naming the limit and its size (M5 §10).
	file, _, ok := r.readLimitedUpload(w, req, uploadImport)
	if !ok {
		return
	}
	defer file.Close()

	// Check if auto-match icons is requested
	autoMatchIcons := req.FormValue("autoMatchIcons") == "true"

	// Read entire file into memory
	fileData, err := io.ReadAll(file)
	if err != nil {
		writeJSONError(w, "Failed to read file", http.StatusInternalServerError)
		return
	}

	// Detect the format
	format, err := converters.DetectFormat(fileData)
	if err != nil {
		slog.Warn("import: format detection failed", "component", "import", "error", err)
		writeJSONError(w, "Could not detect the file format. Supported: HOPS, Homer, Dashy, Heimdall.", http.StatusBadRequest)
		return
	}

	var importedConfig configdoc.Obj // top level of the imported data (theme, settings, assets)
	var importFormat string

	if format == "hops-v3" {
		importedConfig, err = decodeEnvelopeConfig(fileData)
		if err != nil {
			slog.Warn("import: v3 export unreadable", "component", "import", "error", err)
			writeJSONError(w, "Invalid HOPS export: "+err.Error(), http.StatusBadRequest)
			return
		}
		importFormat = "HOPS v3 export"
	} else {
		var configJSON []byte
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
		if err := json.Unmarshal(configJSON, &importedConfig); err != nil {
			writeJSONError(w, "Invalid configuration after conversion: "+err.Error(), http.StatusBadRequest)
			return
		}
	}

	rawDashboards, ok := importedConfig["dashboards"].([]interface{})
	if !ok {
		writeJSONError(w, "Invalid config: missing 'dashboards' field", http.StatusBadRequest)
		return
	}

	// A v3 export is imported only in this build's layout form (M5 spec
	// §2a): there is no conversion of other v3 forms, so any other
	// layoutVersion (or none: a pre-release export) is refused, naming both.
	if format == "hops-v3" {
		if lerr := configdoc.CheckLayoutVersion(importedConfig); lerr != nil {
			writeJSONError(w, "Import refused — this HOPS export cannot be imported: "+lerr.Error()+". Import a v2 export or one made by this HOPS version instead.", http.StatusBadRequest)
			return
		}
	}

	// Bring every imported dashboard to the v3 shape.
	var imported []configdoc.Obj
	var sizeChanges []importedSizes // tiles whose unknown size became Medium (Ruling 3)
	var skipped []string
	for i, raw := range rawDashboards {
		d, ok := raw.(configdoc.Obj)
		if !ok {
			skipped = append(skipped, fmt.Sprintf("dashboards[%d] is not an object", i))
			continue
		}
		if p, ok := d["path"].(string); ok {
			if why := dashboardPathProblem(p); why != "" {
				writeJSONError(w, fmt.Sprintf("Import refused — dashboard %q has an unsafe path: the path %s", dashboardLabel(d), why), http.StatusBadRequest)
				return
			}
		}
		if format == "hops-v3" {
			// Response-only keys (e.g. the computed `display`) are never
			// dashboard content: drop them, as a PUT does.
			for k := range transientDashboardKeys {
				delete(d, k)
			}
			// New to this install: revision restarts at 1; settings are kept.
			d["revision"] = 1
			if verr := configdoc.VerifyImportedDashboard(d); verr != nil {
				writeJSONError(w, fmt.Sprintf("Import refused — dashboard %q is malformed: %s", dashboardLabel(d), verifyProblems(verr)), http.StatusBadRequest)
				return
			}
			imported = append(imported, d)
			continue
		}
		v3, sizes, err := configdoc.ConvertDashboardV2Full(d)
		if err != nil {
			writeJSONError(w, fmt.Sprintf("Import refused — dashboard %q could not be converted: %v", dashboardLabel(d), err), http.StatusBadRequest)
			return
		}
		// The converter writes the current layout form directly, so the
		// converted dashboard is checked as part of a marked document.
		// A tile size HOPS does not recognise became Medium (Ruling 3): the
		// verifier accepts exactly those reported changes.
		verr := configdoc.VerifyMigrationFull(
			configdoc.Obj{"dashboards": []any{d}},
			configdoc.Obj{"schemaVersion": configdoc.SchemaVersion, configdoc.LayoutVersionKey: configdoc.LayoutVersion, "dashboards": []any{v3}},
			nil, sizes,
		)
		if verr != nil {
			var ve *configdoc.VerifyError
			msg := verr.Error()
			if errors.As(verr, &ve) {
				msg = strings.Join(ve.Problems, "; ")
			}
			writeJSONError(w, fmt.Sprintf("Import refused — dashboard %q did not convert cleanly: %s", dashboardLabel(d), msg), http.StatusBadRequest)
			return
		}
		imported = append(imported, v3)
		if len(sizes) > 0 {
			sizeChanges = append(sizeChanges, importedSizes{dash: v3, changes: sizes})
		}
	}
	if len(imported) == 0 {
		msg := "No dashboards found in the import file"
		if len(skipped) > 0 {
			msg += " (skipped: " + strings.Join(skipped, "; ") + ")"
		}
		writeJSONError(w, msg, http.StatusBadRequest)
		return
	}

	warning := r.preUpdateBackup()

	var iconMatchCount, assetsRestored int
	var iconErr error
	var assetsFailed []string
	var names []string
	// Icon matching only touches the imported dashboards, so it runs before the
	// transaction opens (it reads the icons table through r.db).
	if autoMatchIcons {
		iconMatchCount, iconErr = r.applyIconMatching(imported)
		slog.Info("icon matching complete", "component", "import", "matched", iconMatchCount, "error", iconErr)
	}

	var sizeItems []string
	r.updateDocWithLoadErr(w, func(err error) *apiError {
		slog.Error("import: stored config unreadable", "component", "import", "error", err)
		return newAPIError(http.StatusInternalServerError, importUnreadableMsg)
	}, func(stored configdoc.Obj) (configdoc.Obj, interface{}, error) {
		// Imported dashboards are in this build's layout form; never merge
		// them into a document that is not (start-up refuses one anyway).
		if lerr := configdoc.CheckLayoutVersion(stored); lerr != nil {
			slog.Error("import: stored config is not in this build's layout form", "component", "import", "error", lerr)
			return nil, nil, newAPIError(http.StatusInternalServerError, "Stored configuration is not in this build's layout form — import refused so nothing is mixed: "+lerr.Error())
		}
		existing, _ := stored["dashboards"].([]any)
		existingPaths := map[string]bool{}
		for _, d := range existing {
			if dm, ok := d.(configdoc.Obj); ok {
				if p, ok := dm["path"].(string); ok {
					existingPaths[normPath(p)] = true // "x" and "/x" route alike
				}
			}
		}
		used := collectIDs(stored)
		for id := range configdoc.ReservedDashboardIDs { // never import a dashboard onto a collection route
			used[id] = true
		}

		// Append imported dashboards, renaming paths (and ids) if they conflict
		for _, d := range imported {
			path, _ := d["path"].(string)
			originalPath := path
			suffix := 1
			for existingPaths[normPath(path)] {
				path = fmt.Sprintf("%s-%d", originalPath, suffix)
				suffix++
			}
			if path != originalPath {
				d["path"] = path
				d["id"] = strings.TrimPrefix(path, "/")
				if name, ok := d["name"].(string); ok {
					d["name"] = fmt.Sprintf("%s (Imported)", name)
				}
			}
			existingPaths[normPath(path)] = true
			makeIDsUnique(d, used)
			existing = append(existing, d)
			names = append(names, dashboardLabel(d))
		}
		stored["dashboards"] = existing

		// Preserve theme and settings from existing config, or use imported if not present
		for _, k := range []string{"theme", "settings"} {
			if _, has := stored[k]; !has {
				if v, ok := importedConfig[k]; ok {
					stored[k] = v
				}
			}
		}
		delete(stored, "assets") // transport-only field

		// The merged document must be well-formed with document-wide unique ids.
		stored["schemaVersion"] = configdoc.SchemaVersion
		if err := configdoc.VerifyIDs(stored); err != nil {
			var ve *configdoc.VerifyError
			msg := err.Error()
			if errors.As(err, &ve) {
				msg = strings.Join(ve.Problems, "; ")
			}
			return nil, nil, newAPIError(http.StatusBadRequest, "Import refused — the merged configuration would be invalid: "+msg)
		}

		// Restore embedded assets (icons, backgrounds) from import
		assetsRestored, assetsFailed = r.restoreAssets(importedConfig)

		message := fmt.Sprintf("Imported %d dashboard(s) from %s format: %s", len(names), importFormat, strings.Join(names, ", "))
		sizeItems = nil
		for _, ic := range sizeChanges {
			// Named after the merge, so a renamed dashboard is named as stored.
			sizeItems = append(sizeItems, sizeNoteItems(withDashID(ic.changes, ic.dash), configdoc.Obj{"dashboards": []any{ic.dash}})...)
		}
		if len(sizeItems) > 0 {
			message += fmt.Sprintf(". %d tile(s) had a size HOPS does not recognise and are now Medium: %s", len(sizeItems), strings.Join(sizeItems, "; "))
		}
		if len(skipped) > 0 {
			message += fmt.Sprintf(". Skipped %d item(s): %s", len(skipped), strings.Join(skipped, "; "))
		}
		if iconMatchCount > 0 {
			message += fmt.Sprintf(", matched %d icon(s)", iconMatchCount)
		}
		if assetsRestored > 0 {
			message += fmt.Sprintf(", restored %d asset file(s)", assetsRestored)
		}
		if iconErr != nil {
			message += ". Icon auto-matching skipped: " + iconErr.Error()
		}
		if len(assetsFailed) > 0 {
			message += fmt.Sprintf(". %d asset(s) could not be restored: %s", len(assetsFailed), strings.Join(assetsFailed, "; "))
		}
		if assetsFailed == nil {
			assetsFailed = []string{}
		}
		resp := map[string]interface{}{
			"success":        true,
			"assetsFailed":   assetsFailed,
			"message":        message,
			"imported":       len(names),
			"dashboards":     names,
			"skipped":        skipped,
			"iconsMatched":   iconMatchCount,
			"assetsRestored": assetsRestored,
		}
		if iconErr != nil {
			resp["iconMatchError"] = iconErr.Error()
		}
		if warning != "" {
			resp["warning"] = warning
		}
		return stored, resp, nil
	}, func() {
		// Committed: the one-time notice lists these tiles until dismissed.
		r.sizeNotes.add(sizeItems...)
	})
}

// importedSizes pairs an imported dashboard with its normalised tile sizes.
type importedSizes struct {
	dash    configdoc.Obj
	changes []configdoc.SizeChange
}

// withDashID returns changes with DashboardID set to dash's (current) id.
func withDashID(changes []configdoc.SizeChange, dash configdoc.Obj) []configdoc.SizeChange {
	id, _ := dash["id"].(string)
	out := make([]configdoc.SizeChange, len(changes))
	for i, c := range changes {
		c.DashboardID = id
		out[i] = c
	}
	return out
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

	// Cap the upload at the upload.max_bytes_background admin setting; an
	// oversize file is refused naming the limit and its size (M5 §10).
	file, header, ok := r.readLimitedUpload(w, req, uploadBackground)
	if !ok {
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

	// Cap the upload at the upload.max_bytes_icon admin setting; an
	// oversize file is refused naming the limit and its size (M5 §10).
	file, header, ok := r.readLimitedUpload(w, req, uploadIcon)
	if !ok {
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

	// With a categoryId (Settings › Icons, the icon editor) the upload is also
	// registered as the user's icon in one step: checked before the file is
	// written, and the file is removed again if the row can't be stored, so
	// an upload is never left half-done.
	categoryID := req.FormValue("categoryId")
	iconName := ""
	if categoryID != "" {
		ok, err := r.categoryExists(r.db, categoryID)
		if err != nil {
			writeJSONError(w, "Failed to check the category", http.StatusInternalServerError)
			return
		}
		if !ok {
			writeJSONError(w, "That category doesn't exist", http.StatusBadRequest)
			return
		}
		raw := req.FormValue("name")
		if strings.TrimSpace(raw) == "" {
			raw = strings.TrimSuffix(filepath.Base(header.Filename), filepath.Ext(header.Filename))
			if utf8.RuneCountInString(raw) > maxIconNameLen {
				raw = string([]rune(raw)[:maxIconNameLen])
			}
			if strings.TrimSpace(raw) == "" {
				raw = "Uploaded icon"
			}
		}
		n, err := cleanDisplayName(raw, "The icon")
		if err != nil {
			writeJSONError(w, err.Error(), http.StatusBadRequest)
			return
		}
		iconName = n
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
		encErr := png.Encode(destFile, resized)
		closeErr := destFile.Close()
		if encErr != nil || closeErr != nil {
			_ = os.Remove(destPath)
			writeJSONError(w, "Failed to encode image", http.StatusInternalServerError)
			return
		}
	}

	// Return the URL path for the uploaded icon
	urlPath := "/icons/" + filename

	if categoryID == "" {
		writeJSON(w, map[string]interface{}{
			"success": true,
			"id":      iconID,
			"url":     urlPath,
		})
		return
	}
	if _, err := r.db.Exec(
		"INSERT INTO icons (id, name, icon, category_id, image_url, is_preset) VALUES (?, ?, '', ?, ?, 0)",
		iconID, iconName, categoryID, urlPath,
	); err != nil {
		if rerr := os.Remove(destPath); rerr != nil {
			slog.Warn("icon upload: could not remove the file after a failed save", "component", "icons", "path", destPath, "error", rerr)
		}
		writeJSONError(w, "The image was received but could not be saved as an icon", http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{
		"success":    true,
		"id":         iconID,
		"url":        urlPath,
		"name":       iconName,
		"categoryId": categoryID,
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

	// If not in metadata, check for orphan file on disk (file exists but not
	// tracked). Deleted files MOVE to the attic (M6 §12: a backup may still
	// refer to them); a failure refuses the delete, visibly.
	if imageToDelete == nil {
		backgroundsDir := filepath.Join(r.config.DataDir, "backgrounds")
		extensions := []string{".png", ".jpg", ".jpeg", ".gif", ".webp"}
		for _, ext := range extensions {
			name := imageID + ext
			if !database.ValidImageName(name) {
				break
			}
			if _, err := os.Lstat(filepath.Join(backgroundsDir, name)); err == nil {
				if _, err := r.backupManager.MoveToAttic("backgrounds", name); err != nil {
					slog.Error("background delete: could not move the file to the attic", "component", "backgrounds", "file", name, "error", err)
					writeJSONError(w, "Couldn't move the background's file aside, so it was not deleted: "+err.Error(), http.StatusInternalServerError)
					return
				}
				slog.Info("background deleted", "component", "backgrounds", "file", name)
				writeJSONSuccess(w)
				return
			}
		}
		writeJSONError(w, "Image not found", http.StatusNotFound)
		return
	}

	// Only uploaded images have a file of ours: it moves to the attic first,
	// and comes back if the metadata can't be saved.
	moved, movedSum := "", ""
	if imageToDelete.Source == "uploaded" && strings.HasPrefix(imageToDelete.URL, "/backgrounds/") {
		name := strings.TrimPrefix(imageToDelete.URL, "/backgrounds/")
		if database.ValidImageName(name) {
			if sum, err := r.backupManager.MoveToAttic("backgrounds", name); err != nil {
				if !errors.Is(err, os.ErrNotExist) {
					slog.Error("background delete: could not move the file to the attic", "component", "backgrounds", "file", name, "error", err)
					writeJSONError(w, "Couldn't move the background's file aside, so it was not deleted: "+err.Error(), http.StatusInternalServerError)
					return
				}
			} else {
				moved, movedSum = name, sum
			}
		}
	}

	// Remove from metadata
	bgData.Images = append(bgData.Images[:imageIndex], bgData.Images[imageIndex+1:]...)
	if err := r.saveBackgroundData(bgData); err != nil {
		msg := "Failed to save background data"
		if moved != "" {
			if rerr := r.backupManager.RestoreFromAttic("backgrounds", moved, movedSum); rerr != nil {
				slog.Error("background delete: could not put the file back", "component", "backgrounds", "file", moved, "error", rerr)
				msg += "; its file is in " + filepath.Join(r.backupManager.AtticDir(), "backgrounds") + " and couldn't be put back (" + rerr.Error() + ")"
			}
		}
		writeJSONError(w, msg, http.StatusInternalServerError)
		return
	}
	slog.Info("background deleted", "component", "backgrounds", "id", imageID)

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

