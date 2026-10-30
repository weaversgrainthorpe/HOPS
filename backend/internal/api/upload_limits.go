package api

import (
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"

	"github.com/weaversgrainthorpe/HOPS/internal/settings"
)

// uploadKind names one of the three size-limited uploads.
type uploadKind struct {
	key     string // the settings key holding the limit in bytes
	largest string // completes "the largest … is N MB"
}

var (
	uploadImport     = uploadKind{settings.KeyUploadMaxBytesImport, "file you can import"}
	uploadBackground = uploadKind{settings.KeyUploadMaxBytesBackground, "background image allowed"}
	uploadIcon       = uploadKind{settings.KeyUploadMaxBytesIcon, "icon file allowed"}
	uploadBackup     = uploadKind{settings.KeyUploadMaxBytesBackup, "backup you can upload"}
)

// multipartOverhead is the room allowed for the multipart envelope (boundaries,
// part headers, small form fields) on top of the file limit, so that a file
// exactly at the limit is accepted.
const multipartOverhead = 64 << 10

// formatMB renders a byte count the way the admin UI does: whole MB plainly,
// otherwise to one decimal place ("1.5 MB").
func formatMB(n int64) string {
	mb := float64(n) / float64(settings.MB)
	s := strconv.FormatFloat(mb, 'f', 1, 64)
	s = strings.TrimSuffix(s, ".0")
	return s + " MB"
}

// uploadTooLargeMessage names both the file's size and the limit.
func uploadTooLargeMessage(kind uploadKind, size, limit int64) string {
	sizeText := "larger than " + formatMB(limit)
	if size > 0 {
		sizeText = formatMB(size)
		if sizeText == formatMB(limit) { // just over: say so rather than "1 MB … 1 MB"
			sizeText = "just over " + formatMB(limit)
		}
	}
	return fmt.Sprintf("This file is %s, but the largest %s is %s. Choose a smaller file, or raise the limit in Settings → Global settings.",
		sizeText, kind.largest, formatMB(limit))
}

// uploadMaxMemory is how much of a multipart form ParseMultipartForm keeps in
// memory; the rest goes to temp files.
const uploadMaxMemory = 1 << 20

// readLimitedUpload caps the request body, parses the multipart form and
// returns the "file" part. A file over the limit is refused with 413 and a
// message naming the limit and the file's size; a malformed form is a 400.
// ok is false when a response has already been written.
func (r *Router) readLimitedUpload(w http.ResponseWriter, req *http.Request, kind uploadKind) (multipart.File, *multipart.FileHeader, bool) {
	limit := int64(r.settings.GetInt(kind.key))
	bodyCap := limit + multipartOverhead
	if req.ContentLength > bodyCap {
		// Refuse before reading: the body alone is bigger than any allowed file.
		writeJSONError(w, uploadTooLargeMessage(kind, req.ContentLength, limit), http.StatusRequestEntityTooLarge)
		return nil, nil, false
	}
	req.Body = http.MaxBytesReader(w, req.Body, bodyCap)
	// A small in-memory budget: a larger file part spills to a temp file (removed
	// by net/http when the request ends), so an upload near its limit never
	// sits in RAM whole before the handler reads it (Pi Zero; batch review Minor 3).
	if err := req.ParseMultipartForm(uploadMaxMemory); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeJSONError(w, uploadTooLargeMessage(kind, 0, limit), http.StatusRequestEntityTooLarge)
			return nil, nil, false
		}
		writeJSONError(w, "The upload could not be read (malformed form data).", http.StatusBadRequest)
		return nil, nil, false
	}
	file, header, err := req.FormFile("file")
	if err != nil {
		writeJSONError(w, "No file provided", http.StatusBadRequest)
		return nil, nil, false
	}
	if header.Size > limit {
		file.Close() // #nosec G104 -- Close on an error path or after a read-only/bounded read; the primary error is already surfaced and nothing was written
		writeJSONError(w, uploadTooLargeMessage(kind, header.Size, limit), http.StatusRequestEntityTooLarge)
		return nil, nil, false
	}
	return file, header, true
}

// handleUploadLimits returns the upload limits in bytes so the UI can
// refuse an oversize file before sending it (the server still enforces them).
func (r *Router) handleUploadLimits(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, map[string]int{
		"import":     r.settings.GetInt(settings.KeyUploadMaxBytesImport),
		"background": r.settings.GetInt(settings.KeyUploadMaxBytesBackground),
		"icon":       r.settings.GetInt(settings.KeyUploadMaxBytesIcon),
		"backup":     r.settings.GetInt(settings.KeyUploadMaxBytesBackup),
	})
}
