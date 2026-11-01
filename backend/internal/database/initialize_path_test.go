package database

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInitialize_PathWithQuestionMarkAndHash(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "a?b#c%d")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "hops.db")
	db, err := Initialize(path)
	if err != nil {
		t.Fatalf("Initialize: %v", err)
	}
	defer db.Close()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("database not at the exact path: %v", err)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(dir), "a")); err == nil {
		t.Fatal("a stray file/folder 'a' was created")
	}
	var fk int
	if err := db.QueryRow("PRAGMA foreign_keys").Scan(&fk); err != nil || fk != 1 {
		t.Errorf("foreign_keys = %d, err %v; want 1", fk, err)
	}
	var jm string
	if err := db.QueryRow("PRAGMA journal_mode").Scan(&jm); err != nil || jm != "wal" {
		t.Errorf("journal_mode = %q, err %v; want wal", jm, err)
	}
	var bt int
	if err := db.QueryRow("PRAGMA busy_timeout").Scan(&bt); err != nil || bt != 5000 {
		t.Errorf("busy_timeout = %d, err %v; want 5000", bt, err)
	}
}
