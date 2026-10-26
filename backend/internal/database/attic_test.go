package database

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

// M6 §12 (Option B): deleted uploaded images move to the attic; the attic is
// swept only of what no backup, staged restore or the live DB refers to; a
// restore brings attic images back; downloads are archives with the images;
// uploads are validated strictly. Synthetic data only.

func writeFile(t *testing.T, p, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func exists(p string) bool { _, err := os.Lstat(p); return err == nil }

func readString(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// setConfig stores a layout that references the given image URLs.
func setConfig(t *testing.T, db *sql.DB, urls ...string) {
	t.Helper()
	tiles := []string{}
	for _, u := range urls {
		tiles = append(tiles, `{"name":"t","iconUrl":"`+u+`"}`)
	}
	data := `{"schemaVersion":3,"dashboards":[{"id":"d","tiles":[` + strings.Join(tiles, ",") + `]}]}`
	if _, err := db.Exec(`INSERT OR REPLACE INTO config (id, data) VALUES (1, ?)`, data); err != nil {
		t.Fatal(err)
	}
}

func hasProblem(bm *BackupManager, kind, contains string) bool {
	for _, p := range bm.Problems() {
		if p.Kind == kind && strings.Contains(p.Reason, contains) {
			return true
		}
	}
	return false
}

func TestImageRefsInText(t *testing.T) {
	refs := map[string]bool{}
	ImageRefsInText(`{"a":"/icons/ab12.png","b":"/backgrounds/x_y-1.jpg","c":"/api/icons/dashboard/proxmox.svg",`+
		`"d":"http://host/icons/ext.png","e":"/icons/sub/dir.png","f":"/icons/.hidden","g":"url(/backgrounds/k.webp)"}`, refs)
	got := sortedKeys(refs)
	want := []string{"backgrounds/k.webp", "backgrounds/x_y-1.jpg", "icons/ab12.png"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("refs %v, want %v", got, want)
	}
}

func TestDeleteMovesTheFileToTheAttic(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	dir := filepath.Dir(dbPath)
	writeFile(t, filepath.Join(dir, "icons", "a.png"), "AAA")
	if err := bm.MoveToAttic("icons", "a.png"); err != nil {
		t.Fatal(err)
	}
	if exists(filepath.Join(dir, "icons", "a.png")) {
		t.Fatal("the live file is still there")
	}
	if got := readString(t, filepath.Join(dir, "attic", "icons", "a.png")); got != "AAA" {
		t.Fatalf("attic copy %q", got)
	}
	// A different file with the same name later: both are kept.
	writeFile(t, filepath.Join(dir, "icons", "a.png"), "BBB")
	if err := bm.MoveToAttic("icons", "a.png"); err != nil {
		t.Fatal(err)
	}
	if got := readString(t, filepath.Join(dir, "attic", "icons", "a.png")); got != "BBB" {
		t.Fatalf("newest attic copy %q", got)
	}
	m, _ := filepath.Glob(filepath.Join(dir, "attic", "icons", "a.png~*"))
	if len(m) != 1 || readString(t, m[0]) != "AAA" {
		t.Fatalf("older copy not kept: %v", m)
	}
	// Unsafe names never touch anything.
	for _, n := range []string{"../hops.db", ".hidden", "a/b.png", ""} {
		if err := bm.MoveToAttic("icons", n); err == nil {
			t.Errorf("MoveToAttic(%q) accepted", n)
		}
	}
	if err := bm.MoveToAttic("other", "a.png"); err == nil {
		t.Error("unknown kind accepted")
	}
	if err := bm.MoveToAttic("icons", "none.png"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("missing file: %v", err)
	}
}

func TestSweepKeepsReferencedAndRemovesUnreferenced(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	dir := filepath.Dir(dbPath)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)

	// A protected (manual) backup refers to kept.png and bg.jpg.
	setConfig(t, db, "/icons/kept.png", "/backgrounds/bg.jpg")
	if _, err := bm.CreateBackupWithDB(db, "manual"); err != nil {
		t.Fatal(err)
	}
	// The live DB now refers to live.png only.
	setConfig(t, db, "/icons/live.png")
	for _, f := range []string{"icons/kept.png", "icons/gone.png", "icons/live.png", "backgrounds/bg.jpg", "backgrounds/old.jpg"} {
		writeFile(t, filepath.Join(dir, "attic", f), f)
	}
	removed, err := bm.SweepAttic()
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(removed)
	if strings.Join(removed, ",") != "backgrounds/old.jpg,icons/gone.png" {
		t.Fatalf("removed %v", removed)
	}
	for _, f := range []string{"icons/kept.png", "icons/live.png", "backgrounds/bg.jpg"} {
		if !exists(filepath.Join(dir, "attic", f)) {
			t.Errorf("%s was removed although referenced", f)
		}
	}
	// Once the backup is deleted and the live DB moves on, the rest go.
	list, _ := bm.ListBackups()
	for _, b := range list {
		if err := bm.DeleteBackup(b.Name); err != nil {
			t.Fatal(err)
		}
	}
	setConfig(t, db)
	if _, err := bm.SweepAttic(); err != nil {
		t.Fatal(err)
	}
	if u, _ := bm.AtticUsage(); u.Files != 0 {
		t.Fatalf("attic still holds %d files", u.Files)
	}
}

func TestSweepRunsAfterEveryBackupCleanup(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	dir := filepath.Dir(dbPath)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)
	writeFile(t, filepath.Join(dir, "attic", "icons", "orphan.png"), "x")
	if _, err := bm.CreateBackupWithDB(db, "startup"); err != nil {
		t.Fatal(err)
	}
	if exists(filepath.Join(dir, "attic", "icons", "orphan.png")) {
		t.Fatal("the cleanup after a backup didn't sweep the attic")
	}
}

