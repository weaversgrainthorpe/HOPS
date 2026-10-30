package api

import (
	"compress/gzip"
	"io"
	"mime"
	"net/http"
	"strings"
	"sync"
)

// gzipMiddleware compresses text responses (the API's JSON, the UI's HTML,
// JS and CSS, SVG icons) for a client that accepts gzip. /api/config is
// the whole layout and is read on every page view: 18 MB for 100
// dashboards of 1,000 tiles, about 1 MB compressed — the difference between
// 18 s and about 1 s on a phone over mobile data. BestSpeed keeps the cost
// small on a Pi Zero. Pictures, zips and anything already encoded or
// requested by range are sent as they are.
func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Method == http.MethodHead || req.Header.Get("Range") != "" || !acceptsGzip(req.Header.Get("Accept-Encoding")) {
			next.ServeHTTP(w, req)
			return
		}
		w.Header().Add("Vary", "Accept-Encoding")
		gw := &gzipResponseWriter{ResponseWriter: w}
		defer gw.close()
		next.ServeHTTP(gw, req)
	})
}

// acceptsGzip reports whether an Accept-Encoding header allows gzip (a
// "gzip;q=0" refuses it).
func acceptsGzip(h string) bool {
	for _, part := range strings.Split(h, ",") {
		name, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		if !strings.EqualFold(strings.TrimSpace(name), "gzip") {
			continue
		}
		q := strings.ReplaceAll(strings.TrimSpace(params), " ", "")
		return q != "q=0" && q != "q=0.0" && q != "q=0.00" && q != "q=0.000"
	}
	return false
}

// compressible reports whether a Content-Type is worth compressing.
func compressible(ct string) bool {
	mt, _, err := mime.ParseMediaType(ct)
	if err != nil {
		return false
	}
	switch {
	case strings.HasPrefix(mt, "text/"):
		return true
	case mt == "application/json", mt == "application/javascript", mt == "application/manifest+json", mt == "image/svg+xml":
		return true
	}
	return false
}

var gzipWriters = sync.Pool{New: func() any {
	zw, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed)
	return zw
}}

// gzipResponseWriter decides at the first WriteHeader or Write, from the
// handler's Content-Type, whether to compress.
type gzipResponseWriter struct {
	http.ResponseWriter
	decided bool
	zw      *gzip.Writer
}

func (g *gzipResponseWriter) decide(status int) {
	if g.decided {
		return
	}
	g.decided = true
	h := g.ResponseWriter.Header()
	if status < 200 || status == http.StatusNoContent || status == http.StatusNotModified || status == http.StatusPartialContent ||
		h.Get("Content-Encoding") != "" || !compressible(h.Get("Content-Type")) {
		return
	}
	h.Del("Content-Length")
	h.Set("Content-Encoding", "gzip")
	zw := gzipWriters.Get().(*gzip.Writer)
	zw.Reset(g.ResponseWriter)
	g.zw = zw
}

func (g *gzipResponseWriter) WriteHeader(status int) {
	g.decide(status)
	g.ResponseWriter.WriteHeader(status)
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	if !g.decided {
		if g.ResponseWriter.Header().Get("Content-Type") == "" {
			g.ResponseWriter.Header().Set("Content-Type", http.DetectContentType(b))
		}
		g.WriteHeader(http.StatusOK)
	}
	if g.zw != nil {
		return g.zw.Write(b)
	}
	return g.ResponseWriter.Write(b)
}

func (g *gzipResponseWriter) close() {
	if g.zw == nil {
		return
	}
	_ = g.zw.Close()
	gzipWriters.Put(g.zw)
	g.zw = nil
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (g *gzipResponseWriter) Unwrap() http.ResponseWriter { return g.ResponseWriter }
