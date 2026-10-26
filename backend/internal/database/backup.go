package database

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
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
	"syscall"
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
	// FailedRestoreSuffix is where a stage that could not be applied is set
	// aside (so it is not retried on every start), for the admin to inspect.
	FailedRestoreSuffix = ".restore-failed"
	// preApplySuffix: the current database (and its -wal/-shm) is moved
	// aside to this while a staged restore is put in place.
	preApplySuffix = ".pre-apply"
	// noticesFile (in the backups dir) keeps the dismissible backup notices
	// across restarts.
	noticesFile = ".notices.json"
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
	// ProblemCeilingDeleted is not a failure but must be seen: backups newer
	// than keep_days were deleted to stay under max_count.
	ProblemCeilingDeleted = "ceiling-deleted"
	// ProblemRestoreRecovered reports what startup did with an interrupted
	// restore (undone, or completed). Dismissible.
	ProblemRestoreRecovered = "restore-recovered"
	// ProblemNoticesUnreadable: the saved notices file couldn't be read
	// (a notice may be missing). Dismissible.
	ProblemNoticesUnreadable = "notices-unreadable"
	// ProblemNoticesUnsaved: notices couldn't be saved and will be lost on
	// restart. Not dismissible; cleared by the next successful save.
	ProblemNoticesUnsaved = "notices-unsaved"
	// ProblemJournalLeft: the restore journal couldn't be removed. Not
	// dismissible; retried before the next restore and at the next start.
	ProblemJournalLeft = "restore-journal-left"
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
	retention func() RetentionPolicy
	hooks     FailureHooks
	backupErr *BackupProblem // the latest failed backup, until one succeeds
	rotateErr *BackupProblem // the latest cleanup that could not delete, until one works
	restore   *BackupProblem // a staged restore that could not be applied at startup
	ceiling   *BackupProblem // backups within keep_days deleted for max_count, until dismissed
	recovered *BackupProblem // an interrupted restore was undone / completed at startup, until dismissed
	// The notices file itself: unreadable/damaged at load (dismissible;
	// also cleared by the next successful save), and a save that failed
	// (not dismissible; cleared by the next successful save).
	noticesLoadErr *BackupProblem
	noticesSaveErr *BackupProblem
	journalErr     *BackupProblem // the restore journal couldn't be removed (retried before the next restore)

	// Uploaded images (M6 §12): the attic sweep's notices, and the restore's
	// image report (dismissible, kept across restarts).
	atticBlocked  *BackupProblem
	atticFailed   *BackupProblem
	atticLargeP   *BackupProblem
	restoreImages *BackupProblem
	liveDB        *sql.DB
	refCache      map[string]cachedRefs
	indexRebuilt  *BackupProblem // the attic index was rebuilt (dismissible, kept across restarts)
	// atticMu serialises moves into and out of the attic with its sweep.
	atticMu sync.Mutex
}

// NewBackupManager creates a new backup manager
func NewBackupManager(dbPath string) *BackupManager {
	backupDir := filepath.Join(filepath.Dir(dbPath), "backups")
	bm := &BackupManager{
		dbPath:    dbPath,
		backupDir: backupDir,
	}
	bm.loadNotices()
	return bm
}

// persistedNotices is backups/.notices.json: the dismissible notices
// (restore-failed, ceiling-deleted), kept until the admin dismisses them.
type persistedNotices struct {
	Restore   *BackupProblem `json:"restore,omitempty"`
	Ceiling   *BackupProblem `json:"ceiling,omitempty"`
	Recovered *BackupProblem `json:"recovered,omitempty"`
	Images    *BackupProblem `json:"images,omitempty"`
	Index     *BackupProblem `json:"index,omitempty"`
}

// loadNotices reads the persisted notices. An unreadable file is itself
// shown (as a restore-failed-kind notice would be silent otherwise).
func (bm *BackupManager) loadNotices() {
	raw, err := os.ReadFile(filepath.Join(bm.backupDir, noticesFile))
	if err != nil {
		if !os.IsNotExist(err) {
			slog.Error("cannot read the saved backup notices", "component", "backup", "error", err)
			bm.noticesLoadErr = &BackupProblem{Kind: ProblemNoticesUnreadable, At: time.Now(),
				Reason: "the saved backup notices could not be read (" + errText(err) + "); a notice may be missing"}
		}
		return
	}
	var pn persistedNotices
	if err := json.Unmarshal(raw, &pn); err != nil {
		slog.Error("the saved backup notices are damaged", "component", "backup", "error", err)
		bm.noticesLoadErr = &BackupProblem{Kind: ProblemNoticesUnreadable, At: time.Now(),
			Reason: "the saved backup notices are damaged (" + err.Error() + "); a notice may be missing"}
		return
	}
	bm.restore, bm.ceiling, bm.recovered, bm.restoreImages, bm.indexRebuilt = pn.Restore, pn.Ceiling, pn.Recovered, pn.Images, pn.Index
}

