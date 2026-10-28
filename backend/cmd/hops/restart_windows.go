//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"

	"golang.org/x/sys/windows/svc"
)

// errServiceRestart: running as a Windows service, whose manager (or NSSM) restarts HOPS when
// it exits; starting a second copy here would fight it for the port.
var errServiceRestart = errors.New("running as a Windows service: the service manager restarts HOPS")

// restartSelf starts HOPS again after an API-requested restart (a backup restore). Windows has
// no exec, so a new copy is started in this console and this one exits (exitAfter).
func restartSelf() (exitAfter bool, err error) {
	if isSvc, _ := svc.IsWindowsService(); isSvc {
		return false, errServiceRestart
	}
	exe, err := os.Executable()
	if err != nil {
		return false, err
	}
	cmd := exec.Command(exe, os.Args[1:]...) // #nosec G204 -- re-runs this very binary with its own arguments
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := cmd.Start(); err != nil {
		return false, err
	}
	return true, nil
}
