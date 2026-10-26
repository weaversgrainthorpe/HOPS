package database

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Uploaded images and backups (M6 §12, Option B, Jonathan 2026-10-26).
//
// Uploaded images live in <data>/icons and <data>/backgrounds. Local backups
// are database-only, but no image a backup refers to is destroyed while that
// backup exists: deleting an uploaded image MOVES it to
// <data>/attic/<icons|backgrounds>/<name>, and an attic file is removed for
// good only when no backup (protected ones included), no staged restore and
// not the live database refer to it. When in doubt (a backup can't be read)
// nothing is deleted, and that is a visible notice.

const (
	// AtticDirName is the folder (in the data directory) deleted images move to.
	AtticDirName = "attic"
	// AtticLargeBytes: above this the attic is a visible notice (it may be
	// holding images for backups nobody needs any more).
	AtticLargeBytes = 200 << 20
	// restoreImagesSuffix names the marker a staged restore leaves for the
	// next start: which backup was restored (its staged images install then).
	restoreImagesSuffix = ".restore-images"
	// stagedImagesDir (in the backups dir) holds, per uploaded backup, the
	// images that came with it: backups/.images/<backup name>/<kind>/<file>.
	stagedImagesDir = ".images"
)

// Problem kinds for images and the attic.
const (
	// ProblemAtticBlocked: a backup (or the live DB) couldn't be read, so the
	// attic sweep deleted nothing. Sticky; cleared by the next sweep that works.
	ProblemAtticBlocked = "attic-blocked"
	// ProblemAtticDeleteFailed: unreferenced attic files couldn't be removed.
	// Sticky; cleared by the next sweep that removes everything it should.
	ProblemAtticDeleteFailed = "attic-delete-failed"
	// ProblemAtticLarge: the attic is bigger than AtticLargeBytes. Sticky
	// while it is.
	ProblemAtticLarge = "attic-large"
	// ProblemRestoreImages: after a restore, images the restored data uses are
	// missing, or couldn't be installed. Dismissible; kept across restarts.
	ProblemRestoreImages = "restore-images"
)

// ImageKinds are the two kinds of uploaded image, as folder names.
var ImageKinds = []string{"icons", "backgrounds"}

// imageNamePattern is a plain uploaded-image file name: no separators, not
// hidden. The same shape the upload handlers produce.
var imageNamePattern = regexp.MustCompile(`^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$`)

// imageRefPattern finds "/icons/<name>" and "/backgrounds/<name>" in text.
var imageRefPattern = regexp.MustCompile(`/(icons|backgrounds)/([A-Za-z0-9_-][A-Za-z0-9._-]{0,127})`)

// atticVersionPattern: an older attic copy kept under "<name>~<12 hex>" when
// a different file with the same name was deleted later.
var atticVersionPattern = regexp.MustCompile(`^(.+)~[0-9a-f]{12}$`)

// ValidImageKind reports whether kind is "icons" or "backgrounds".
func ValidImageKind(kind string) bool { return kind == "icons" || kind == "backgrounds" }

// ValidImageName reports whether name is a plain uploaded-image file name.
func ValidImageName(name string) bool {
	return imageNamePattern.MatchString(name) && !strings.Contains(name, "..")
}

// ImageKey is how an image is named in references and archives: "<kind>/<name>".
func ImageKey(kind, name string) string { return kind + "/" + name }

func splitImageKey(key string) (string, string) {
	kind, name, _ := strings.Cut(key, "/")
	return kind, name
}

// ImageRefsInText adds to refs every uploaded-image URL in s: "/icons/<name>"
// or "/backgrounds/<name>" that starts a path (so "/api/icons/dashboard/x"
// and "http://host/icons/x" are not ours) and isn't followed by more path.
func ImageRefsInText(s string, refs map[string]bool) {
	if !strings.Contains(s, "/icons/") && !strings.Contains(s, "/backgrounds/") {
		return
	}
	for _, m := range imageRefPattern.FindAllStringSubmatchIndex(s, -1) {
		start, end := m[0], m[1]
		if start > 0 && isPathChar(s[start-1]) {
			continue
		}
		if end < len(s) && s[end] == '/' {
			continue
		}
		name := s[m[4]:m[5]]
		if !ValidImageName(name) {
			continue
		}
		refs[ImageKey(s[m[2]:m[3]], name)] = true
	}
}

