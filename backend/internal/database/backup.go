package database

import (
	"bytes"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	// DefaultKeepCount is how many backups rotation keeps when no keep-count
	// is configured (the backup.keep_count setting's default).
	DefaultKeepCount = 10
	// MinKeepCount and MaxKeepCount bound the keep-count, whatever the
	// configured value (the settings registry enforces the same bounds).
	MinKeepCount = 3
	MaxKeepCount = 100
	// BackupPrefix is the prefix for backup files
	BackupPrefix = "hops-backup-"
	// BackupSuffix is the suffix for backup files
	BackupSuffix = ".db"
	// PreV3MigrationReason names the synchronous backup taken just before the
	// one-way v2→v3 config migration. It is the only whole-DB copy of the v2
	// data (the rollback path to v2.2.1), so rotation never deletes it.
	PreV3MigrationReason = "pre-v3-migration"
	// UploadedReason names a backup the admin uploaded (never restored
	// automatically; it is restored like any other backup).
	UploadedReason = "uploaded"
	// PendingRestoreSuffix is appended to the DB path for a restore staged
	// to be applied on the next start (see RestoreBackup).
	PendingRestoreSuffix = ".restore-pending"
	// maxBackupNameLen bounds a backup name taken from a request.
	maxBackupNameLen = 200
)

// requiredTables are the tables every HOPS database has had since the
// oldest schema HOPS still migrates (see migration_safety_test.go). A file
// without them is not a HOPS database.
var requiredTables = []string{"users", "config", "app_settings"}

// backupNamePattern is the strict shape of a backup name: our prefix, then
// only letters, digits, '.', '_' and '-', then ".db". No separators, so a
// name can never leave the backups directory.
var backupNamePattern = regexp.MustCompile(`^` + regexp.QuoteMeta(BackupPrefix) + `[A-Za-z0-9._-]+` + regexp.QuoteMeta(BackupSuffix) + `$`)

// isPinnedBackup reports whether rotation must keep this backup regardless
// of age (only the admin may delete it, from the Backups page).
func isPinnedBackup(name string) bool {
	return strings.HasSuffix(name, "_"+PreV3MigrationReason+BackupSuffix)
}

// ValidateBackupName refuses anything that is not a plain backup file name
// (used for every name taken from a request: restore, delete, download).
func ValidateBackupName(name string) error {
	if len(name) > maxBackupNameLen || !backupNamePattern.MatchString(name) ||
		strings.Contains(name, "..") || filepath.Base(name) != name {
		return fmt.Errorf("invalid backup name: %q", name)
	}
	return nil
}

// Problem kinds recorded for the UI (Problems).
const (
	ProblemBackupFailed   = "backup-failed"
	ProblemRotationFailed = "rotation-failed"
	ProblemRestoreFailed  = "restore-failed"
)

// BackupProblem is a backup failure the admin must see: what failed, when,
// and why. It stays until the condition is cleared (a later backup, rotation
// or restore that works).
type BackupProblem struct {
	Kind    string    `json:"kind"`
	Trigger string    `json:"trigger,omitempty"` // the backup's reason, e.g. "startup"
	At      time.Time `json:"at"`
	Reason  string    `json:"reason"`
}

// SafetyBackupError means the backup taken before a destructive action
// failed, so the action was not done.
type SafetyBackupError struct{ Err error }

func (e *SafetyBackupError) Error() string { return "safety backup failed: " + e.Err.Error() }
func (e *SafetyBackupError) Unwrap() error { return e.Err }

// InvalidBackupError means a file is not a usable HOPS database.
type InvalidBackupError struct{ Reason string }

func (e *InvalidBackupError) Error() string { return e.Reason }

// ErrBackupNotFound is returned for a well-formed name with no such backup.
var ErrBackupNotFound = errors.New("backup not found")

// ErrInvalidBackupName is returned for a name ValidateBackupName refuses.
var ErrInvalidBackupName = errors.New("invalid backup name")

// FailureHooks inject failures for tests (a nil hook does nothing). Create
// runs before a backup is written; Remove replaces os.Remove in rotation.
type FailureHooks struct {
	Create func(reason string) error
	Remove func(path string) error
}

