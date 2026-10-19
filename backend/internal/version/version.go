package version

// Version information for HOPS. Keep these constants in sync with the
// top-level VERSION file — that file drives the deploy script; this
// Go constant is what the health endpoint and About modal surface at
// runtime.
const (
	Major = 3
	Minor = 0
	Patch = 0
)

// String returns the version as a semantic version string
func String() string {
	return "3.0.0"
}

// Full returns the full version string with build info
func Full() string {
	return "HOPS v3.0.0"
}