// isPathChar: a byte that, before "/icons/", means it is part of a longer
// path or a host name (or base64), not the start of our URL.
func isPathChar(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' ||
		c == '.' || c == '_' || c == '-' || c == '/' || c == '+' || c == ':' || c == '%' || c == '~'
}

// RefScope says which tables are read for references.
type RefScope int

const (
	// RefsAll reads every text value in every table: the safest reading, used
	// to decide what may be deleted and what to bring back.
	RefsAll RefScope = iota
	// RefsLive reads only what the running app shows (the layout, the icon
	// library, settings): used to report an image as missing, so an image
	// only an archived v2 document mentions isn't reported as broken.
	RefsLive
)

var liveRefTables = map[string]bool{"config": true, "icons": true, "app_settings": true}

// ReadImageRefs returns the uploaded images referenced in db ("<kind>/<name>").
// Any error means the answer is unknown (never "no references").
func ReadImageRefs(db *sql.DB, scope RefScope) (map[string]bool, error) {
	rows, err := db.Query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
	if err != nil {
		return nil, err
	}
	var tables []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			rows.Close()
			return nil, err
		}
		if scope == RefsAll || liveRefTables[n] {
			tables = append(tables, n)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	refs := map[string]bool{}
	for _, t := range tables {
		if err := scanTableRefs(db, t, refs); err != nil {
			return nil, fmt.Errorf("reading table %s: %w", t, err)
		}
	}
	return refs, nil
}

func scanTableRefs(db *sql.DB, table string, refs map[string]bool) error {
	rows, err := db.Query(`SELECT * FROM "` + strings.ReplaceAll(table, `"`, `""`) + `"`)
	if err != nil {
		return err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return err
	}
	vals := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return err
		}
		for _, v := range vals {
			switch s := v.(type) {
			case string:
				ImageRefsInText(s, refs)
			case []byte:
				ImageRefsInText(string(s), refs)
			}
		}
	}
	return rows.Err()
}

// openReadOnly opens a database file read-only and immutable (nothing is
// written, not even a journal): for backups and stages, which never change.
func openReadOnly(path string) (*sql.DB, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	u := url.URL{Scheme: "file", Path: abs, RawQuery: "mode=ro&immutable=1"}
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

// ReadFileImageRefs reads the references in a database file (read-only).
func ReadFileImageRefs(path string, scope RefScope) (map[string]bool, error) {
	fi, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !fi.Mode().IsRegular() {
		return nil, fmt.Errorf("%s is not a regular file", filepath.Base(path))
	}
	db, err := openReadOnly(path)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	return ReadImageRefs(db, scope)
}

// dataDir is the data directory (the database's folder).
func (bm *BackupManager) dataDir() string { return filepath.Dir(bm.dbPath) }

// AtticDir is <data>/attic.
func (bm *BackupManager) AtticDir() string { return filepath.Join(bm.dataDir(), AtticDirName) }

// liveImagePath is <data>/<kind>/<name>.
func (bm *BackupManager) liveImagePath(kind, name string) string {
	return filepath.Join(bm.dataDir(), kind, name)
}

func (bm *BackupManager) atticImagePath(kind, name string) string {
	return filepath.Join(bm.AtticDir(), kind, name)
}

// SetLiveDB gives the manager the open database, so the attic sweep can read
// what the running app references. Without it the file is read (read-only).
func (bm *BackupManager) SetLiveDB(db *sql.DB) {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	bm.liveDB = db
}

func (bm *BackupManager) liveRefs(scope RefScope) (map[string]bool, error) {
	bm.mu.Lock()
	db := bm.liveDB
	bm.mu.Unlock()
	if db != nil {
		return ReadImageRefs(db, scope)
	}
	if _, err := os.Lstat(bm.dbPath); err != nil {
		return nil, fmt.Errorf("the live database can't be read: %w", err)
	}
	abs, err := filepath.Abs(bm.dbPath)
	if err != nil {
		return nil, err
	}
	u := url.URL{Scheme: "file", Path: abs, RawQuery: "mode=ro"}
	fdb, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	defer fdb.Close()
	return ReadImageRefs(fdb, scope)
}

// checkImage validates a kind and name taken from anywhere.
func checkImage(kind, name string) error {
	if !ValidImageKind(kind) {
		return fmt.Errorf("invalid image kind %q", kind)
	}
	if !ValidImageName(name) {
		return fmt.Errorf("invalid image name %q", name)
	}
	return nil
}

// MoveToAttic moves an uploaded image out of its live folder into the attic
// (never unlinks it). os.ErrNotExist (wrapped) when there is no such file. If
// the attic already has a DIFFERENT file with that name, the older one is
// kept beside it as "<name>~<hash>" (both stay until unreferenced).
func (bm *BackupManager) MoveToAttic(kind, name string) error {
	if err := checkImage(kind, name); err != nil {
		return err
	}
	bm.atticMu.Lock()
	defer bm.atticMu.Unlock()
	src := bm.liveImagePath(kind, name)
	fi, err := os.Lstat(src)
	if err != nil {
		return err
	}
	if !fi.Mode().IsRegular() {
		return fmt.Errorf("%s is not a regular file", src)
	}
	dir := filepath.Join(bm.AtticDir(), kind)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("cannot create the attic folder: %w", err)
	}
	dst := filepath.Join(dir, name)
	if _, err := os.Lstat(dst); err == nil {
		oldSum, err1 := fileSHA256(dst)
		newSum, err2 := fileSHA256(src)
		if err1 != nil || err2 != nil {
			return fmt.Errorf("cannot compare with the attic copy of %s: %v %v", name, err1, err2)
		}
		if oldSum == newSum {
			// The attic already holds this exact file: the live copy can go.
			if err := os.Remove(src); err != nil {
				return err
			}
			slog.Info("image moved to the attic (an identical copy was already there)", "component", "backup", "image", ImageKey(kind, name))
			return nil
		}
		versioned := filepath.Join(dir, name+"~"+oldSum[:12])
		if _, err := os.Lstat(versioned); err == nil {
			if err := os.Remove(dst); err != nil { // same content as versioned
				return err
			}
		} else if err := os.Rename(dst, versioned); err != nil {
			return fmt.Errorf("cannot keep the older attic copy of %s: %w", name, err)
		}
	}
	if err := os.Rename(src, dst); err != nil {
		return fmt.Errorf("cannot move %s to the attic: %w", name, err)
	}
	_ = syncDir(dir)
	slog.Info("image moved to the attic", "component", "backup", "image", ImageKey(kind, name))
	return nil
}

