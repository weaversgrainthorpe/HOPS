package database

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Exact image versions. A name like /icons/x.png can
// mean different files over time (delete x.png, upload another x.png), so:
//
//   - the attic is keyed by CONTENT: <data>/attic/<kind>/<sha256>, with an
//     index (attic/index.json) of name → the hashes that name has had;
//   - every backup records, next to it (<backup>.images.json), which version
//     (SHA-256) of each image it refers to; an uploaded archive's record comes
//     from its manifest;
//   - restore and download resolve each reference by its recorded hash: the
//     live file if its hash matches, else the backup's own staged image, else
//     the attic. A backup without a record (older, or a plain .db upload) gets
//     only what is unambiguous; the rest is a visible notice;
//   - the sweep keeps every hash a record names, and every version of a name
//     that the live DB, a backup without a record, or a staged restore uses.

const (
	// imageRecordSuffix names a backup's image record: <backup>.images.json.
	imageRecordSuffix = ".images.json"
	atticIndexName    = "index.json"
	recordVersion     = 1
)

var sha256Pattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// ImageRecord is a backup's record of the exact images it refers to.
type ImageRecord struct {
	Version int `json:"version"`
	// Images maps "<kind>/<name>" to the SHA-256 of the version the backup uses.
	Images map[string]string `json:"images"`
	// Unresolved: referenced, but no single version could be found when the
	// backup was made (missing, or several candidates).
	Unresolved []string `json:"unresolved"`
}

func (bm *BackupManager) recordPath(backup string) string {
	return filepath.Join(bm.backupDir, backup+imageRecordSuffix)
}

// readRecord reads a backup's image record: (nil, nil) when it has none.
func (bm *BackupManager) readRecord(backup string) (*ImageRecord, error) {
	raw, err := os.ReadFile(bm.recordPath(backup))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("its image record can't be read: %w", err)
	}
	var rec ImageRecord
	if err := json.Unmarshal(raw, &rec); err != nil || rec.Version < 1 {
		return nil, fmt.Errorf("its image record is damaged")
	}
	for k, h := range rec.Images {
		kind, name := splitImageKey(k)
		if !ValidImageKind(kind) || !ValidImageName(name) || !sha256Pattern.MatchString(h) {
			return nil, fmt.Errorf("its image record is damaged (%q)", k)
		}
	}
	if rec.Images == nil {
		rec.Images = map[string]string{}
	}
	return &rec, nil
}

// writeRecord writes a backup's image record durably (temp, fsync, rename).
func (bm *BackupManager) writeRecord(backup string, rec ImageRecord) error {
	rec.Version = recordVersion
	if rec.Images == nil {
		rec.Images = map[string]string{}
	}
	if rec.Unresolved == nil {
		rec.Unresolved = []string{}
	}
	sort.Strings(rec.Unresolved)
	raw, _ := json.MarshalIndent(rec, "", "  ")
	return writeFileDurable(bm.recordPath(backup), raw)
}

func writeFileDurable(path string, raw []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+"-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	_, err = tmp.Write(raw)
	if err == nil {
		err = tmp.Sync()
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(name, path)
	}
	if err != nil {
		os.Remove(name) // #nosec G104 -- best-effort cleanup on an error path; the primary error is returned (logged), a leftover temp is swept at start
		return err
	}
	_ = syncDir(filepath.Dir(path))
	return nil
}

// --- The attic index: name → hashes ---

type atticIndex struct {
	Version int                 `json:"version"`
	Names   map[string][]string `json:"names"`
	// Unknown: versions ("<kind>/<sha256>") a rebuild couldn't match to a
	// name. The sweep always keeps them (it can't tell who uses them).
	Unknown []string `json:"unknown,omitempty"`
}

func (bm *BackupManager) indexPath() string { return filepath.Join(bm.AtticDir(), atticIndexName) }

// loadIndexLocked reads the index (atticMu held). A missing, damaged or
// unreadable index is NEVER read as empty while the attic holds files (the
// sweep would delete versions kept for names): it is rebuilt from the
// backups' records, versions it can't match to a name are kept as unknown,
// and that is a visible notice. If the rebuild fails, the error blocks
// whatever needed the index.
func (bm *BackupManager) loadIndexLocked() (atticIndex, error) {
	idx := atticIndex{Version: 1, Names: map[string][]string{}}
	raw, err := os.ReadFile(bm.indexPath())
	var cause string
	switch {
	case err == nil:
		if jerr := json.Unmarshal(raw, &idx); jerr == nil {
			if idx.Names == nil {
				idx.Names = map[string][]string{}
			}
			return idx, nil
		}
		idx = atticIndex{Version: 1, Names: map[string][]string{}}
		cause = "damaged"
	case os.IsNotExist(err):
		cause = "missing"
	default:
		cause = "unreadable (" + errText(err) + ")"
	}
	files, lerr := bm.listAttic()
	if lerr != nil {
		return idx, fmt.Errorf("the attic index (%s) is %s and the attic can't be read to rebuild it: %w", bm.indexPath(), cause, lerr)
	}
	if len(files) == 0 {
		return idx, nil
	}
	return bm.rebuildIndexLocked(cause, files)
}