func TestUnreadableBackupBlocksTheSweepWithANotice(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	dir := filepath.Dir(dbPath)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)
	writeFile(t, filepath.Join(dir, "attic", "icons", "orphan.png"), "x")
	bad := BackupPrefix + "2026-01-01_00-00-00_manual" + BackupSuffix
	writeFile(t, filepath.Join(bm.backupDir, bad), "this is not a database at all, just junk text")

	if _, err := bm.SweepAttic(); err == nil {
		t.Fatal("the sweep went ahead with an unreadable backup")
	}
	if !exists(filepath.Join(dir, "attic", "icons", "orphan.png")) {
		t.Fatal("an attic file was deleted although a backup couldn't be read")
	}
	if !hasProblem(bm, ProblemAtticBlocked, bad) {
		t.Fatalf("no visible notice naming the backup: %+v", bm.Problems())
	}
	// Fixed: the next sweep works and the notice goes.
	os.Remove(filepath.Join(bm.backupDir, bad))
	if _, err := bm.SweepAttic(); err != nil {
		t.Fatal(err)
	}
	if exists(filepath.Join(dir, "attic", "icons", "orphan.png")) {
		t.Fatal("not swept once readable")
	}
	if hasProblem(bm, ProblemAtticBlocked, "") {
		t.Fatal("the notice stayed after a sweep that worked")
	}
}

func TestSweepDeleteFailureIsANotice(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	dir := filepath.Dir(dbPath)
	bm.SetLiveDB(openDB(t, dbPath))
	writeFile(t, filepath.Join(dir, "attic", "icons", "orphan.png"), "x")
	bm.SetFailureHooks(FailureHooks{Remove: func(string) error { return errors.New("disk says no") }})
	if _, err := bm.SweepAttic(); err == nil {
		t.Fatal("no error")
	}
	if !hasProblem(bm, ProblemAtticDeleteFailed, "disk says no") {
		t.Fatalf("no notice: %+v", bm.Problems())
	}
}

