package version

// Version information for HOPS
const (
	Major = 1
	Minor = 5
	Patch = 0
)

// String returns the version as a semantic version string
func String() string {
	return "1.5.0"
}

// Full returns the full version string with build info
func Full() string {
	return "HOPS v1.5.0"
}
