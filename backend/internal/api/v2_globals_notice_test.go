package api

import (
	"encoding/json"
	"strings"
	"testing"
)

// HOPS 2's global theme mode, custom CSS, search shortcut and default
// dashboard have no HOPS 3 equivalent. A value other than the 2.x default is
// never dropped silently: the upgrade shows a one-time notice and an import
// lists it with the things not carried over.

func v2WithGlobals(theme, settings map[string]interface{}) []byte {
	var doc map[string]interface{}
	_ = json.Unmarshal(v2File(v2Dash("h", "Home", "/home"), v2Dash("w", "Work", "/work")), &doc)
	if theme != nil {
		doc["theme"] = theme
	}
	if settings != nil {
		doc["settings"] = settings
	}
	b, _ := json.Marshal(doc)
	return b
}

func customGlobals() []byte {
	return v2WithGlobals(
		map[string]interface{}{"mode": "light", "customCss": "body { color: red; }"},
		map[string]interface{}{"searchHotkey": "k", "defaultView": "/work"},
	)
}

func defaultGlobals() []byte {
	return v2WithGlobals(
		map[string]interface{}{"mode": "dark"},
		map[string]interface{}{"searchHotkey": "/", "defaultView": "/"},
	)
}

// v2SettingsNotice returns the not-carried notice in GET /api/config, or nil.
func v2SettingsNotice(t *testing.T, c *apiClient) map[string]interface{} {
	t.Helper()
	list, _ := getView(t, c)["notices"].([]interface{})
	for _, n := range list {
		m := n.(map[string]interface{})
		if strings.HasPrefix(m["id"].(string), noticeV2SettingsPrefix) {
			return m
		}
	}
	return nil
}

func assertMentions(t *testing.T, what, text string, wants ...string) {
	t.Helper()
	for _, want := range wants {
		if !strings.Contains(text, want) {
			t.Errorf("%s %q does not mention %q", what, text, want)
		}
	}
}

func TestStartup_V2GlobalsNotCarriedNotice(t *testing.T) {
	router, _ := setupTestRouterSeeded(t, string(customGlobals()))
	c := newClient(t, router)
	n := v2SettingsNotice(t, c)
	if n == nil {
		t.Fatal("no notice for the HOPS 2 settings that were not carried over")
	}
	text := n["text"].(string)
	assertMentions(t, "notice", text,
		`light/dark setting ("light")`, "Theme Settings",
		"custom CSS", "pre-v3-migration",
		`search shortcut ("k")`, "opens with /",
		`default dashboard ("Work")`, "Settings › Dashboards", "drag")
	if strings.Contains(text, "color: red") {
		t.Errorf("notice %q repeats the CSS itself", text)
	}

	// One-time: dismissed, it is gone.
	if code, resp := c.do("POST", "/api/notices/"+n["id"].(string)+"/dismiss", nil); code != 200 {
		t.Fatalf("dismiss: %d %v", code, resp)
	}
	if again := v2SettingsNotice(t, c); again != nil {
		t.Fatalf("notice still shown after dismissal: %v", again)
	}
}

func TestStartup_V2GlobalsAtDefaultsNoNotice(t *testing.T) {
	for name, data := range map[string][]byte{
		"defaults": defaultGlobals(),
		"absent":   v2WithGlobals(nil, nil),
		"empty":    v2WithGlobals(map[string]interface{}{"mode": "", "customCss": "  "}, map[string]interface{}{"searchHotkey": "", "defaultView": ""}),
	} {
		t.Run(name, func(t *testing.T) {
			router, _ := setupTestRouterSeeded(t, string(data))
			if n := v2SettingsNotice(t, newClient(t, router)); n != nil {
				t.Fatalf("notice for default settings: %v", n)
			}
		})
	}
}

// Only the ones that differ from the default are named.
func TestStartup_V2GlobalsOnlyChangedNamed(t *testing.T) {
	data := v2WithGlobals(map[string]interface{}{"mode": "dark"}, map[string]interface{}{"searchHotkey": "/", "defaultView": "/nowhere"})
	router, _ := setupTestRouterSeeded(t, string(data))
	n := v2SettingsNotice(t, newClient(t, router))
	if n == nil {
		t.Fatal("no notice for a changed default dashboard")
	}
	text := n["text"].(string)
	assertMentions(t, "notice", text, "/nowhere")
	for _, not := range []string{"light/dark", "custom CSS", "search shortcut"} {
		if strings.Contains(text, not) {
			t.Errorf("notice %q names %q, which was at its default", text, not)
		}
	}
}

func notCarriedLines(resp map[string]interface{}) []string {
	l, _ := resp["notCarried"].([]interface{})
	out := make([]string, 0, len(l))
	for _, s := range l {
		out = append(out, s.(string))
	}
	return out
}

func TestImport_V2GlobalsNotCarried(t *testing.T) {
	router, _ := setupTestRouter(t)
	c := newClient(t, router)

	code, preview := c.importFileWith(customGlobals(), map[string]string{"preview": "true"})
	if code != 200 {
		t.Fatalf("preview: %d %v", code, preview)
	}
	if got := notCarriedLines(preview); len(got) != 4 {
		t.Errorf("preview notCarried = %q, want the 4 HOPS 2 settings", got)
	}

	code, resp := c.importFile(customGlobals())
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	lines := notCarriedLines(resp)
	if len(lines) != 4 {
		t.Fatalf("notCarried = %q, want the 4 HOPS 2 settings", lines)
	}
	all := strings.Join(lines, "\n")
	assertMentions(t, "notCarried", all,
		`light/dark setting ("light")`, "Theme Settings",
		"custom CSS", "file you imported",
		`search shortcut ("k")`, "opens with /",
		`default dashboard ("Work")`, "Settings › Dashboards")
	assertMentions(t, "message", resp["message"].(string), "4 thing(s) couldn't be carried over")
}

func TestImport_V2GlobalsAtDefaultsNotListed(t *testing.T) {
	router, _ := setupTestRouter(t)
	c := newClient(t, router)
	code, resp := c.importFile(defaultGlobals())
	if code != 200 {
		t.Fatalf("import: %d %v", code, resp)
	}
	if got := notCarriedLines(resp); len(got) != 0 {
		t.Errorf("notCarried = %q for default settings, want none", got)
	}
}