// saveNoticesLocked writes the dismissible notices (bm.mu held). A failure
// becomes a non-dismissible notice (they would be lost on restart), cleared
// by the next successful save, which also clears a load error.
func (bm *BackupManager) saveNoticesLocked() {
	path := filepath.Join(bm.backupDir, noticesFile)
	err := func() error {
		if bm.restore == nil && bm.ceiling == nil && bm.recovered == nil && bm.restoreImages == nil && bm.indexRebuilt == nil {
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				return err
			}
			return nil
		}
		raw, _ := json.Marshal(persistedNotices{Restore: bm.restore, Ceiling: bm.ceiling, Recovered: bm.recovered, Images: bm.restoreImages, Index: bm.indexRebuilt})
		if err := os.MkdirAll(bm.backupDir, 0755); err != nil {
			return err
		}
		tmp := path + ".tmp"
		if err := os.WriteFile(tmp, raw, 0644); err != nil {
			os.Remove(tmp)
			return err
		}
		return os.Rename(tmp, path)
	}()
	if err != nil {
		slog.Error("cannot save the backup notices; they will be lost on restart", "component", "backup", "error", err)
		bm.noticesSaveErr = &BackupProblem{Kind: ProblemNoticesUnsaved, At: time.Now(),
			Reason: "backup notices couldn't be saved and will be lost on restart: " + errText(err)}
		return
	}
	bm.noticesSaveErr = nil // the load error stays until dismissed
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

// SetRetention sets where the retention policy comes from (the backup.*
// settings). The policy is normalized (RetentionPolicy.Normalized).
func (bm *BackupManager) SetRetention(fn func() RetentionPolicy) {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	bm.retention = fn
}

// SetFailureHooks installs test failure hooks.
func (bm *BackupManager) SetFailureHooks(h FailureHooks) {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	bm.hooks = h
}

// Retention is the policy cleanup applies now.
func (bm *BackupManager) Retention() RetentionPolicy {
	bm.mu.Lock()
	fn := bm.retention
	bm.mu.Unlock()
	p := DefaultRetention
	if fn != nil {
		p = fn()
	}
	return p.Normalized()
}

// Problems returns the backup failures the admin must see, oldest first.
func (bm *BackupManager) Problems() []BackupProblem {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	var out []BackupProblem
	for _, p := range []*BackupProblem{bm.restore, bm.backupErr, bm.rotateErr, bm.ceiling, bm.recovered, bm.noticesLoadErr, bm.noticesSaveErr, bm.journalErr,
		bm.atticBlocked, bm.atticFailed, bm.atticLargeP, bm.restoreImages, bm.indexRebuilt} {
		if p != nil {
			out = append(out, *p)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.Before(out[j].At) })
	return out
}

// DismissProblem drops a dismissible notice (ceiling-deleted or
// restore-failed) and forgets it across restarts. It reports whether there
// was one; failures (backup, cleanup) are not dismissible.
func (bm *BackupManager) DismissProblem(kind string) bool {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	var had bool
	switch kind {
	case ProblemCeilingDeleted:
		had, bm.ceiling = bm.ceiling != nil, nil
	case ProblemRestoreFailed:
		had, bm.restore = bm.restore != nil, nil
	case ProblemRestoreRecovered:
		had, bm.recovered = bm.recovered != nil, nil
	case ProblemRestoreImages:
		had, bm.restoreImages = bm.restoreImages != nil, nil
	case ProblemAtticIndexRebuilt:
		had, bm.indexRebuilt = bm.indexRebuilt != nil, nil
	case ProblemNoticesUnreadable:
		had, bm.noticesLoadErr = bm.noticesLoadErr != nil, nil
		return had // nothing in the file changes
	default:
		return false
	}
	if had {
		bm.saveNoticesLocked()
	}
	return had
}

// RecordJournalLeft records that the restore journal couldn't be removed.
func (bm *BackupManager) RecordJournalLeft(reason string) {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	bm.journalErr = &BackupProblem{Kind: ProblemJournalLeft, At: time.Now(),
		Reason: "the restore journal (" + filepath.Base(bm.dbPath+restoreJournalSuffix) + ") couldn't be removed: " + reason +
			". HOPS tries again before the next restore and at the next start; until it is gone, a new restore may be refused"}
}

