//go:build !windows

package main

import (
	"os"
	"syscall"
)

// restartSelf starts HOPS again after an API-requested restart (a backup restore). On Unix it
// replaces this process with a fresh copy of the binary, keeping the PID, so it works the same
// under systemd, Docker or launchd as when HOPS was started by hand. Every file and socket Go
// opens is close-on-exec. It returns only on failure.
func restartSelf() (exitAfter bool, err error) {
	exe, err := os.Executable()
	if err != nil {
		return false, err
	}
	return false, syscall.Exec(exe, os.Args, os.Environ()) // #nosec G204 -- re-runs this very binary with its own arguments
}
