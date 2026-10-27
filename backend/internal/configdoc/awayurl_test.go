package configdoc

import "testing"

// A tile's optional awayUrl (the address opened when a browser is set to
// Away) is checked on saves and imports with the same scheme allow-list the
// editor uses for url.
func TestVerifyDashboard_AwayURL(t *testing.T) {
	withAway := func(v any) Obj {
		n := tileNode("a")
		n["awayUrl"] = v
		return v3Dash([]any{n})
	}
	for _, ok := range []string{"https://nas.tailnet.ts.net", "http://100.64.0.7:8080/x", "ssh://me@nas.example:2222", "ftp://files.example", "nas.example.com"} {
		if err := VerifyDashboard(withAway(ok)); err != nil {
			t.Errorf("awayUrl %q should pass: %v", ok, err)
		}
	}
	if err := VerifyDashboard(v3Dash([]any{tileNode("a")})); err != nil {
		t.Errorf("absent awayUrl should pass: %v", err)
	}
	for _, bad := range []any{"javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "gopher://x", "", "   ", 42, true, "https://exa mple.com"} {
		wantProblem(t, VerifyDashboard(withAway(bad)), "awayUrl")
	}
}

func TestValidTileURL(t *testing.T) {
	cases := map[string]bool{
		"https://a.b": true, "HTTP://a.b": true, "ssh://h": true, "mailto:x@y.z": true,
		"/relative": true, "//cdn.example": true, "host.lan:8080": true,
		"javascript:x": false, "data:x": false, "file:///x": false, "chrome://settings": false, "": false,
	}
	for u, want := range cases {
		if got := ValidTileURL(u); got != want {
			t.Errorf("ValidTileURL(%q) = %v, want %v", u, got, want)
		}
	}
}

// Pentest L1: a tile's url is checked with the same allow-list as awayUrl on
// saves, imports and transfers. Absent or blank is a tile with nothing to open.
func TestVerifyDashboard_TileURL(t *testing.T) {
	withURL := func(v any) Obj {
		n := tileNode("a")
		n["url"] = v
		return v3Dash([]any{n})
	}
	for _, ok := range []any{"https://nas.lan", "http://10.0.0.1:8080/x", "ssh://me@nas:2222", "mailto:a@b.c", "nas.lan", " http://lead.space/", "", nil} {
		if err := VerifyDashboard(withURL(ok)); err != nil {
			t.Errorf("url %q should pass: %v", ok, err)
		}
	}
	for _, bad := range []any{"javascript:alert(document.domain)", " JaVaScRiPt:x", "data:text/html,<script>x</script>", "vbscript:x", "file:///etc/passwd", "chrome://settings", 42} {
		wantProblem(t, VerifyDashboard(withURL(bad)), "url is", "javascript:")
	}
}

// The v2 import converter refuses a javascript: tile url; the whole-document
// startup migration keeps it (shown as unsafe, never dropped silently).
func TestConvertDashboardV2_RefusesUnsafeURL(t *testing.T) {
	v2 := Obj{"id": "d", "name": "D", "path": "/d", "tabs": []any{Obj{"id": "t", "name": "T",
		"groups": []any{Obj{"id": "g", "name": "G", "entries": []any{Obj{"id": "e", "name": "E", "url": "javascript:alert(1)"}}}}}}}
	_, err := ConvertDashboardV2(v2)
	wantProblem(t, err, "tile", "url is")
	if _, err := MigrateV2(Obj{"dashboards": []any{v2}}); err != nil {
		t.Errorf("startup migration should keep the tile, got %v", err)
	}
}
