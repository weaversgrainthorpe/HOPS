package api

import (
	"bytes"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "image/gif"
	_ "image/jpeg"

	"github.com/weaversgrainthorpe/HOPS/internal/converters"
	"github.com/weaversgrainthorpe/HOPS/internal/version"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const bearerPrefix = "Bearer "

// extractSessionID extracts the session ID from the Authorization header,
// removing the "Bearer " prefix if present
func extractSessionID(req *http.Request) string {
	sessionID := req.Header.Get("Authorization")
	if strings.HasPrefix(sessionID, bearerPrefix) {
		return sessionID[len(bearerPrefix):]
	}
	return sessionID
}

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

	// Create automatic backup before modifying config
	if r.backupManager != nil {
		if _, err := r.backupManager.CreateBackupWithDB(r.db, "pre-config-update"); err != nil {
			log.Printf("[Backup] Warning: failed to create pre-update backup: %v", err)
			// Continue anyway - don't block the update
		}
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

// handleLogin authenticates a user with rate limiting
func (r *Router) handleLogin(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get client IP for rate limiting
	clientIP := getClientIP(req)
	if !r.rateLimiter.Allow(clientIP) {
		http.Error(w, "Too many login attempts. Please try again later.", http.StatusTooManyRequests)
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

// getClientIP extracts the client IP address from the request
func getClientIP(req *http.Request) string {
	// Check X-Forwarded-For header first (for reverse proxies)
	if xff := req.Header.Get("X-Forwarded-For"); xff != "" {
		// Take the first IP in the list
		if idx := strings.Index(xff, ","); idx != -1 {
			return strings.TrimSpace(xff[:idx])
		}
		return strings.TrimSpace(xff)
	}

	// Check X-Real-IP header
	if xri := req.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}

	// Fall back to RemoteAddr
	if idx := strings.LastIndex(req.RemoteAddr, ":"); idx != -1 {
		return req.RemoteAddr[:idx]
	}
	return req.RemoteAddr
}

// handleLogout logs out a user
func (r *Router) handleLogout(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	sessionID := extractSessionID(req)
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
	sessionID := extractSessionID(req)
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
// Supports optional dashboardId query parameter to export a single dashboard
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

	dashboardId := req.URL.Query().Get("dashboardId")
	format := req.URL.Query().Get("format")
	filename := "hops-config"

	// If a specific dashboard is requested, filter the config
	if dashboardId != "" {
		var cfg map[string]interface{}
		if err := json.Unmarshal([]byte(configData), &cfg); err != nil {
			http.Error(w, "Failed to parse config", http.StatusInternalServerError)
			return
		}

		// Find the specific dashboard
		dashboards, ok := cfg["dashboards"].([]interface{})
		if !ok {
			http.Error(w, "Invalid config structure", http.StatusInternalServerError)
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
			http.Error(w, "Dashboard not found", http.StatusNotFound)
			return
		}

		// Create a new config with only this dashboard
		// Mark it as a single-dashboard export so import can handle it appropriately
		singleExport := map[string]interface{}{
			"exportType":  "single-dashboard",
			"exportedAt":  time.Now().Format(time.RFC3339),
			"dashboards":  []interface{}{targetDashboard},
		}

		exportData, err := json.MarshalIndent(singleExport, "", "  ")
		if err != nil {
			http.Error(w, "Failed to serialize config", http.StatusInternalServerError)
			return
		}
		configData = string(exportData)

		// Use dashboard name for filename
		if dashboardName != "" {
			filename = "hops-" + strings.ToLower(strings.ReplaceAll(dashboardName, " ", "-"))
		}
	}

	if format == "yaml" {
		// TODO: Convert JSON to YAML
		w.Header().Set("Content-Type", "application/x-yaml")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s.yaml", filename))
	} else {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s.json", filename))
	}

	w.Write([]byte(configData))
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

// matchIconForName searches the icons database for a matching icon based on the service name
// Prioritizes icons with image_url (dashboard SVGs) over MDI-only icons
func (r *Router) matchIconForName(name string) (match IconMatch, found bool) {
	if name == "" {
		return IconMatch{}, false
	}

	// Normalize the name for matching (lowercase, trim)
	normalizedName := strings.ToLower(strings.TrimSpace(name))

	// Check brand aliases first - look for alias keywords in the name
	for alias, canonical := range brandAliases {
		if strings.Contains(normalizedName, alias) {
			// Try to find the canonical icon
			row := r.db.QueryRow(
				`SELECT icon, image_url, color FROM icons
				 WHERE LOWER(id) = ? OR LOWER(name) = ?
				 ORDER BY (image_url IS NOT NULL AND image_url != '') DESC
				 LIMIT 1`,
				canonical, canonical,
			)
			var iconVal, imageURLVal, colorVal sql.NullString
			if err := row.Scan(&iconVal, &imageURLVal, &colorVal); err == nil {
				if (iconVal.Valid && iconVal.String != "") || (imageURLVal.Valid && imageURLVal.String != "") {
					return IconMatch{
						Icon:     iconVal.String,
						ImageURL: imageURLVal.String,
						Color:    colorVal.String,
					}, true
				}
			}
		}
	}

	// Also create a version without spaces (for matching "HomeAssistant" to "Home Assistant")
	noSpaceName := strings.ReplaceAll(normalizedName, " ", "")
	noSpaceName = strings.ReplaceAll(noSpaceName, "-", "")
	noSpaceName = strings.ReplaceAll(noSpaceName, "_", "")

	// Helper to scan a row into IconMatch
	scanMatch := func(row *sql.Row) (IconMatch, bool) {
		var iconVal, imageURLVal, colorVal sql.NullString
		err := row.Scan(&iconVal, &imageURLVal, &colorVal)
		if err != nil {
			return IconMatch{}, false
		}
		// Return if we have either icon or image_url
		if (iconVal.Valid && iconVal.String != "") || (imageURLVal.Valid && imageURLVal.String != "") {
			return IconMatch{
				Icon:     iconVal.String,
				ImageURL: imageURLVal.String,
				Color:    colorVal.String,
			}, true
		}
		return IconMatch{}, false
	}

	// Try exact match first - prioritize icons with image_url (dashboard SVGs)
	row := r.db.QueryRow(
		`SELECT icon, image_url, color FROM icons
		 WHERE LOWER(name) = ? OR LOWER(id) = ?
		 ORDER BY (image_url IS NOT NULL AND image_url != '') DESC
		 LIMIT 1`,
		normalizedName, normalizedName,
	)
	if m, ok := scanMatch(row); ok {
		return m, true
	}

	// Try matching without spaces (handles "HomeAssistant" matching "homeassistant" or "Home Assistant")
	row = r.db.QueryRow(
		`SELECT icon, image_url, color FROM icons
		 WHERE REPLACE(REPLACE(REPLACE(LOWER(name), ' ', ''), '-', ''), '_', '') = ?
		    OR REPLACE(REPLACE(REPLACE(LOWER(id), ' ', ''), '-', ''), '_', '') = ?
		 ORDER BY (image_url IS NOT NULL AND image_url != '') DESC
		 LIMIT 1`,
		noSpaceName, noSpaceName,
	)
	if m, ok := scanMatch(row); ok {
		return m, true
	}

	// Try partial match on name - prioritize dashboard icons and longer matches
	row = r.db.QueryRow(
		`SELECT icon, image_url, color FROM icons
		 WHERE (LOWER(name) LIKE ? OR LOWER(id) LIKE ?)
		 AND LENGTH(name) >= 4
		 ORDER BY (image_url IS NOT NULL AND image_url != '') DESC, LENGTH(name) DESC
		 LIMIT 1`,
		"%"+normalizedName+"%", "%"+normalizedName+"%",
	)
	if m, ok := scanMatch(row); ok {
		return m, true
	}

	// Try word-based matching: split the search term and try each word
	words := strings.FieldsFunc(normalizedName, func(c rune) bool {
		return c == ' ' || c == '-' || c == '_'
	})

	// Try individual words first
	for _, word := range words {
		if len(word) < 3 {
			continue
		}
		row = r.db.QueryRow(
			`SELECT icon, image_url, color FROM icons
			 WHERE LOWER(name) = ? OR LOWER(id) = ?
			 ORDER BY (image_url IS NOT NULL AND image_url != '') DESC
			 LIMIT 1`,
			word, word,
		)
		if m, ok := scanMatch(row); ok {
			return m, true
		}
	}

	// Try combining adjacent words (e.g., "TP Link" -> "tp-link", "tplink")
	for i := 0; i < len(words)-1; i++ {
		combined := words[i] + "-" + words[i+1]
		combinedNoHyphen := words[i] + words[i+1]

		// Try hyphenated version (e.g., "tp-link")
		row = r.db.QueryRow(
			`SELECT icon, image_url, color FROM icons
			 WHERE LOWER(name) = ? OR LOWER(id) = ?
			 ORDER BY (image_url IS NOT NULL AND image_url != '') DESC
			 LIMIT 1`,
			combined, combined,
		)
		if m, ok := scanMatch(row); ok {
			return m, true
		}

		// Try without hyphen (e.g., "tplink")
		row = r.db.QueryRow(
			`SELECT icon, image_url, color FROM icons
			 WHERE LOWER(name) = ? OR LOWER(id) = ?
			    OR REPLACE(REPLACE(REPLACE(LOWER(name), ' ', ''), '-', ''), '_', '') = ?
			    OR REPLACE(REPLACE(REPLACE(LOWER(id), ' ', ''), '-', ''), '_', '') = ?
			 ORDER BY (image_url IS NOT NULL AND image_url != '') DESC
			 LIMIT 1`,
			combinedNoHyphen, combinedNoHyphen, combinedNoHyphen, combinedNoHyphen,
		)
		if m, ok := scanMatch(row); ok {
			return m, true
		}
	}

	// Final fallback: try LIKE match on any word >= 4 chars to find partial matches
	for _, word := range words {
		if len(word) < 4 {
			continue
		}
		row = r.db.QueryRow(
			`SELECT icon, image_url, color FROM icons
			 WHERE (LOWER(name) LIKE ? OR LOWER(id) LIKE ?)
			 AND LENGTH(name) >= 4
			 ORDER BY (image_url IS NOT NULL AND image_url != '') DESC, LENGTH(name) DESC
			 LIMIT 1`,
			"%"+word+"%", "%"+word+"%",
		)
		if m, ok := scanMatch(row); ok {
			return m, true
		}
	}

	return IconMatch{}, false
}

// applyIconMatching recursively searches through the config and matches icons for entries
func (r *Router) applyIconMatching(config map[string]interface{}) int {
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

					// Try to match based on name
					name, _ := entry["name"].(string)
					if match, found := r.matchIconForName(name); found {
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
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse multipart form (for file uploads)
	if err := req.ParseMultipartForm(10 << 20); err != nil { // 10 MB max
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	// Check if auto-match icons is requested
	autoMatchIcons := req.FormValue("autoMatchIcons") == "true"

	file, _, err := req.FormFile("file")
	if err != nil {
		http.Error(w, "No file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Read entire file into memory
	fileData, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "Failed to read file", http.StatusInternalServerError)
		return
	}

	var configJSON []byte
	var importFormat string

	// Detect the format
	format, err := converters.DetectFormat(fileData)
	if err != nil {
		http.Error(w, fmt.Sprintf("Unable to detect format: %v", err), http.StatusBadRequest)
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
			http.Error(w, fmt.Sprintf("Failed to convert Homer config: %v", err), http.StatusBadRequest)
			return
		}
		importFormat = "Homer YAML"

	case "dashy":
		configJSON, err = converters.ConvertFromDashy(fileData)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to convert Dashy config: %v", err), http.StatusBadRequest)
			return
		}
		importFormat = "Dashy YAML"

	case "heimdall":
		configJSON, err = converters.ConvertFromHeimdall(fileData)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to convert Heimdall config: %v", err), http.StatusBadRequest)
			return
		}
		importFormat = "Heimdall JSON"

	default:
		http.Error(w, "Unsupported file format", http.StatusBadRequest)
		return
	}

	// Validate the resulting JSON has the expected structure
	var importedConfig map[string]interface{}
	if err := json.Unmarshal(configJSON, &importedConfig); err != nil {
		http.Error(w, "Invalid configuration after conversion", http.StatusInternalServerError)
		return
	}

	importedDashboards, ok := importedConfig["dashboards"].([]interface{})
	if !ok {
		http.Error(w, "Invalid config: missing 'dashboards' field", http.StatusBadRequest)
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
		log.Printf("[Import] Applying icon matching to config...")
		iconMatchCount = r.applyIconMatching(existingConfig)
		log.Printf("[Import] Icon matching complete: %d icons matched", iconMatchCount)

		// Debug: Log a sample entry after matching
		if dashboards, ok := existingConfig["dashboards"].([]interface{}); ok && len(dashboards) > 0 {
			if dash, ok := dashboards[len(dashboards)-1].(map[string]interface{}); ok {
				if tabs, ok := dash["tabs"].([]interface{}); ok && len(tabs) > 0 {
					if tab, ok := tabs[0].(map[string]interface{}); ok {
						if groups, ok := tab["groups"].([]interface{}); ok && len(groups) > 0 {
							if group, ok := groups[0].(map[string]interface{}); ok {
								if entries, ok := group["entries"].([]interface{}); ok && len(entries) > 0 {
									if entry, ok := entries[0].(map[string]interface{}); ok {
										log.Printf("[Import] Sample entry after matching: name=%v, icon=%v", entry["name"], entry["icon"])
									}
								}
							}
						}
					}
				}
			}
		}
	} else {
		log.Printf("[Import] autoMatchIcons is false, skipping icon matching")
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

	// Serialize merged config
	mergedJSON, err := json.Marshal(existingConfig)
	if err != nil {
		http.Error(w, "Failed to serialize merged config", http.StatusInternalServerError)
		return
	}

	// Save to database
	_, err = r.db.Exec(
		"INSERT OR REPLACE INTO config (id, data, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)",
		string(mergedJSON),
	)
	if err != nil {
		http.Error(w, "Failed to save config", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	// Build response message
	message := fmt.Sprintf("Imported %d dashboard(s) from %s format", importedCount, importFormat)
	if iconMatchCount > 0 {
		message += fmt.Sprintf(", matched %d icon(s)", iconMatchCount)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"message":      message,
		"imported":     importedCount,
		"iconsMatched": iconMatchCount,
	})
}

// handleIntegrations proxies requests to external services (reserved for future use)
// func (r *Router) handleIntegrations(w http.ResponseWriter, req *http.Request) {
// 	http.Error(w, "Not implemented yet", http.StatusNotImplemented)
// }

// handleIconActions routes icon CRUD operations based on HTTP method
func (r *Router) handleIconActions(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodPut:
		r.authMiddleware(r.handleUpdateIcon)(w, req)
	case http.MethodDelete:
		r.authMiddleware(r.handleDeleteIcon)(w, req)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleIconCategoryActions routes category CRUD operations based on HTTP method
func (r *Router) handleIconCategoryActions(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodPut:
		r.authMiddleware(r.handleUpdateIconCategory)(w, req)
	case http.MethodDelete:
		r.authMiddleware(r.handleDeleteIconCategory)(w, req)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleGetIconCategories returns all icon categories or creates a new one
func (r *Router) handleGetIconCategories(w http.ResponseWriter, req *http.Request) {
	if req.Method == http.MethodPost {
		r.authMiddleware(r.handleCreateIconCategory)(w, req)
		return
	}

	if req.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	rows, err := r.db.Query(`
		SELECT id, name, icon, order_num, is_preset, created_at
		FROM icon_categories
		ORDER BY order_num ASC
	`)
	if err != nil {
		http.Error(w, "Failed to load icon categories", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	categories := []map[string]interface{}{}
	for rows.Next() {
		var id, name, icon, createdAt string
		var orderNum int
		var isPreset bool

		if err := rows.Scan(&id, &name, &icon, &orderNum, &isPreset, &createdAt); err != nil {
			http.Error(w, "Failed to scan category", http.StatusInternalServerError)
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
		r.authMiddleware(r.handleCreateIcon)(w, req)
		return
	}

	if req.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
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
		`, categoryID)
	} else {
		rows, err = r.db.Query(`
			SELECT id, name, icon, category_id, color, image_url, is_preset, created_at
			FROM icons
			ORDER BY name ASC
		`)
	}

	if err != nil {
		http.Error(w, "Failed to load icons", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	icons := []map[string]interface{}{}
	for rows.Next() {
		var id, name, icon, categoryID, createdAt string
		var color, imageURL sql.NullString
		var isPreset bool

		if err := rows.Scan(&id, &name, &icon, &categoryID, &color, &imageURL, &isPreset, &createdAt); err != nil {
			http.Error(w, "Failed to scan icon", http.StatusInternalServerError)
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
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
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
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate required fields - icon is optional if imageUrl is provided
	if iconData.ID == "" || iconData.Name == "" || iconData.CategoryID == "" {
		http.Error(w, "Missing required fields", http.StatusBadRequest)
		return
	}

	// Must have either icon or imageUrl
	if iconData.Icon == "" && (iconData.ImageURL == nil || *iconData.ImageURL == "") {
		http.Error(w, "Either icon or imageUrl is required", http.StatusBadRequest)
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
		http.Error(w, "Failed to create icon", http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]bool{"success": true})
}

// handleUpdateIcon updates an existing icon (admin only)
func (r *Router) handleUpdateIcon(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	iconID := req.URL.Path[len("/api/icons/"):]
	if iconID == "" {
		http.Error(w, "Icon ID required", http.StatusBadRequest)
		return
	}

	var iconData struct {
		Name       string  `json:"name"`
		Icon       string  `json:"icon"`
		CategoryID string  `json:"categoryId"`
		Color      *string `json:"color"`
	}

	if err := json.NewDecoder(req.Body).Decode(&iconData); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
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
		http.Error(w, "Failed to update icon", http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]bool{"success": true})
}

// handleDeleteIcon deletes an icon (admin only, only user-created icons)
func (r *Router) handleDeleteIcon(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	iconID := req.URL.Path[len("/api/icons/"):]
	if iconID == "" {
		http.Error(w, "Icon ID required", http.StatusBadRequest)
		return
	}

	// Only allow deletion of user-created icons (not presets)
	_, err := r.db.Exec("DELETE FROM icons WHERE id = ? AND is_preset = 0", iconID)
	if err != nil {
		http.Error(w, "Failed to delete icon", http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]bool{"success": true})
}

// handleCreateIconCategory creates a new icon category (admin only)
func (r *Router) handleCreateIconCategory(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var categoryData struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Icon  string `json:"icon"`
		Order int    `json:"order"`
	}

	if err := json.NewDecoder(req.Body).Decode(&categoryData); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if categoryData.ID == "" || categoryData.Name == "" || categoryData.Icon == "" {
		http.Error(w, "Missing required fields", http.StatusBadRequest)
		return
	}

	_, err := r.db.Exec(
		"INSERT INTO icon_categories (id, name, icon, order_num, is_preset) VALUES (?, ?, ?, ?, 0)",
		categoryData.ID, categoryData.Name, categoryData.Icon, categoryData.Order,
	)
	if err != nil {
		http.Error(w, "Failed to create category", http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]bool{"success": true})
}

// handleUpdateIconCategory updates an existing icon category (admin only)
func (r *Router) handleUpdateIconCategory(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	categoryID := req.URL.Path[len("/api/icon-categories/"):]
	if categoryID == "" {
		http.Error(w, "Category ID required", http.StatusBadRequest)
		return
	}

	var categoryData struct {
		Name  string `json:"name"`
		Icon  string `json:"icon"`
		Order int    `json:"order"`
	}

	if err := json.NewDecoder(req.Body).Decode(&categoryData); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	_, err := r.db.Exec(
		"UPDATE icon_categories SET name = ?, icon = ?, order_num = ? WHERE id = ?",
		categoryData.Name, categoryData.Icon, categoryData.Order, categoryID,
	)
	if err != nil {
		http.Error(w, "Failed to update category", http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]bool{"success": true})
}

// handleDeleteIconCategory deletes a category (admin only, only user-created categories)
func (r *Router) handleDeleteIconCategory(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	categoryID := req.URL.Path[len("/api/icon-categories/"):]
	if categoryID == "" {
		http.Error(w, "Category ID required", http.StatusBadRequest)
		return
	}

	// Only allow deletion of user-created categories (not presets)
	// This will also cascade delete all icons in the category
	_, err := r.db.Exec("DELETE FROM icon_categories WHERE id = ? AND is_preset = 0", categoryID)
	if err != nil {
		http.Error(w, "Failed to delete category", http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]bool{"success": true})
}

// Helper function to write JSON responses
func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(data); err != nil {
		http.Error(w, fmt.Sprintf("Failed to encode response: %v", err), http.StatusInternalServerError)
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
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse multipart form (max 50 MB)
	if err := req.ParseMultipartForm(50 << 20); err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	file, header, err := req.FormFile("file")
	if err != nil {
		http.Error(w, "No file provided", http.StatusBadRequest)
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
		http.Error(w, "Invalid file type. Allowed: JPEG, PNG, GIF, WebP", http.StatusBadRequest)
		return
	}

	// Create backgrounds directory if it doesn't exist
	backgroundsDir := filepath.Join(r.config.DataDir, "backgrounds")
	if err := os.MkdirAll(backgroundsDir, 0755); err != nil {
		http.Error(w, "Failed to create backgrounds directory", http.StatusInternalServerError)
		return
	}

	// Generate unique filename
	randomBytes := make([]byte, 16)
	if _, err := rand.Read(randomBytes); err != nil {
		http.Error(w, "Failed to generate filename", http.StatusInternalServerError)
		return
	}
	filename := hex.EncodeToString(randomBytes) + ext
	imageID := hex.EncodeToString(randomBytes)

	// Save file
	destPath := filepath.Join(backgroundsDir, filename)
	destFile, err := os.Create(destPath)
	if err != nil {
		http.Error(w, "Failed to create file", http.StatusInternalServerError)
		return
	}
	defer destFile.Close()

	if _, err := io.Copy(destFile, file); err != nil {
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
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
		log.Printf("Warning: Failed to load background data: %v", err)
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
			log.Printf("Warning: Failed to save background data: %v", err)
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
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse multipart form (max 5 MB for icons)
	if err := req.ParseMultipartForm(5 << 20); err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	file, header, err := req.FormFile("file")
	if err != nil {
		http.Error(w, "No file provided", http.StatusBadRequest)
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
		http.Error(w, "Invalid file type. Allowed: JPEG, PNG, GIF, WebP, SVG", http.StatusBadRequest)
		return
	}

	// Create icons directory if it doesn't exist
	iconsDir := filepath.Join(r.config.DataDir, "icons")
	if err := os.MkdirAll(iconsDir, 0755); err != nil {
		http.Error(w, "Failed to create icons directory", http.StatusInternalServerError)
		return
	}

	// Generate unique filename
	randomBytes := make([]byte, 16)
	if _, err := rand.Read(randomBytes); err != nil {
		http.Error(w, "Failed to generate filename", http.StatusInternalServerError)
		return
	}
	iconID := hex.EncodeToString(randomBytes)

	// Read file into buffer
	fileData, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "Failed to read file", http.StatusInternalServerError)
		return
	}

	var filename string
	var destPath string

	// Handle SVG separately (no resizing needed)
	if contentType == "image/svg+xml" {
		filename = iconID + ".svg"
		destPath = filepath.Join(iconsDir, filename)
		if err := os.WriteFile(destPath, fileData, 0644); err != nil {
			http.Error(w, "Failed to save file", http.StatusInternalServerError)
			return
		}
	} else {
		// Decode and resize raster images
		img, _, err := image.Decode(bytes.NewReader(fileData))
		if err != nil {
			http.Error(w, "Failed to decode image: "+err.Error(), http.StatusBadRequest)
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
			http.Error(w, "Failed to create file", http.StatusInternalServerError)
			return
		}
		defer destFile.Close()

		if err := png.Encode(destFile, resized); err != nil {
			http.Error(w, "Failed to encode image", http.StatusInternalServerError)
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
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	bgData, err := r.loadBackgroundData()
	if err != nil {
		http.Error(w, "Failed to load background data", http.StatusInternalServerError)
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
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	imageID := req.URL.Path[len("/api/backgrounds/"):]
	if imageID == "" {
		http.Error(w, "Image ID required", http.StatusBadRequest)
		return
	}

	var update struct {
		Name     string `json:"name"`
		Category string `json:"category"`
	}
	if err := json.NewDecoder(req.Body).Decode(&update); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	bgData, err := r.loadBackgroundData()
	if err != nil {
		http.Error(w, "Failed to load background data", http.StatusInternalServerError)
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
		http.Error(w, "Image not found", http.StatusNotFound)
		return
	}

	if err := r.saveBackgroundData(bgData); err != nil {
		http.Error(w, "Failed to save background data", http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]bool{"success": true})
}

// handleDeleteBackground deletes an uploaded background image
func (r *Router) handleDeleteBackground(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	imageID := req.URL.Path[len("/api/backgrounds/"):]
	if imageID == "" {
		http.Error(w, "Image ID required", http.StatusBadRequest)
		return
	}

	bgData, err := r.loadBackgroundData()
	if err != nil {
		http.Error(w, "Failed to load background data", http.StatusInternalServerError)
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
					http.Error(w, "Failed to delete file", http.StatusInternalServerError)
					return
				}
				writeJSON(w, map[string]bool{"success": true})
				return
			}
		}
		http.Error(w, "Image not found", http.StatusNotFound)
		return
	}

	// Only delete uploaded images from disk
	if imageToDelete.Source == "uploaded" && strings.HasPrefix(imageToDelete.URL, "/backgrounds/") {
		filename := filepath.Base(imageToDelete.URL)
		backgroundsDir := filepath.Join(r.config.DataDir, "backgrounds")
		filePath := filepath.Join(backgroundsDir, filename)

		if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
			log.Printf("Warning: Failed to delete file %s: %v", filePath, err)
		}
	}

	// Remove from metadata
	bgData.Images = append(bgData.Images[:imageIndex], bgData.Images[imageIndex+1:]...)
	if err := r.saveBackgroundData(bgData); err != nil {
		http.Error(w, "Failed to save background data", http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]bool{"success": true})
}

// handleBackgroundCategories handles category CRUD operations
func (r *Router) handleBackgroundCategories(w http.ResponseWriter, req *http.Request) {
	bgData, err := r.loadBackgroundData()
	if err != nil {
		http.Error(w, "Failed to load background data", http.StatusInternalServerError)
		return
	}

	switch req.Method {
	case http.MethodGet:
		writeJSON(w, bgData.Categories)

	case http.MethodPost:
		var newCat BackgroundCategory
		if err := json.NewDecoder(req.Body).Decode(&newCat); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		// Generate ID if not provided
		if newCat.ID == "" {
			randomBytes := make([]byte, 8)
			if _, err := rand.Read(randomBytes); err != nil {
				http.Error(w, "Failed to generate ID", http.StatusInternalServerError)
				return
			}
			newCat.ID = hex.EncodeToString(randomBytes)
		}

		bgData.Categories = append(bgData.Categories, newCat)
		if err := r.saveBackgroundData(bgData); err != nil {
			http.Error(w, "Failed to save background data", http.StatusInternalServerError)
			return
		}

		writeJSON(w, newCat)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleBackgroundCategoryActions handles individual category operations
func (r *Router) handleBackgroundCategoryActions(w http.ResponseWriter, req *http.Request) {
	categoryID := req.URL.Path[len("/api/backgrounds/categories/"):]
	if categoryID == "" {
		http.Error(w, "Category ID required", http.StatusBadRequest)
		return
	}

	bgData, err := r.loadBackgroundData()
	if err != nil {
		http.Error(w, "Failed to load background data", http.StatusInternalServerError)
		return
	}

	switch req.Method {
	case http.MethodPut:
		var update BackgroundCategory
		if err := json.NewDecoder(req.Body).Decode(&update); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
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
			http.Error(w, "Category not found", http.StatusNotFound)
			return
		}

		if err := r.saveBackgroundData(bgData); err != nil {
			http.Error(w, "Failed to save background data", http.StatusInternalServerError)
			return
		}

		writeJSON(w, map[string]bool{"success": true})

	case http.MethodDelete:
		// Don't allow deleting default categories
		defaultIDs := map[string]bool{
			"network": true, "servers": true, "docker": true, "homelab": true,
			"smarthome": true, "apps": true, "multimedia": true, "weather": true,
			"storage": true, "tech": true, "space": true, "minimal": true, "uploaded": true,
		}
		if defaultIDs[categoryID] {
			http.Error(w, "Cannot delete default category", http.StatusBadRequest)
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
			http.Error(w, "Category not found", http.StatusNotFound)
			return
		}

		// Move images in this category to "uploaded"
		for i, img := range bgData.Images {
			if img.Category == categoryID {
				bgData.Images[i].Category = "uploaded"
			}
		}

		if err := r.saveBackgroundData(bgData); err != nil {
			http.Error(w, "Failed to save background data", http.StatusInternalServerError)
			return
		}

		writeJSON(w, map[string]bool{"success": true})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleBackups handles listing backups and creating new ones
func (r *Router) handleBackups(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		// List all backups
		backups, err := r.backupManager.ListBackups()
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to list backups: %v", err), http.StatusInternalServerError)
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
			http.Error(w, fmt.Sprintf("Failed to create backup: %v", err), http.StatusInternalServerError)
			return
		}

		writeJSON(w, map[string]interface{}{
			"success": true,
			"path":    backupPath,
			"message": "Backup created successfully",
		})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleBackupActions handles restore and delete operations on individual backups
func (r *Router) handleBackupActions(w http.ResponseWriter, req *http.Request) {
	backupName := filepath.Base(req.URL.Path)
	if backupName == "" || backupName == "backups" {
		http.Error(w, "Backup name required", http.StatusBadRequest)
		return
	}

	switch req.Method {
	case http.MethodPost:
		// Restore from backup
		if err := r.backupManager.RestoreBackup(backupName); err != nil {
			http.Error(w, fmt.Sprintf("Failed to restore backup: %v", err), http.StatusInternalServerError)
			return
		}

		writeJSON(w, map[string]interface{}{
			"success": true,
			"message": "Backup restored successfully. Please restart the server.",
		})

	case http.MethodDelete:
		// Delete a backup - not implemented for safety
		http.Error(w, "Backup deletion not allowed for safety", http.StatusForbidden)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
