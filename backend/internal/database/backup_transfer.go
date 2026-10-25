package database

import (
	"fmt"
	"io"
	"log/slog"
	"os"
)

// Download and upload of backups (Settings › Backups). Both are admin-only
// at the API layer; names and contents are validated here as well.

// OpenBackup opens a backup for download.
func (bm *BackupManager) OpenBackup(name string) (*os.File, os.FileInfo, error) {
	path, fi, err := bm.backupFile(name)
	if err != nil {
		return nil, nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, fmt.Errorf("cannot open backup %s: %w", name, err)
	}
	return f, fi, nil
}

// StoreUploadedBackup validates an uploaded database and stores it as a new
// "…_uploaded" backup. It is never restored automatically. On any failure
// nothing is left behind.
func (bm *BackupManager) StoreUploadedBackup(src io.Reader) (string, error) {
	if err := os.MkdirAll(bm.backupDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create backup directory: %w", err)
	}
	// A dot-name that is not a backup name: never listed while it is written.
	tmp, err := os.CreateTemp(bm.backupDir, ".upload-*.tmp")
	if err != nil {
		return "", fmt.Errorf("cannot store the upload: %w", err)
	}
	tmpPath := tmp.Name()
	keep := false
	defer func() {
		if !keep {
			os.Remove(tmpPath)
		}
	}()
	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		return "", fmt.Errorf("cannot store the upload: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return "", fmt.Errorf("cannot store the upload: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return "", fmt.Errorf("cannot store the upload: %w", err)
	}
	if err := ValidateHOPSDatabase(tmpPath); err != nil {
		return "", err
	}
	name, path := bm.newBackupPath(UploadedReason)
	if err := os.Rename(tmpPath, path); err != nil {
		return "", fmt.Errorf("cannot store the upload: %w", err)
	}
	keep = true
	slog.Info("stored uploaded backup", "component", "backup", "name", name)
	if err := bm.CleanupOldBackups(); err != nil {
		slog.Warn("failed to cleanup old backups", "component", "backup", "error", err)
	}
	return name, nil
}
