package database

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/version"
)

// Backup archives (M6 §12): a downloaded backup is one .zip holding the
// database, every uploaded image it refers to (from the live folders, the
// attic, or the backup's own staged images) and a manifest with each file's
// SHA-256. An uploaded archive is validated strictly before anything is kept.

const (
	// ArchiveFormat names the manifest's format.
	ArchiveFormat = "hops-backup-archive"
	// ArchiveFormatVersion is the manifest version this HOPS writes and reads.
	ArchiveFormatVersion = 1
	// ArchiveSuffix replaces ".db" in a downloaded archive's name.
	ArchiveSuffix       = ".zip"
	archiveDBName       = "hops.db"
	archiveManifestName = "manifest.json"
	// maxManifestBytes bounds the manifest read from an upload.
	maxManifestBytes = 4 << 20
	// MaxArchiveEntries bounds the number of entries in an uploaded archive.
	MaxArchiveEntries = 20000
	// maxReportedMissing bounds the missing images reported from a manifest.
	maxReportedMissing = 200
)

// imageExtensions are the file types each kind may hold (as the upload
// handlers accept them).
var imageExtensions = map[string]map[string]bool{
	"icons":       {".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".svg": true},
	"backgrounds": {".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true},
}

// AllowedImageExt says whether ext (lower-case, with the dot) is a file type
// the kind ("icons" or "backgrounds") may hold, as the upload handlers accept.
func AllowedImageExt(kind, ext string) bool { return imageExtensions[kind][ext] }

// ArchiveFile is one file in an archive's manifest.
type ArchiveFile struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

// ArchiveManifest is manifest.json.
type ArchiveManifest struct {
	Format          string        `json:"format"`
	FormatVersion   int           `json:"formatVersion"`
	HOPSVersion     string        `json:"hopsVersion"`
	CreatedAt       time.Time     `json:"createdAt"`
	Backup          string        `json:"backup"`
	BackupCreatedAt time.Time     `json:"backupCreatedAt"`
	Files           []ArchiveFile `json:"files"`
	// Missing lists images the database refers to that weren't found
	// anywhere when the archive was made.
	Missing []string `json:"missing"`
	// Ambiguous: images the backup had no record of, with several versions
	// to choose from; none was included.
	Ambiguous []string `json:"ambiguous,omitempty"`
}

// ArchiveName is a backup's download name: "…hops-backup-<ts>_<reason>.zip".
func ArchiveName(backup string) string {
	return strings.TrimSuffix(backup, BackupSuffix) + ArchiveSuffix
}

// BackupImages is which images a backup's archive would hold, which
// referenced images are missing, and which can't be told apart (a backup
// with no record of its image versions, and several versions exist).
type BackupImages struct {
	Included  []string `json:"included"`
	Missing   []string `json:"missing"`
	Ambiguous []string `json:"ambiguous"`
}

type plannedImage struct{ key, src, sum string }

// PlanBackupImages reports which images the backup's archive will include
// and which it refers to but can't (the UI warns before a download).
func (bm *BackupManager) PlanBackupImages(backup string) (BackupImages, error) {
	p, _, err := bm.backupFile(backup)
	if err != nil {
		return BackupImages{}, err
	}
	out, _, err := bm.planImages(backup, p)
	return out, err
}

func (bm *BackupManager) planImages(backup, dbFile string) (BackupImages, []plannedImage, error) {
	all, err := ReadFileImageRefs(dbFile, RefsAll)
	if err != nil {
		return BackupImages{}, nil, fmt.Errorf("cannot read the backup's image references: %w", err)
	}
	live, err := ReadFileImageRefs(dbFile, RefsLive)
	if err != nil {
		return BackupImages{}, nil, fmt.Errorf("cannot read the backup's image references: %w", err)
	}
	rec, err := bm.readRecord(backup)
	if err != nil {
		return BackupImages{}, nil, err
	}
	bm.atticMu.Lock()
	idx, idxErr := bm.loadIndexLocked()
	bm.atticMu.Unlock()
	if idxErr != nil && rec == nil {
		return BackupImages{}, nil, idxErr
	}
	out := BackupImages{Included: []string{}, Missing: []string{}, Ambiguous: []string{}}
	var plan []plannedImage
	for _, key := range sortedKeys(all) {
		src, sum, why := bm.imageSourceFor(backup, rec, idx, key)
		switch why {
		case "":
			out.Included = append(out.Included, key)
			plan = append(plan, plannedImage{key: key, src: src, sum: sum})
		case "ambiguous":
			out.Ambiguous = append(out.Ambiguous, key)
		default:
			if live[key] {
				out.Missing = append(out.Missing, key)
			}
		}
	}
	return out, plan, nil
}

// BuildBackupArchive writes the backup's archive to a temporary file in the
// backups folder and returns it (open, at offset 0) with its manifest. The
// caller serves it and calls the cleanup func. It is built completely before
// anything is sent, so a failure is an error response, never a truncated
// file; an image that changes or vanishes while it is built fails it too
// (never a quietly incomplete archive).
func (bm *BackupManager) BuildBackupArchive(backup string) (*os.File, ArchiveManifest, func(), error) {
	dbFile, fi, err := bm.backupFile(backup)
	if err != nil {
		return nil, ArchiveManifest{}, nil, err
	}
	planned, plan, err := bm.planImages(backup, dbFile)
	if err != nil {
		return nil, ArchiveManifest{}, nil, err
	}
	tmp, err := os.CreateTemp(bm.backupDir, ".download-*.tmp")
	if err != nil {
		return nil, ArchiveManifest{}, nil, fmt.Errorf("cannot build the archive: %w", err)
	}
	cleanup := func() {
		tmp.Close() // #nosec G104 -- best-effort cleanup on an error path; the primary error is returned (logged), a leftover temp is swept at start
		os.Remove(tmp.Name()) // #nosec G104 -- best-effort cleanup on an error path; the primary error is returned (logged), a leftover temp is swept at start
	}
	man := ArchiveManifest{
		Format: ArchiveFormat, FormatVersion: ArchiveFormatVersion, HOPSVersion: version.String(),
		CreatedAt: time.Now().UTC(), Backup: backup, BackupCreatedAt: fi.ModTime().UTC(),
		Files: []ArchiveFile{}, Missing: planned.Missing, Ambiguous: planned.Ambiguous,
	}
	zw := zip.NewWriter(tmp)
	add := func(name, src, want string) error {
		f, err := os.Open(src) // #nosec G304 -- path is built from a validated name under the data dir or a server-chosen temp/backup path, never raw user input
		if err != nil {
			return err
		}
		defer f.Close()
		w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate, Modified: time.Now()})
		if err != nil {
			return err
		}
		h := sha256.New()
		n, err := io.Copy(io.MultiWriter(w, h), f)
		if err != nil {
			return err
		}
		sum := hex.EncodeToString(h.Sum(nil))
		if want != "" && sum != want {
			return fmt.Errorf("it changed while the archive was being made")
		}
		man.Files = append(man.Files, ArchiveFile{Path: name, Size: n, SHA256: sum})
		return nil
	}
	if err := add(archiveDBName, dbFile, ""); err != nil {
		cleanup()
		return nil, ArchiveManifest{}, nil, fmt.Errorf("cannot build the archive: %w", err)
	}
	for _, p := range plan {
		if err := add(p.key, p.src, p.sum); err != nil {
			cleanup()
			return nil, ArchiveManifest{}, nil, fmt.Errorf("cannot add %s to the archive (%v); nothing was downloaded, try again", p.key, err)
		}
	}
	raw, _ := json.MarshalIndent(man, "", "  ")
	w, err := zw.CreateHeader(&zip.FileHeader{Name: archiveManifestName, Method: zip.Deflate, Modified: time.Now()})
	if err == nil {
		_, err = w.Write(raw)
	}
	if err == nil {
		err = zw.Close()
	}
	if err == nil {
		_, err = tmp.Seek(0, io.SeekStart)
	}
	if err != nil {
		cleanup()
		return nil, ArchiveManifest{}, nil, fmt.Errorf("cannot build the archive: %w", err)
	}
	slog.Info("built backup archive", "component", "backup", "name", backup, "images", len(man.Files)-1, "missing", len(man.Missing), "ambiguous", len(man.Ambiguous))
	return tmp, man, cleanup, nil
}

