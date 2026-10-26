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
