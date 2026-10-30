package configdoc

import (
	"fmt"
	"log/slog"
	"math"
	"sort"
	"strconv"

	"github.com/weaversgrainthorpe/HOPS/internal/settings"
)

// Effective is a dashboard's settings after inheritance from the globals.
type Effective struct {
	// StatusChecksEnabled is the gate: true only when the global setting is on
	// and the dashboard is not Disabled (explicit false). A dashboard can stop
	// checks but never turn them on against the global (EffectiveStatusChecks).
	StatusChecksEnabled        bool
	StatusCheckIntervalMinutes int
	StatusCheckTimeoutSeconds  int
	EditIdleTimeoutMinutes     int
	AnimatedFolderBackgrounds  bool
}

// SettingKeys maps each DashboardSettings JSON key to its global settings key.
var SettingKeys = map[string]string{
	"statusChecksEnabled":        settings.KeyStatusChecksEnabled,
	"statusCheckIntervalMinutes": settings.KeyStatusCheckIntervalMinutes,
	"statusCheckTimeoutSeconds":  settings.KeyStatusCheckTimeoutSeconds,
	"editIdleTimeoutMinutes":     settings.KeyEditModeIdleTimeoutMinutes,
	"animatedFolderBackgrounds":  settings.KeyFoldersAnimatedBackgrounds,
}

// settingsKeys is the sorted key list, derived from SettingKeys so the two
// can never drift.
var settingsKeys = func() []string {
	keys := make([]string, 0, len(SettingKeys))
	for k := range SettingKeys {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}()

// asInt accepts any JSON-decoded or Go integer, and whole-valued floats.
func asInt(v any) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case int64:
		return int(n), true
	case float64:
		if n == math.Trunc(n) && math.Abs(n) < 1<<31 {
			return int(n), true
		}
	}
	return 0, false
}

// overrideString renders a non-null override as the string form the global
// settings validator expects. ok is false when the type is wrong for the key.
func overrideString(svc *settings.Service, jsonKey string, v any) (string, bool) {
	def, _ := svc.Definition(SettingKeys[jsonKey])
	switch def.Type {
	case "bool":
		b, ok := v.(bool)
		return strconv.FormatBool(b), ok
	case "enum", "log_level":
		s, ok := v.(string)
		return s, ok
	default: // integer-typed
		n, ok := asInt(v)
		return strconv.Itoa(n), ok
	}
}

// Resolve returns the dashboard's effective settings: each non-null override
// wins, otherwise the global value; statusChecksEnabled is the gate instead
// (global on and the dashboard not Disabled). Writes are gated by ValidateOverrides, so a
// stored override that is the wrong type or out of range is unexpected; it
// falls back to the global and is logged at WARN (never silently coerced).
func Resolve(svc *settings.Service, dash Obj) Effective {
	id, _ := dash["id"].(string)
	var ov Obj
	if raw := dash["settings"]; raw != nil {
		if m, ok := raw.(Obj); ok {
			ov = m
		} else {
			slog.Warn("dashboard settings is not an object; using globals for every key",
				"component", "configdoc", "dashboard", id, "type", fmt.Sprintf("%T", raw))
		}
	}

	// pick returns the override as a validated string, or the global value.
	pick := func(jsonKey string) string {
		gk := SettingKeys[jsonKey]
		v, present := ov[jsonKey]
		if !present || v == nil {
			return svc.Get(gk)
		}
		s, ok := overrideString(svc, jsonKey, v)
		if ok {
			if err := svc.Validate(gk, s); err == nil {
				return s
			} else {
				slog.Warn("dashboard setting override invalid; using global",
					"component", "configdoc", "dashboard", id, "key", jsonKey, "error", err)
				return svc.Get(gk)
			}
		}
		slog.Warn("dashboard setting override has wrong type; using global",
			"component", "configdoc", "dashboard", id, "key", jsonKey, "value", fmt.Sprintf("%v", v))
		return svc.Get(gk)
	}
	toInt := func(s, gk string) int {
		if n, err := strconv.Atoi(s); err == nil {
			return n
		}
		return svc.GetInt(gk)
	}
	gateOpen, _, _ := EffectiveStatusChecks(svc, dash, nil, nil, nil)
	return Effective{
		StatusChecksEnabled:        gateOpen,
		StatusCheckIntervalMinutes: toInt(pick("statusCheckIntervalMinutes"), settings.KeyStatusCheckIntervalMinutes),
		StatusCheckTimeoutSeconds:  toInt(pick("statusCheckTimeoutSeconds"), settings.KeyStatusCheckTimeoutSeconds),
		EditIdleTimeoutMinutes:     toInt(pick("editIdleTimeoutMinutes"), settings.KeyEditModeIdleTimeoutMinutes),
		AnimatedFolderBackgrounds:  pick("animatedFolderBackgrounds") == "true",
	}
}

// ValidateOverrides checks each non-null override against the global key's
// validator. Unknown keys and wrong types are errors.
func ValidateOverrides(svc *settings.Service, overrides Obj) error {
	keys := make([]string, 0, len(overrides))
	for k := range overrides {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		gk, known := SettingKeys[k]
		if !known {
			return fmt.Errorf("unknown dashboard setting %q", k)
		}
		v := overrides[k]
		if v == nil {
			continue
		}
		s, ok := overrideString(svc, k, v)
		if !ok {
			return fmt.Errorf("dashboard setting %q: wrong type %T", k, v)
		}
		if err := svc.Validate(gk, s); err != nil {
			return fmt.Errorf("dashboard setting %q: %w", k, err)
		}
	}
	return nil
}