func TestLargeAtticIsANotice(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	dir := filepath.Dir(dbPath)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)
	setConfig(t, db, "/backgrounds/huge.jpg")
	p := filepath.Join(dir, "attic", "backgrounds", "huge.jpg")
	writeFile(t, p, "")
	if err := os.Truncate(p, AtticLargeBytes+1); err != nil {
		t.Fatal(err)
	}
	if _, err := bm.SweepAttic(); err != nil {
		t.Fatal(err)
	}
	if !hasProblem(bm, ProblemAtticLarge, "MB") {
		t.Fatalf("no large-attic notice: %+v", bm.Problems())
	}
	u, _ := bm.AtticUsage()
	if u.Files != 1 || u.Bytes != AtticLargeBytes+1 {
		t.Fatalf("usage %+v", u)
	}
}

func TestRestoreBringsAtticImagesBackAndReportsMissing(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	dir := filepath.Dir(dbPath)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)
	setConfig(t, db, "/icons/a.png", "/backgrounds/b.jpg", "/icons/lost.png")
	writeFile(t, filepath.Join(dir, "icons", "a.png"), "A")
	writeFile(t, filepath.Join(dir, "backgrounds", "b.jpg"), "B")
	p, err := bm.CreateBackupWithDB(db, "manual")
	if err != nil {
		t.Fatal(err)
	}
	// The images are deleted (to the attic) and the layout moves on.
	setConfig(t, db)
	if err := bm.MoveToAttic("icons", "a.png"); err != nil {
		t.Fatal(err)
	}
	if err := bm.MoveToAttic("backgrounds", "b.jpg"); err != nil {
		t.Fatal(err)
	}
	if err := bm.RestoreBackup(db, filepath.Base(p)); err != nil {
		t.Fatal(err)
	}
	// A sweep between staging and the restart keeps what the stage needs.
	if _, err := bm.SweepAttic(); err != nil {
		t.Fatal(err)
	}
	db.Close()
	applied, err := ApplyPendingRestore(dbPath)
	if err != nil || !applied {
		t.Fatalf("apply: %v %v", applied, err)
	}
	res := bm.AfterRestore(true)
	if got := readString(t, filepath.Join(dir, "icons", "a.png")); got != "A" {
		t.Fatalf("a.png %q", got)
	}
	if got := readString(t, filepath.Join(dir, "backgrounds", "b.jpg")); got != "B" {
		t.Fatalf("b.jpg %q", got)
	}
	if len(res.FromAttic) != 2 || strings.Join(res.Missing, ",") != "icons/lost.png" {
		t.Fatalf("result %+v", res)
	}
	if !hasProblem(bm, ProblemRestoreImages, "icons/lost.png") {
		t.Fatalf("missing image not a visible notice: %+v", bm.Problems())
	}
	// The notice survives a restart and is dismissible.
	bm2 := NewBackupManager(dbPath)
	if !hasProblem(bm2, ProblemRestoreImages, "icons/lost.png") {
		t.Fatal("notice not kept across a restart")
	}
	if !bm2.DismissProblem(ProblemRestoreImages) || hasProblem(bm2, ProblemRestoreImages, "") {
		t.Fatal("not dismissible")
	}
	if exists(restoreImagesMarkerPath(dbPath)) {
		t.Fatal("marker left behind")
	}
}

func TestDiscardedRestoreClearsItsMarker(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	db := openDB(t, dbPath)
	p, err := bm.CreateBackupWithDB(db, "manual")
	if err != nil {
		t.Fatal(err)
	}
	if err := bm.RestoreBackup(db, filepath.Base(p)); err != nil {
		t.Fatal(err)
	}
	if !exists(restoreImagesMarkerPath(dbPath)) {
		t.Fatal("no marker")
	}
	if err := bm.DiscardPendingRestore(); err != nil {
		t.Fatal(err)
	}
	if exists(restoreImagesMarkerPath(dbPath)) {
		t.Fatal("marker left after discard")
	}
}