// RestoreFromAttic moves an image back from the attic to its live folder (an
// undo when the delete it was part of failed). It never replaces a file.
func (bm *BackupManager) RestoreFromAttic(kind, name string) error {
	if err := checkImage(kind, name); err != nil {
		return err
	}
	bm.atticMu.Lock()
	defer bm.atticMu.Unlock()
	return bm.restoreFromAtticLocked(kind, name)
}

func (bm *BackupManager) restoreFromAtticLocked(kind, name string) error {
	dst := bm.liveImagePath(kind, name)
	if _, err := os.Lstat(dst); err == nil {
		return fmt.Errorf("%s already exists", ImageKey(kind, name))
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	// A hard link + remove: never replaces a file that appeared meanwhile.
	if err := placeExclusive(bm.atticImagePath(kind, name), dst); err != nil {
		return err
	}
	slog.Info("image brought back from the attic", "component", "backup", "image", ImageKey(kind, name))
	return nil
}

// AtticUsage is the attic's size (shown in the Backups dialog).
type AtticUsage struct {
	Files int   `json:"files"`
	Bytes int64 `json:"bytes"`
}

type atticFile struct {
	kind, name, base, path string
	size                   int64
}

// listAttic returns the files in the attic (a missing attic is empty).
func (bm *BackupManager) listAttic() ([]atticFile, error) {
	var out []atticFile
	for _, kind := range ImageKinds {
		dir := filepath.Join(bm.AtticDir(), kind)
		entries, err := os.ReadDir(dir)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				continue
			}
			return nil, err
		}
		for _, e := range entries {
			if !e.Type().IsRegular() {
				continue
			}
			info, err := e.Info()
			if err != nil {
				return nil, err
			}
			base := e.Name()
			if m := atticVersionPattern.FindStringSubmatch(base); m != nil {
				base = m[1]
			}
			out = append(out, atticFile{kind: kind, name: e.Name(), base: base, path: filepath.Join(dir, e.Name()), size: info.Size()})
		}
	}
	return out, nil
}

// AtticUsage reports how many files and bytes the attic holds.
func (bm *BackupManager) AtticUsage() (AtticUsage, error) {
	files, err := bm.listAttic()
	if err != nil {
		return AtticUsage{}, err
	}
	var u AtticUsage
	for _, f := range files {
		u.Files++
		u.Bytes += f.size
	}
	return u, nil
}

// cachedRefs is a backup's references, valid while its size and mtime match
// (backups are written once and never changed).
type cachedRefs struct {
	size  int64
	mtime time.Time
	refs  map[string]bool
}