// BackupManager handles database backup operations
type BackupManager struct {
	dbPath    string
	backupDir string

	mu        sync.Mutex
	keepCount func() int
	hooks     FailureHooks
	backupErr *BackupProblem // the latest failed backup, until one succeeds
	rotateErr *BackupProblem // the latest rotation that could not delete, until one works
	restore   *BackupProblem // a staged restore that could not be applied at startup
}

// NewBackupManager creates a new backup manager
func NewBackupManager(dbPath string) *BackupManager {
	backupDir := filepath.Join(filepath.Dir(dbPath), "backups")
	return &BackupManager{
		dbPath:    dbPath,
		backupDir: backupDir,
	}
}

var (
	sharedMu       sync.Mutex
	sharedManagers = map[string]*BackupManager{}
)

// SharedBackupManager returns the one manager for dbPath in this process, so
// that the startup backup (main) and the API see the same failure record.
func SharedBackupManager(dbPath string) *BackupManager {
	key := filepath.Clean(dbPath)
	if abs, err := filepath.Abs(key); err == nil {
		key = abs
	}
	sharedMu.Lock()
	defer sharedMu.Unlock()
	if bm, ok := sharedManagers[key]; ok {
		return bm
	}
	bm := NewBackupManager(dbPath)
	sharedManagers[key] = bm
	return bm
}

// SetKeepCount sets where the keep-count comes from (the backup.keep_count
// setting). The value is clamped to [MinKeepCount, MaxKeepCount].
func (bm *BackupManager) SetKeepCount(fn func() int) {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	bm.keepCount = fn
}

// SetFailureHooks installs test failure hooks.
func (bm *BackupManager) SetFailureHooks(h FailureHooks) {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	bm.hooks = h
}

// KeepCount is how many (unpinned) backups rotation keeps.
func (bm *BackupManager) KeepCount() int {
	bm.mu.Lock()
	fn := bm.keepCount
	bm.mu.Unlock()
	n := DefaultKeepCount
	if fn != nil {
		n = fn()
	}
	if n < MinKeepCount {
		n = MinKeepCount
	}
	if n > MaxKeepCount {
		n = MaxKeepCount
	}
	return n
}

// Problems returns the backup failures the admin must see, oldest first.
func (bm *BackupManager) Problems() []BackupProblem {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	var out []BackupProblem
	for _, p := range []*BackupProblem{bm.restore, bm.backupErr, bm.rotateErr} {
		if p != nil {
			out = append(out, *p)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.Before(out[j].At) })
	return out
}

// RecordRestoreFailure records that a staged restore could not be applied
// at startup (main calls it with ApplyPendingRestore's error).
func (bm *BackupManager) RecordRestoreFailure(err error) {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	bm.restore = &BackupProblem{Kind: ProblemRestoreFailed, At: time.Now(), Reason: err.Error()}
}

func (bm *BackupManager) noteBackup(reason string, err error) {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	if err != nil {
		bm.backupErr = &BackupProblem{Kind: ProblemBackupFailed, Trigger: reason, At: time.Now(), Reason: err.Error()}
		return
	}
	bm.backupErr = nil
}

func (bm *BackupManager) createHook(reason string) error {
	bm.mu.Lock()
	h := bm.hooks.Create
	bm.mu.Unlock()
	if h != nil {
		return h(reason)
	}
	return nil
}

func (bm *BackupManager) remove(path string) error {
	bm.mu.Lock()
	h := bm.hooks.Remove
	bm.mu.Unlock()
	if h != nil {
		return h(path)
	}
	return os.Remove(path)
}

// newBackupPath names a new backup "hops-backup-<timestamp>[-n]_<reason>.db".
// Timestamps have one-second resolution, so a second backup within the same
// second gets a "-2", "-3"... suffix instead of clashing with (or, on the
// file-copy path, overwriting) the first.
func (bm *BackupManager) newBackupPath(reason string) (string, string) {
	timestamp := time.Now().Format("2006-01-02_15-04-05")
	safeReason := strings.ReplaceAll(reason, " ", "-")
	safeReason = strings.ReplaceAll(safeReason, "/", "-")
	stamp := timestamp
	for n := 2; ; n++ {
		name := fmt.Sprintf("%s%s_%s%s", BackupPrefix, stamp, safeReason, BackupSuffix)
		path := filepath.Join(bm.backupDir, name)
		if _, err := os.Lstat(path); os.IsNotExist(err) {
			return name, path
		}
		stamp = fmt.Sprintf("%s-%d", timestamp, n)
	}
}