// --- Archives ---

func readZip(t *testing.T, f *os.File) map[string][]byte {
	t.Helper()
	fi, _ := f.Stat()
	zr, err := zip.NewReader(f, fi.Size())
	if err != nil {
		t.Fatal(err)
	}
	out := map[string][]byte{}
	for _, e := range zr.File {
		rc, _ := e.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		out[e.Name] = b
	}
	return out
}

func sum(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

func TestDownloadArchiveContentsAndManifest(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	dir := filepath.Dir(dbPath)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)
	setConfig(t, db, "/icons/a.png", "/backgrounds/b.jpg", "/icons/lost.png")
	writeFile(t, filepath.Join(dir, "icons", "a.png"), "A-live")
	writeFile(t, filepath.Join(dir, "attic", "backgrounds", "b.jpg"), "B-attic")
	writeFile(t, filepath.Join(dir, "icons", "unrelated.png"), "U")
	p, err := bm.CreateBackupWithDB(db, "manual")
	if err != nil {
		t.Fatal(err)
	}
	name := filepath.Base(p)
	if got := ArchiveName(name); !strings.HasSuffix(got, "_manual.zip") || !strings.HasPrefix(got, "hops-backup-") {
		t.Fatalf("archive name %q", got)
	}
	plan, err := bm.PlanBackupImages(name)
	if err != nil || strings.Join(plan.Missing, ",") != "icons/lost.png" || len(plan.Included) != 2 {
		t.Fatalf("plan %+v %v", plan, err)
	}
	f, man, done, err := bm.BuildBackupArchive(name)
	if err != nil {
		t.Fatal(err)
	}
	defer done()
	files := readZip(t, f)
	keys := sortedKeys(func() map[string]bool {
		m := map[string]bool{}
		for k := range files {
			m[k] = true
		}
		return m
	}())
	if strings.Join(keys, ",") != "backgrounds/b.jpg,hops.db,icons/a.png,manifest.json" {
		t.Fatalf("archive holds %v", keys)
	}
	if string(files["icons/a.png"]) != "A-live" || string(files["backgrounds/b.jpg"]) != "B-attic" {
		t.Fatal("wrong image contents")
	}
	if !bytes.HasPrefix(files["hops.db"], sqliteMagic) {
		t.Fatal("hops.db is not the database")
	}
	var m ArchiveManifest
	if err := json.Unmarshal(files["manifest.json"], &m); err != nil {
		t.Fatal(err)
	}
	if m.Format != ArchiveFormat || m.FormatVersion != 1 || m.HOPSVersion == "" || m.CreatedAt.IsZero() || m.Backup != name {
		t.Fatalf("manifest header %+v", m)
	}
	if strings.Join(m.Missing, ",") != "icons/lost.png" || strings.Join(man.Missing, ",") != "icons/lost.png" {
		t.Fatalf("missing %v", m.Missing)
	}
	if len(m.Files) != 3 {
		t.Fatalf("files %+v", m.Files)
	}
	for _, af := range m.Files {
		if af.SHA256 != sum(files[af.Path]) || af.Size != int64(len(files[af.Path])) {
			t.Errorf("manifest entry %s doesn't match", af.Path)
		}
	}
	// The temp file goes once served.
	done()
	if m, _ := filepath.Glob(filepath.Join(bm.backupDir, ".download-*")); len(m) != 0 {
		t.Fatalf("temp left: %v", m)
	}
}

// archiveSpec builds a zip; entries are written in order. mutate changes the
// manifest before it is written (nil = honest manifest).
type zipEntry struct {
	name    string
	data    []byte
	symlink bool
}