func (bm *BackupManager) backupRefs(b BackupInfo) (map[string]bool, error) {
	bm.mu.Lock()
	c, ok := bm.refCache[b.Name]
	bm.mu.Unlock()
	if ok && c.size == b.Size && c.mtime.Equal(b.CreatedAt) {
		return c.refs, nil
	}
	refs, err := ReadFileImageRefs(b.Path, RefsAll)
	if err != nil {
		return nil, err
	}
	bm.mu.Lock()
	if bm.refCache == nil {
		bm.refCache = map[string]cachedRefs{}
	}
	bm.refCache[b.Name] = cachedRefs{size: b.Size, mtime: b.CreatedAt, refs: refs}
	bm.mu.Unlock()
	return refs, nil
}

// SweepAttic removes the attic files that nothing refers to any more: no
// backup (protected ones included), no staged restore, not the live
// database. If any of those can't be read, NOTHING is removed and that is a
// visible notice. It returns the files removed.
func (bm *BackupManager) SweepAttic() ([]string, error) {
	bm.atticMu.Lock()
	defer bm.atticMu.Unlock()
	files, err := bm.listAttic()
	if err != nil {
		err = fmt.Errorf("the attic (%s) can't be read: %w", bm.AtticDir(), err)
		bm.noteAttic(&BackupProblem{Kind: ProblemAtticBlocked, At: time.Now(), Reason: err.Error()}, nil, nil)
		return nil, err
	}
	if len(files) == 0 {
		bm.noteAttic(nil, nil, nil)
		return nil, nil
	}

	refs, unreadable := bm.allReferences()
	if len(unreadable) > 0 {
		reason := fmt.Sprintf("%s couldn't be read, so no image in the attic (%s) was deleted: %s",
			pluralBackups(len(unreadable)), bm.AtticDir(), strings.Join(unreadable, "; "))
		slog.Error("attic sweep blocked", "component", "backup", "reason", reason)
		bm.mu.Lock()
		prevFailed := bm.atticFailed // nothing was tried: an earlier failure still stands
		bm.mu.Unlock()
		bm.noteAttic(&BackupProblem{Kind: ProblemAtticBlocked, At: time.Now(), Reason: reason}, prevFailed, bm.atticLarge(files))
		return nil, errors.New(reason)
	}

	var removed, failed []string
	var left []atticFile
	for _, f := range files {
		if refs[ImageKey(f.kind, f.base)] {
			left = append(left, f)
			continue
		}
		if err := bm.remove(f.path); err != nil && !errors.Is(err, fs.ErrNotExist) {
			slog.Warn("attic: could not remove an unreferenced image", "component", "backup", "file", f.path, "error", err)
			failed = append(failed, ImageKey(f.kind, f.name)+": "+errText(err))
			left = append(left, f)
			continue
		}
		slog.Info("attic: removed an image no backup refers to", "component", "backup", "image", ImageKey(f.kind, f.name))
		removed = append(removed, ImageKey(f.kind, f.name))
	}
	var failProblem *BackupProblem
	var retErr error
	if len(failed) > 0 {
		retErr = fmt.Errorf("couldn't remove %d image(s) no backup refers to from the attic (%s): %s", len(failed), bm.AtticDir(), strings.Join(failed, "; "))
		failProblem = &BackupProblem{Kind: ProblemAtticDeleteFailed, At: time.Now(), Reason: retErr.Error()}
	}
	bm.noteAttic(nil, failProblem, bm.atticLarge(left))
	return removed, retErr
}

func pluralBackups(n int) string {
	if n == 1 {
		return "1 backup"
	}
	return fmt.Sprintf("%d backups", n)
}

// allReferences is every image referenced by the live DB, every backup and
// any staged restore, and what couldn't be read ("name: reason").
func (bm *BackupManager) allReferences() (map[string]bool, []string) {
	refs := map[string]bool{}
	var unreadable []string
	add := func(m map[string]bool) {
		for k := range m {
			refs[k] = true
		}
	}
	if live, err := bm.liveRefs(RefsAll); err != nil {
		unreadable = append(unreadable, "the live database: "+err.Error())
	} else {
		add(live)
	}
	backups, err := bm.ListBackups()
	if err != nil {
		unreadable = append(unreadable, "the backups folder: "+err.Error())
	}
	for _, b := range backups {
		r, err := bm.backupRefs(b)
		if err != nil {
			unreadable = append(unreadable, b.Name+": "+err.Error())
			continue
		}
		add(r)
	}
	// A staged restore (and its temp copy, while a restore is being staged)
	// will need its images at the next start.
	for _, p := range []string{PendingRestorePath(bm.dbPath), PendingRestorePath(bm.dbPath) + ".tmp"} {
		if _, err := os.Lstat(p); err != nil {
			continue
		}
		r, err := ReadFileImageRefs(p, RefsAll)
		if err != nil {
			unreadable = append(unreadable, filepath.Base(p)+": "+err.Error())
			continue
		}
		add(r)
	}
	return refs, unreadable
}