// --- Uploads ---

// UploadCaps bounds an uploaded archive: the whole upload, and each image.
// A cap of 0 (or less) refuses: no upload, or no images.
type UploadCaps struct {
	Total    int64 // the database and all images together
	PerImage int64 // each image
	// Process, when set, checks and normalises each image the way a normal
	// upload of that kind would (decode, re-encode); an error refuses the
	// upload with that reason.
	Process func(kind, name string, data []byte) ([]byte, error)
}

// UploadResult is what StoreUpload stored.
type UploadResult struct {
	Name string `json:"name"`
	// Legacy: a plain .db with no images (the UI shows a warning).
	Legacy bool `json:"legacy"`
	Images int  `json:"images"`
	// Missing: images the archive's manifest says weren't found when it was made.
	Missing []string `json:"missing"`
}

// LegacyUploadWarning is shown for a plain .db upload.
const LegacyUploadWarning = "This backup has no images; missing images will show as broken"

var zipMagic = []byte("PK\x03\x04")

// StoreUpload stores an uploaded backup: a HOPS backup archive (.zip), or a
// legacy plain database (.db, accepted with a warning). Every check refuses
// the upload with an *InvalidBackupError naming the reason, and on any
// failure nothing is left behind. It is never restored here.
func (bm *BackupManager) StoreUpload(src io.Reader, caps UploadCaps) (UploadResult, error) {
	if err := os.MkdirAll(bm.backupDir, 0o700); err != nil {
		return UploadResult{}, fmt.Errorf("failed to create backup directory: %w", err)
	}
	tmp, err := os.CreateTemp(bm.backupDir, ".upload-*.tmp")
	if err != nil {
		return UploadResult{}, fmt.Errorf("cannot store the upload: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if caps.Total <= 0 {
		tmp.Close() // #nosec G104 -- Close on an error path or after a read-only/bounded read; the primary error is already surfaced and nothing was written
		return UploadResult{}, invalid("uploading backups is turned off (the size limit is 0)")
	}
	n, err := io.Copy(tmp, io.LimitReader(src, caps.Total+1))
	if err == nil {
		err = tmp.Sync()
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return UploadResult{}, fmt.Errorf("cannot store the upload: %w", err)
	}
	if n > caps.Total {
		return UploadResult{}, &InvalidBackupError{Reason: fmt.Sprintf("the upload is larger than the %s limit", formatBytes(caps.Total))}
	}
	head := make([]byte, 16)
	f, err := os.Open(tmpPath) // #nosec G304 -- path is built from a validated name under the data dir or a server-chosen temp/backup path, never raw user input
	if err != nil {
		return UploadResult{}, fmt.Errorf("cannot store the upload: %w", err)
	}
	k, _ := io.ReadFull(f, head)
	f.Close() // #nosec G104 -- Close on an error path or after a read-only/bounded read; the primary error is already surfaced and nothing was written
	head = head[:k]
	switch {
	case bytes.HasPrefix(head, zipMagic):
		return bm.storeArchive(tmpPath, caps)
	case bytes.HasPrefix(head, sqliteMagic):
		name, err := bm.storeUploadedDB(tmpPath)
		if err != nil {
			return UploadResult{}, err
		}
		slog.Warn("stored a legacy backup upload (a plain database, no images)", "component", "backup", "name", name)
		return UploadResult{Name: name, Legacy: true, Missing: []string{}}, nil
	default:
		return UploadResult{}, &InvalidBackupError{Reason: "this file is not a HOPS backup archive (.zip) and not a SQLite database"}
	}
}

// storeUploadedDB validates a database file and places it as a new
// "…_uploaded" backup (never replacing a file).
func (bm *BackupManager) storeUploadedDB(dbFile string) (string, error) {
	if err := ValidateHOPSDatabase(dbFile); err != nil {
		return "", err
	}
	for attempt := 0; ; attempt++ {
		n, p := bm.newBackupPath(UploadedReason)
		err := placeExclusive(dbFile, p)
		if err == nil {
			slog.Info("stored uploaded backup", "component", "backup", "name", n)
			return n, nil
		}
		if !os.IsExist(err) || attempt >= 5 {
			return "", fmt.Errorf("cannot store the upload: %w", err)
		}
	}
}

func invalid(format string, a ...any) error {
	return &InvalidBackupError{Reason: fmt.Sprintf(format, a...)}
}

// archiveEntryKind checks an entry's path and returns what it is: "db",
// "manifest", "dir", or an image key's kind. Anything else is refused.
func archiveEntryKind(f *zip.File) (string, error) {
	name := f.Name
	switch {
	case name == "":
		return "", invalid("the archive has an entry with no name")
	case strings.ContainsAny(name, "\\\x00"):
		return "", invalid("the archive has an unsafe path %q", name)
	case strings.HasPrefix(name, "/") || (len(name) > 1 && name[1] == ':'):
		return "", invalid("the archive has an absolute path %q", name)
	}
	for _, seg := range strings.Split(strings.TrimSuffix(name, "/"), "/") {
		if seg == ".." || seg == "." || seg == "" {
			return "", invalid("the archive has a path that leaves its folder (%q)", name)
		}
	}
	mode := f.Mode()
	if strings.HasSuffix(name, "/") || mode.IsDir() {
		if name == "icons/" || name == "backgrounds/" {
			return "dir", nil
		}
		return "", invalid("the archive has an unexpected folder %q", name)
	}
	if mode&fs.ModeSymlink != 0 {
		return "", invalid("the archive has a link (%q); links are not allowed", name)
	}
	if mode&fs.ModeType != 0 {
		return "", invalid("the archive has %q, which is not a plain file", name)
	}
	switch name {
	case archiveDBName:
		return "db", nil
	case archiveManifestName:
		return "manifest", nil
	}
	kind, file, ok := strings.Cut(name, "/")
	if !ok || !ValidImageKind(kind) || strings.Contains(file, "/") {
		return "", invalid("the archive has an unexpected file %q (only hops.db, manifest.json, icons/ and backgrounds/ files are allowed)", name)
	}
	if !ValidImageName(file) {
		return "", invalid("the archive has an image with an unsafe name (%q)", name)
	}
	if !imageExtensions[kind][strings.ToLower(path.Ext(file))] {
		return "", invalid("the archive has %q, which is not an allowed image type", name)
	}
	return kind, nil
}

// storeArchive validates an uploaded archive and stores it: the database as
// a new "…_uploaded" backup, its images staged under backups/.images/<name>
// (installed only when that backup is restored).
func (bm *BackupManager) storeArchive(zipPath string, caps UploadCaps) (UploadResult, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return UploadResult{}, invalid("this is not a readable .zip archive (%v)", err)
	}
	defer zr.Close()
	if len(zr.File) > MaxArchiveEntries {
		return UploadResult{}, invalid("the archive has %d entries (at most %d are allowed)", len(zr.File), MaxArchiveEntries)
	}

	var manifestFile, dbEntry *zip.File
	images := map[string]*zip.File{}
	seen := map[string]bool{}
	var declared uint64
	for _, f := range zr.File {
		kind, err := archiveEntryKind(f)
		if err != nil {
			return UploadResult{}, err
		}
		if seen[f.Name] {
			return UploadResult{}, invalid("the archive has %q twice", f.Name)
		}
		seen[f.Name] = true
		declared += f.UncompressedSize64
		if declared > uint64(caps.Total) { // #nosec G115 -- value bounded by construction or masked/shifted to one byte (parsing/encoding), no overflow possible
			return UploadResult{}, invalid("the archive's contents are larger than the %s limit", formatBytes(caps.Total))
		}
		switch kind {
		case "dir":
		case "manifest":
			manifestFile = f
		case "db":
			dbEntry = f
		default:
			if caps.PerImage <= 0 {
				return UploadResult{}, invalid("the archive has images, but images are turned off (the per-image size limit is 0)")
			}
			if f.UncompressedSize64 > uint64(caps.PerImage) {
				return UploadResult{}, invalid("%s is larger than the %s allowed for an image", f.Name, formatBytes(caps.PerImage))
			}
			images[f.Name] = f
		}
	}
	if manifestFile == nil {
		return UploadResult{}, invalid("the archive has no manifest.json, so it isn't a HOPS backup archive")
	}
	if dbEntry == nil {
		return UploadResult{}, invalid("the archive has no hops.db")
	}
	man, err := readManifest(manifestFile)
	if err != nil {
		return UploadResult{}, err
	}
	listed := map[string]ArchiveFile{}
	for _, af := range man.Files {
		if _, dup := listed[af.Path]; dup {
			return UploadResult{}, invalid("the manifest lists %q twice", af.Path)
		}
		listed[af.Path] = af
		if af.Path != archiveDBName && images[af.Path] == nil {
			return UploadResult{}, invalid("the manifest lists %q but the archive doesn't have it", af.Path)
		}
	}
	for name := range seen {
		if name == archiveManifestName || strings.HasSuffix(name, "/") {
			continue
		}
		if _, ok := listed[name]; !ok {
			return UploadResult{}, invalid("the archive has %q, which its manifest doesn't list", name)
		}
	}

	stage, err := os.MkdirTemp(bm.backupDir, ".upload-*.tmp")
	if err != nil {
		return UploadResult{}, fmt.Errorf("cannot store the upload: %w", err)
	}
	defer os.RemoveAll(stage)

	dbStage := filepath.Join(stage, archiveDBName)
	if err := extractChecked(dbEntry, dbStage, listed[archiveDBName], caps.Total); err != nil {
		return UploadResult{}, err
	}
	if err := ValidateHOPSDatabase(dbStage); err != nil {
		return UploadResult{}, err
	}
	imgStage := filepath.Join(stage, "images")
	// The record of exact versions: the images as stored (after Process).
	record := ImageRecord{Images: map[string]string{}}
	names := make([]string, 0, len(images))
	for n := range images {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		kind, file := splitImageKey(n)
		if err := os.MkdirAll(filepath.Join(imgStage, kind), 0o700); err != nil {
			return UploadResult{}, fmt.Errorf("cannot store the upload: %w", err)
		}
		dst := filepath.Join(imgStage, kind, file)
		if err := extractChecked(images[n], dst, listed[n], caps.PerImage); err != nil {
			return UploadResult{}, err
		}
		if caps.Process != nil {
			data, err := os.ReadFile(dst) // #nosec G304 -- path is built from a validated name under the data dir or a server-chosen temp/backup path, never raw user input
			if err != nil {
				return UploadResult{}, fmt.Errorf("cannot store the upload: %w", err)
			}
			out, err := caps.Process(kind, file, data)
			if err != nil {
				return UploadResult{}, invalid("%s isn't a usable image (%v)", n, err)
			}
			if err := os.WriteFile(dst, out, 0o600); err != nil {
				return UploadResult{}, fmt.Errorf("cannot store the upload: %w", err)
			}
		}
		sum, err := fileSHA256(dst)
		if err != nil {
			return UploadResult{}, fmt.Errorf("cannot store the upload: %w", err)
		}
		record.Images[n] = sum
	}
	record.Unresolved = append(record.Unresolved, man.Missing...)

	name, err := bm.storeUploadedDB(dbStage)
	if err != nil {
		return UploadResult{}, err
	}
	undo := func(cause error) (UploadResult, error) {
		// Never keep a backup without its images or its record.
		os.Remove(bm.recordPath(name)) // #nosec G104 -- best-effort cleanup on an error path; the primary error is returned (logged), a leftover temp is swept at start
		os.RemoveAll(bm.stagedImagesPath(name)) // #nosec G104 -- best-effort cleanup on an error path; the primary error is returned (logged), a leftover temp is swept at start
		if rerr := os.Remove(filepath.Join(bm.backupDir, name)); rerr != nil {
			slog.Error("could not remove an uploaded backup whose images couldn't be stored", "component", "backup", "name", name, "error", rerr)
			return UploadResult{}, fmt.Errorf("cannot store the upload's images (%v), and the backup %s couldn't be removed again (%v): delete it in the Backups dialog", cause, name, rerr)
		}
		return UploadResult{}, fmt.Errorf("cannot store the upload's images: %w", cause)
	}
	if err := bm.writeRecord(name, record); err != nil {
		return undo(err)
	}
	if len(names) > 0 {
		dst := bm.stagedImagesPath(name)
		err := os.MkdirAll(filepath.Dir(dst), 0o700)
		if err == nil {
			err = os.Rename(imgStage, dst)
		}
		if err != nil {
			return undo(err)
		}
	}
	missing := man.Missing
	if missing == nil {
		missing = []string{}
	}
	slog.Info("stored uploaded backup archive", "component", "backup", "name", name, "images", len(names), "missing", len(missing))
	return UploadResult{Name: name, Images: len(names), Missing: missing}, nil
}

