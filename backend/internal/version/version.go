package version

// Version information for HOPS
const (
	Major = 1
	Minor = 4
	Patch = 10
)

// String returns the version as a semantic version string
func String() string {
	return "1.4.10"
}

// Full returns the full version string with build info
func Full() string {
	return "HOPS v1.4.10"
}
