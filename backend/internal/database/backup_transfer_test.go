package database

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenBackupForDownloadRefusesSymlink(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	if err := os.MkdirAll(bm.backupDir, 0o755); err != nil {
		t.Fatal(err)
	}
	name := BackupPrefix + "2026-01-01_00-00-00_manual" + BackupSuffix
	if err := os.Symlink(dbPath, filepath.Join(bm.backupDir, name)); err != nil {
		t.Fatal(err)
	}
	if f, _, err := bm.OpenBackup(name); err == nil {
		f.Close()
		t.Fatal("a symlinked backup was opened")
	}
	if err := bm.RestoreBackup(nil, name); err == nil {
		t.Fatal("a symlinked backup was restored")
	}
}

func TestStoreUploadedBackup(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	f, err := os.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	name, err := bm.StoreUploadedBackup(f)
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	if !strings.HasSuffix(name, "_uploaded.db") || ValidateBackupName(name) != nil {
		t.Fatalf("bad name %q", name)
	}
	// Not restored: the live DB file is untouched and nothing is pending.
	if _, err := os.Stat(PendingRestorePath(dbPath)); !os.IsNotExist(err) {
		t.Fatal("an upload staged a restore")
	}
	// An invalid upload leaves nothing behind (no temp file, no backup).
	before, _ := os.ReadDir(bm.backupDir)
	if _, err := bm.StoreUploadedBackup(strings.NewReader("garbage garbage garbage garbage")); err == nil {
		t.Fatal("garbage stored")
	}
	after, _ := os.ReadDir(bm.backupDir)
	if len(after) != len(before) {
		t.Fatalf("invalid upload left files behind: %d -> %d", len(before), len(after))
	}
}

// M4: the upload's final name is taken exclusively: an existing file is never replaced.
func TestPlaceExclusiveNeverReplaces(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	os.WriteFile(src, []byte("new"), 0o644)
	os.WriteFile(dst, []byte("old"), 0o644)
	if err := placeExclusive(src, dst); err == nil {
		t.Fatal("replaced an existing file")
	}
	if b, _ := os.ReadFile(dst); string(b) != "old" {
		t.Fatal("existing file changed")
	}
	os.Remove(dst)
	if err := placeExclusive(src, dst); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Fatal("source left behind")
	}
	if b, _ := os.ReadFile(dst); string(b) != "new" {
		t.Fatal("not placed")
	}
}

// Fix round 2: without hard links, placing falls back to an exclusive copy.
func TestPlaceExclusiveWithoutHardLinks(t *testing.T) {
	linkFile = func(string, string) error {
		return &os.LinkError{Op: "link", Err: errors.New("operation not supported")}
	}
	t.Cleanup(func() { linkFile = os.Link })
	dir := t.TempDir()
	src, dst := filepath.Join(dir, "src"), filepath.Join(dir, "dst")
	os.WriteFile(src, []byte("new"), 0o644)
	os.WriteFile(dst, []byte("old"), 0o644)
	if err := placeExclusive(src, dst); err == nil {
		t.Fatal("replaced an existing file")
	}
	if b, _ := os.ReadFile(dst); string(b) != "old" {
		t.Fatal("existing file changed")
	}
	os.Remove(dst)
	if err := placeExclusive(src, dst); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(dst); string(b) != "new" {
		t.Fatal("not placed")
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Fatal("source left behind")
	}
}
