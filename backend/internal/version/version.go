package version

// Version information for HOPS
const (
	Major = 1
	Minor = 6
	Patch = 1
)

// String returns the version as a semantic version string
func String() string {
	return "1.6.1"
}

// Full returns the full version string with build info
func Full() string {
	return "HOPS v1.6.1"
}
