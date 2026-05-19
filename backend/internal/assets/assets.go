// Package assets exposes the bundled icons and background presets that ship
// inside the HOPS binary. These are read-only and embedded at build time;
// user-uploaded icons and backgrounds continue to live on disk under the data
// directory.
package assets

import "embed"

//go:embed dashboard-icons
var dashboardIconsFS embed.FS

//go:embed presets
var presetsFS embed.FS

// DashboardIcons is the embedded filesystem rooted at "dashboard-icons/".
var DashboardIcons = dashboardIconsFS

// Presets is the embedded filesystem rooted at "presets/".
var Presets = presetsFS
