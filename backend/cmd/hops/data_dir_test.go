package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDataDirBeside(t *testing.T) {
	dir := t.TempDir()
	prog := filepath.Join(dir, "app", "hops")
	if err := os.MkdirAll(filepath.Dir(prog), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(prog, nil, 0o755); err != nil {
		t.Fatal(err)
	}
	real, err := filepath.EvalSymlinks(filepath.Join(dir, "app")) // TempDir may itself sit behind a symlink
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(real, "data")

	got, err := dataDirBeside(prog)
	if err != nil || got != want {
		t.Errorf("dataDirBeside(%q) = %q, %v; want %q", prog, got, err, want)
	}

	// A symlink (e.g. /usr/local/bin/hops) gives the folder of the real program.
	link := filepath.Join(dir, "hops-link")
	if err := os.Symlink(prog, link); err != nil {
		t.Skip("no symlinks here:", err)
	}
	if got, err := dataDirBeside(link); err != nil || got != want {
		t.Errorf("via symlink: %q, %v; want %q", got, err, want)
	}

	if _, err := dataDirBeside(filepath.Join(dir, "missing")); err == nil {
		t.Error("a program that isn't there should be an error, not a guessed folder")
	}
}