func buildZip(t *testing.T, entries []zipEntry, mutate func(*ArchiveManifest)) []byte {
	t.Helper()
	man := ArchiveManifest{Format: ArchiveFormat, FormatVersion: 1, HOPSVersion: "3.0.0", CreatedAt: time.Now(), Files: []ArchiveFile{}}
	for _, e := range entries {
		if strings.HasSuffix(e.name, "/") {
			continue
		}
		man.Files = append(man.Files, ArchiveFile{Path: e.name, Size: int64(len(e.data)), SHA256: sum(e.data)})
	}
	if mutate != nil {
		mutate(&man)
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range entries {
		h := &zip.FileHeader{Name: e.name, Method: zip.Deflate}
		if e.symlink {
			h.SetMode(fs.ModeSymlink | 0o777)
		}
		w, err := zw.CreateHeader(h)
		if err != nil {
			t.Fatal(err)
		}
		w.Write(e.data)
	}
	if mutate == nil || man.Format != "" {
		raw, _ := json.Marshal(man)
		w, _ := zw.Create("manifest.json")
		w.Write(raw)
	}
	zw.Close()
	return buf.Bytes()
}

func hopsDBBytes(t *testing.T, urls ...string) []byte {
	t.Helper()
	p := filepath.Join(t.TempDir(), "src.db")
	db, err := Initialize(p)
	if err != nil {
		t.Fatal(err)
	}
	setConfig(t, db, urls...)
	out := filepath.Join(t.TempDir(), "out.db")
	if _, err := db.Exec(`VACUUM INTO '` + out + `'`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	b, _ := os.ReadFile(out)
	return b
}

func dirSnapshot(t *testing.T, dir string) string {
	t.Helper()
	var names []string
	filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err == nil && p != dir {
			rel, _ := filepath.Rel(dir, p)
			names = append(names, rel)
		}
		return nil
	})
	sort.Strings(names)
	return strings.Join(names, "\n")
}

