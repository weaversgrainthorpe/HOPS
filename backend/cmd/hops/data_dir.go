package main

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// defaultDataDir is the "data" folder next to the hops program, wherever it
// was started from. (It used to be ../data from the current folder, left
// over from v2 running inside backend/: a downloaded hops started in
// C:\Temp\HOPS3 put its data in C:\Temp\data.)
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

// checkDataDirArg refuses a data folder given on the command line that can't
// be what was meant, before anything touches the disk. In PowerShell and cmd a
// backslash just before a closing quote swallows the quote, so
// --data "C:\HOPS Data\" arrives as C:\HOPS Data" and Windows then says only
// that the "syntax is incorrect". A quote at the end is refused on every OS
// (it is never meant); a quote anywhere else is refused on Windows, where a
// folder name can't hold one. An empty path is fine (the default is used).
func checkDataDirArg(path string) error {
	return checkDataDirArgOS(path, runtime.GOOS)
}

func checkDataDirArgOS(path, goos string) error {
	if strings.HasSuffix(path, `"`) {
		return errors.New(`The data folder path ends in a quote mark ("). In PowerShell and cmd, a backslash just before the closing quote swallows the quote. Remove the trailing \ and run again, e.g. --data "C:\HOPS Data"`)
	}
	if goos == "windows" && strings.Contains(path, `"`) {
		return errors.New(`The data folder path has a quote mark (") in it. A folder name can't contain ".`)
	}
	return nil
}
