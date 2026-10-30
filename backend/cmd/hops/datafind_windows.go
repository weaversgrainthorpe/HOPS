//go:build windows

package main

import (
	"os"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// defaultDataSearch looks next to this program, then at Windows services
// installed with NSSM that run a HOPS program. Running programs are not
// looked at on Windows.
func defaultDataSearch() dataSearch {
	s := dataSearch{selfPID: os.Getpid(), services: nssmServices}
	if exe, err := os.Executable(); err == nil {
		s.exe = exe
	}
	return s
}

// nssmServices lists the services whose NSSM Parameters\Application is a
// HOPS program, with their AppParameters and AppDirectory. A service whose
// keys cannot be read is skipped.
func nssmServices() ([]serviceCommand, error) {
	root, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Services`, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	names, err := root.ReadSubKeyNames(-1)
	if err != nil {
		return nil, err
	}
	var out []serviceCommand
	for _, name := range names {
		k, err := registry.OpenKey(root, name+`\Parameters`, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		app, _, err := k.GetStringValue("Application")
		if err != nil || !isHOPSProgram(app) || !strings.HasSuffix(strings.ToLower(app), ".exe") {
			k.Close()
			continue
		}
		params, _, _ := k.GetStringValue("AppParameters")
		dir, _, _ := k.GetStringValue("AppDirectory")
		k.Close()
		out = append(out, serviceCommand{name: name, exe: app, args: splitCommandLine(params, false), dir: dir})
	}
	return out, nil
}