// rebuildIndexLocked rebuilds the index from the backups' records (and a
// staged restore's), keeping every version it can't match as unknown.
func (bm *BackupManager) rebuildIndexLocked(cause string, files []atticFile) (atticIndex, error) {
	idx := atticIndex{Version: 1, Names: map[string][]string{}}
	fail := func(err error) (atticIndex, error) {
		return idx, fmt.Errorf("the attic index (%s) is %s and couldn't be rebuilt: %w", bm.indexPath(), cause, err)
	}
	present := map[string]bool{}
	for _, f := range files {
		present[f.kind+"/"+f.sum] = true
	}
	known := map[string]bool{}
	addRec := func(rec *ImageRecord) {
		for k, h := range rec.Images {
			kind, _ := splitImageKey(k)
			if present[kind+"/"+h] {
				idx.Names[k] = addHash(idx.Names[k], h)
				known[kind+"/"+h] = true
			}
		}
	}
	backups, err := bm.ListBackups()
	if err != nil {
		return fail(err)
	}
	for _, b := range backups {
		rec, err := bm.readRecord(b.Name)
		if err != nil {
			return fail(fmt.Errorf("%s: %w", b.Name, err))
		}
		if rec != nil {
			addRec(rec)
		}
	}
	if m, err := readRestoreMarker(bm.dbPath); err != nil {
		return fail(err)
	} else if m != nil && m.Record != nil {
		addRec(m.Record)
	}
	for _, f := range files {
		if !known[f.kind+"/"+f.sum] {
			idx.Unknown = append(idx.Unknown, f.kind+"/"+f.sum)
		}
	}
	sort.Strings(idx.Unknown)
	if cause != "missing" {
		aside := fmt.Sprintf("%s.damaged-%d", bm.indexPath(), time.Now().Unix())
		if err := os.Rename(bm.indexPath(), aside); err != nil && !os.IsNotExist(err) {
			return fail(fmt.Errorf("the old index couldn't be set aside: %w", err))
		}
	}
	if err := bm.saveIndexLocked(idx); err != nil {
		return fail(err)
	}
	reason := fmt.Sprintf("The list of deleted images kept for older backups (%s) was %s; HOPS rebuilt it from the backups' records", bm.indexPath(), cause)
	if n := len(idx.Unknown); n > 0 {
		reason += fmt.Sprintf(". %d deleted image version(s) couldn't be matched to their names, so HOPS keeps them for now. They are cleared automatically "+
			"once every backup has a record of its images and every image the dashboards use is in place, or you can clear them with "+
			"\"Clean up unknown images\" in Settings › Backups", n)
	}
	slog.Warn("attic index rebuilt", "component", "backup", "cause", cause, "unknown", len(idx.Unknown))
	bm.mu.Lock()
	bm.indexRebuilt = &BackupProblem{Kind: ProblemAtticIndexRebuilt, At: time.Now(), Reason: reason}
	bm.saveNoticesLocked()
	bm.mu.Unlock()
	return idx, nil
}

func (bm *BackupManager) saveIndexLocked(idx atticIndex) error {
	if err := os.MkdirAll(bm.AtticDir(), 0o700); err != nil {
		return err
	}
	idx.Version = 1
	raw, _ := json.MarshalIndent(idx, "", "  ")
	return writeFileDurable(bm.indexPath(), raw)
}

func addHash(list []string, h string) []string {
	for _, x := range list {
		if x == h {
			return list
		}
	}
	return append(list, h)
}

// --- Hashing image files ---

// fingerprint is a file's exact state (see fileFingerprint).
type fingerprint struct {
	dev, ino         uint64
	size             int64
	mtimeNs, ctimeNs int64
}

type hashEntry struct {
	fp  fingerprint
	sum string
}

// liveHash hashes a regular file, reusing an earlier hash only while the
// file's full fingerprint (device, inode, size, mtime and ctime in ns) is
// unchanged; where there is no fingerprint it always hashes fresh. A record
// must describe the file actually there.
func (bm *BackupManager) liveHash(path string) (string, error) {
	fi, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !fi.Mode().IsRegular() {
		return "", fmt.Errorf("%s is not a regular file", path)
	}
	fp, ok := fileFingerprint(fi)
	if ok {
		bm.mu.Lock()
		e, hit := bm.hashCache[path]
		bm.mu.Unlock()
		if hit && e.fp == fp {
			return e.sum, nil
		}
	}
	sum, err := fileSHA256(path)
	if err != nil {
		return "", err
	}
	if ok {
		// Stat again: a write during the hash must not be cached as this content.
		if fi2, err := os.Lstat(path); err == nil {
			if fp2, ok2 := fileFingerprint(fi2); ok2 && fp2 == fp {
				bm.mu.Lock()
				if bm.hashCache == nil {
					bm.hashCache = map[string]hashEntry{}
				}
				bm.hashCache[path] = hashEntry{fp: fp, sum: sum}
				bm.mu.Unlock()
			}
		}
	}
	return sum, nil
}

// cachedHashes is how many hashes are cached (tests).
func (bm *BackupManager) cachedHashes() int {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	return len(bm.hashCache)
}

func isRegular(p string) bool {
	fi, err := os.Lstat(p)
	return err == nil && fi.Mode().IsRegular()
}

// --- Moving into and out of the attic ---

// MoveToAttic moves an uploaded image out of its live folder into the attic
// as attic/<kind>/<sha256> (never unlinks it; an identical version already
// there is simply kept) and records the version under its name. It returns
// the hash. os.ErrNotExist (wrapped) when there is no such file. The index
// is written first: if it can't be, nothing is moved.
func (bm *BackupManager) MoveToAttic(kind, name string) (string, error) {
	if err := checkImage(kind, name); err != nil {
		return "", err
	}
	bm.atticMu.Lock()
	defer bm.atticMu.Unlock()
	src := bm.liveImagePath(kind, name)
	fi, err := os.Lstat(src)
	if err != nil {
		return "", err
	}
	if !fi.Mode().IsRegular() {
		return "", fmt.Errorf("%s is not a regular file", src)
	}
	sum, err := fileSHA256(src)
	if err != nil {
		return "", fmt.Errorf("cannot read %s: %w", name, err)
	}
	idx, err := bm.loadIndexLocked()
	if err != nil {
		return "", err
	}
	key := ImageKey(kind, name)
	idx.Names[key] = addHash(idx.Names[key], sum)
	if err := bm.saveIndexLocked(idx); err != nil {
		return "", fmt.Errorf("cannot record %s in the attic index: %w", name, err)
	}
	dir := filepath.Join(bm.AtticDir(), kind)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("cannot create the attic folder: %w", err)
	}
	dst := filepath.Join(dir, sum)
	if isRegular(dst) {
		if err := os.Remove(src); err != nil {
			return "", err
		}
		slog.Info("image moved to the attic (this version was already there)", "component", "backup", "image", key, "sha256", sum)
		return sum, nil
	}
	if err := os.Rename(src, dst); err != nil {
		// The index entry without its file is harmless (lookups check the file).
		return "", fmt.Errorf("cannot move %s to the attic: %w", name, err)
	}
	_ = syncDir(dir)
	slog.Info("image moved to the attic", "component", "backup", "image", key, "sha256", sum)
	return sum, nil
}

