package configdoc

import (
	"encoding/json"
	"strings"
)

// HOPS 2 kept four app-wide settings at the top of its document that HOPS 3
// has no use for: theme.mode, theme.customCss, settings.searchHotkey and
// settings.defaultView. They stay in the stored document (and the archived v2
// row), but nothing reads them, so a value other than the 2.x default is
// reported to the user as not carried over.

// Which HOPS 2 setting a V2Global is.
const (
	V2ThemeMode    = "themeMode"
	V2CustomCSS    = "customCss"
	V2SearchHotkey = "searchHotkey"
	V2DefaultView  = "defaultView"
)

// V2Global is one HOPS 2 app-wide setting that was not at its default.
type V2Global struct {
	Setting string // one of the V2* constants
	Value   string // as the document has it (the CSS itself is never shown)
	// Dashboard is, for defaultView, the name of the dashboard at that path
	// in the same document; "" when none is.
	Dashboard string
}

// V2GlobalsNotCarried lists doc's HOPS 2 app-wide settings that differ from
// the 2.x defaults (mode dark, no custom CSS, hotkey "/", default view "/"),
// in a fixed order. Missing or empty values count as the default.
func V2GlobalsNotCarried(doc Obj) []V2Global {
	theme, _ := doc["theme"].(Obj)
	settings, _ := doc["settings"].(Obj)
	var out []V2Global
	if v, set := v2Text(theme["mode"]); set && v != "dark" {
		out = append(out, V2Global{Setting: V2ThemeMode, Value: v})
	}
	if v, set := v2Text(theme["customCss"]); set {
		out = append(out, V2Global{Setting: V2CustomCSS, Value: v})
	}
	if v, set := v2Text(settings["searchHotkey"]); set && v != "/" {
		out = append(out, V2Global{Setting: V2SearchHotkey, Value: v})
	}
	if v, set := v2Text(settings["defaultView"]); set && v != "/" {
		out = append(out, V2Global{Setting: V2DefaultView, Value: v, Dashboard: dashboardAtPath(doc, v)})
	}
	return out
}

// v2Text is a setting's value as text, trimmed; set is false when it is
// missing, null or empty. A non-string value is shown as its JSON.
func v2Text(v any) (string, bool) {
	if v == nil {
		return "", false
	}
	s, ok := v.(string)
	if !ok {
		b, err := json.Marshal(v)
		if err != nil {
			return "", false
		}
		s = string(b)
	}
	s = strings.TrimSpace(s)
	return s, s != ""
}

// dashboardAtPath is the name of doc's first dashboard routed at path
// ("x" and "/x" alike, case ignored), or "".
func dashboardAtPath(doc Obj, path string) string {
	want := strings.ToLower(strings.Trim(path, "/"))
	list, _ := doc["dashboards"].([]any)
	for _, d := range list {
		dm, ok := d.(Obj)
		if !ok {
			continue
		}
		if p, _ := dm["path"].(string); strings.ToLower(strings.Trim(p, "/")) == want {
			name, _ := dm["name"].(string)
			return name
		}
	}
	return ""
}
