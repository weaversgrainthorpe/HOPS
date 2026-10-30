//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
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
// HOPS program, with their AppParameters and AppDirectory, and a line for
// each HOPS service it could not read fully. A service whose Parameters key
// cannot be opened is not an NSSM service and is skipped.
func nssmServices() ([]serviceCommand, []string, error) {
	root, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Services`, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		return nil, nil, err
	}
	defer root.Close()
	names, err := root.ReadSubKeyNames(-1)
	if err != nil {
		return nil, nil, err
	}
	var out []serviceCommand
	var problems []string
	for _, name := range names {
		k, err := registry.OpenKey(root, name+`\Parameters`, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		app, err := regString(k, "Application")
		if err != nil || !isHOPSProgram(app) || !strings.HasSuffix(strings.ToLower(app), ".exe") {
			k.Close()
			continue
		}
		params, perr := regString(k, "AppParameters")
		dir, derr := regString(k, "AppDirectory")
		k.Close()
		if perr != nil && perr != registry.ErrNotExist {
			problems = append(problems, fmt.Sprintf("Windows service %s: couldn't read AppParameters (%v)", name, perr))
		}
		if derr != nil || !filepath.IsAbs(dir) {
			if derr != nil && derr != registry.ErrNotExist {
				problems = append(problems, fmt.Sprintf("Windows service %s: couldn't read AppDirectory (%v)", name, derr))
			}
			dir = ""
		}
		out = append(out, serviceCommand{name: name, exe: app, args: splitCommandLine(params, false), dir: dir})
	}
	return out, problems, nil
}

// regString reads a string value, expanding %VARIABLES% in a REG_EXPAND_SZ.
func regString(k registry.Key, name string) (string, error) {
	v, typ, err := k.GetStringValue(name)
	if err != nil {
		return "", err
	}
	if typ == registry.EXPAND_SZ {
		return registry.ExpandString(v)
	}
	return v, nil
}
