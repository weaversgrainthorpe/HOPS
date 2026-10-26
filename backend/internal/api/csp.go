package api

import (
	"crypto/sha256"
	"encoding/base64"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Browser security headers (design/security/v3-security-assurance.md §4).
//
// The Content-Security-Policy for the app's own pages and API responses. Each
// directive is a deliberate decision:
//
//   - script-src 'self' + the sha256 hash of each inline <script> in the SPA's
//     index.html (SvelteKit's hydration bootstrap). No 'unsafe-inline', no
//     'unsafe-eval': an injected <script> or event-handler attribute does not
//     run. The hash is computed from the index.html actually served, so a
//     rebuild of the UI can never leave the policy out of step with it.
//   - style-src 'self' 'unsafe-inline': Svelte renders style="" attributes
//     (and the icon library's SVGs carry them), which CSP cannot hash. Inline
//     style cannot run script; this is the accepted residual risk.
//   - img-src 'self' data: http: https: — tile, folder and tab icons may be
//     any image URL the admin sets, and homelab services commonly serve their
//     logos over plain http on the LAN. Images cannot run script. No blob:
//     (the app never renders blob images; blobs are only downloaded).
//   - connect-src 'self' + the Iconify API and its two fallback hosts (the
//     online icon fallback in @iconify/svelte). Nothing else may be fetched,
//     so injected markup cannot exfiltrate data by XHR/fetch.
//   - frame-src http: https: — iframe tiles open the admin's own service URLs,
//     on any host, http or https. data:, blob: and javascript: frames are not
//     allowed.
//   - frame-ancestors 'self' (and X-Frame-Options SAMEORIGIN for old
//     browsers): HOPS may frame itself but no other site may frame HOPS
//     (clickjacking).
//   - object-src 'none', base-uri 'self', form-action 'self'.
//
// Asset routes (uploaded icons/backgrounds, presets, dashboard icons) replace
// this with the much stricter setAssetCSP sandbox policy.
const (
	cspScriptSrcBase = "script-src 'self'"
	cspRest          = "; style-src 'self' 'unsafe-inline'" +
		"; img-src 'self' data: http: https:" +
		"; font-src 'self' data:" +
		"; connect-src 'self' https://api.iconify.design https://api.simplesvg.com https://api.unisvg.com" +
		"; frame-src http: https:" +
		"; worker-src 'self'" +
		"; manifest-src 'self'" +
		"; object-src 'none'" +
		"; base-uri 'self'" +
		"; form-action 'self'" +
		"; frame-ancestors 'self'"
)

// inlineScriptRe matches <script ...>body</script>; group 1 is the attribute
// text, group 2 the body.
var inlineScriptRe = regexp.MustCompile(`(?is)<script\b([^>]*)>(.*?)</script\s*>`)

// scriptSrcAttrRe spots a src attribute (an external script, not hashed).
var scriptSrcAttrRe = regexp.MustCompile(`(?i)(^|\s)src\s*=`)

// inlineScriptHashes returns the CSP source expression ('sha256-...') for
// every inline script (no src attribute) in html.
func inlineScriptHashes(html []byte) []string {
	var out []string
	for _, m := range inlineScriptRe.FindAllSubmatch(html, -1) {
		if scriptSrcAttrRe.Match(m[1]) {
			continue
		}
		sum := sha256.Sum256(m[2])
		out = append(out, "'sha256-"+base64.StdEncoding.EncodeToString(sum[:])+"'")
	}
	return out
}

// appContentSecurityPolicy builds the app CSP, allowing exactly the inline
// scripts present in indexHTML.
func appContentSecurityPolicy(indexHTML []byte) string {
	script := cspScriptSrcBase
	if hashes := inlineScriptHashes(indexHTML); len(hashes) > 0 {
		script += " " + strings.Join(hashes, " ")
	}
	return "default-src 'self'; " + script + cspRest
}

// setSecurityHeaders sets every browser security header on a response.
//
// Referrer-Policy is same-origin: HOPS's own requests keep the referrer, but
// nothing (dashboard names in the URL, the admin paths) leaks to the services
// tiles link to, nor to the Iconify CDN. Permissions-Policy turns off the
// powerful features HOPS never uses, for HOPS and for anything it frames.
func setSecurityHeaders(w http.ResponseWriter, csp string) {
	h := w.Header()
	h.Set("Content-Security-Policy", csp)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "SAMEORIGIN")
	h.Set("X-XSS-Protection", "0")
	h.Set("Referrer-Policy", "same-origin")
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=()")
}

// spaIndexHTML reads the index.html the router will serve (the --frontend
// directory on disk when set, otherwise the embedded build). A missing
// index.html (a Go test build without the UI) yields an empty policy hash
// list; that is logged, not hidden, since a real build would then fail to
// boot its UI.
func (r *Router) spaIndexHTML() []byte {
	if r.config != nil && r.config.FrontendDir != "" {
		if fi, err := os.Stat(r.config.FrontendDir); err == nil && fi.IsDir() {
			b, err := os.ReadFile(filepath.Join(r.config.FrontendDir, "index.html"))
			if err != nil {
				slog.Warn("CSP: cannot read index.html from --frontend; inline scripts will be blocked", "component", "http", "error", err)
			}
			return b
		}
	}
	b, err := fs.ReadFile(spaFS, "index.html")
	if err != nil {
		slog.Warn("CSP: embedded UI has no index.html; inline scripts will be blocked", "component", "http", "error", err)
	}
	return b
}

// setDiskIndexCSP recomputes the CSP for an index.html served from the
// --frontend directory (dev override), so rebuilding the UI while the server
// runs keeps the inline-script hash in step.
func setDiskIndexCSP(w http.ResponseWriter, indexPath string) {
	b, err := os.ReadFile(indexPath)
	if err != nil {
		return // ServeFile will answer the missing file itself
	}
	w.Header().Set("Content-Security-Policy", appContentSecurityPolicy(b))
}
