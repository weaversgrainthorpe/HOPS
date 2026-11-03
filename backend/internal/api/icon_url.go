package api

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/database"
)

// An item's iconUrl is shown as <img src>. HOPS itself writes an uploaded
// icon (/icons/<file>), a packaged icon (/api/icons/dashboard/<file>), and
// keeps http(s) image addresses (the editor, the add page, the converters);
// a data:image and a preset (/presets/<file>) are accepted too. Anything else
// (a path outside those, a ".." step, another scheme) is refused on import and
// save, so an imported file can't point a viewer's browser elsewhere.

// iconAssetPath is a packaged-icon or preset path: one file name, no subfolders.
var iconAssetPath = regexp.MustCompile(`^/(api/icons/dashboard|presets)/[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$`)

// iconURLProblem says why u can't be an icon address, or "" when it can.
func iconURLProblem(u string) string {
	s := strings.TrimSpace(u)
	lower := strings.ToLower(s)
	switch {
	case s == "":
		return ""
	case strings.HasPrefix(lower, "data:"):
		if strings.HasPrefix(lower, "data:image/") {
			return ""
		}
		return "a data: address that is not an image"
	case strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://"):
		p, err := url.Parse(s)
		if err != nil || p.Host == "" {
			return "not a complete web address"
		}
		if hasDotDotSegment(p.Path) {
			return `it has a ".." step in its path`
		}
		return ""
	case strings.HasPrefix(s, "//"):
		return "an address without http:// or https://"
	case strings.HasPrefix(s, "/"):
		if hasDotDotSegment(s) {
			return `it has a ".." step in its path`
		}
		if name, ok := strings.CutPrefix(s, "/icons/"); ok && database.ValidImageName(name) {
			return ""
		}
		if iconAssetPath.MatchString(s) && !strings.Contains(s, "..") {
			return ""
		}
		return "not an uploaded or packaged HOPS icon"
	}
	return "only http://, https:// and data:image addresses or HOPS's own icons can be used"
}

// hasDotDotSegment reports whether a path has a ".." segment.
func hasDotDotSegment(p string) bool {
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." {
			return true
		}
	}
	return false
}

// storedIconURLs is every tab, folder and tile iconUrl in doc: one stored
// before the check is kept while it is unchanged.
func storedIconURLs(doc configdoc.Obj) map[string]bool {
	kept := map[string]bool{}
	forEachIconURL(doc, func(_, _, u string) bool {
		kept[u] = true
		return true
	})
	return kept
}

// forEachIconURL calls fn with each tab's, folder's and tile's iconUrl in doc,
// with the item's kind and name; fn returning false stops.
func forEachIconURL(doc configdoc.Obj, fn func(kind, name, u string) bool) {
	dashes, _ := doc["dashboards"].([]any)
	for _, d := range dashes {
		dm, _ := d.(configdoc.Obj)
		tabs, _ := dm["tabs"].([]any)
		for _, t := range tabs {
			tm, _ := t.(configdoc.Obj)
			if u, ok := tm["iconUrl"].(string); ok {
				name, _ := tm["name"].(string)
				if !fn("tab", name, u) {
					return
				}
			}
		}
	}
	configdoc.Walk(doc, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		u, ok := n["iconUrl"].(string)
		if !ok {
			return true
		}
		kind := "tile"
		if n["kind"] == "folder" {
			kind = "folder"
		}
		name, _ := n["name"].(string)
		return fn(kind, name, u)
	})
}

// iconURLBoundsError refuses the first tab, folder or tile in d whose iconUrl
// can't be used (iconURLProblem), naming it, unless it is one of kept. A
// visible 400, nothing stored.
func iconURLBoundsError(d configdoc.Obj, kept map[string]bool) *apiError {
	var ae *apiError
	forEachIconURL(configdoc.Obj{"dashboards": []any{d}}, func(kind, name, u string) bool {
		if kept[u] {
			return true
		}
		if why := iconURLProblem(u); why != "" {
			ae = newAPIError(http.StatusBadRequest, fmt.Sprintf("The icon address of %s %q can't be used (%s): %q", kind, name, why, trunc(u, 120)))
			return false
		}
		return true
	})
	return ae
}

// trunc shortens s to n runes for a message.
func trunc(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
