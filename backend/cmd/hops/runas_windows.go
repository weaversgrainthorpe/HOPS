//go:build windows

package main

// defaultAccountOps does no user switching on Windows: run the command as
// Administrator instead.
func defaultAccountOps() accountOps {
	return accountOps{euid: func() int { return -1 }}
}
