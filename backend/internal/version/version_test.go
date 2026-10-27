package version

import "testing"

func TestStringWithoutPrerelease(t *testing.T) {
	old := Prerelease
	t.Cleanup(func() { Prerelease = old })
	Prerelease = ""
	if got := String(); got != "3.0.0" {
		t.Fatalf("String() = %q, want 3.0.0", got)
	}
	if got := Full(); got != "HOPS v3.0.0" {
		t.Fatalf("Full() = %q, want HOPS v3.0.0", got)
	}
}

func TestStringWithPrerelease(t *testing.T) {
	old := Prerelease
	t.Cleanup(func() { Prerelease = old })
	Prerelease = "rc1"
	if got := String(); got != "3.0.0-rc1" {
		t.Fatalf("String() = %q, want 3.0.0-rc1", got)
	}
	if got := Full(); got != "HOPS v3.0.0-rc1" {
		t.Fatalf("Full() = %q, want HOPS v3.0.0-rc1", got)
	}
}
