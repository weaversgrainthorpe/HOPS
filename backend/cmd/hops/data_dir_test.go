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

func TestV2DataElsewhere(t *testing.T) {
	root := t.TempDir()
	if r, err := filepath.EvalSymlinks(root); err == nil {
		root = r
	}
	// HOPS 2's usual layout: the program in backend/, started from backend/, data in ../data.
	backend := filepath.Join(root, "HOPS", "backend")
	prog := filepath.Join(backend, "hops")
	v2data := filepath.Join(root, "HOPS", "data")
	for _, d := range []string{backend, v2data} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(prog, nil, 0o755); err != nil {
		t.Fatal(err)
	}
	def := filepath.Join(backend, "data")

	if got := v2DataElsewhere(def, backend, prog); got != "" {
		t.Errorf("no database anywhere: got %q, want none", got)
	}
	if err := os.WriteFile(filepath.Join(v2data, "hops.db"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := v2DataElsewhere(def, backend, prog); got != v2data {
		t.Errorf("v2 data at ../data from the start folder: got %q, want %q", got, v2data)
	}
	// Started from elsewhere: ../data beside the program still finds it.
	if got := v2DataElsewhere(def, root, prog); got != v2data {
		t.Errorf("v2 data at ../data beside the program: got %q, want %q", got, v2data)
	}
	// The default folder already has a database: that one is used, nothing is flagged.
	if err := os.MkdirAll(def, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(def, "hops.db"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := v2DataElsewhere(def, backend, prog); got != "" {
		t.Errorf("default folder has a database: got %q, want none", got)
	}
	// A folder called hops.db is not a database.
	other := filepath.Join(root, "x", "backend")
	if err := os.MkdirAll(filepath.Join(root, "x", "data", "hops.db"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := v2DataElsewhere(filepath.Join(other, "data"), other, filepath.Join(other, "hops")); got != "" {
		t.Errorf("a directory named hops.db: got %q, want none", got)
	}
}