func readManifest(f *zip.File) (ArchiveManifest, error) {
	if f.UncompressedSize64 > maxManifestBytes {
		return ArchiveManifest{}, invalid("the archive's manifest is too large")
	}
	rc, err := f.Open()
	if err != nil {
		return ArchiveManifest{}, invalid("the archive's manifest can't be read (%v)", err)
	}
	defer rc.Close()
	raw, err := io.ReadAll(io.LimitReader(rc, maxManifestBytes+1))
	if err != nil {
		return ArchiveManifest{}, invalid("the archive's manifest can't be read (%v)", err)
	}
	if len(raw) > maxManifestBytes {
		return ArchiveManifest{}, invalid("the archive's manifest is too large")
	}
	var man ArchiveManifest
	if err := json.Unmarshal(raw, &man); err != nil {
		return ArchiveManifest{}, invalid("the archive's manifest is damaged (%v)", err)
	}
	if man.Format != ArchiveFormat {
		return ArchiveManifest{}, invalid("the archive's manifest isn't a HOPS backup manifest")
	}
	if man.FormatVersion > ArchiveFormatVersion {
		return ArchiveManifest{}, invalid("the archive was made by a newer HOPS (format %d); update HOPS to use it", man.FormatVersion)
	}
	if man.FormatVersion < 1 {
		return ArchiveManifest{}, invalid("the archive's manifest has no valid format version")
	}
	for _, af := range man.Files {
		if len(af.SHA256) != 64 {
			return ArchiveManifest{}, invalid("the manifest has no valid SHA-256 for %q", af.Path)
		}
	}
	// The missing list is only reported back: keep well-formed image keys,
	// and at most maxReportedMissing of them.
	var missing []string
	for _, k := range man.Missing {
		kind, name := splitImageKey(k)
		if ValidImageKind(kind) && ValidImageName(name) && len(missing) < maxReportedMissing {
			missing = append(missing, k)
		}
	}
	man.Missing = missing
	return man, nil
}

