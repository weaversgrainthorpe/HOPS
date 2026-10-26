//go:build dev

package main

import (
	"flag"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/weaversgrainthorpe/HOPS/internal/api"
)

// registerDevFlags registers the dev-only flags; this file is compiled only
// with `-tags dev`. The returned func applies them after flag.Parse.
func registerDevFlags() func() {
	frontendDir := flag.String("frontend", "", "DEV BUILD: serve the UI from this build directory on disk instead of the embedded copy")
	return func() {
		if *frontendDir == "" {
			return
		}
		if _, err := os.Stat(filepath.Join(*frontendDir, "index.html")); os.IsNotExist(err) {
			slog.Warn("--frontend dir has no index.html, using embedded UI", "path", *frontendDir)
			return
		}
		slog.Warn("DEV BUILD serving UI from disk (--frontend), NOT the copy embedded in this binary", "path", *frontendDir)
		api.SetDevFrontendDir(*frontendDir)
	}
}