func TestUploadedArchiveValidation(t *testing.T) {
	bm, _ := setupBackupTest(t)
	os.MkdirAll(bm.backupDir, 0o755)
	good := hopsDBBytes(t, "/icons/a.png")
	png := []byte("\x89PNG fake image bytes")
	caps := UploadCaps{Total: 8 << 20, PerImage: 64 << 10}

	otherDB := func() []byte {
		p := filepath.Join(t.TempDir(), "notes.db")
		db, _ := sql.Open("sqlite", p)
		db.Exec(`CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)`)
		db.Close()
		b, _ := os.ReadFile(p)
		return b
	}()

	cases := []struct {
		name string
		zip  []byte
		want string
	}{
		{"traversal", buildZip(t, []zipEntry{{name: "hops.db", data: good}, {name: "../evil.png", data: png}}, nil), "leaves its folder"},
		{"nested traversal", buildZip(t, []zipEntry{{name: "hops.db", data: good}, {name: "icons/../../evil.png", data: png}}, nil), "leaves its folder"},
		{"absolute", buildZip(t, []zipEntry{{name: "hops.db", data: good}, {name: "/etc/evil.png", data: png}}, nil), "absolute path"},
		{"windows absolute", buildZip(t, []zipEntry{{name: "hops.db", data: good}, {name: "C:/evil.png", data: png}}, nil), "absolute path"},
		{"backslash", buildZip(t, []zipEntry{{name: "hops.db", data: good}, {name: "icons\\..\\evil.png", data: png}}, nil), "unsafe path"},
		{"symlink", buildZip(t, []zipEntry{{name: "hops.db", data: good}, {name: "icons/a.png", data: []byte("/etc/passwd"), symlink: true}}, nil), "link"},
		{"other folder", buildZip(t, []zipEntry{{name: "hops.db", data: good}, {name: "scripts/run.sh", data: png}}, nil), "unexpected file"},
		{"nested image", buildZip(t, []zipEntry{{name: "hops.db", data: good}, {name: "icons/sub/a.png", data: png}}, nil), "unexpected file"},
		{"not an image type", buildZip(t, []zipEntry{{name: "hops.db", data: good}, {name: "icons/a.html", data: png}}, nil), "not an allowed image type"},
		{"oversize image", buildZip(t, []zipEntry{{name: "hops.db", data: good}, {name: "icons/big.png", data: make([]byte, 65<<10)}}, nil), "larger than"},
		{"oversize total", buildZip(t, []zipEntry{{name: "hops.db", data: good}, {name: "backgrounds/a.jpg", data: make([]byte, 60<<10)}}, nil), "larger than"},
		{"hash mismatch", buildZip(t, []zipEntry{{name: "hops.db", data: good}, {name: "icons/a.png", data: png}}, func(m *ArchiveManifest) {
			for i := range m.Files {
				if m.Files[i].Path == "icons/a.png" {
					m.Files[i].SHA256 = sum([]byte("something else"))
				}
			}
		}), "SHA-256"},
		{"size mismatch", buildZip(t, []zipEntry{{name: "hops.db", data: good}, {name: "icons/a.png", data: png}}, func(m *ArchiveManifest) {
			for i := range m.Files {
				if m.Files[i].Path == "icons/a.png" {
					m.Files[i].Size++
				}
			}
		}), "manifest says"},
		{"unlisted file", buildZip(t, []zipEntry{{name: "hops.db", data: good}, {name: "icons/a.png", data: png}}, func(m *ArchiveManifest) {
			m.Files = m.Files[:1]
		}), "doesn't list"},
		{"listed but absent", buildZip(t, []zipEntry{{name: "hops.db", data: good}}, func(m *ArchiveManifest) {
			m.Files = append(m.Files, ArchiveFile{Path: "icons/x.png", Size: 1, SHA256: sum([]byte("x"))})
		}), "doesn't have it"},
		{"no manifest", buildZip(t, []zipEntry{{name: "hops.db", data: good}}, func(m *ArchiveManifest) { m.Format = "" }), "no manifest.json"},
		{"foreign manifest", buildZip(t, []zipEntry{{name: "hops.db", data: good}}, func(m *ArchiveManifest) { m.Format = "something-else" }), "isn't a HOPS backup manifest"},
		{"newer format", buildZip(t, []zipEntry{{name: "hops.db", data: good}}, func(m *ArchiveManifest) { m.FormatVersion = 9 }), "newer HOPS"},
		{"no db", buildZip(t, []zipEntry{{name: "icons/a.png", data: png}}, nil), "no hops.db"},
		{"non-HOPS db", buildZip(t, []zipEntry{{name: "hops.db", data: otherDB}}, nil), "not a HOPS database"},
		{"not a zip or db", []byte("plain text, nothing else"), "not a SQLite database"},
	}
	before := dirSnapshot(t, bm.backupDir)
	smallCaps := caps
	for _, tc := range cases {
		c := caps
		if tc.name == "oversize total" {
			c = UploadCaps{Total: int64(len(good)) + 30<<10, PerImage: 64 << 10}
		}
		_ = smallCaps
		_, err := bm.StoreUpload(bytes.NewReader(tc.zip), c)
		var ibe *InvalidBackupError
		if !errors.As(err, &ibe) || !strings.Contains(ibe.Reason, tc.want) {
			t.Errorf("%s: got %v, want an invalid-backup reason containing %q", tc.name, err, tc.want)
		}
		if after := dirSnapshot(t, bm.backupDir); after != before {
			t.Errorf("%s: left files behind:\n%s", tc.name, after)
		}
	}
	// The whole upload over the total cap.
	if _, err := bm.StoreUpload(bytes.NewReader(good), UploadCaps{Total: 100}); err == nil || !strings.Contains(err.Error(), "larger than") {
		t.Errorf("oversize upload: %v", err)
	}
}