func (bm *BackupManager) atticLarge(files []atticFile) *BackupProblem {
	var total int64
	for _, f := range files {
		total += f.size
	}
	if total <= AtticLargeBytes {
		return nil
	}
	return &BackupProblem{Kind: ProblemAtticLarge, At: time.Now(),
		Reason: fmt.Sprintf("the attic (%s) holds %d deleted images (%s) that older backups still refer to. "+
			"Deleting backups you no longer need lets HOPS remove them", bm.AtticDir(), len(files), formatBytes(total))}
}

// noteAttic records the sweep's outcome (each nil clears its notice; an
// existing large-attic notice keeps its time while it still applies).
func (bm *BackupManager) noteAttic(blocked, failed, large *BackupProblem) {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	bm.atticBlocked = blocked
	bm.atticFailed = failed
	if large != nil && bm.atticLargeP != nil {
		large.At = bm.atticLargeP.At
	}
	bm.atticLargeP = large
}

func formatBytes(n int64) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/float64(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(n)/float64(1<<10))
	default:
		return fmt.Sprintf("%d B", n)
	}
}

// sweepAfterCleanup runs the attic sweep after a backup cleanup; its
// failures are notices (Problems), so only the log line is added here.
func (bm *BackupManager) sweepAfterCleanup() {
	if _, err := bm.SweepAttic(); err != nil {
		slog.Warn("attic sweep after backup cleanup", "component", "backup", "error", err)
	}
}

// --- Restoring: bring the restored data's images back ---

type restoreImagesMarker struct {
	Backup string `json:"backup"`
}

func restoreImagesMarkerPath(dbPath string) string {
	return PendingRestorePath(dbPath) + restoreImagesSuffix
}

func writeRestoreImagesMarker(dbPath, backup string) error {
	raw, _ := json.Marshal(restoreImagesMarker{Backup: backup})
	tmp := restoreImagesMarkerPath(dbPath) + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, restoreImagesMarkerPath(dbPath))
}

// stagedImagesPath is backups/.images/<backup>.
func (bm *BackupManager) stagedImagesPath(backup string) string {
	return filepath.Join(bm.backupDir, stagedImagesDir, backup)
}

// RestoredImages is what AfterRestore did with the restored data's images.
type RestoredImages struct {
	Installed []string // from the uploaded backup's own images
	FromAttic []string // brought back from the attic
	Missing   []string // referenced, found nowhere
	Clashes   []string // not installed: a different file with that name is there
	Failed    []string // couldn't be put in place ("key: reason")
}

