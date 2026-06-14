package version

// Version information for HOPS. Keep these constants in sync with the
// top-level VERSION file — that file drives the deploy script; this
// Go constant is what the health endpoint and About modal surface at
// runtime.
const (
	Major = 2
	Minor = 1
	Patch = 3
)

// String returns the version as a semantic version string
func String() string {
	return "2.1.3"
}

// Full returns the full version string with build info
func Full() string {
	return "HOPS v2.1.3"
}
