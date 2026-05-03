package database

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// setupBackupTest creates a temporary database file and a BackupManager for it.
func setupBackupTest(t *testing.T) (*BackupManager, string) {
	t.Helper()
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	// Create a real (initialized) database so VACUUM INTO works
	db, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("failed to init test database: %v", err)
	}
	db.Close()

	bm := NewBackupManager(dbPath)
	return bm, dbPath
}

// --- CreateBackup tests ---

func TestCreateBackup(t *testing.T) {
	bm, _ := setupBackupTest(t)

	path, err := bm.CreateBackup("manual")
	if err != nil {
		t.Fatalf("CreateBackup failed: %v", err)
	}

	// Verify file exists
	if _, err := os.Stat(path); err != nil {
		t.Errorf("backup file not created: %v", err)
	}

	// Verify name format
	name := filepath.Base(path)
	if !strings.HasPrefix(name, BackupPrefix) {
		t.Errorf("backup name missing prefix: %s", name)
	}
	if !strings.HasSuffix(name, BackupSuffix) {
		t.Errorf("backup name missing suffix: %s", name)
	}
	if !strings.Contains(name, "manual") {
		t.Errorf("backup name missing reason: %s", name)
	}
}

func TestCreateBackupSanitizesReason(t *testing.T) {
	bm, _ := setupBackupTest(t)

	// Reason with spaces and slashes should be sanitized
	path, err := bm.CreateBackup("my reason/with slashes")
	if err != nil {
		t.Fatalf("CreateBackup failed: %v", err)
	}

	name := filepath.Base(path)
	if strings.Contains(name, " ") {
		t.Errorf("backup name contains space: %s", name)
	}
	if strings.Contains(name, "/") {
		t.Errorf("backup name contains slash: %s", name)
	}
}

func TestCreateBackupWithDB(t *testing.T) {
	bm, dbPath := setupBackupTest(t)

	db, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("Initialize failed: %v", err)
	}
	defer db.Close()

	path, err := bm.CreateBackupWithDB(db, "test")
	if err != nil {
		t.Fatalf("CreateBackupWithDB failed: %v", err)
	}

	if _, err := os.Stat(path); err != nil {
		t.Errorf("backup file not created: %v", err)
	}

	// Verify the backup is itself a valid SQLite database
	backupDB, err := Initialize(path)
	if err != nil {
		t.Fatalf("backup file is not a valid SQLite database: %v", err)
	}
	defer backupDB.Close()

	var count int
	if err := backupDB.QueryRow("SELECT COUNT(*) FROM users").Scan(&count); err != nil {
		t.Errorf("backup missing users table: %v", err)
	}
}

// --- ListBackups tests ---

func TestListBackupsEmpty(t *testing.T) {
	bm, _ := setupBackupTest(t)

	backups, err := bm.ListBackups()
	if err != nil {
		t.Fatalf("ListBackups failed: %v", err)
	}
	if len(backups) != 0 {
		t.Errorf("expected 0 backups, got %d", len(backups))
	}
}

func TestListBackupsSortedNewestFirst(t *testing.T) {
	bm, _ := setupBackupTest(t)

	// Create three backups with explicit time gaps so mod times differ
	if _, err := bm.CreateBackup("first"); err != nil {
		t.Fatalf("CreateBackup failed: %v", err)
	}
	time.Sleep(1100 * time.Millisecond) // backup names use second-level timestamps
	if _, err := bm.CreateBackup("second"); err != nil {
		t.Fatalf("CreateBackup failed: %v", err)
	}
	time.Sleep(1100 * time.Millisecond)
	if _, err := bm.CreateBackup("third"); err != nil {
		t.Fatalf("CreateBackup failed: %v", err)
	}

	backups, err := bm.ListBackups()
	if err != nil {
		t.Fatalf("ListBackups failed: %v", err)
	}
	if len(backups) != 3 {
		t.Fatalf("expected 3 backups, got %d", len(backups))
	}

	// Newest first
	if !strings.Contains(backups[0].Name, "third") {
		t.Errorf("expected newest backup first, got %s", backups[0].Name)
	}
	if !strings.Contains(backups[2].Name, "first") {
		t.Errorf("expected oldest backup last, got %s", backups[2].Name)
	}
}

func TestListBackupsIgnoresNonBackupFiles(t *testing.T) {
	bm, _ := setupBackupTest(t)

	if _, err := bm.CreateBackup("test"); err != nil {
		t.Fatalf("CreateBackup failed: %v", err)
	}

	// Create a file that doesn't match the backup naming convention
	junkPath := filepath.Join(bm.backupDir, "not-a-backup.txt")
	if err := os.WriteFile(junkPath, []byte("junk"), 0644); err != nil {
		t.Fatalf("failed to write junk file: %v", err)
	}

	backups, err := bm.ListBackups()
	if err != nil {
		t.Fatalf("ListBackups failed: %v", err)
	}
	if len(backups) != 1 {
		t.Errorf("expected 1 backup (junk should be ignored), got %d", len(backups))
	}
}

// --- RestoreBackup tests ---

func TestRestoreBackup(t *testing.T) {
	bm, dbPath := setupBackupTest(t)

	// Create a backup
	backupPath, err := bm.CreateBackup("pre-modify")
	if err != nil {
		t.Fatalf("CreateBackup failed: %v", err)
	}
	backupName := filepath.Base(backupPath)

	// Modify the database
	db, err := Initialize(dbPath)
	if err != nil {
		t.Fatalf("Initialize failed: %v", err)
	}
	if _, err := db.Exec("UPDATE config SET data = '{\"modified\":true}'"); err != nil {
		t.Fatalf("failed to update config: %v", err)
	}
	db.Close()

	// Restore the backup
	if err := bm.RestoreBackup(backupName); err != nil {
		t.Fatalf("RestoreBackup failed: %v", err)
	}

	// Verify the modified data was reverted
	db, err = Initialize(dbPath)
	if err != nil {
		t.Fatalf("Initialize after restore failed: %v", err)
	}
	defer db.Close()

	var configData string
	if err := db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&configData); err != nil {
		t.Fatalf("failed to read config: %v", err)
	}
	if strings.Contains(configData, "modified") {
		t.Error("expected restore to revert config, but modified data remains")
	}
}

