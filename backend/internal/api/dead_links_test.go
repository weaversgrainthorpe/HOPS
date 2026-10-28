package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

const deadLinksFixture = `{"dashboards":[{"id":"dl","name":"Home","path":"/home","tabs":[{"id":"t1","name":"Main","groups":[
	{"id":"g1","name":"Servers","entries":[
		{"id":"nas","name":"Old NAS","url":"http://192.0.2.10","statusCheck":{"enabled":true}},
		{"id":"fresh","name":"Router","url":"http://192.0.2.1","statusCheck":{"enabled":true}},
		{"id":"quiet","name":"Inherits","url":"http://192.0.2.2"}
	]}]}]}]}`

type deadLinksResp struct {
	ChecksEnabled    bool   `json:"checksEnabled"`
	ThresholdHours   int    `json:"thresholdHours"`
	HistoryStartedAt string `json:"historyStartedAt"`
	CheckedTiles     int    `json:"checkedTiles"`
	Links            []struct {
		ID            string   `json:"id"`
		Name          string   `json:"name"`
		URL           string   `json:"url"`
		DashboardPath string   `json:"dashboardPath"`
		TabID         string   `json:"tabId"`
		FolderIDs     []string `json:"folderIds"`
		Path          []string `json:"path"`
		FailingSince  string   `json:"failingSince"`
		LastError     string   `json:"lastError"`
	} `json:"links"`
}

func getDeadLinks(t *testing.T, router http.Handler) deadLinksResp {
	t.Helper()
	tok := loginTestUser(t, router)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, authedRequest("GET", "/api/dead-links", nil, tok, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/dead-links: %d %s", w.Code, w.Body.String())
	}
	var out deadLinksResp
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestDeadLinks_ThresholdFilterAndPath(t *testing.T) {
	for _, tc := range []struct {
		name      string
		rows      map[string]string
		wantIDs   []string
		threshold int
	}{
		{"default 7 days lists only the long failure", nil, []string{"nas"}, 168},
		{"1 hour lists both", map[string]string{"status.dead_after_hours": "1"}, []string{"nas", "fresh"}, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			router, db := setupTestRouterWithSettingsRows(t, deadLinksFixture, nil, tc.rows)
			now := time.Now().UTC()
			for id, age := range map[string]time.Duration{"nas": 10 * 24 * time.Hour, "fresh": 2 * time.Hour, "gone": 30 * 24 * time.Hour} {
				if _, err := db.Exec(`INSERT INTO status_failing (entry_id, since, last_error, last_checked) VALUES (?, ?, 'HTTP 502', ?)`,
					id, now.Add(-age).Format(time.RFC3339), now.Format(time.RFC3339)); err != nil {
					t.Fatal(err)
				}
			}
			out := getDeadLinks(t, router)
			if !out.ChecksEnabled || out.ThresholdHours != tc.threshold || out.CheckedTiles != 3 {
				t.Fatalf("header: %+v", out)
			}
			if out.HistoryStartedAt != "2026-09-01T00:00:00Z" {
				t.Errorf("historyStartedAt = %q", out.HistoryStartedAt)
			}
			if len(out.Links) != len(tc.wantIDs) {
				t.Fatalf("links = %+v, want ids %v", out.Links, tc.wantIDs)
			}
			for i, id := range tc.wantIDs {
				if out.Links[i].ID != id {
					t.Errorf("link %d = %s, want %s (oldest first)", i, out.Links[i].ID, id)
				}
			}
			nas := out.Links[0]
			if nas.Name != "Old NAS" || nas.URL != "http://192.0.2.10" || nas.LastError != "HTTP 502" ||
				nas.DashboardPath != "/home" || nas.TabID != "t1" || len(nas.FolderIDs) != 1 {
				t.Errorf("row: %+v", nas)
			}
			if want := []string{"Home", "Main", "Servers"}; len(nas.Path) != 3 || nas.Path[0] != want[0] || nas.Path[1] != want[1] || nas.Path[2] != want[2] {
				t.Errorf("path = %v, want %v", nas.Path, want)
			}
		})
	}
}

func TestDeadLinks_ChecksOffGlobally(t *testing.T) {
	router, _ := setupTestRouterWithSettingsRows(t, deadLinksFixture, nil, map[string]string{"status.checks_enabled": "false"})
	out := getDeadLinks(t, router)
	if out.ChecksEnabled {
		t.Fatalf("checksEnabled true with the global switch off: %+v", out)
	}
	if out.Links == nil {
		t.Error("links must be an empty list, not null")
	}
}

func TestDeadLinks_AdminOnly(t *testing.T) {
	router, _ := setupTestRouterSeeded(t, deadLinksFixture)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", "/api/dead-links", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous GET: %d, want 401", w.Code)
	}
}