// manualReasonPattern is what is kept of a reason typed for a manual backup.
var manualReasonPattern = regexp.MustCompile(`[^a-z0-9-]`)

// SanitizeManualReason makes a requested backup reason safe for a file name
// (lower-case letters, digits and '-', at most 40) and refuses the reasons
// with a special meaning (the pinned pre-v3-migration one, "uploaded").
func SanitizeManualReason(reason string) (string, error) {
	r := manualReasonPattern.ReplaceAllString(strings.ToLower(strings.TrimSpace(reason)), "-")
	if len(r) > 40 {
		r = r[:40]
	}
	if strings.Trim(r, "-") == "" {
		return "manual", nil
	}
	if r == PreV3MigrationReason || r == UploadedReason {
		return "", fmt.Errorf("%q is reserved for backups HOPS takes itself", r)
	}
	return r, nil
}

// CreateBackup creates a backup by copying the database file. Use
// CreateBackupWithDB while the database is open (WAL mode: a plain copy
// misses what is still in the WAL).
func (bm *BackupManager) CreateBackup(reason string) (string, error) {
	path, err := bm.createBackup(reason, nil)
	bm.noteBackup(reason, err)
	return path, err
}

// CreateBackupWithDB creates a backup using an open database connection
// (VACUUM INTO), so it is a consistent copy including the WAL. A failure is
// recorded (Problems) until a later backup succeeds.
func (bm *BackupManager) CreateBackupWithDB(db *sql.DB, reason string) (string, error) {
	path, err := bm.createBackup(reason, db)
	bm.noteBackup(reason, err)
	return path, err
}

func (bm *BackupManager) createBackup(reason string, db *sql.DB) (string, error) {
	if err := bm.createHook(reason); err != nil {
		return "", err
	}
	if err := os.MkdirAll(bm.backupDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create backup directory: %w", err)
	}

	backupName, backupPath := bm.newBackupPath(reason)

	if db != nil {
		// SQLite's VACUUM INTO (3.27+). Quotes doubled against SQL injection.
		sanitizedPath := strings.ReplaceAll(backupPath, "'", "''")
		if _, err := db.Exec(fmt.Sprintf("VACUUM INTO '%s'", sanitizedPath)); err != nil {
			os.Remove(backupPath) // never leave a partial file listed as a backup
			return "", fmt.Errorf("failed to write backup: %w", err)
		}
	} else if err := copyFile(bm.dbPath, backupPath); err != nil {
		os.Remove(backupPath)
		return "", fmt.Errorf("failed to copy database: %w", err)
	}

	slog.Info("created backup", "component", "backup", "name", backupName)

	if err := bm.CleanupOldBackups(); err != nil {
		slog.Warn("failed to cleanup old backups", "component", "backup", "error", err)
	}

	return backupPath, nil
}

// ListBackups returns a list of available backups sorted by date (newest first)
func (bm *BackupManager) ListBackups() ([]BackupInfo, error) {
	entries, err := os.ReadDir(bm.backupDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []BackupInfo{}, nil
		}
		return nil, fmt.Errorf("failed to read backup directory: %w", err)
	}

	backups := []BackupInfo{}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasPrefix(name, BackupPrefix) || !strings.HasSuffix(name, BackupSuffix) {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		backups = append(backups, BackupInfo{
			Name:      name,
			Path:      filepath.Join(bm.backupDir, name),
			Size:      info.Size(),
			CreatedAt: info.ModTime(),
			Pinned:    isPinnedBackup(name),
		})
	}

	// Sort by creation time (newest first)
	sort.Slice(backups, func(i, j int) bool {
		return backups[i].CreatedAt.After(backups[j].CreatedAt)
	})

	return backups, nil
}

