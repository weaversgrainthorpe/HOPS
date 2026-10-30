package version

// Version information for HOPS. Keep these constants in sync with the
// top-level VERSION file — that file drives the deploy script; this
// Go constant is what the health endpoint and About modal surface at
// runtime.
const (
	Major = 3
	Minor = 0
	Patch = 1
)

// Prerelease is an optional pre-release label (e.g. "rc1") stamped at build
// time with -ldflags "-X github.com/weaversgrainthorpe/HOPS/internal/version.Prerelease=rc1"
// by scripts/build-rc.sh. Empty for a normal release build.
var Prerelease = ""

// String returns the version as a semantic version string
func String() string {
	return withPrerelease("3.0.1")
}

// Full returns the full version string with build info
func Full() string {
	return "HOPS v" + String()
}

func withPrerelease(base string) string {
	if Prerelease == "" {
		return base
	}
	return base + "-" + Prerelease
}
