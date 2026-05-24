package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
)

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
		})
	}
	writeJSON(w, map[string]any{"settings": out})
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