// RestoreFromAttic puts back the version sum of an image (an undo when the
// delete it was part of failed). It never replaces a file. The attic copy
// stays until the sweep finds nothing refers to it.
func (bm *BackupManager) RestoreFromAttic(kind, name, sum string) error {
	if err := checkImage(kind, name); err != nil {
		return err
	}
	if !sha256Pattern.MatchString(sum) {
		return fmt.Errorf("invalid image hash")
	}
	bm.atticMu.Lock()
	defer bm.atticMu.Unlock()
	if err := installAtomic(bm.atticHashPath(kind, sum), bm.liveImagePath(kind, name), sum); err != nil {
		return err
	}
	slog.Info("image brought back from the attic", "component", "backup", "image", ImageKey(kind, name), "sha256", sum)
	return nil
}

// installHook, when set (tests), runs after part of an install's temp file is
// written; an error makes the install fail there, as a crash or full disk would.
var installHook func(dst string) error

// installAtomic installs src at dst, never replacing an existing file and
// never leaving a partial file under dst: it copies into a temp file in
// dst's folder, checks the SHA-256 (when want is set), fsyncs, then links
// it to dst exclusively (or renames where hard links aren't supported).
func installAtomic(src, dst, want string) error {
	if isRegular(dst) {
		return fmt.Errorf("%s: %w", filepath.Base(dst), os.ErrExist)
	}
	dir := filepath.Dir(dst)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	in, err := os.Open(src) // #nosec G304 -- path is built from a validated name under the data dir or a server-chosen temp/backup path, never raw user input
	if err != nil {
		return err
	}
	defer in.Close()
	tmp, err := os.CreateTemp(dir, ".install-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	h := sha256.New()
	w := io.MultiWriter(tmp, h)
	_, err = io.CopyN(w, in, 1)
	if err != nil && err != io.EOF {
		tmp.Close() // #nosec G104 -- Close on an error path or after a read-only/bounded read; the primary error is already surfaced and nothing was written
		return err
	}
	if installHook != nil {
		if herr := installHook(dst); herr != nil {
			tmp.Close() // #nosec G104 -- Close on an error path or after a read-only/bounded read; the primary error is already surfaced and nothing was written
			return herr
		}
	}
	if err == nil {
		_, err = io.Copy(w, in)
	}
	if err == nil || err == io.EOF {
		err = tmp.Sync()
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	if got := hex.EncodeToString(h.Sum(nil)); want != "" && got != want {
		return fmt.Errorf("%s doesn't have the expected content (SHA-256 mismatch)", filepath.Base(src))
	}
	if err := linkFile(tmpName, dst); err != nil {
		if os.IsExist(err) {
			return fmt.Errorf("%s: %w", filepath.Base(dst), os.ErrExist)
		}
		// No hard links here: rename (atomic), after checking again.
		if isRegular(dst) {
			return fmt.Errorf("%s: %w", filepath.Base(dst), os.ErrExist)
		}
		if err := os.Rename(tmpName, dst); err != nil {
			return err
		}
	}
	_ = syncDir(dir)
	return nil
}

// --- The record taken with each backup ---

// recordFor works out which version of each image a backup file refers to:
// the live file's hash; anything not in place is unresolved. atticMu held.
func (bm *BackupManager) recordFor(dbFile string) (ImageRecord, error) {
	rec := ImageRecord{Images: map[string]string{}}
	refs, err := ReadFileImageRefs(dbFile, RefsAll)
	if err != nil {
		return rec, fmt.Errorf("cannot read the backup's image references: %w", err)
	}
	for _, key := range sortedKeys(refs) {
		kind, name := splitImageKey(key)
		lp := bm.liveImagePath(kind, name)
		if _, err := os.Lstat(lp); err == nil {
			sum, err := bm.liveHash(lp)
			if err != nil {
				return rec, fmt.Errorf("cannot read %s: %w", key, err)
			}
			rec.Images[key] = sum
			continue
		}
		// Not in place: which version it means can't be known for certain
		// (an attic version may be an older one), so it is unresolved.
		rec.Unresolved = append(rec.Unresolved, key)
	}
	return rec, nil
}

// recordBackup writes the image record for a backup just written; on any
// failure the caller removes the backup (a backup without its record would
// silently lose track of which images it used).
func (bm *BackupManager) recordBackup(name, path string) error {
	bm.atticMu.Lock()
	defer bm.atticMu.Unlock()
	rec, err := bm.recordFor(path)
	if err != nil {
		return err
	}
	if err := bm.writeRecord(name, rec); err != nil {
		return fmt.Errorf("cannot write the backup's image record: %w", err)
	}
	return nil
}

// removeBackupExtras removes a deleted backup's image record, and MOVES its
// staged images (an uploaded backup's: the only copy) into the attic, where
// the sweep decides (a restore staged before the delete still needs them).
// A failure is logged; the sweep retries leftovers (and shows what it can't).
func (bm *BackupManager) removeBackupExtras(name string) {
	bm.atticMu.Lock()
	defer bm.atticMu.Unlock()
	if err := os.Remove(bm.recordPath(name)); err != nil && !os.IsNotExist(err) {
		slog.Warn("could not remove a deleted backup's image record; retried by the next sweep", "component", "backup", "name", name, "error", err)
	}
	if err := bm.moveStagedToAtticLocked(name); err != nil {
		slog.Warn("could not move a deleted backup's images to the attic; retried by the next sweep", "component", "backup", "name", name, "error", err)
	}
}

// moveStagedToAtticLocked moves backups/.images/<name>/<kind>/<file> into
// the attic by content (index first), then removes the emptied folder.
func (bm *BackupManager) moveStagedToAtticLocked(name string) error {
	root := bm.stagedImagesPath(name)
	if _, err := os.Lstat(root); os.IsNotExist(err) {
		return nil
	}
	type item struct{ kind, file, path, sum string }
	var items []item
	for _, kind := range ImageKinds {
		entries, err := os.ReadDir(filepath.Join(root, kind))
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		for _, e := range entries {
			if !e.Type().IsRegular() || !ValidImageName(e.Name()) {
				continue
			}
			p := filepath.Join(root, kind, e.Name())
			sum, err := fileSHA256(p)
			if err != nil {
				return err
			}
			items = append(items, item{kind, e.Name(), p, sum})
		}
	}
	if len(items) > 0 {
		idx, err := bm.loadIndexLocked()
		if err != nil {
			return err
		}
		for _, it := range items {
			k := ImageKey(it.kind, it.file)
			idx.Names[k] = addHash(idx.Names[k], it.sum)
		}
		if err := bm.saveIndexLocked(idx); err != nil {
			return err
		}
		for _, it := range items {
			dir := filepath.Join(bm.AtticDir(), it.kind)
			if err := os.MkdirAll(dir, 0o700); err != nil {
				return err
			}
			dst := filepath.Join(dir, it.sum)
			if isRegular(dst) {
				if err := os.Remove(it.path); err != nil {
					return err
				}
				continue
			}
			if err := os.Rename(it.path, dst); err != nil {
				return err
			}
			slog.Info("a deleted backup's image moved to the attic", "component", "backup", "backup", name, "image", ImageKey(it.kind, it.file), "sha256", it.sum)
		}
	}
	return os.RemoveAll(root)
}

// --- Resolving a backup's images (download and restore) ---

// imageSourceFor resolves one image reference of a backup: by its recorded
// hash (live if it matches, else the backup's staged image, else the attic),
// or, without a record, only when exactly one version exists. It returns
// the source path and hash, or why it can't ("missing", "ambiguous").
func (bm *BackupManager) imageSourceFor(backup string, rec *ImageRecord, idx atticIndex, key string) (src, sum, why string) {
	kind, name := splitImageKey(key)
	lp := bm.liveImagePath(kind, name)
	staged := filepath.Join(bm.stagedImagesPath(backup), kind, name)
	if rec != nil {
		want, ok := rec.Images[key]
		if !ok {
			// The record couldn't pin it down: any candidate makes it
			// ambiguous (reported), never silently taken or kept.
			if isRegular(lp) || isRegular(staged) {
				return "", "", "ambiguous"
			}
			for _, h := range idx.Names[key] {
				if isRegular(bm.atticHashPath(kind, h)) {
					return "", "", "ambiguous"
				}
			}
			if hasUnknownOfKind(idx, kind) {
				return "", "", "ambiguous"
			}
			return "", "", "missing"
		}
		for _, p := range []string{lp, staged} {
			if isRegular(p) {
				if h, err := bm.liveHash(p); err == nil && h == want {
					return p, want, ""
				}
			}
		}
		if ap := bm.atticHashPath(kind, want); isRegular(ap) {
			return ap, want, ""
		}
		return "", "", "missing"
	}
	cands := map[string]string{}
	for _, p := range []string{lp, staged} {
		if isRegular(p) {
			if h, err := bm.liveHash(p); err == nil {
				if _, seen := cands[h]; !seen {
					cands[h] = p
				}
			}
		}
	}
	for _, h := range idx.Names[key] {
		if ap := bm.atticHashPath(kind, h); isRegular(ap) {
			if _, seen := cands[h]; !seen {
				cands[h] = ap
			}
		}
	}
	// After an index rebuild, an unknown version of this kind may be the one
	// this backup used: never pick (or keep) a candidate silently then.
	if hasUnknownOfKind(idx, kind) {
		return "", "", "ambiguous"
	}
	switch len(cands) {
	case 0:
		return "", "", "missing"
	case 1:
		for h, p := range cands {
			return p, h, ""
		}
	}
	return "", "", "ambiguous"
}

func hasUnknownOfKind(idx atticIndex, kind string) bool {
	for _, u := range idx.Unknown {
		if strings.HasPrefix(u, kind+"/") {
			return true
		}
	}
	return false
}

// --- The sweep ---

// AtticUsage is the attic's size (shown in the Backups dialog).
type AtticUsage struct {
	Files int   `json:"files"`
	Bytes int64 `json:"bytes"`
}

type atticFile struct {
	kind, sum, path string
	size            int64
}

// listAttic returns the versions in the attic (a missing attic is empty).
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
			if !e.Type().IsRegular() || !sha256Pattern.MatchString(e.Name()) {
				continue
			}
			info, err := e.Info()
			if err != nil {
				return nil, err
			}
			out = append(out, atticFile{kind: kind, sum: e.Name(), path: filepath.Join(dir, e.Name()), size: info.Size()})
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

// keepSet is what the sweep must keep: exact versions, and every version of
// some names.
type keepSet struct {
	hashes map[string]bool
	names  map[string]bool
	// recorded: versions ("<kind>/<sum>") a backup's or staged restore's
	// record names exactly.
	recorded map[string]bool
	// unknownBlockers: why unknown versions (see atticIndex.Unknown) must
	// still be kept. Empty means nothing could need them.
	unknownBlockers []string
	unknown         []string
}

// SweepAttic removes the attic versions that nothing refers to any more, and
// the image records and staged images of backups that are gone. If anything
// that decides it (a backup, its record, a staged restore, the live
// database, the index) can't be read, NO attic file is removed and that is a
// visible notice. It returns the attic files removed.
func (bm *BackupManager) SweepAttic() ([]string, error) {
	bm.atticMu.Lock()
	defer bm.atticMu.Unlock()
	var failed []string
	failed = append(failed, bm.removeOrphanExtrasLocked()...)

	files, err := bm.listAttic()
	if err != nil {
		err = fmt.Errorf("the attic (%s) can't be read: %w", bm.AtticDir(), err)
		bm.noteAttic(&BackupProblem{Kind: ProblemAtticBlocked, At: time.Now(), Reason: err.Error()}, bm.failedProblem(failed), nil)
		return nil, err
	}
	if len(files) == 0 {
		bm.noteAttic(nil, bm.failedProblem(failed), nil)
		return nil, nil
	}

	keep, unreadable := bm.keepSetLocked()
	if len(unreadable) > 0 {
		reason := fmt.Sprintf("%s couldn't be read, so no image in the attic (%s) was deleted: %s",
			pluralThings(len(unreadable)), bm.AtticDir(), strings.Join(unreadable, "; "))
		slog.Error("attic sweep blocked", "component", "backup", "reason", reason)
		bm.mu.Lock()
		prevFailed := bm.atticFailed // nothing was tried: an earlier failure still stands
		bm.mu.Unlock()
		if fp := bm.failedProblem(failed); fp != nil {
			prevFailed = fp
		}
		bm.noteAttic(&BackupProblem{Kind: ProblemAtticBlocked, At: time.Now(), Reason: reason}, prevFailed, bm.atticLarge(files))
		return nil, errors.New(reason)
	}

	removedHashes := map[string]bool{}
	var removed []string
	var left []atticFile
	for _, f := range files {
		if keep.hashes[f.sum] {
			left = append(left, f)
			continue
		}
		if err := bm.remove(f.path); err != nil && !errors.Is(err, fs.ErrNotExist) {
			slog.Warn("attic: could not remove an unreferenced image", "component", "backup", "file", f.path, "error", err)
			failed = append(failed, f.kind+"/"+f.sum+": "+errText(err))
			left = append(left, f)
			continue
		}
		slog.Info("attic: removed an image version no backup refers to", "component", "backup", "kind", f.kind, "sha256", f.sum)
		removed = append(removed, f.kind+"/"+f.sum)
		removedHashes[f.kind+"/"+f.sum] = true
	}
	if len(removedHashes) > 0 {
		if idx, err := bm.loadIndexLocked(); err == nil {
			for key, hs := range idx.Names {
				kind, _ := splitImageKey(key)
				var kept []string
				for _, h := range hs {
					if !removedHashes[kind+"/"+h] {
						kept = append(kept, h)
					}
				}
				if len(kept) == 0 {
					delete(idx.Names, key)
				} else {
					idx.Names[key] = kept
				}
			}
			var unknown []string
			for _, u := range idx.Unknown {
				if !removedHashes[u] {
					unknown = append(unknown, u)
				}
			}
			idx.Unknown = unknown
			if err := bm.saveIndexLocked(idx); err != nil {
				failed = append(failed, "the attic index: "+errText(err))
			}
		}
	}
	var retErr error
	fp := bm.failedProblem(failed)
	if fp != nil {
		retErr = errors.New(fp.Reason)
	}
	bm.noteAttic(nil, fp, bm.atticLarge(left))
	return removed, retErr
}

func (bm *BackupManager) failedProblem(failed []string) *BackupProblem {
	if len(failed) == 0 {
		return nil
	}
	return &BackupProblem{Kind: ProblemAtticDeleteFailed, At: time.Now(),
		Reason: fmt.Sprintf("couldn't remove %d leftover file(s) (in %s or %s): %s", len(failed), bm.AtticDir(), bm.backupDir, strings.Join(failed, "; "))}
}

func pluralThings(n int) string {
	if n == 1 {
		return "1 source"
	}
	return fmt.Sprintf("%d sources", n)
}

// keepSetLocked collects what must be kept, and what couldn't be read.
// The live DB is read before AND after the backups (a reference added
// meanwhile is kept); the union is used.
func (bm *BackupManager) keepSetLocked() (keepSet, []string) {
	keep := keepSet{hashes: map[string]bool{}, names: map[string]bool{}, recorded: map[string]bool{}}
	var unreadable []string
	var recordless []string
	liveAll := map[string]bool{}
	addNames := func(m map[string]bool) {
		for k := range m {
			keep.names[k] = true
		}
	}
	addRecord := func(rec *ImageRecord) {
		for k, h := range rec.Images {
			kind, _ := splitImageKey(k)
			keep.hashes[kind+"/"+h] = true
			keep.recorded[kind+"/"+h] = true
		}
		for _, k := range rec.Unresolved {
			keep.names[k] = true
		}
	}
	if live, err := bm.liveRefs(RefsAll); err != nil {
		unreadable = append(unreadable, "the live database: "+err.Error())
	} else {
		addNames(live)
		for k := range live {
			liveAll[k] = true
		}
	}
	backups, err := bm.ListBackups()
	if err != nil {
		unreadable = append(unreadable, "the backups folder: "+err.Error())
	}
	for _, b := range backups {
		rec, err := bm.readRecord(b.Name)
		if err != nil {
			unreadable = append(unreadable, b.Name+": "+err.Error())
			continue
		}
		if rec != nil {
			addRecord(rec)
			continue
		}
		recordless = append(recordless, b.Name)
		r, err := bm.backupRefs(b)
		if err != nil {
			unreadable = append(unreadable, b.Name+": "+err.Error())
			continue
		}
		addNames(r)
	}
	// A staged restore (and its temp copy, while a restore is being staged)
	// needs its images at the next start.
	stagedRecorded := false
	if m, err := readRestoreMarker(bm.dbPath); err != nil {
		unreadable = append(unreadable, "the staged restore's image marker: "+err.Error())
	} else if m != nil && m.Record != nil {
		addRecord(m.Record)
		stagedRecorded = true
	}
	for _, p := range []string{PendingRestorePath(bm.dbPath), PendingRestorePath(bm.dbPath) + ".tmp"} {
		if _, err := os.Lstat(p); err != nil {
			continue
		}
		if !stagedRecorded {
			keep.unknownBlockers = append(keep.unknownBlockers, "a restore is being staged or waiting to be applied without a record of its images")
		}
		r, err := ReadFileImageRefs(p, RefsAll)
		if err != nil {
			unreadable = append(unreadable, filepath.Base(p)+": "+err.Error())
			continue
		}
		addNames(r)
	}
	if live, err := bm.liveRefs(RefsAll); err != nil {
		unreadable = append(unreadable, "the live database: "+err.Error())
	} else {
		addNames(live)
		for k := range live {
			liveAll[k] = true
		}
	}
	idx, err := bm.loadIndexLocked()
	if err != nil {
		unreadable = append(unreadable, err.Error())
	}
	for name := range keep.names {
		kind, _ := splitImageKey(name)
		for _, h := range idx.Names[name] {
			keep.hashes[kind+"/"+h] = true
		}
	}
	if len(recordless) > 0 {
		sort.Strings(recordless)
		keep.unknownBlockers = append(keep.unknownBlockers, fmt.Sprintf("%d backup(s) have no record of their images (%s); restoring one may need them",
			len(recordless), strings.Join(recordless, ", ")))
	}
	var notInPlace []string
	for _, k := range sortedKeys(liveAll) {
		kind, name := splitImageKey(k)
		if !isRegular(bm.liveImagePath(kind, name)) {
			notInPlace = append(notInPlace, k)
		}
	}
	if len(notInPlace) > 0 {
		keep.unknownBlockers = append(keep.unknownBlockers, fmt.Sprintf("the dashboards use %d image(s) that aren't in place (%s); one of these versions may be it",
			len(notInPlace), strings.Join(notInPlace, ", ")))
	}
	keep.unknown = idx.Unknown
	// Unknown versions are kept while anything could still need them.
	if len(keep.unknownBlockers) > 0 {
		for _, u := range idx.Unknown {
			keep.hashes[u] = true
		}
	}
	// keepSet hashes are "<kind>/<sum>"; the attic listing compares by kind too.
	out := keepSet{hashes: map[string]bool{}, names: keep.names, recorded: keep.recorded,
		unknownBlockers: keep.unknownBlockers, unknown: keep.unknown}
	for k := range keep.hashes {
		_, h := splitImageKey(k)
		out.hashes[h] = true
	}
	return out, unreadable
}

// removeOrphanExtrasLocked removes image records and staged-image folders
// whose backup is gone. It returns what couldn't be removed.
func (bm *BackupManager) removeOrphanExtrasLocked() []string {
	var failed []string
	if m, err := filepath.Glob(filepath.Join(bm.backupDir, BackupPrefix+"*"+BackupSuffix+imageRecordSuffix)); err == nil {
		for _, p := range m {
			backup := strings.TrimSuffix(filepath.Base(p), imageRecordSuffix)
			if _, err := os.Lstat(filepath.Join(bm.backupDir, backup)); err == nil || !os.IsNotExist(err) {
				continue
			}
			if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
				failed = append(failed, filepath.Base(p)+": "+errText(err))
			} else {
				slog.Info("removed the image record of a deleted backup", "component", "backup", "name", backup)
			}
		}
	}
	entries, err := os.ReadDir(filepath.Join(bm.backupDir, stagedImagesDir))
	if err == nil {
		for _, e := range entries {
			if ValidateBackupName(e.Name()) != nil {
				continue
			}
			if _, err := os.Lstat(filepath.Join(bm.backupDir, e.Name())); err == nil || !os.IsNotExist(err) {
				continue
			}
			if err := bm.moveStagedToAtticLocked(e.Name()); err != nil {
				failed = append(failed, filepath.Join(stagedImagesDir, e.Name())+": "+errText(err))
			} else {
				slog.Info("removed the images of a deleted backup", "component", "backup", "name", e.Name())
			}
		}
	}
	return failed
}

func (bm *BackupManager) atticLarge(files []atticFile) *BackupProblem {
	var total int64
	for _, f := range files {
		total += f.size
	}
	if total <= AtticLargeBytes {
		return nil
	}
	unknown := 0
	if idx, err := bm.readIndexOnlyLocked(); err == nil {
		present := map[string]bool{}
		for _, f := range files {
			present[f.kind+"/"+f.sum] = true
		}
		for _, u := range idx.Unknown {
			if present[u] {
				unknown++
			}
		}
	}
	reason := fmt.Sprintf("Deleted images kept for older backups take %s (%d versions, in %s). They are kept because backups still use them; "+
		"they are removed automatically once no backup does, so deleting backups you no longer need in Settings › Backups frees this space",
		formatBytes(total), len(files), bm.AtticDir())
	if unknown > 0 {
		reason += fmt.Sprintf(". %d of them couldn't be matched to their names: \"Clean up unknown images\" in Settings › Backups clears those", unknown)
	}
	return &BackupProblem{Kind: ProblemAtticLarge, At: time.Now(), Reason: reason}
}

// readIndexOnlyLocked reads the index as it is, without rebuilding.
func (bm *BackupManager) readIndexOnlyLocked() (atticIndex, error) {
	idx := atticIndex{Names: map[string][]string{}}
	raw, err := os.ReadFile(bm.indexPath())
	if err != nil {
		return idx, err
	}
	err = json.Unmarshal(raw, &idx)
	return idx, err
}

// --- "Clean up unknown images" ---

// UnknownItem is one unknown attic version, for the preview.
type UnknownItem struct {
	ID         string    `json:"id"` // "<kind>/<sha256>"
	Kind       string    `json:"kind"`
	Size       int64     `json:"size"`
	ModifiedAt time.Time `json:"modifiedAt"`
}

// UnknownPreview is what "Clean up unknown images" would delete, and why
// HOPS keeps them by itself (the risks the admin accepts by confirming).
type UnknownPreview struct {
	Items    []UnknownItem `json:"items"`
	Warnings []string      `json:"warnings"`
}

// unknownCandidatesLocked lists the unknown versions present in the attic
// and not named exactly by any record.
func (bm *BackupManager) unknownCandidatesLocked() ([]UnknownItem, keepSet, error) {
	keep, unreadable := bm.keepSetLocked()
	if len(unreadable) > 0 {
		return nil, keep, fmt.Errorf("HOPS can't tell which images are still needed: %s", strings.Join(unreadable, "; "))
	}
	items := []UnknownItem{}
	for _, u := range keep.unknown {
		if keep.recorded[u] {
			continue
		}
		kind, sum := splitImageKey(u)
		if !ValidImageKind(kind) || !sha256Pattern.MatchString(sum) {
			continue
		}
		fi, err := os.Lstat(bm.atticHashPath(kind, sum))
		if err != nil || !fi.Mode().IsRegular() {
			continue
		}
		items = append(items, UnknownItem{ID: u, Kind: kind, Size: fi.Size(), ModifiedAt: fi.ModTime()})
	}
	return items, keep, nil
}

// PreviewUnknownCleanup lists what "Clean up unknown images" would delete;
// nothing is deleted.
func (bm *BackupManager) PreviewUnknownCleanup() (UnknownPreview, error) {
	bm.atticMu.Lock()
	defer bm.atticMu.Unlock()
	items, keep, err := bm.unknownCandidatesLocked()
	if err != nil {
		return UnknownPreview{}, err
	}
	w := keep.unknownBlockers
	if w == nil {
		w = []string{}
	}
	return UnknownPreview{Items: items, Warnings: w}, nil
}

// CleanUpUnknown deletes the confirmed unknown versions that are still
// unknown now (re-checked: never one a record names, never anything else).
func (bm *BackupManager) CleanUpUnknown(ids []string) ([]string, error) {
	bm.atticMu.Lock()
	defer bm.atticMu.Unlock()
	items, _, err := bm.unknownCandidatesLocked()
	if err != nil {
		return nil, err
	}
	want := map[string]bool{}
	for _, id := range ids {
		want[id] = true
	}
	var deleted, failed []string
	gone := map[string]bool{}
	for _, it := range items {
		if !want[it.ID] {
			continue
		}
		kind, sum := splitImageKey(it.ID)
		if err := bm.remove(bm.atticHashPath(kind, sum)); err != nil && !os.IsNotExist(err) {
			failed = append(failed, it.ID+": "+errText(err))
			continue
		}
		slog.Info("attic: removed an unknown image version (confirmed by the admin)", "component", "backup", "kind", kind, "sha256", sum)
		deleted = append(deleted, it.ID)
		gone[it.ID] = true
	}
	if len(gone) > 0 {
		idx, err := bm.loadIndexLocked()
		if err == nil {
			var unknown []string
			for _, u := range idx.Unknown {
				if !gone[u] {
					unknown = append(unknown, u)
				}
			}
			idx.Unknown = unknown
			err = bm.saveIndexLocked(idx)
		}
		if err != nil {
			failed = append(failed, "the attic index: "+errText(err))
		}
	}
	if len(failed) > 0 {
		return deleted, fmt.Errorf("couldn't remove %d unknown image version(s): %s", len(failed), strings.Join(failed, "; "))
	}
	return deleted, nil
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

// --- Restoring: put back the exact images the restored data used ---

// restoreMarker is left by RestoreBackup for the next start: which backup
// was restored, and its image record (copied, so a cleanup that deletes the
// backup meanwhile can't lose it). Record is nil for a backup without one.
type restoreMarker struct {
	Backup string       `json:"backup"`
	Record *ImageRecord `json:"record"`
}

func restoreImagesMarkerPath(dbPath string) string {
	return PendingRestorePath(dbPath) + restoreImagesSuffix
}

func readRestoreMarker(dbPath string) (*restoreMarker, error) {
	raw, err := os.ReadFile(restoreImagesMarkerPath(dbPath))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var m restoreMarker
	if err := json.Unmarshal(raw, &m); err != nil || (m.Backup != "" && ValidateBackupName(m.Backup) != nil) {
		return nil, fmt.Errorf("the restore's image marker is damaged")
	}
	if m.Record != nil && m.Record.Images == nil {
		m.Record.Images = map[string]string{}
	}
	return &m, nil
}

// writeRestoreMarker records the backup being restored and its image record
// (RestoreBackup refuses a backup whose record can't be read).
func (bm *BackupManager) writeRestoreMarker(backup string, rec *ImageRecord) error {
	raw, _ := json.Marshal(restoreMarker{Backup: backup, Record: rec})
	return writeFileDurable(restoreImagesMarkerPath(bm.dbPath), raw)
}

// stagedImagesPath is backups/.images/<backup>.
func (bm *BackupManager) stagedImagesPath(backup string) string {
	return filepath.Join(bm.backupDir, stagedImagesDir, backup)
}

// RestoredImages is what AfterRestore did with the restored data's images.
type RestoredImages struct {
	Installed []string // the recorded (or only) version, put in place
	Missing   []string // referenced, the version it used found nowhere
	Clashes   []string // a different version is in place under that name (kept)
	Ambiguous []string // no record and several versions: nothing changed
	Failed    []string // couldn't be put in place ("key: reason")
}

// AfterRestore runs at start, after RecoverAndApplyRestore and before the
// database is opened. When a restore was applied it puts in place the exact
// version of each image the restored data uses (by the backup's record:
// from its staged images or the attic), never replacing a file that is
// there; without a record only an unambiguous version is put back. Anything
// missing, clashing, ambiguous or failed is a visible notice: a restore never
// silently shows broken or wrong images. Without an applied restore it only
// clears the marker.
func (bm *BackupManager) AfterRestore(applied bool) RestoredImages {
	marker, mErr := readRestoreMarker(bm.dbPath)
	defer func() {
		if err := os.Remove(restoreImagesMarkerPath(bm.dbPath)); err != nil && !os.IsNotExist(err) {
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
	var parts []string
	if mErr != nil {
		parts = append(parts, mErr.Error()+", so HOPS can't tell which version of each image the backup used")
	}
	backup := ""
	var rec *ImageRecord
	if marker != nil {
		backup, rec = marker.Backup, marker.Record
	}
	idx, idxErr := bm.loadIndexLocked()
	if idxErr != nil {
		parts = append(parts, idxErr.Error())
	}

	for _, key := range sortedKeys(all) {
		kind, name := splitImageKey(key)
		lp := bm.liveImagePath(kind, name)
		if rec != nil {
			want, ok := rec.Images[key]
			if !ok {
				if _, _, why := bm.imageSourceFor(backup, rec, idx, key); why == "ambiguous" {
					res.Ambiguous = append(res.Ambiguous, key)
				} else if live[key] {
					res.Missing = append(res.Missing, key)
				}
				continue
			}
			if isRegular(lp) {
				h, err := bm.liveHash(lp)
				if err != nil {
					res.Failed = append(res.Failed, key+": "+errText(err))
				} else if h != want {
					res.Clashes = append(res.Clashes, key)
				}
				continue
			}
			src, _, why := bm.imageSourceFor(backup, rec, idx, key)
			if why != "" {
				if live[key] {
					res.Missing = append(res.Missing, key)
				}
				continue
			}
			if err := installAtomic(src, lp, want); err != nil {
				res.Failed = append(res.Failed, key+": "+errText(err))
				continue
			}
			res.Installed = append(res.Installed, key)
			continue
		}
		// No record: only what is unambiguous.
		src, sum, why := bm.imageSourceFor(backup, nil, idx, key)
		switch {
		case why == "ambiguous":
			res.Ambiguous = append(res.Ambiguous, key)
		case why == "missing":
			if live[key] {
				res.Missing = append(res.Missing, key)
			}
		case src == lp:
			// The only version is the one in place.
		default:
			if err := installAtomic(src, lp, sum); err != nil {
				res.Failed = append(res.Failed, key+": "+errText(err))
				continue
			}
			res.Installed = append(res.Installed, key)
		}
	}

	slog.Info("restore: images", "component", "backup", "installed", len(res.Installed), "missing", len(res.Missing),
		"clashes", len(res.Clashes), "ambiguous", len(res.Ambiguous), "failed", len(res.Failed))
	if len(res.Missing) > 0 {
		parts = append(parts, fmt.Sprintf("%d image(s) the restored data uses couldn't be found in the version it used, and will show as broken: %s. Upload them again",
			len(res.Missing), strings.Join(res.Missing, ", ")))
	}
	if len(res.Clashes) > 0 {
		parts = append(parts, fmt.Sprintf("%d image(s) weren't put back because a different version with the same name is in place (it was kept, so these may look different from when the backup was made): %s",
			len(res.Clashes), strings.Join(res.Clashes, ", ")))
	}
	if len(res.Ambiguous) > 0 {
		parts = append(parts, fmt.Sprintf("HOPS can't tell which version of these images this backup used (it has no record of their exact version), so it changed none of them: %s",
			strings.Join(res.Ambiguous, ", ")))
	}
	if len(res.Failed) > 0 {
		parts = append(parts, fmt.Sprintf("%d image(s) couldn't be put in place: %s", len(res.Failed), strings.Join(res.Failed, "; ")))
	}
	if len(parts) > 0 {
		bm.recordRestoreImages("After the restore, " + strings.Join(parts, ". "))
	}
	return res
}

func (bm *BackupManager) recordRestoreImages(reason string) {
	slog.Warn("restore: images missing, ambiguous or not installed", "component", "backup", "reason", reason)
	bm.mu.Lock()
	defer bm.mu.Unlock()
	bm.restoreImages = &BackupProblem{Kind: ProblemRestoreImages, At: time.Now(), Reason: reason}
	bm.saveNoticesLocked()
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// AtticUnknownCount is how many unknown versions the attic index lists (the
// Backups dialog offers "Clean up unknown images" when there are any). It
// reads the index as it is; an unreadable index is an error, never "none".
func (bm *BackupManager) AtticUnknownCount() (int, error) {
	bm.atticMu.Lock()
	defer bm.atticMu.Unlock()
	idx, err := bm.readIndexOnlyLocked()
	if err != nil {
		// No index and no attic files is a fresh install (nothing deleted
		// yet): an empty attic, not an error. A missing index while the attic
		// holds files is still an error (the index was lost), as is a damaged
		// or unreadable one.
		if errors.Is(err, fs.ErrNotExist) {
			files, lerr := bm.listAttic()
			if lerr != nil {
				return 0, fmt.Errorf("the attic index is missing and the attic can't be read: %w", lerr)
			}
			if len(files) == 0 {
				return 0, nil
			}
			return 0, fmt.Errorf("the attic index (%s) is missing but the attic holds %d image versions: %w", bm.indexPath(), len(files), err)
		}
		return 0, err
	}
	return len(idx.Unknown), nil
}
