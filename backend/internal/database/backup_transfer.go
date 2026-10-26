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

// StoreUploadedBackup stores an uploaded backup (an archive or a legacy
// database) with no size caps of its own; see StoreUpload.
func (bm *BackupManager) StoreUploadedBackup(src io.Reader) (string, error) {
	r, err := bm.StoreUpload(src, UploadCaps{})
	return r.Name, err
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