// backupFile validates name and returns the path of that backup, which must
// be a regular file (not a symlink) in the backups directory.
func (bm *BackupManager) backupFile(name string) (string, os.FileInfo, error) {
	if err := ValidateBackupName(name); err != nil {
		return "", nil, fmt.Errorf("%w: %q", ErrInvalidBackupName, name)
	}
	path := filepath.Join(bm.backupDir, name)
	fi, err := os.Lstat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil, fmt.Errorf("%w: %s", ErrBackupNotFound, name)
		}
		return "", nil, fmt.Errorf("cannot read backup %s: %w", name, err)
	}
	if !fi.Mode().IsRegular() {
		return "", nil, fmt.Errorf("%w: %s is not a regular file", ErrInvalidBackupName, name)
	}
	return path, fi, nil
}

// PendingRestorePath is where a restore is staged until the next start.
func PendingRestorePath(dbPath string) string { return dbPath + PendingRestoreSuffix }

// RestoreBackup stages a restore from the named backup.
//
// Order, each step refusing the restore when it fails (nothing changed):
//  1. the name is valid and the backup is a regular file here;
//  2. the backup is a real HOPS database (ValidateHOPSDatabase);
//  3. a "pre-restore" safety backup of the current data is taken (with db,
//     through VACUUM INTO so the WAL is included) — a failure is a
//     *SafetyBackupError and the restore is refused;
//  4. the backup is copied to PendingRestorePath.
//
// The database file is never replaced under the open connection: in WAL mode
// the old WAL would be checkpointed into the new file and corrupt it. The
// caller restarts the process, and ApplyPendingRestore swaps the file in
// before the database is opened.
func (bm *BackupManager) RestoreBackup(db *sql.DB, backupName string) error {
	backupPath, _, err := bm.backupFile(backupName)
	if err != nil {
		return err
	}
	if err := ValidateHOPSDatabase(backupPath); err != nil {
		return err
	}

	var safetyErr error
	if db != nil {
		_, safetyErr = bm.CreateBackupWithDB(db, "pre-restore")
	} else {
		_, safetyErr = bm.CreateBackup("pre-restore")
	}
	if safetyErr != nil {
		slog.Error("restore refused: pre-restore backup failed", "component", "backup", "name", backupName, "error", safetyErr)
		return &SafetyBackupError{Err: safetyErr}
	}

	pending := PendingRestorePath(bm.dbPath)
	tmp := pending + ".tmp"
	if err := copyFile(backupPath, tmp); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("failed to stage the restore: %w", err)
	}
	if err := os.Rename(tmp, pending); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("failed to stage the restore: %w", err)
	}

	slog.Info("restore staged; applied on the next start", "component", "backup", "name", backupName)
	return nil
}

// ApplyPendingRestore swaps a staged restore in for the database file. It
// must run before the database is opened. It reports whether a restore was
// applied; on error the current database is left in place (and the staged
// file kept, so the next start tries again) and the caller must surface it.
func ApplyPendingRestore(dbPath string) (bool, error) {
	pending := PendingRestorePath(dbPath)
	if _, err := os.Lstat(pending); err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, fmt.Errorf("cannot read the staged restore: %w", err)
	}
	if err := ValidateHOPSDatabase(pending); err != nil {
		return false, fmt.Errorf("the staged restore is not usable: %w", err)
	}
	// The old database's WAL and shared-memory files belong to the old file;
	// left in place they would be replayed into the restored one.
	for _, suffix := range []string{"-wal", "-shm"} {
		if err := os.Remove(dbPath + suffix); err != nil && !os.IsNotExist(err) {
			return false, fmt.Errorf("cannot remove the old %s file: %w", suffix, err)
		}
	}
	if err := os.Rename(pending, dbPath); err != nil {
		return false, fmt.Errorf("cannot put the restored database in place: %w", err)
	}
	return true, nil
}

// sqliteMagic starts every SQLite 3 database file.
var sqliteMagic = []byte("SQLite format 3\x00")

