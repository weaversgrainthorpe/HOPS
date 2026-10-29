package main

import (
	"os"
	"path/filepath"
)

// defaultDataDir is the "data" folder next to the hops program, wherever it
// was started from. (Before rc4 it was ../data from the current folder, left
// over from v2 running inside backend/: a downloaded hops started in
// C:\Temp\HOPS3 put its data in C:\Temp\data. rc2 trial F.)
func defaultDataDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return dataDirBeside(exe)
}

// dataDirBeside is the "data" folder next to exe, following a symlink to the
// real program first.
func dataDirBeside(exe string) (string, error) {
	real, err := filepath.EvalSymlinks(exe)
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(real), "data"), nil
}

// v2DataElsewhere is the folder of an existing HOPS database at one of the
// places HOPS 2 kept it by default (../data from the folder it was started
// in, or ../data beside the program), or "" when there is none or the default
// folder already has a database. HOPS 3 defaults to "data" beside the
// program instead, so an upgraded install started without --data would
// otherwise create a new, empty database there and look as if everything
// had been lost.
func v2DataElsewhere(defaultDir, cwd, exe string) string {
	exists := func(dir string) bool {
		st, err := os.Stat(filepath.Join(dir, "hops.db"))
		return err == nil && st.Mode().IsRegular()
	}
	if exists(defaultDir) {
		return ""
	}
	var candidates []string
	if cwd != "" {
		candidates = append(candidates, filepath.Join(cwd, "..", "data"))
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(real), "..", "data"))
	}
	for _, c := range candidates {
		c = filepath.Clean(c)
		if c != filepath.Clean(defaultDir) && exists(c) {
			if abs, err := filepath.Abs(c); err == nil {
				return abs
			}
			return c
		}
	}
	return ""
}