// AfterRestore runs at start, after RecoverAndApplyRestore and before the
// database is opened. When a restore was applied it installs the uploaded
// backup's own images (never replacing a different file with the same name),
// brings back from the attic every image the restored data refers to that
// isn't in place, and reports what is still missing as a visible notice. A
// restore never silently shows broken images. Without an applied restore it
// only clears the marker.
func (bm *BackupManager) AfterRestore(applied bool) RestoredImages {
	markerPath := restoreImagesMarkerPath(bm.dbPath)
	var marker restoreImagesMarker
	raw, mErr := os.ReadFile(markerPath)
	if mErr == nil {
		if err := json.Unmarshal(raw, &marker); err != nil || (marker.Backup != "" && ValidateBackupName(marker.Backup) != nil) {
			marker.Backup = ""
			mErr = fmt.Errorf("the restore's image marker is damaged")
		}
	}
	defer func() {
		if err := os.Remove(markerPath); err != nil && !os.IsNotExist(err) {
			slog.Warn("could not remove the restore's image marker", "component", "backup", "error", err)
		}
	}()
	var res RestoredImages
	if !applied {
		return res
	}
	bm.atticMu.Lock()
	defer bm.atticMu.Unlock()

	all, err := ReadFileImageRefs(bm.dbPath, RefsAll)
	if err != nil {
		bm.recordRestoreImages(fmt.Sprintf("HOPS couldn't check the images the restored data uses (%v); some may show as broken", err))
		return res
	}
	live, err := ReadFileImageRefs(bm.dbPath, RefsLive)
	if err != nil {
		live = all
	}
	keys := sortedKeys(all)

	if marker.Backup != "" {
		staged := bm.stagedImagesPath(marker.Backup)
		for _, key := range keys {
			kind, name := splitImageKey(key)
			src := filepath.Join(staged, kind, name)
			if fi, err := os.Lstat(src); err != nil || !fi.Mode().IsRegular() {
				continue
			}
			dst := bm.liveImagePath(kind, name)
			if _, err := os.Lstat(dst); err == nil {
				same, err := sameContent(src, dst)
				if err != nil {
					res.Failed = append(res.Failed, key+": "+errText(err))
				} else if !same {
					res.Clashes = append(res.Clashes, key)
				}
				continue
			}
			if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
				res.Failed = append(res.Failed, key+": "+errText(err))
				continue
			}
			if err := copyExclusive(src, dst); err != nil {
				if os.IsExist(err) {
					res.Clashes = append(res.Clashes, key)
				} else {
					res.Failed = append(res.Failed, key+": "+errText(err))
				}
				continue
			}
			res.Installed = append(res.Installed, key)
		}
	}

	for _, key := range keys {
		kind, name := splitImageKey(key)
		if _, err := os.Lstat(bm.liveImagePath(kind, name)); err == nil {
			continue
		}
		if _, err := os.Lstat(bm.atticImagePath(kind, name)); err != nil {
			continue
		}
		if err := bm.restoreFromAtticLocked(kind, name); err != nil {
			res.Failed = append(res.Failed, key+": "+errText(err))
			continue
		}
		res.FromAttic = append(res.FromAttic, key)
	}

	for _, key := range sortedKeys(live) {
		kind, name := splitImageKey(key)
		if _, err := os.Lstat(bm.liveImagePath(kind, name)); err != nil {
			res.Missing = append(res.Missing, key)
		}
	}
	// A failed install is already reported as such, not again as missing.
	res.Missing = without(res.Missing, keysOf(res.Failed))

	slog.Info("restore: images", "component", "backup", "installed", len(res.Installed), "fromAttic", len(res.FromAttic),
		"missing", len(res.Missing), "clashes", len(res.Clashes), "failed", len(res.Failed))
	var parts []string
	if len(res.Missing) > 0 {
		parts = append(parts, fmt.Sprintf("%d image(s) the restored data uses couldn't be found anywhere and will show as broken: %s. Upload them again",
			len(res.Missing), strings.Join(res.Missing, ", ")))
	}
	if len(res.Clashes) > 0 {
		parts = append(parts, fmt.Sprintf("%d image(s) from the uploaded backup weren't installed because a different file with the same name is already there (it was kept): %s",
			len(res.Clashes), strings.Join(res.Clashes, ", ")))
	}
	if len(res.Failed) > 0 {
		parts = append(parts, fmt.Sprintf("%d image(s) couldn't be put in place: %s", len(res.Failed), strings.Join(res.Failed, "; ")))
	}
	if mErr != nil && !os.IsNotExist(mErr) {
		parts = append(parts, "the uploaded backup's own images couldn't be installed ("+mErr.Error()+")")
	}
	if len(parts) > 0 {
		bm.recordRestoreImages("After the restore, " + strings.Join(parts, ". "))
	}
	return res
}

func (bm *BackupManager) recordRestoreImages(reason string) {
	slog.Warn("restore: images missing or not installed", "component", "backup", "reason", reason)
	bm.mu.Lock()
	defer bm.mu.Unlock()
	bm.restoreImages = &BackupProblem{Kind: ProblemRestoreImages, At: time.Now(), Reason: reason}
	bm.saveNoticesLocked()
}

func sameContent(a, b string) (bool, error) {
	sa, err := fileSHA256(a)
	if err != nil {
		return false, err
	}
	sb, err := fileSHA256(b)
	if err != nil {
		return false, err
	}
	return sa == sb, nil
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func keysOf(failed []string) map[string]bool {
	out := map[string]bool{}
	for _, f := range failed {
		k, _, _ := strings.Cut(f, ": ")
		out[k] = true
	}
	return out
}

func without(list []string, drop map[string]bool) []string {
	var out []string
	for _, s := range list {
		if !drop[s] {
			out = append(out, s)
		}
	}
	return out
}
