//go:build dev

package api

import (
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// devFrontendDir is the --frontend directory. This file exists only in
// `-tags dev` builds; release binaries cannot serve the UI from disk.
var devFrontendDir string

// SetDevFrontendDir sets the on-disk UI directory (empty = embedded UI).
func SetDevFrontendDir(dir string) { devFrontendDir = dir }

func devFrontendActive() bool {
	if devFrontendDir == "" {
		return false
	}
	fi, err := os.Stat(devFrontendDir)
	return err == nil && fi.IsDir()
}

// serveSPADev serves from the on-disk directory when one is set.
func serveSPADev(w http.ResponseWriter, req *http.Request) bool {
	if !devFrontendActive() {
		return false
	}
	serveSPADisk(w, req)
	return true
}

// devSPAIndexHTML returns index.html from the on-disk directory when active.
func devSPAIndexHTML() ([]byte, bool) {
	if !devFrontendActive() {
		return nil, false
	}
	b, err := os.ReadFile(filepath.Join(devFrontendDir, "index.html"))
	if err != nil {
		slog.Warn("CSP: cannot read index.html from --frontend; inline scripts will be blocked", "component", "http", "error", err)
	}
	return b, true
}

// serveSPADisk serves the SPA from devFrontendDir on disk (dev builds only).
func serveSPADisk(w http.ResponseWriter, req *http.Request) {
	// Get the absolute path to prevent directory traversal
	// Confined to the build dir: clean as a rooted path (drops any ".."), then
	// verify the prefix as a belt-and-braces check.
	root := filepath.Clean(devFrontendDir)
	p := filepath.Join(root, filepath.FromSlash(path.Clean("/"+req.URL.Path)))
	if p != root && !strings.HasPrefix(p, root+string(filepath.Separator)) {
		http.NotFound(w, req)
		return
	}

	// Check if path is a file
	fi, err := os.Stat(p)
	if err == nil && !fi.IsDir() {
		// File exists, serve it
		if filepath.Base(p) == "index.html" {
			setDiskIndexCSP(w, p)
		}
		http.ServeFile(w, req, p)
		return
	}

	// Check if it's a directory and index.html exists
	if err == nil && fi.IsDir() {
		indexPath := filepath.Join(p, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			setDiskIndexCSP(w, indexPath)
			http.ServeFile(w, req, indexPath)
			return
		}
	}

	// File doesn't exist or it's a SPA route, serve index.html
	indexPath := filepath.Join(devFrontendDir, "index.html")
	setDiskIndexCSP(w, indexPath)
	http.ServeFile(w, req, indexPath)
}

// setDiskIndexCSP recomputes the CSP for an index.html served from disk, so
// rebuilding the UI while the server runs keeps the inline-script hash in step.
func setDiskIndexCSP(w http.ResponseWriter, indexPath string) {
	b, err := os.ReadFile(indexPath)
	if err != nil {
		return // ServeFile will answer the missing file itself
	}
	w.Header().Set("Content-Security-Policy", appContentSecurityPolicy(b))
}
