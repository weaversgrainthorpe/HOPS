package database

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Uploaded images and backups.
//
// Uploaded images live in <data>/icons and <data>/backgrounds. Local backups
// are database-only, but no image a backup refers to is destroyed while that
// backup exists: deleting an uploaded image MOVES it to the attic, keyed by
// content (<data>/attic/<kind>/<sha256>, see attic_versions.go), and an attic
// version is removed for good only when no backup (protected ones included),
// no staged restore and not the live database can still use it. When in
// doubt (something can't be read) nothing is deleted, and that is a visible
// notice.

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
	// ProblemAtticIndexRebuilt: the attic index was missing or damaged and was
	// rebuilt from the backups' records. Dismissible; kept across restarts.
	ProblemAtticIndexRebuilt = "attic-index-rebuilt"
)

// ImageKinds are the two kinds of uploaded image, as folder names.
var ImageKinds = []string{"icons", "backgrounds"}

// imageNamePattern is a plain uploaded-image file name: no separators, not
// hidden. The same shape the upload handlers produce.
var imageNamePattern = regexp.MustCompile(`^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$`)

// imageRefPattern finds "/icons/<name>" and "/backgrounds/<name>" in text.
var imageRefPattern = regexp.MustCompile(`/(icons|backgrounds)/([A-Za-z0-9_-][A-Za-z0-9._-]{0,127})`)

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
			rows.Close() // #nosec G104 -- Close on an error path or after a read-only/bounded read; the primary error is already surfaced and nothing was written
			return nil, err
		}
		if scope == RefsAll || liveRefTables[n] {
			tables = append(tables, n)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close() // #nosec G104 -- Close on an error path or after a read-only/bounded read; the primary error is already surfaced and nothing was written
		return nil, err
	}
	rows.Close() // #nosec G104 -- Close on an error path or after a read-only/bounded read; the primary error is already surfaced and nothing was written
	refs := map[string]bool{}
	for _, t := range tables {
		if err := scanTableRefs(db, t, refs); err != nil {
			return nil, fmt.Errorf("reading table %s: %w", t, err)
		}
	}
	return refs, nil
}

func scanTableRefs(db *sql.DB, table string, refs map[string]bool) error {
	rows, err := db.Query(`SELECT * FROM "` + strings.ReplaceAll(table, `"`, `""`) + `"`) // #nosec G202 -- only ? placeholder lists or a fixed/quote-escaped table name, never user input
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
// sqliteURI is a SQLite "file:" URI for an absolute path (slashes as
// filepath.ToSlash gives them). A Windows path needs the leading slash
// (file:///C:/…): without it "C:" was read as a host, SQLite couldn't open
// the file, and every backup failed on Windows.
func sqliteURI(slashPath, query string) string {
	if !strings.HasPrefix(slashPath, "/") {
		slashPath = "/" + slashPath
	}
	u := url.URL{Scheme: "file", Path: slashPath, RawQuery: query}
	return u.String()
}

// sqliteFileURI is sqliteURI for any path.
func sqliteFileURI(path, query string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	return sqliteURI(filepath.ToSlash(abs), query), nil
}

// SQLiteFileURI is sqliteFileURI for callers outside this package.
func SQLiteFileURI(path, query string) (string, error) { return sqliteFileURI(path, query) }

func openReadOnly(path string) (*sql.DB, error) {
	uri, err := sqliteFileURI(path, "mode=ro&immutable=1")
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", uri)
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

// atticHashPath is <data>/attic/<kind>/<sha256>: the attic is keyed by
// content, so every version of a name is kept separately.
func (bm *BackupManager) atticHashPath(kind, sum string) string {
	return filepath.Join(bm.AtticDir(), kind, sum)
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
	uri, err := sqliteFileURI(bm.dbPath, "mode=ro")
	if err != nil {
		return nil, err
	}
	fdb, err := sql.Open("sqlite", uri)
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
