//go:build !windows

package main

import (
	"context"
	"os"
	"os/exec"
	"runtime"
	"time"
)

// defaultDataSearch looks next to this program, at running HOPS programs
// (/proc on Linux, ps on macOS), at systemd services, then where the install
// script and the Docker image keep the data.
func defaultDataSearch() dataSearch {
	s := dataSearch{
		selfPID:   os.Getpid(),
		wellKnown: []string{"/var/lib/hops", "/app/data"},
	}
	if exe, err := os.Executable(); err == nil {
		s.exe = exe
	}
	switch runtime.GOOS {
	case "linux":
		s.procDir = "/proc"
		s.unitDirs = []string{"/etc/systemd/system", "/lib/systemd/system", "/usr/lib/systemd/system"}
	case "darwin":
		s.ps = func() ([]byte, error) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			return exec.CommandContext(ctx, "ps", "-axo", "pid=,command=").Output()
		}
	}
	return s
}