func TestRestoreBackupNonexistent(t *testing.T) {
	bm, _ := setupBackupTest(t)

	err := bm.RestoreBackup("hops-backup-2099-01-01_00-00-00_nonexistent.db")
	if err == nil {
		t.Error("expected RestoreBackup to fail for nonexistent backup")
	}
}

func TestRestoreBackupPathTraversal(t *testing.T) {
	bm, _ := setupBackupTest(t)

	// Try to restore with a path traversal attempt
	// The fix uses filepath.Base() so traversal segments are stripped,
	// resulting in a "not found" error instead of escaping the backup directory
	err := bm.RestoreBackup("../../../etc/passwd")
	if err == nil {
		t.Error("expected RestoreBackup to fail for path traversal attempt")
	}
	// Verify the error mentions "not found", not a successful restore
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("expected 'not found' error, got: %v", err)
	}
}

// --- DeleteBackup tests ---

func TestDeleteBackup(t *testing.T) {
	bm, _ := setupBackupTest(t)

	path, err := bm.CreateBackup("delete-me")
	if err != nil {
		t.Fatalf("CreateBackup failed: %v", err)
	}
	name := filepath.Base(path)

	if err := bm.DeleteBackup(name); err != nil {
		t.Fatalf("DeleteBackup failed: %v", err)
	}

	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("expected backup file to be deleted")
	}
}

func TestDeleteBackupInvalidName(t *testing.T) {
	bm, _ := setupBackupTest(t)

	// Names not matching the backup format must be rejected
	if err := bm.DeleteBackup("not-a-backup.txt"); err == nil {
		t.Error("expected DeleteBackup to reject invalid name")
	}
}

func TestDeleteBackupPathTraversal(t *testing.T) {
	bm, _ := setupBackupTest(t)

	// Path traversal should be sanitized via filepath.Base
	// then rejected by the prefix/suffix validation
	err := bm.DeleteBackup("../../../etc/passwd")
	if err == nil {
		t.Error("expected DeleteBackup to reject path traversal attempt")
	}
}

func TestDeleteBackupNonexistent(t *testing.T) {
	bm, _ := setupBackupTest(t)

	err := bm.DeleteBackup("hops-backup-2099-01-01_00-00-00_nonexistent.db")
	if err == nil {
		t.Error("expected DeleteBackup to fail for nonexistent backup")
	}
}

// --- CleanupOldBackups tests ---

func TestCleanupOldBackupsBelowLimit(t *testing.T) {
	bm, _ := setupBackupTest(t)

	// Create fewer backups than MaxBackups
	for i := 0; i < 3; i++ {
		if _, err := bm.CreateBackup("test"); err != nil {
			t.Fatalf("CreateBackup failed: %v", err)
		}
		time.Sleep(1100 * time.Millisecond)
	}

	if err := bm.CleanupOldBackups(); err != nil {
		t.Fatalf("CleanupOldBackups failed: %v", err)
	}

	backups, _ := bm.ListBackups()
	if len(backups) != 3 {
		t.Errorf("expected 3 backups (below limit), got %d", len(backups))
	}
}

func TestCleanupOldBackupsRemovesExcess(t *testing.T) {
	bm, _ := setupBackupTest(t)

	// Create one more than MaxBackups by manually placing files with distinct mod times.
	// We avoid CreateBackup here to keep the test fast (no per-iteration sleep).
	for i := 0; i < MaxBackups+3; i++ {
		name := filepath.Join(bm.backupDir, BackupPrefix+
			"2026-01-01_00-00-"+padZero(i)+"_test"+BackupSuffix)
		if err := os.MkdirAll(bm.backupDir, 0755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(name, []byte("dummy"), 0644); err != nil {
			t.Fatalf("write: %v", err)
		}
		// Set distinct mod times so sorting is deterministic
		modTime := time.Now().Add(time.Duration(i) * time.Second)
		if err := os.Chtimes(name, modTime, modTime); err != nil {
			t.Fatalf("chtimes: %v", err)
		}
	}

	if err := bm.CleanupOldBackups(); err != nil {
		t.Fatalf("CleanupOldBackups failed: %v", err)
	}

	backups, _ := bm.ListBackups()
	if len(backups) != MaxBackups {
		t.Errorf("expected %d backups after cleanup, got %d", MaxBackups, len(backups))
	}
}

func padZero(i int) string {
	if i < 10 {
		return "0" + string(rune('0'+i))
	}
	return string(rune('0'+i/10)) + string(rune('0'+i%10))
}

// --- copyFile test ---

func TestCopyFile(t *testing.T) {
	tmpDir := t.TempDir()
	src := filepath.Join(tmpDir, "source.txt")
	dst := filepath.Join(tmpDir, "dest.txt")

	content := []byte("hello world")
	if err := os.WriteFile(src, content, 0644); err != nil {
		t.Fatalf("failed to write source: %v", err)
	}

	if err := copyFile(src, dst); err != nil {
		t.Fatalf("copyFile failed: %v", err)
	}

	got, err := os.ReadFile(dst)
	if err != nil {
		t.Fatalf("failed to read dest: %v", err)
	}
	if string(got) != string(content) {
		t.Errorf("expected %q, got %q", content, got)
	}
}
