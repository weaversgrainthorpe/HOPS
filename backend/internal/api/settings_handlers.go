package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// inContainer reports whether HOPS runs in a Docker or Podman container, where the port is set
// by the container's port mapping rather than in Settings. A variable so tests can set it.
var inContainer = func() bool { return detectContainerIn("/") }

// detectContainerIn looks for the marker file Docker (/.dockerenv) or Podman
// (/run/.containerenv) puts in a container's root. A Proxmox LXC container has neither, and
// changing the port there works as on any host.
func detectContainerIn(root string) bool {
	for _, marker := range []string{".dockerenv", "run/.containerenv"} {
		if _, err := os.Stat(filepath.Join(root, marker)); err == nil {
			return true
		}
	}
	return false
}

// settingDTO is what the API returns for each setting — the definition plus
// the current value. Keeps the frontend from having to merge two arrays.
type settingDTO struct {
	Key             string   `json:"key"`
	Type            string   `json:"type"`
	Value           string   `json:"value"`
	Default         string   `json:"default"`
	RestartRequired bool     `json:"restartRequired"`
	Description     string   `json:"description"`
	Min             int      `json:"min,omitempty"`
	Max             int      `json:"max,omitempty"`
	Enum            []string `json:"enum,omitempty"`
	// AdjustedFrom is the out-of-range value that was stored when the setting
	// was clamped on load; empty otherwise. The admin UI shows it
	// as a notice until the setting is saved.
	AdjustedFrom string `json:"adjustedFrom,omitempty"`
}

// handleSettingsList returns every setting's definition + current value.
// Admin-only (registered via r.protected in setupRoutes).
func (r *Router) handleSettingsList(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	defs := r.settings.AllDefinitions()
	values := r.settings.All()
	adjusted := r.settings.Adjustments()
	out := make([]settingDTO, 0, len(defs))
	for _, d := range defs {
		out = append(out, settingDTO{
			Key:             d.Key,
			Type:            d.Type,
			Value:           values[d.Key],
			Default:         d.Default,
			RestartRequired: d.RestartRequired,
			Description:     d.Description,
			Min:             d.Min,
			Max:             d.Max,
			Enum:            d.Enum,
			AdjustedFrom:    adjusted[d.Key],
		})
	}
	writeJSON(w, map[string]any{"settings": out, "runtime": map[string]any{"container": inContainer()}})
}

// handleSettingUpdate updates one setting by key. The URL is
// /api/settings/<key> and the body is {"value": "..."}.
func (r *Router) handleSettingUpdate(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPut {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	key := strings.TrimPrefix(req.URL.Path, "/api/settings/")
	if key == "" || strings.Contains(key, "/") {
		writeJSONError(w, "Setting key required", http.StatusBadRequest)
		return
	}
	if _, ok := r.settings.Definition(key); !ok {
		writeJSONError(w, "Unknown setting", http.StatusNotFound)
		return
	}

	var body struct {
		Value string `json:"value"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		writeJSONError(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	if err := r.settings.Set(key, body.Value); err != nil {
		// Validation failures from settings.Set are safe to surface — they
		// describe why the value was rejected (range, format, enum).
		writeJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}

	slog.Info("setting updated", "component", "settings", "key", key)
	writeJSONSuccess(w)
}
