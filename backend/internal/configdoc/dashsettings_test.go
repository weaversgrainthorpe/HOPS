package configdoc

import (
	"bytes"
	"database/sql"
	"log/slog"
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
	if e.AnimatedFolderBackgrounds {
		t.Errorf("overrides not applied: %+v", e)
	}
	// no settings object at all -> all global
	g := Resolve(svc, Obj{"id": "d2"})
	if g.StatusCheckIntervalMinutes != 5 || !g.AnimatedFolderBackgrounds {
		t.Errorf("globals not used: %+v", g)
	}
}

// statusChecksEnabled is a gate: the dashboard can stop checks (false) but
// never turn them on against the global; null or absent follows the global.
func TestResolve_StatusChecksGate(t *testing.T) {
	svc := newSvc(t)
	dash := func(v any) Obj { return Obj{"id": "d1", "settings": Obj{"statusChecksEnabled": v}} }
	if !Resolve(svc, dash(true)).StatusChecksEnabled || !Resolve(svc, dash(nil)).StatusChecksEnabled {
		t.Error("global on: true or null should be enabled")
	}
	if Resolve(svc, dash(false)).StatusChecksEnabled {
		t.Error("global on, dashboard false: should be disabled")
	}
	if err := svc.Set(settings.KeyStatusChecksEnabled, "false"); err != nil {
		t.Fatal(err)
	}
	for _, v := range []any{true, nil, false} {
		if Resolve(svc, dash(v)).StatusChecksEnabled {
			t.Errorf("global off, dashboard %v: should be disabled", v)
		}
	}
}

func TestResolve_BadStoredValueFallsBackToGlobal(t *testing.T) {
	svc := newSvc(t)
	e := Resolve(svc, Obj{"id": "d1", "settings": Obj{
		"statusCheckIntervalMinutes": "soon",
		"statusCheckTimeoutSeconds":  float64(0),
		"statusChecksEnabled":        float64(1),
		"editIdleTimeoutMinutes":     1.5,
	}})
	if e.StatusCheckIntervalMinutes != 5 || e.StatusCheckTimeoutSeconds != 10 ||
		!e.StatusChecksEnabled || e.EditIdleTimeoutMinutes != 15 {
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
	if err := ValidateOverrides(svc, Obj{
		"statusCheckIntervalMinutes": float64(3), "statusChecksEnabled": false,
		"editIdleTimeoutMinutes": nil,
	}); err != nil {
		t.Errorf("valid overrides rejected: %v", err)
	}
}

func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

func TestResolve_WarnsOnBadOverrides(t *testing.T) {
	svc := newSvc(t)
	cases := []struct {
		name string
		dash Obj
		want []string
	}{
		{"wrong type", Obj{"id": "dash-a", "settings": Obj{"statusCheckIntervalMinutes": "soon"}},
			[]string{"level=WARN", "dash-a", "statusCheckIntervalMinutes"}},
		{"out of range", Obj{"id": "dash-b", "settings": Obj{"statusCheckTimeoutSeconds": float64(0)}},
			[]string{"level=WARN", "dash-b", "statusCheckTimeoutSeconds"}},
		{"non-object settings", Obj{"id": "dash-c", "settings": "oops"},
			[]string{"level=WARN", "dash-c", "not an object"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			buf := captureLogs(t)
			Resolve(svc, c.dash)
			for _, w := range c.want {
				if !strings.Contains(buf.String(), w) {
					t.Errorf("log %q missing %q", buf.String(), w)
				}
			}
		})
	}
	buf := captureLogs(t)
	Resolve(svc, Obj{"id": "ok", "settings": Obj{"statusCheckIntervalMinutes": nil}})
	Resolve(svc, Obj{"id": "ok"})
	if buf.Len() != 0 {
		t.Errorf("no warning expected for valid/absent settings, got %q", buf.String())
	}
}