func TestLegacyDBUploadIsAcceptedWithAWarning(t *testing.T) {
	bm, _ := setupBackupTest(t)
	res, err := bm.StoreUpload(bytes.NewReader(hopsDBBytes(t)), UploadCaps{Total: 8 << 20, PerImage: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	if !res.Legacy || !strings.HasSuffix(res.Name, "_uploaded.db") {
		t.Fatalf("result %+v", res)
	}
	if !strings.Contains(LegacyUploadWarning, "no images") {
		t.Fatal("warning text")
	}
}

func TestUploadedArchiveImagesInstallOnRestoreWithoutOverwriting(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	dir := filepath.Dir(dbPath)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)
	dbBytes := hopsDBBytes(t, "/icons/a.png", "/icons/c.png", "/backgrounds/same.jpg")
	z := buildZip(t, []zipEntry{
		{name: "hops.db", data: dbBytes},
		{name: "icons/", data: nil},
		{name: "icons/a.png", data: []byte("A-from-archive")},
		{name: "icons/c.png", data: []byte("C-from-archive")},
		{name: "backgrounds/same.jpg", data: []byte("SAME")},
	}, nil)
	res, err := bm.StoreUpload(bytes.NewReader(z), UploadCaps{Total: 8 << 20, PerImage: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	if res.Legacy || res.Images != 3 {
		t.Fatalf("result %+v", res)
	}
	// Staged with the backup, not installed yet.
	if exists(filepath.Join(dir, "icons", "a.png")) {
		t.Fatal("images installed before a restore")
	}
	if !exists(filepath.Join(bm.backupDir, ".images", res.Name, "icons", "a.png")) {
		t.Fatal("images not staged with the backup")
	}
	// A different c.png and an identical same.jpg are already live.
	writeFile(t, filepath.Join(dir, "icons", "c.png"), "C-mine")
	writeFile(t, filepath.Join(dir, "backgrounds", "same.jpg"), "SAME")

	// Its download includes its own staged images.
	f, man, done, err := bm.BuildBackupArchive(res.Name)
	if err != nil {
		t.Fatal(err)
	}
	if files := readZip(t, f); string(files["icons/a.png"]) != "A-from-archive" || string(files["icons/c.png"]) != "C-from-archive" {
		t.Fatalf("download of an uploaded backup: %v", man.Files)
	}
	done()

	if err := bm.RestoreBackup(db, res.Name); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if applied, err := ApplyPendingRestore(dbPath); err != nil || !applied {
		t.Fatal(err)
	}
	r := bm.AfterRestore(true)
	if got := readString(t, filepath.Join(dir, "icons", "a.png")); got != "A-from-archive" {
		t.Fatalf("a.png %q", got)
	}
	if got := readString(t, filepath.Join(dir, "icons", "c.png")); got != "C-mine" {
		t.Fatalf("a different file with the same name was overwritten: %q", got)
	}
	if strings.Join(r.Clashes, ",") != "icons/c.png" || strings.Join(r.Installed, ",") != "icons/a.png" {
		t.Fatalf("result %+v", r)
	}
	if !hasProblem(bm, ProblemRestoreImages, "icons/c.png") || !hasProblem(bm, ProblemRestoreImages, "different file") {
		t.Fatalf("clash not a visible notice: %+v", bm.Problems())
	}

	// Deleting the uploaded backup removes its staged images.
	if err := bm.DeleteBackup(res.Name); err != nil {
		t.Fatal(err)
	}
	if exists(filepath.Join(bm.backupDir, ".images", res.Name)) {
		t.Fatal("staged images left after the backup was deleted")
	}
}

func TestStaleUploadAndDownloadTempsSwept(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	os.MkdirAll(filepath.Join(bm.backupDir, ".upload-1.tmp", "images"), 0o755)
	writeFile(t, filepath.Join(bm.backupDir, ".download-2.tmp"), "x")
	if err := SweepStaleTempFiles(dbPath); err != nil {
		t.Fatal(err)
	}
	if m, _ := filepath.Glob(filepath.Join(bm.backupDir, ".*.tmp")); len(m) != 0 {
		t.Fatalf("left: %v", m)
	}
}
