// Package web exposes the compiled SvelteKit SPA embedded into the HOPS
// binary. Embedding the UI is what makes HOPS a true single-file download:
// the server no longer needs a frontend/build directory on disk alongside
// the executable.
//
// The build/ subdirectory is generated — the SvelteKit output (frontend/build)
// is copied here before `go build`. Only the .gitkeep placeholder is tracked
// in git; see .gitignore. The `all:` prefix is REQUIRED so that SvelteKit's
// _app directory (and any dotfiles) are embedded — //go:embed otherwise skips
// names beginning with "_" or ".".
package web

import "embed"

//go:embed all:build
var buildFS embed.FS

// BuildFS is the embedded SPA filesystem, rooted at "build/".
var BuildFS = buildFS
