package configdoc

import (
	"database/sql"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/settings"
	_ "modernc.org/sqlite"
)

func newSvc(t *testing.T) *settings.Service {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err := db.Exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`); err != nil {
		t.Fatal(err)
	}
	s, err := settings.New(db)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestResolve_InheritAndOverride(t *testing.T) {
	svc := newSvc(t)
	e := Resolve(svc, Obj{"id": "d1", "settings": Obj{
		"statusCheckIntervalMinutes": float64(2),
		"statusChecksEnabled":        nil,
		"defaultLayout":              "free",
		"animatedFolderBackgrounds":  false,
	}})
	if e.StatusCheckIntervalMinutes != 2 {
		t.Errorf("interval = %d, want 2", e.StatusCheckIntervalMinutes)
	}
	if !e.StatusChecksEnabled {
		t.Error("null should inherit global true")
	}
	if e.StatusCheckTimeoutSeconds != 10 || e.EditIdleTimeoutMinutes != 15 {
		t.Errorf("missing keys should inherit: %+v", e)
	}
	if e.DefaultLayout != "free" || e.AnimatedFolderBackgrounds {
		t.Errorf("overrides not applied: %+v", e)
	}
	// no settings object at all -> all global
	g := Resolve(svc, Obj{"id": "d2"})
	if g.StatusCheckIntervalMinutes != 5 || g.DefaultLayout != "grid" || !g.AnimatedFolderBackgrounds {
		t.Errorf("globals not used: %+v", g)
	}
}

func TestResolve_BadStoredValueFallsBackToGlobal(t *testing.T) {
	svc := newSvc(t)
	e := Resolve(svc, Obj{"id": "d1", "settings": Obj{
		"statusCheckIntervalMinutes": "soon",
		"statusCheckTimeoutSeconds":  float64(0),
		"defaultLayout":              "tiles",
		"statusChecksEnabled":        float64(1),
		"editIdleTimeoutMinutes":     1.5,
	}})
	if e.StatusCheckIntervalMinutes != 5 || e.StatusCheckTimeoutSeconds != 10 ||
		e.DefaultLayout != "grid" || !e.StatusChecksEnabled || e.EditIdleTimeoutMinutes != 15 {
		t.Errorf("bad values must fall back to global: %+v", e)
	}
}

func TestSettingsKeysDerivedFromSettingKeys(t *testing.T) {
	if len(settingsKeys) != len(SettingKeys) {
		t.Fatalf("settingsKeys %d vs SettingKeys %d", len(settingsKeys), len(SettingKeys))
	}
	for _, k := range settingsKeys {
		if _, ok := SettingKeys[k]; !ok {
			t.Errorf("%s missing from SettingKeys", k)
		}
	}
}

func TestValidateOverrides(t *testing.T) {
	svc := newSvc(t)
	if err := ValidateOverrides(svc, Obj{"statusCheckIntervalMinutes": float64(0)}); err == nil ||
		!strings.Contains(err.Error(), "minimum") {
		t.Errorf("interval 0: want minimum error, got %v", err)
	}
	if err := ValidateOverrides(svc, Obj{"bogus": float64(1)}); err == nil {
		t.Error("unknown key should error")
	}
	if err := ValidateOverrides(svc, Obj{"statusCheckIntervalMinutes": "5"}); err == nil {
		t.Error("string for int should error")
	}
	if err := ValidateOverrides(svc, Obj{"statusChecksEnabled": "true"}); err == nil {
		t.Error("string for bool should error")
	}
	if err := ValidateOverrides(svc, Obj{"defaultLayout": "tiles"}); err == nil {
		t.Error("bad enum should error")
	}
	if err := ValidateOverrides(svc, Obj{
		"statusCheckIntervalMinutes": float64(3), "statusChecksEnabled": false,
		"defaultLayout": "free", "editIdleTimeoutMinutes": nil,
	}); err != nil {
		t.Errorf("valid overrides rejected: %v", err)
	}
}
