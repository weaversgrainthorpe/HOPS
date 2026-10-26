//go:build !dev

package main

// registerDevFlags is a no-op in release builds: there are no dev-only flags,
// so `--frontend` is an unknown flag. The dev counterpart is dev_flags.go.
func registerDevFlags() func() { return func() {} }
