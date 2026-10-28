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
