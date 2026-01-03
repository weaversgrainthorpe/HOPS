package api

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/yourusername/hops/internal/converters"
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
	var configData map[string]interface{}
	if err := json.Unmarshal(configJSON, &configData); err != nil {
		http.Error(w, "Invalid configuration after conversion", http.StatusInternalServerError)
		return
	}

	if _, ok := configData["dashboards"]; !ok {
		http.Error(w, "Invalid config: missing 'dashboards' field", http.StatusInternalServerError)
		return
	}

	// Save to database
	_, err = r.db.Exec(
		"INSERT OR REPLACE INTO config (id, data, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)",
		string(configJSON),
	)
	if err != nil {
		http.Error(w, "Failed to save config", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Configuration imported successfully from %s format", importFormat),
	})
}

// handleIntegrations proxies requests to external services
func (r *Router) handleIntegrations(w http.ResponseWriter, req *http.Request) {
	// TODO: Implement service integrations (Pi-hole, Proxmox, etc.)
	http.Error(w, "Not implemented yet", http.StatusNotImplemented)
}

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
			SELECT id, name, icon, category_id, color, is_preset, created_at
			FROM icons
			WHERE category_id = ?
			ORDER BY name ASC
		`, categoryID)
	} else {
		rows, err = r.db.Query(`
			SELECT id, name, icon, category_id, color, is_preset, created_at
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
		var color sql.NullString
		var isPreset bool

		if err := rows.Scan(&id, &name, &icon, &categoryID, &color, &isPreset, &createdAt); err != nil {
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
	}

	if err := json.NewDecoder(req.Body).Decode(&iconData); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if iconData.ID == "" || iconData.Name == "" || iconData.Icon == "" || iconData.CategoryID == "" {
		http.Error(w, "Missing required fields", http.StatusBadRequest)
		return
	}

	var color sql.NullString
	if iconData.Color != nil && *iconData.Color != "" {
		color = sql.NullString{String: *iconData.Color, Valid: true}
	}

	_, err := r.db.Exec(
		"INSERT INTO icons (id, name, icon, category_id, color, is_preset) VALUES (?, ?, ?, ?, ?, 0)",
		iconData.ID, iconData.Name, iconData.Icon, iconData.CategoryID, color,
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

	// Find the image
	var imageToDelete *BackgroundImage
	imageIndex := -1
	for i, img := range bgData.Images {
		if img.ID == imageID {
			imageToDelete = &bgData.Images[i]
			imageIndex = i
			break
		}
	}

	if imageToDelete == nil {
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
			rand.Read(randomBytes)
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
			"smarthome": true, "tech": true, "space": true, "minimal": true, "uploaded": true,
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
