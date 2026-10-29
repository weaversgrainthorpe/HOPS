package configdoc

import (
	"net/url"
	"strings"
)

// AwayURLKey is a tile's optional away address: the URL a browser set to Away
// opens instead of url (e.g. a Tailscale or public address). Absent means the
// tile has none and opens url everywhere. Status checks always use url.
const AwayURLKey = "awayUrl"

// tileSafeSchemes is the scheme allow-list, the twin of isValidUrl in
// frontend/src/lib/utils/url.ts.
var tileSafeSchemes = []string{"http://", "https://", "ftp://", "ftps://", "ssh://", "mailto:"}

// ValidTileURL reports whether u is a tile address HOPS will open: an
// allow-listed scheme that parses, a protocol-relative or root-relative path,
// or a bare host (opened as https). Any other scheme (javascript:, data:,
// file:, …) is refused. It mirrors isValidUrl in the frontend.
func ValidTileURL(u string) bool {
	s := strings.TrimSpace(u)
	if s == "" {
		return false
	}
	lower := strings.ToLower(s)
	for _, p := range []string{"javascript:", "data:", "vbscript:"} {
		if strings.HasPrefix(lower, p) {
			return false
		}
	}
	for _, p := range tileSafeSchemes {
		if strings.HasPrefix(lower, p) {
			u, err := url.Parse(s)
			// "http://" with no host can never open (the browser refuses it too).
			return err == nil && (!strings.HasSuffix(p, "://") || u.Host != "")
		}
	}
	if strings.HasPrefix(s, "//") {
		_, err := url.Parse("https:" + s)
		return err == nil
	}
	if strings.HasPrefix(s, "/") {
		return true
	}
	// A bare host. Anything that already carries some other scheme is refused.
	if i := strings.Index(s, ":"); i > 0 && !strings.ContainsAny(s[:i], "./") {
		if _, err := url.Parse("https://" + s); err != nil || !looksLikeHostPort(s) {
			return false
		}
	}
	p, err := url.Parse("https://" + s)
	return err == nil && p.Host != ""
}

// looksLikeHostPort is true for "host:8080" style input, so a bare host with a
// port is not mistaken for a foreign scheme such as "chrome:".
func looksLikeHostPort(s string) bool {
	i := strings.Index(s, ":")
	rest := s[i+1:]
	j := strings.IndexAny(rest, "/?#")
	if j >= 0 {
		rest = rest[:j]
	}
	if rest == "" {
		return false
	}
	for _, r := range rest {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// checkTileURLs requires every tile's url, when present and not blank, to be
// a string that ValidTileURL accepts (pentest L1: url was never checked, so
// "javascript:" was stored and served). An absent or blank url is a tile with
// nothing to open (a note tile has none). Run on saves, imports and transfers
// (VerifyImportedDashboard), never on the whole stored document.
func (v *verifier) checkTileURLs(d Obj) {
	Walk(Obj{"dashboards": []any{d}}, func(_, _ Obj, _ []Obj, n Obj) bool {
		if n["kind"] != "tile" {
			return true
		}
		raw, has := n["url"]
		if !has || raw == nil {
			return true
		}
		s, ok := raw.(string)
		if ok && (strings.TrimSpace(s) == "" || ValidTileURL(s)) {
			return true
		}
		v.add("tile %s: url is %s, want an http(s), ftp(s), ssh or mailto address (javascript:, data: and other schemes are refused)", show(n["id"]), trunc(show(raw)))
		return true
	})
}

// checkAwayURLs requires every tile's awayUrl, when present, to be a non-empty
// string that ValidTileURL accepts. Run on saves and imports.
func (v *verifier) checkAwayURLs(d Obj) {
	Walk(Obj{"dashboards": []any{d}}, func(_, _ Obj, _ []Obj, n Obj) bool {
		if n["kind"] != "tile" {
			return true
		}
		raw, has := n[AwayURLKey]
		if !has {
			return true
		}
		if s, ok := raw.(string); !ok || !ValidTileURL(s) {
			v.add("tile %s: awayUrl is %s, want an http(s), ftp(s), ssh or mailto address (or absent)", show(n["id"]), trunc(show(raw)))
		}
		return true
	})
}
