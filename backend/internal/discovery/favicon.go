package discovery

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"
)

// Favicon fetch + hash. After a detector matches on a (host, port), we
// fetch /favicon.ico once and stash the bytes in the emitted result so
// the curate UI can render the actual icon — much more useful than a
// guessed dashboard-icon when the admin doesn't recognise the app name.
//
// Two derived values land in raw_fingerprint:
//   - favicon_data_url: base64 data URL of the favicon (cap ~32 KB) so
//     the UI can display it without an extra round-trip.
//   - favicon_mmh3:     the Shodan-compatible MurmurHash3-32 of the
//     base64-encoded bytes. Useful for future Phase-4 user detectors
//     that want to match by favicon (the homarr / Shodan convention).
//     Always computed; an empty hash table today still leaves the
//     hash visible in raw_fingerprint for the admin to lookup manually.

// faviconReadCap bounds how many bytes we'll read from a favicon
// response. The vast majority are <8 KB; we cap higher to catch
// occasional larger PNG/SVG icons while still preventing pathological
// servers from sending us 100 MB.
const faviconReadCap = 32 * 1024

// faviconFetch fetches /favicon.ico from host:port and returns:
//   - dataURL: base64 data URL ("data:image/png;base64,...") for inline display
//   - mmh3:    Shodan-style 32-bit signed hash of the base64-encoded body
//   - ok:      true if a non-empty image was retrieved
//
// Best-effort: any failure (timeout, 404, non-image content, body too
// small to be a real icon) returns ok=false with empty strings.
func faviconFetch(ctx context.Context, host string, port int, tlsOn bool, timeout time.Duration) (dataURL string, mmh3 int32, ok bool) {
	snap, err := httpGetProbe(ctx, host, port, "/favicon.ico", tlsOn, timeout)
	if err != nil || snap == nil {
		return "", 0, false
	}
	if snap.Status < 200 || snap.Status >= 300 {
		return "", 0, false
	}
	if len(snap.Body) < 32 {
		// Servers that respond 200 with an empty body or a 1-byte
		// placeholder shouldn't pollute results with a phantom icon.
		return "", 0, false
	}
	body := snap.Body
	if len(body) > faviconReadCap {
		body = body[:faviconReadCap]
	}
	contentType := snap.Headers["content-type"]
	if contentType == "" {
		contentType = guessFaviconContentType(body)
	}
	// Strip charset suffixes etc.
	if i := strings.Index(contentType, ";"); i >= 0 {
		contentType = strings.TrimSpace(contentType[:i])
	}
	// Reject non-image content (probably an HTML 404 page returned at 200).
	if !strings.HasPrefix(contentType, "image/") {
		return "", 0, false
	}

	b64 := base64.StdEncoding.EncodeToString(body)
	// Shodan's MMH3 input is the base64 string with newlines every 76
	// chars (Python's `base64.encodebytes` default). Match that so our
	// hashes line up with the published Shodan corpus.
	wrapped := wrapBase64ForShodan(b64)
	hash := murmur3_32([]byte(wrapped), 0)

	return fmt.Sprintf("data:%s;base64,%s", contentType, b64), hash, true
}

// wrapBase64ForShodan inserts a "\n" every 76 chars and one at the end —
// the encoding Python's `base64.encodebytes` produces and the input
// `mmh3.hash` consumes when Shodan publishes their favicon corpus.
func wrapBase64ForShodan(b64 string) string {
	const lineLen = 76
	var out strings.Builder
	out.Grow(len(b64) + len(b64)/lineLen + 1)
	for i := 0; i < len(b64); i += lineLen {
		end := i + lineLen
		if end > len(b64) {
			end = len(b64)
		}
		out.WriteString(b64[i:end])
		out.WriteByte('\n')
	}
	return out.String()
}

// guessFaviconContentType sniffs the first few bytes when the server
// didn't bother to set Content-Type. Cheap; covers the formats that
// actually show up as favicons (ICO, PNG, GIF, SVG).
func guessFaviconContentType(b []byte) string {
	if len(b) >= 4 && b[0] == 0x00 && b[1] == 0x00 && b[2] == 0x01 && b[3] == 0x00 {
		return "image/x-icon"
	}
	if len(b) >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4e && b[3] == 0x47 {
		return "image/png"
	}
	if len(b) >= 6 && (string(b[:6]) == "GIF87a" || string(b[:6]) == "GIF89a") {
		return "image/gif"
	}
	// SVG: leading whitespace then "<?xml" or "<svg"
	trimmed := strings.TrimLeft(string(b[:min(len(b), 64)]), " \t\r\n")
	if strings.HasPrefix(trimmed, "<?xml") || strings.HasPrefix(trimmed, "<svg") {
		return "image/svg+xml"
	}
	if len(b) >= 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff {
		return "image/jpeg"
	}
	if len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP" {
		return "image/webp"
	}
	return ""
}

// murmur3_32 is the 32-bit MurmurHash3 (x86 variant) that Shodan uses
// to fingerprint favicons. Returns the signed 32-bit form so the result
// matches `mmh3.hash(..., signed=True)` in Python.
//
// Inlined here (~30 lines) instead of pulling in a third-party murmur3
// dep — the algorithm is small and stable, and we'd rather not adopt a
// new go.mod entry for what amounts to a single function call.
func murmur3_32(data []byte, seed uint32) int32 {
	const c1 = 0xcc9e2d51
	const c2 = 0x1b873593

	h := seed
	nblocks := len(data) / 4
	for i := 0; i < nblocks; i++ {
		k := uint32(data[i*4]) | uint32(data[i*4+1])<<8 |
			uint32(data[i*4+2])<<16 | uint32(data[i*4+3])<<24
		k *= c1
		k = (k << 15) | (k >> 17)
		k *= c2
		h ^= k
		h = (h << 13) | (h >> 19)
		h = h*5 + 0xe6546b64
	}

	var k uint32
	tail := data[nblocks*4:]
	switch len(tail) {
	case 3:
		k ^= uint32(tail[2]) << 16
		fallthrough
	case 2:
		k ^= uint32(tail[1]) << 8
		fallthrough
	case 1:
		k ^= uint32(tail[0])
		k *= c1
		k = (k << 15) | (k >> 17)
		k *= c2
		h ^= k
	}

	h ^= uint32(len(data))
	h ^= h >> 16
	h *= 0x85ebca6b
	h ^= h >> 13
	h *= 0xc2b2ae35
	h ^= h >> 16

	return int32(h)
}