// RecordRestoreRecovery records what startup did with an interrupted
// restore, as a dismissible notice kept across restarts. detail (optional)
// is appended.
func (bm *BackupManager) RecordRestoreRecovery(o Outcome, detail ...string) {
	var reason string
	switch o {
	case OutcomeUndone:
		reason = "An interrupted restore was undone: HOPS is running on the data it had before the restore. Try the restore again from Settings › Backups"
	case OutcomeRecoveredApplied:
		reason = "The restore was applied (HOPS had stopped part-way through putting it in place, and finished it at this start)"
	default:
		return
	}
	for _, d := range detail {
		if d != "" {
			reason += ". " + d
		}
	}
	bm.mu.Lock()
	defer bm.mu.Unlock()
	bm.recovered = &BackupProblem{Kind: ProblemRestoreRecovered, At: time.Now(), Reason: reason}
	bm.saveNoticesLocked()
}

// RecordRestoreFailure records that a staged restore could not be applied
// at startup (main calls it with ApplyPendingRestore's error).
func (bm *BackupManager) RecordRestoreFailure(err error) {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	bm.restore = &BackupProblem{Kind: ProblemRestoreFailed, At: time.Now(), Reason: err.Error()}
	bm.saveNoticesLocked()
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

	// Which version of each image it uses (M6 §12): part of the backup.
	if err := bm.recordBackup(backupName, backupPath); err != nil {
		os.Remove(backupPath)
		os.Remove(bm.recordPath(backupName))
		return "", fmt.Errorf("failed to record the backup's images: %w", err)
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
			Protected: IsProtectedBackup(name),
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
//  2. the backup is copied to a temporary stage, and that copy is checked
//     to be a real HOPS database (ValidateHOPSDatabase) — copied FIRST, so
//     the safety backup's cleanup can never delete the target (e.g. the
//     oldest backup kept);
//  3. a "pre-restore" safety backup of the current data is taken (with db,
//     through VACUUM INTO so the WAL is included) — a failure is a
//     *SafetyBackupError and the restore is refused;
//  4. the stage is renamed to PendingRestorePath.
//
// The database file is never replaced under the open connection: in WAL mode
// the old WAL would be checkpointed into the new file and corrupt it. The
// caller restarts the process, and ApplyPendingRestore swaps the file in
// before the database is opened. Writes made between the safety backup and
// the restart are not in either copy (the confirmation says so).
func (bm *BackupManager) RestoreBackup(db *sql.DB, backupName string) error {
	backupPath, _, err := bm.backupFile(backupName)
	if err != nil {
		return err
	}
	if err := ClearLeftoverJournal(bm.dbPath); err != nil {
		return err
	}
	bm.mu.Lock()
	bm.journalErr = nil
	bm.mu.Unlock()
	pending := PendingRestorePath(bm.dbPath)
	tmp := pending + ".tmp"
	if err := copyFile(backupPath, tmp); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("failed to stage the restore: %w", err)
	}
	staged := false
	defer func() {
		if !staged {
			os.Remove(tmp)
		}
	}()
	if err := ValidateHOPSDatabase(tmp); err != nil {
		return err
	}
	// Its image record, read now: the safety backup's cleanup may delete the
	// backup (and its record) before the restore is staged.
	rec, err := bm.readRecord(backupName)
	if err != nil {
		return fmt.Errorf("the backup %s: %w", backupName, err)
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

	// Which backup is restored: its own images (an uploaded archive's) are
	// installed at the next start, after the restore is applied.
	if err := bm.writeRestoreMarker(backupName, rec); err != nil {
		return fmt.Errorf("failed to stage the restore: %w", err)
	}
	if err := os.Rename(tmp, pending); err != nil {
		os.Remove(restoreImagesMarkerPath(bm.dbPath))
		return fmt.Errorf("failed to stage the restore: %w", err)
	}
	staged = true
	slog.Info("restore staged; applied on the next start", "component", "backup", "name", backupName)
	return nil
}

// PendingRestore reports whether a restore is staged (applied on the next start).
func (bm *BackupManager) PendingRestore() bool {
	_, err := os.Lstat(PendingRestorePath(bm.dbPath))
	return err == nil
}

// DiscardPendingRestore removes a staged restore (os.ErrNotExist if none).
func (bm *BackupManager) DiscardPendingRestore() error {
	err := os.Remove(PendingRestorePath(bm.dbPath))
	if err == nil {
		slog.Info("staged restore discarded", "component", "backup")
		if rerr := os.Remove(restoreImagesMarkerPath(bm.dbPath)); rerr != nil && !os.IsNotExist(rerr) {
			slog.Warn("could not remove the discarded restore's image marker", "component", "backup", "error", rerr)
		}
	}
	return err
}

// renameFile is os.Rename; tests inject failures.
var renameFile = os.Rename

// crashAfter, when set (tests), makes RecoverAndApplyRestore stop dead after
// the named step, as a power cut would, so the next start's recovery is tested.
var crashAfter func(step string) bool

var errSimulatedCrash = errors.New("simulated crash")

func crashed(step string) bool { return crashAfter != nil && crashAfter(step) }

// dbFileSuffixes are the database file and its WAL-mode companions, in the
// order they are moved aside.
var dbFileSuffixes = []string{"", "-wal", "-shm"}

// restoreJournalSuffix names the journal an apply writes before it moves
// anything, so an interrupted apply can be resolved with certainty.
const restoreJournalSuffix = ".restore-journal"

type restoreJournal struct {
	StageSHA256 string `json:"stageSha256"` // the staged file: proves hops.db IS the restored file
	State       string `json:"state"`       // "moving" until the stage is in place, then "applied"
}

// UnsafeStartError means the files are in a state HOPS can't resolve with
// certainty after an interrupted or half-failed restore. HOPS must NOT start
// (opening the database would create an empty one and serve it as real
// data); the message names the files and what to do.
type UnsafeStartError struct {
	Msg   string
	What  string   // what went wrong
	Files []string // the files present (full paths)
	Steps []string // numbered recovery steps for exactly those files
}

func (e *UnsafeStartError) Error() string { return e.Msg }

func unsafeStart(dbPath, what string) error {
	exists := func(f string) bool { _, err := os.Lstat(f); return err == nil }
	var present []string
	for _, f := range []string{dbPath, PendingRestorePath(dbPath), dbPath + restoreJournalSuffix} {
		if exists(f) {
			present = append(present, f)
		}
	}
	var asides []string
	for _, suf := range dbFileSuffixes {
		if exists(dbPath + preApplySuffix + suf) {
			present = append(present, dbPath+preApplySuffix+suf)
			asides = append(asides, suf)
		}
	}
	// Steps for exactly the files present.
	var steps []string
	if len(asides) > 0 {
		for _, suf := range asides {
			if exists(dbPath + suf) {
				steps = append(steps, fmt.Sprintf("move %s out of the way (e.g. rename it to %s.unknown)", dbPath+suf, dbPath+suf))
			}
		}
		for _, suf := range asides {
			steps = append(steps, fmt.Sprintf("rename %s to %s (this is the data you had before the restore)", dbPath+preApplySuffix+suf, dbPath+suf))
		}
	} else if exists(dbPath) {
		steps = append(steps, fmt.Sprintf("check that %s is the data you want HOPS to use (keep a copy of it first)", dbPath))
	}
	if exists(PendingRestorePath(dbPath)) {
		steps = append(steps, fmt.Sprintf("rename %s to %s to keep it (you can restore again later)", PendingRestorePath(dbPath), dbPath+FailedRestoreSuffix))
	}
	if exists(dbPath + restoreJournalSuffix) {
		steps = append(steps, fmt.Sprintf("delete %s", dbPath+restoreJournalSuffix))
	}
	steps = append(steps, "start HOPS again")
	for n := range steps {
		steps[n] = fmt.Sprintf("%d. %s", n+1, steps[n])
	}
	return &UnsafeStartError{
		Msg: fmt.Sprintf("HOPS will not start: a restore was interrupted and %s. Nothing was deleted. Files present: %s. "+
			"To recover, stop HOPS, then: %s.", what, strings.Join(present, ", "), strings.Join(steps, "; ")),
		Files: present,
		Steps: steps,
		What:  what,
	}
}

// Outcome is what RecoverAndApplyRestore did.
type Outcome int

const (
	OutcomeNone             Outcome = iota // nothing staged, nothing to recover
	OutcomeApplied                         // the staged restore was applied
	OutcomeRecoveredApplied                // an interrupted apply had put the restore in place; it was completed
	OutcomeUndone                          // an interrupted apply was undone: the data is as before the restore
)

// RestoreResult reports RecoverAndApplyRestore's outcome. Detail adds what
// the admin must know about it (e.g. the stage couldn't be set aside);
// JournalLeft is set when the restore journal couldn't be removed.
type RestoreResult struct {
	Outcome     Outcome
	Detail      string
	JournalLeft string
}

// ApplyPendingRestore is RecoverAndApplyRestore reporting only whether the
// staged restore is now in place.
func ApplyPendingRestore(dbPath string) (bool, error) {
	r, err := RecoverAndApplyRestore(dbPath)
	return r.Outcome == OutcomeApplied || r.Outcome == OutcomeRecoveredApplied, err
}

// RecoverAndApplyRestore runs before the database is opened. It first
// resolves an apply that was interrupted (journal present), then applies a
// staged restore:
//
//  1. write the journal (the stage's SHA-256, state "moving");
//  2. move hops.db, -wal and -shm aside to hops.db.pre-apply*;
//  3. rename the stage to hops.db;
//  4. mark the journal "applied";
//  5. delete the aside files, then the journal.
//
// The aside files are deleted only once the restored file is provably in
// place (journal "applied", or the stage gone and hops.db's hash equal to
// the stage's). On a failure the aside files are moved back and the stage
// is kept as .restore-failed (an ordinary error: HOPS runs on its data). If
// moving back fails, or the state is ambiguous, an *UnsafeStartError is
// returned: the caller must exit without opening the database.
func RecoverAndApplyRestore(dbPath string) (RestoreResult, error) {
	if r, done, err := recoverInterrupted(dbPath); done || err != nil {
		return r, err
	}
	pending := PendingRestorePath(dbPath)
	if _, err := os.Lstat(pending); err != nil {
		if os.IsNotExist(err) {
			return RestoreResult{}, nil
		}
		return RestoreResult{}, fmt.Errorf("cannot read the staged restore: %w", err)
	}
	setAside := func(err error) error {
		if rerr := renameFile(pending, dbPath+FailedRestoreSuffix); rerr != nil {
			return fmt.Errorf("%w (and the staged file could not be set aside: %v)", err, rerr)
		}
		return fmt.Errorf("%w; the staged file was kept as %s", err, filepath.Base(dbPath+FailedRestoreSuffix))
	}
	if err := ValidateHOPSDatabase(pending); err != nil {
		return RestoreResult{}, setAside(fmt.Errorf("the staged restore is not usable: %w", err))
	}
	sum, err := fileSHA256(pending)
	if err != nil {
		return RestoreResult{}, setAside(fmt.Errorf("cannot read the staged restore: %w", err))
	}
	if err := writeJournal(dbPath, restoreJournal{StageSHA256: sum, State: "moving"}); err != nil {
		os.Remove(dbPath + restoreJournalSuffix)
		return RestoreResult{}, setAside(fmt.Errorf("cannot start the restore: %w", err))
	}
	if crashed("journal") {
		return RestoreResult{}, errSimulatedCrash
	}

	// undo moves the aside files back. Any failure is unsafe: the stage and
	// journal stay, so the next start resolves it (or a person does).
	undo := func(cause error) error {
		if err := moveAsideBack(dbPath); err != nil {
			return unsafeStart(dbPath, fmt.Sprintf("it failed (%v) and moving the current database back failed too (%v)", cause, err))
		}
		if err := removeJournal(dbPath); err != nil {
			slog.Error("could not remove the restore journal", "component", "backup", "error", err)
		}
		return setAside(cause)
	}
	for _, suf := range dbFileSuffixes {
		if err := renameFile(dbPath+suf, dbPath+preApplySuffix+suf); err != nil && !os.IsNotExist(err) {
			return RestoreResult{}, undo(fmt.Errorf("cannot move the current database aside: %w", err))
		}
		if err := syncDir(filepath.Dir(dbPath)); err != nil {
			slog.Warn("could not sync the data directory", "component", "backup", "error", err)
		}
		if crashed("aside" + suf) {
			return RestoreResult{}, errSimulatedCrash
		}
	}
	if err := syncFile(pending); err != nil {
		return RestoreResult{}, undo(fmt.Errorf("cannot flush the staged restore to disk: %w", err))
	}
	if err := renameFile(pending, dbPath); err != nil {
		return RestoreResult{}, undo(fmt.Errorf("cannot put the restored database in place: %w", err))
	}
	if err := syncDir(filepath.Dir(dbPath)); err != nil {
		slog.Warn("could not sync the data directory", "component", "backup", "error", err)
	}
	if crashed("rename-in") {
		return RestoreResult{}, errSimulatedCrash
	}
	left, err := finishApplied(dbPath, sum)
	if err != nil {
		return RestoreResult{}, err
	}
	return RestoreResult{Outcome: OutcomeApplied, JournalLeft: left}, nil
}

// finishApplied marks the journal applied, then removes the aside files and
// the journal. If the journal can't be marked, HOPS must not start: opening
// the restored DB would change it, and the next start could no longer prove
// it is the restored file, leaving the originals unresolvable.
func finishApplied(dbPath, sum string) (string, error) {
	if err := writeJournal(dbPath, restoreJournal{StageSHA256: sum, State: "applied"}); err != nil {
		return "", unsafeStart(dbPath, "the restored database is in place but the restore journal could not be updated ("+err.Error()+")")
	}
	if crashed("mark-applied") {
		return "", errSimulatedCrash
	}
	for _, suf := range dbFileSuffixes {
		if err := os.Remove(dbPath + preApplySuffix + suf); err != nil && !os.IsNotExist(err) {
			// Journal stays "applied": the next start removes them.
			slog.Warn("could not remove the replaced database file; retried at the next start", "component", "backup", "file", dbPath+preApplySuffix+suf, "error", err)
			return "", nil
		}
	}
	if crashed("cleanup") {
		return "", errSimulatedCrash
	}
	if err := removeJournal(dbPath); err != nil {
		slog.Warn("could not remove the restore journal; retried before the next restore and at the next start", "component", "backup", "error", err)
		return err.Error(), nil
	}
	return "", nil
}

// removeJournal deletes the restore journal (fine if absent).
func removeJournal(dbPath string) error {
	if err := removeFile(dbPath + restoreJournalSuffix); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// removeFile is os.Remove; tests inject failures.
var removeFile = os.Remove

// ClearLeftoverJournal removes a journal left by a completed restore (state
// "applied", nothing moved aside, nothing staged). RestoreBackup calls it
// before staging; a journal it can't remove refuses the new restore.
func ClearLeftoverJournal(dbPath string) error {
	raw, err := os.ReadFile(dbPath + restoreJournalSuffix)
	if os.IsNotExist(err) {
		return nil
	}
	var j restoreJournal
	if err != nil || json.Unmarshal(raw, &j) != nil || j.State != "applied" {
		return fmt.Errorf("an earlier restore's journal (%s) is still there and isn't from a finished restore; restart HOPS to resolve it first", dbPath+restoreJournalSuffix)
	}
	for _, suf := range dbFileSuffixes {
		if _, err := os.Lstat(dbPath + preApplySuffix + suf); err == nil {
			return fmt.Errorf("an earlier restore isn't finished (%s exists); restart HOPS to resolve it first", dbPath+preApplySuffix+suf)
		}
	}
	if err := removeJournal(dbPath); err != nil {
		return fmt.Errorf("an earlier restore's journal couldn't be removed: %w", err)
	}
	return nil
}

// syncDir fsyncs a directory so renames in it are durable. Filesystems that
// can't sync a directory (EINVAL) are tolerated.
func syncDir(dir string) error {
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	if err := d.Sync(); err != nil && !errors.Is(err, syscall.EINVAL) && !errors.Is(err, syscall.ENOTSUP) {
		return err
	}
	return nil
}

// syncFile fsyncs a file's contents.
func syncFile(path string) error {
	f, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

// moveAsideBack renames each hops.db.pre-apply* file back, refusing to
// overwrite anything at the target name.
func moveAsideBack(dbPath string) error {
	var errs []string
	for _, suf := range dbFileSuffixes {
		from := dbPath + preApplySuffix + suf
		if _, err := os.Lstat(from); err != nil {
			continue
		}
		if _, err := os.Lstat(dbPath + suf); err == nil {
			errs = append(errs, fmt.Sprintf("%s already exists", dbPath+suf))
			continue
		}
		if err := renameFile(from, dbPath+suf); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	return nil
}

// recoverInterrupted resolves what an interrupted apply left. done is true
// when it decided the outcome (the caller stops there).
func recoverInterrupted(dbPath string) (RestoreResult, bool, error) {
	journalPath := dbPath + restoreJournalSuffix
	raw, jerr := os.ReadFile(journalPath)
	asides := false
	for _, suf := range dbFileSuffixes {
		if _, err := os.Lstat(dbPath + preApplySuffix + suf); err == nil {
			asides = true
		}
	}
	if jerr != nil {
		if !os.IsNotExist(jerr) {
			return RestoreResult{}, true, unsafeStart(dbPath, "its journal can't be read ("+jerr.Error()+")")
		}
		if asides {
			return RestoreResult{}, true, unsafeStart(dbPath, "files it moved aside are present without its journal")
		}
		return RestoreResult{}, false, nil
	}
	var j restoreJournal
	if err := json.Unmarshal(raw, &j); err != nil || j.StageSHA256 == "" {
		return RestoreResult{}, true, unsafeStart(dbPath, "its journal is damaged")
	}
	pending := PendingRestorePath(dbPath)
	_, stageErr := os.Lstat(pending)
	stageThere := stageErr == nil
	_, dbErr := os.Lstat(dbPath)
	dbThere := dbErr == nil

	if j.State == "applied" {
		if stageThere {
			return RestoreResult{}, true, unsafeStart(dbPath, "the journal says it was applied but the staged file is still there")
		}
		if !dbThere {
			return RestoreResult{}, true, unsafeStart(dbPath, "the journal says it was applied but there is no database")
		}
		hadAsides := asides
		left, err := finishApplied(dbPath, j.StageSHA256)
		if err != nil {
			return RestoreResult{}, true, err
		}
		if !hadAsides {
			// Only the journal was left (its removal failed last time): no news.
			return RestoreResult{JournalLeft: left}, true, nil
		}
		slog.Warn("completed a restore that was interrupted after the restored database was put in place", "component", "backup")
		return RestoreResult{Outcome: OutcomeRecoveredApplied, JournalLeft: left}, true, nil
	}

	if stageThere {
		// The rename-in never happened (it is atomic): hops.db, if present,
		// is the original — unless the original is ALSO aside (ambiguous).
		if _, err := os.Lstat(dbPath + preApplySuffix); err == nil && dbThere {
			return RestoreResult{}, true, unsafeStart(dbPath, "both the original database (moved aside) and another "+dbPath+" exist")
		}
		if err := moveAsideBack(dbPath); err != nil {
			return RestoreResult{}, true, unsafeStart(dbPath, "moving the current database back failed ("+err.Error()+")")
		}
		if _, err := os.Lstat(dbPath); err != nil {
			return RestoreResult{}, true, unsafeStart(dbPath, "there is no database to go back to")
		}
		res := RestoreResult{Outcome: OutcomeUndone}
		if err := removeJournal(dbPath); err != nil {
			res.JournalLeft = err.Error()
		}
		if err := renameFile(pending, dbPath+FailedRestoreSuffix); err != nil {
			slog.Error("could not set the undone restore aside", "component", "backup", "error", err)
			if rerr := os.Remove(pending); rerr != nil { // never retried silently
				res.Detail = fmt.Sprintf("The staged restore couldn't be set aside (%v) or removed (%v): delete %s", err, rerr, pending)
			} else {
				res.Detail = fmt.Sprintf("The staged restore couldn't be kept as %s (%v), so it was removed", filepath.Base(dbPath+FailedRestoreSuffix), err)
			}
		}
		slog.Warn("undid an interrupted restore; running on the data from before it", "component", "backup")
		return res, true, nil
	}

	// The stage is gone: the rename-in happened if hops.db is the staged file.
	if !dbThere {
		return RestoreResult{}, true, unsafeStart(dbPath, "neither the staged file nor a database is in place")
	}
	sum, err := fileSHA256(dbPath)
	if err != nil || sum != j.StageSHA256 {
		return RestoreResult{}, true, unsafeStart(dbPath, "the database in place can't be proven to be the restored file")
	}
	left, err := finishApplied(dbPath, j.StageSHA256)
	if err != nil {
		return RestoreResult{}, true, err
	}
	slog.Warn("completed a restore that was interrupted after the restored database was put in place", "component", "backup")
	return RestoreResult{Outcome: OutcomeRecoveredApplied, JournalLeft: left}, true, nil
}

func writeJournal(dbPath string, j restoreJournal) error {
	raw, _ := json.Marshal(j)
	tmp := dbPath + restoreJournalSuffix + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := f.Write(raw); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, dbPath+restoreJournalSuffix); err != nil {
		return err
	}
	return syncDir(filepath.Dir(dbPath))
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// SweepStaleTempFiles removes temp files an interrupted stage or upload left
// behind (hops.db.restore-pending.tmp, backups/.upload-*.tmp). Run at start.
func SweepStaleTempFiles(dbPath string) error {
	var errs []string
	stale := []string{PendingRestorePath(dbPath) + ".tmp"}
	if m, err := filepath.Glob(filepath.Join(filepath.Dir(dbPath), "backups", ".upload-*.tmp")); err == nil {
		stale = append(stale, m...)
	}
	for _, pat := range []string{
		filepath.Join(filepath.Dir(dbPath), "backups", ".download-*.tmp"),
		filepath.Join(filepath.Dir(dbPath), "backups", ".*"+imageRecordSuffix+"-*.tmp"),
		filepath.Join(filepath.Dir(dbPath), "icons", ".install-*.tmp"),
		filepath.Join(filepath.Dir(dbPath), "backgrounds", ".install-*.tmp"),
		filepath.Join(filepath.Dir(dbPath), AtticDirName, "."+atticIndexName+"-*.tmp"),
	} {
		if m, err := filepath.Glob(pat); err == nil {
			stale = append(stale, m...)
		}
	}
	for _, f := range stale {
		if err := os.RemoveAll(f); err != nil && !os.IsNotExist(err) {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("could not remove stale temporary files: %s", strings.Join(errs, "; "))
	}
	return nil
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
	// Then its image record and staged images (leftovers: the next sweep).
	bm.removeBackupExtras(backupName)

	slog.Info("deleted backup", "component", "backup", "name", backupName)
	bm.sweepAfterCleanup()
	return nil
}

// CleanupOldBackups deletes what the retention policy says (PlanRetention).
// A backup it cannot delete is recorded (Problems) until a later cleanup
// works, and returned as an error; deletions within keep_days (for the
// ceiling) are recorded as a notice too.
func (bm *BackupManager) CleanupOldBackups() error {
	plan, err := bm.PlanCleanup()
	if err != nil {
		bm.noteCleanup(err)
		return err
	}
	_, err = bm.deletePlanned(plan)
	bm.sweepAfterCleanup()
	return err
}

// PlanCleanup is what a cleanup would delete now, and why ("Clean up now"
// shows it before anything is deleted).
func (bm *BackupManager) PlanCleanup() ([]RetentionDeletion, error) {
	all, err := bm.ListBackups()
	if err != nil {
		return nil, err
	}
	return PlanRetention(all, bm.Retention(), time.Now()), nil
}

// CleanupConfirmed deletes those of names that the policy still deletes now
// (re-planned, so nothing outside the rules is ever deleted, even if the
// list the user confirmed is stale). It returns what was deleted.
func (bm *BackupManager) CleanupConfirmed(names []string) ([]string, error) {
	plan, err := bm.PlanCleanup()
	if err != nil {
		bm.noteCleanup(err)
		return nil, err
	}
	want := map[string]bool{}
	for _, n := range names {
		want[n] = true
	}
	var chosen []RetentionDeletion
	for _, d := range plan {
		if want[d.Name] {
			chosen = append(chosen, d)
		}
	}
	deleted, err := bm.deletePlanned(chosen)
	bm.sweepAfterCleanup()
	return deleted, err
}

func (bm *BackupManager) deletePlanned(plan []RetentionDeletion) ([]string, error) {
	var deleted, failed []string
	ceiling := 0
	for _, d := range plan {
		if err := bm.remove(filepath.Join(bm.backupDir, d.Name)); err != nil {
			slog.Warn("failed to remove old backup", "component", "backup", "name", d.Name, "error", err)
			failed = append(failed, d.Name+": "+errText(err))
			continue
		}
		slog.Info("removed old backup", "component", "backup", "name", d.Name, "reason", d.Reason)
		bm.removeBackupExtras(d.Name)
		deleted = append(deleted, d.Name)
		if d.OverCeiling {
			ceiling++
		}
	}
	var err error
	if len(failed) > 0 {
		err = fmt.Errorf("could not delete %d old backup(s): %s", len(failed), strings.Join(failed, "; "))
	}
	bm.noteCleanup(err)
	if ceiling > 0 {
		p := bm.Retention()
		bm.mu.Lock()
		bm.ceiling = &BackupProblem{Kind: ProblemCeilingDeleted, At: time.Now(),
			Reason: fmt.Sprintf("Deleted %d backup(s) newer than %d days to stay under the %d-backup ceiling", ceiling, p.KeepDays, p.MaxCount)}
		bm.saveNoticesLocked()
		bm.mu.Unlock()
	}
	return deleted, err
}

func (bm *BackupManager) noteCleanup(err error) {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	if err != nil {
		bm.rotateErr = &BackupProblem{Kind: ProblemRotationFailed, At: time.Now(), Reason: err.Error()}
	} else {
		bm.rotateErr = nil
	}
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
	// Protected backups are never deleted automatically (pre-v3-migration,
	// manual, uploaded): "kept until you delete it".
	Protected bool `json:"protected"`
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
