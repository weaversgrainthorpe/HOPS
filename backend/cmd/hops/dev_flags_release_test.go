//go:build !dev

package main

import (
	"flag"
	"testing"
)

// Release builds must not register --frontend (an unknown flag is an error).
func TestReleaseBuildHasNoFrontendFlag(t *testing.T) {
	registerDevFlags()()
	if flag.Lookup("frontend") != nil {
		t.Fatal("release build registers --frontend")
	}
}
