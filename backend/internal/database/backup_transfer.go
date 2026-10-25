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
	var name string
	for attempt := 0; ; attempt++ {
		n, path := bm.newBackupPath(UploadedReason)
		err := placeExclusive(tmpPath, path)
		if err == nil {
			name = n
			break
		}
		if !os.IsExist(err) || attempt >= 5 {
			return "", fmt.Errorf("cannot store the upload: %w", err)
		}
	}
	keep = true
	slog.Info("stored uploaded backup", "component", "backup", "name", name)
	if err := bm.CleanupOldBackups(); err != nil {
		slog.Warn("failed to cleanup old backups", "component", "backup", "error", err)
	}
	return name, nil
}

// linkFile is os.Link; tests simulate a filesystem without hard links.
var linkFile = os.Link

// placeExclusive moves src to dst only if dst doesn't exist (a hard link
// fails on an existing name, unlike rename, which would replace it). Where
// hard links aren't supported it falls back to an exclusive create + copy.
func placeExclusive(src, dst string) error {
	if err := linkFile(src, dst); err != nil {
		if os.IsExist(err) {
			return err
		}
		if cerr := copyExclusive(src, dst); cerr != nil {
			return cerr
		}
	}
	if err := os.Remove(src); err != nil {
		// Placed; the leftover temp name is swept at the next start.
		slog.Warn("could not remove the upload's temporary file", "component", "backup", "file", src, "error", err)
	}
	return nil
}

// copyExclusive copies src to a NEW file dst (O_EXCL: never an existing one).
func copyExclusive(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(dst)
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		os.Remove(dst)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(dst)
		return err
	}
	return nil
}
