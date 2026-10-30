//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
)

// errServiceRestart: not running in an interactive console (a Windows service, NSSM, or
// output redirected with no console), so whatever started HOPS restarts it when it exits;
// starting a second copy here would fight it for the port and leave an orphan it can't manage.
var errServiceRestart = errors.New("not running in an interactive console: the service manager restarts HOPS")

// restartSelf starts HOPS again after an API-requested restart (a backup restore). Windows has
// no exec, so a new copy is started in this console and this one exits (exitAfter). That is
// only done when HOPS was started by hand in a console window: NSSM is not seen as a service
// by svc.IsWindowsService (its parent is nssm.exe), so the console check is what keeps it safe.
func restartSelf() (exitAfter bool, err error) {
	if isSvc, _ := svc.IsWindowsService(); isSvc || !interactiveConsole() {
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

// interactiveConsole reports whether HOPS is attached to a console someone is typing into:
// stdin is a console handle and the process is not in session 0, where services (including
// NSSM's, which may give HOPS a hidden console of its own) always run.
func interactiveConsole() bool {
	var mode uint32
	if windows.GetConsoleMode(windows.Handle(os.Stdin.Fd()), &mode) != nil {
		return false
	}
	var session uint32
	if err := windows.ProcessIdToSessionId(windows.GetCurrentProcessId(), &session); err != nil || session == 0 {
		return false
	}
	return true
}