// ValidateHOPSDatabase checks that path is a SQLite database with HOPS's
// tables, opening it read-only (immutable: nothing is written, not even a
// journal). The error says why it is refused, for the user.
func ValidateHOPSDatabase(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return &InvalidBackupError{Reason: "cannot read the file: " + err.Error()}
	}
	head := make([]byte, len(sqliteMagic))
	_, rerr := io.ReadFull(f, head)
	f.Close()
	if rerr != nil || !bytes.Equal(head, sqliteMagic) {
		return &InvalidBackupError{Reason: "this file is not a SQLite database"}
	}

	abs, err := filepath.Abs(path)
	if err != nil {
		return &InvalidBackupError{Reason: "cannot read the file: " + err.Error()}
	}
	u := url.URL{Scheme: "file", Path: abs, RawQuery: "mode=ro&immutable=1"}
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return &InvalidBackupError{Reason: "this file is not a readable SQLite database: " + err.Error()}
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	var check string
	if err := db.QueryRow("PRAGMA quick_check").Scan(&check); err != nil {
		return &InvalidBackupError{Reason: "this file is not a readable SQLite database: " + err.Error()}
	}
	if check != "ok" {
		return &InvalidBackupError{Reason: "this SQLite database is damaged: " + check}
	}
	var missing []string
	for _, t := range requiredTables {
		var n int
		if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, t).Scan(&n); err != nil {
			return &InvalidBackupError{Reason: "this file is not a readable SQLite database: " + err.Error()}
		}
		if n == 0 {
			missing = append(missing, t)
		}
	}
	if len(missing) > 0 {
		return &InvalidBackupError{Reason: "this is not a HOPS database (it has no " + strings.Join(missing, ", ") + " table)"}
	}
	return nil
}

// DeleteBackup removes a specific backup file
func (bm *BackupManager) DeleteBackup(backupName string) error {
	backupPath, _, err := bm.backupFile(backupName)
	if err != nil {
		return err
	}
	if err := os.Remove(backupPath); err != nil {
		return fmt.Errorf("failed to delete backup: %w", err)
	}

	slog.Info("deleted backup", "component", "backup", "name", backupName)
	return nil
}

// CleanupOldBackups removes backups beyond the keep-count. Pinned backups
// (the pre-v3-migration one) are neither counted nor removed. A backup it
// cannot delete is recorded (Problems) until a later rotation works, and
// returned as an error.
func (bm *BackupManager) CleanupOldBackups() error {
	err := bm.cleanupOldBackups()
	bm.mu.Lock()
	if err != nil {
		bm.rotateErr = &BackupProblem{Kind: ProblemRotationFailed, At: time.Now(), Reason: err.Error()}
	} else {
		bm.rotateErr = nil
	}
	bm.mu.Unlock()
	return err
}

func (bm *BackupManager) cleanupOldBackups() error {
	all, err := bm.ListBackups()
	if err != nil {
		return err
	}
	backups := make([]BackupInfo, 0, len(all))
	for _, b := range all {
		if !b.Pinned {
			backups = append(backups, b)
		}
	}

	keep := bm.KeepCount()
	if len(backups) <= keep {
		return nil
	}

	var failed []string
	for _, backup := range backups[keep:] {
		if err := bm.remove(backup.Path); err != nil {
			slog.Warn("failed to remove old backup", "component", "backup", "name", backup.Name, "error", err)
			failed = append(failed, backup.Name+": "+errText(err))
		} else {
			slog.Info("removed old backup", "component", "backup", "name", backup.Name)
		}
	}
	if len(failed) > 0 {
		return fmt.Errorf("could not delete %d old backup(s): %s", len(failed), strings.Join(failed, "; "))
	}
	return nil
}

// errText is an error's text without the path os errors repeat.
func errText(err error) string {
	var pe *os.PathError
	if errors.As(err, &pe) {
		return pe.Err.Error()
	}
	return err.Error()
}

// BackupInfo contains information about a backup file
type BackupInfo struct {
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"createdAt"`
	Pinned    bool      `json:"pinned"`
}

// copyFile copies a file from src to dst
func copyFile(src, dst string) error {
	sourceFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	destFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, sourceFile)
	if err != nil {
		return err
	}

	return destFile.Sync()
}