// extractChecked writes an entry to a NEW file, reading at most limit bytes
// (whatever the entry declares), and checks its size and SHA-256 against the
// manifest.
func extractChecked(f *zip.File, dst string, want ArchiveFile, limit int64) error {
	rc, err := f.Open()
	if err != nil {
		return invalid("%s can't be read from the archive (%v)", f.Name, err)
	}
	defer rc.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600) // #nosec G304 -- path is built from a validated name under the data dir or a server-chosen temp/backup path, never raw user input
	if err != nil {
		return fmt.Errorf("cannot store the upload: %w", err)
	}
	var h hash.Hash = sha256.New()
	r := io.LimitReader(rc, limit+1)
	n, err := io.Copy(io.MultiWriter(out, h), r)
	cerr := out.Close()
	if err != nil {
		if errors.Is(err, zip.ErrChecksum) || errors.Is(err, zip.ErrFormat) {
			return invalid("%s is damaged in the archive (%v)", f.Name, err)
		}
		return invalid("%s can't be read from the archive (%v)", f.Name, err)
	}
	if cerr != nil {
		return fmt.Errorf("cannot store the upload: %w", cerr)
	}
	if n > limit {
		return invalid("%s is larger than the %s allowed", f.Name, formatBytes(limit))
	}
	if n != want.Size {
		return invalid("%s is %d bytes but the manifest says %d (the archive was changed or damaged)", f.Name, n, want.Size)
	}
	if got := hex.EncodeToString(h.Sum(nil)); !strings.EqualFold(got, want.SHA256) {
		return invalid("%s doesn't match its SHA-256 in the manifest (the archive was changed or damaged)", f.Name)
	}
	return nil
}
