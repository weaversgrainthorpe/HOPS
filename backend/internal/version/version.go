package version

// Version information for HOPS
const (
	Major = 0
	Minor = 1
	Patch = 0
)

// String returns the version as a semantic version string
func String() string {
	return "0.1.0"
}

// Full returns the full version string with build info
func Full() string {
	return "HOPS v0.1.0"
}
