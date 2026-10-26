package database

import (
	"archive/zip"
	"bytes"
	"compress/flate"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"hash/crc32"
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

// toAttic puts content live as <kind>/<name>, then deletes it into the attic.
func toAttic(t *testing.T, bm *BackupManager, kind, name, content string) string {
	t.Helper()
	writeFile(t, bm.liveImagePath(kind, name), content)
	h, err := bm.MoveToAttic(kind, name)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func atticCount(t *testing.T, bm *BackupManager) int {
	t.Helper()
	u, err := bm.AtticUsage()
	if err != nil {
		t.Fatal(err)
	}
	return u.Files
}

func TestDeleteMovesTheFileToTheAttic(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	dir := filepath.Dir(dbPath)
	writeFile(t, filepath.Join(dir, "icons", "a.png"), "AAA")
	h1, err := bm.MoveToAttic("icons", "a.png")
	if err != nil {
		t.Fatal(err)
	}
	if exists(filepath.Join(dir, "icons", "a.png")) {
		t.Fatal("the live file is still there")
	}
	// Keyed by content.
	if h1 != sum([]byte("AAA")) || readString(t, filepath.Join(dir, "attic", "icons", h1)) != "AAA" {
		t.Fatalf("attic copy not at its hash: %s", h1)
	}
	// A different file with the same name later: both versions are kept, each
	// at its own hash, and the index lists both for the name.
	h2 := toAttic(t, bm, "icons", "a.png", "BBB")
	if h2 == h1 || readString(t, filepath.Join(dir, "attic", "icons", h2)) != "BBB" || readString(t, filepath.Join(dir, "attic", "icons", h1)) != "AAA" {
		t.Fatal("an older version was replaced")
	}
	bm.atticMu.Lock()
	idx, err := bm.loadIndexLocked()
	bm.atticMu.Unlock()
	if err != nil || strings.Join(idx.Names["icons/a.png"], ",") != h1+","+h2 {
		t.Fatalf("index %v %v", idx.Names, err)
	}
	// The same version again: kept once.
	toAttic(t, bm, "icons", "a.png", "AAA")
	if atticCount(t, bm) != 2 {
		t.Fatal("an identical version was stored twice")
	}
	// Unsafe names never touch anything.
	for _, n := range []string{"../hops.db", ".hidden", "a/b.png", ""} {
		if _, err := bm.MoveToAttic("icons", n); err == nil {
			t.Errorf("MoveToAttic(%q) accepted", n)
		}
	}
	if _, err := bm.MoveToAttic("other", "a.png"); err == nil {
		t.Error("unknown kind accepted")
	}
	if _, err := bm.MoveToAttic("icons", "none.png"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("missing file: %v", err)
	}
	// A damaged index is rebuilt (visibly) before anything is moved.
	writeFile(t, filepath.Join(dir, "attic", "index.json"), "{not json")
	writeFile(t, filepath.Join(dir, "icons", "c.png"), "C")
	if _, err := bm.MoveToAttic("icons", "c.png"); err != nil || !hasProblem(bm, ProblemAtticIndexRebuilt, "damaged") {
		t.Fatalf("damaged index: %v %+v", err, bm.Problems())
	}
	// A damaged index that can't be rebuilt (a backup's record is damaged too):
	// nothing is moved, the delete is refused.
	os.MkdirAll(bm.backupDir, 0o755)
	writeFile(t, filepath.Join(bm.backupDir, BackupPrefix+"2026-01-01_00-00-00_manual"+BackupSuffix), "x")
	writeFile(t, bm.recordPath(BackupPrefix+"2026-01-01_00-00-00_manual"+BackupSuffix), "{damaged")
	writeFile(t, filepath.Join(dir, "attic", "index.json"), "{not json")
	writeFile(t, filepath.Join(dir, "icons", "d.png"), "D")
	if _, err := bm.MoveToAttic("icons", "d.png"); err == nil || !exists(filepath.Join(dir, "icons", "d.png")) {
		t.Fatalf("moved although the index couldn't be rebuilt: %v", err)
	}
}

func TestEveryBackupRecordsItsImageVersions(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	dir := filepath.Dir(dbPath)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)
	writeFile(t, filepath.Join(dir, "icons", "a.png"), "A")
	setConfig(t, db, "/icons/a.png", "/icons/lost.png")
	p, err := bm.CreateBackupWithDB(db, "manual")
	if err != nil {
		t.Fatal(err)
	}
	rec, err := bm.readRecord(filepath.Base(p))
	if err != nil || rec == nil {
		t.Fatalf("no record: %v", err)
	}
	if rec.Images["icons/a.png"] != sum([]byte("A")) || strings.Join(rec.Unresolved, ",") != "icons/lost.png" {
		t.Fatalf("record %+v", rec)
	}
	// Deleting the backup removes its record.
	if err := bm.DeleteBackup(filepath.Base(p)); err != nil {
		t.Fatal(err)
	}
	if exists(bm.recordPath(filepath.Base(p))) {
		t.Fatal("record left behind")
	}
}

func TestSweepKeepsReferencedAndRemovesUnreferenced(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)

	// A protected (manual) backup uses kept.png and bg.jpg (recorded by hash).
	writeFile(t, bm.liveImagePath("icons", "kept.png"), "KEPT")
	writeFile(t, bm.liveImagePath("backgrounds", "bg.jpg"), "BG")
	setConfig(t, db, "/icons/kept.png", "/backgrounds/bg.jpg")
	if _, err := bm.CreateBackupWithDB(db, "manual"); err != nil {
		t.Fatal(err)
	}
	// The live DB now uses live.png only.
	setConfig(t, db, "/icons/live.png")
	hKept := toAttic(t, bm, "icons", "kept.png", "KEPT")
	hBg := toAttic(t, bm, "backgrounds", "bg.jpg", "BG")
	hLive := toAttic(t, bm, "icons", "live.png", "LIVE")
	hGone := toAttic(t, bm, "icons", "gone.png", "GONE")
	// A later version of kept.png that no backup used.
	hKept2 := toAttic(t, bm, "icons", "kept.png", "KEPT-v2")
	removed, err := bm.SweepAttic()
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(removed)
	want := []string{"icons/" + hGone, "icons/" + hKept2}
	sort.Strings(want)
	if strings.Join(removed, ",") != strings.Join(want, ",") {
		t.Fatalf("removed %v, want %v", removed, want)
	}
	for _, p := range []string{bm.atticHashPath("icons", hKept), bm.atticHashPath("backgrounds", hBg), bm.atticHashPath("icons", hLive)} {
		if !exists(p) {
			t.Errorf("%s was removed although referenced", p)
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
	if atticCount(t, bm) != 0 {
		t.Fatal("attic not emptied")
	}
}

func TestSweepRunsAfterEveryBackupCleanup(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)
	h := toAttic(t, bm, "icons", "orphan.png", "x")
	if _, err := bm.CreateBackupWithDB(db, "startup"); err != nil {
		t.Fatal(err)
	}
	if exists(bm.atticHashPath("icons", h)) {
		t.Fatal("the cleanup after a backup didn't sweep the attic")
	}
}

func TestUnreadableBackupBlocksTheSweepWithANotice(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)
	h := toAttic(t, bm, "icons", "orphan.png", "x")
	bad := BackupPrefix + "2026-01-01_00-00-00_manual" + BackupSuffix
	writeFile(t, filepath.Join(bm.backupDir, bad), "this is not a database at all, just junk text")

	if _, err := bm.SweepAttic(); err == nil {
		t.Fatal("the sweep went ahead with an unreadable backup")
	}
	if !exists(bm.atticHashPath("icons", h)) {
		t.Fatal("an attic file was deleted although a backup couldn't be read")
	}
	if !hasProblem(bm, ProblemAtticBlocked, bad) {
		t.Fatalf("no visible notice naming the backup: %+v", bm.Problems())
	}
	// A damaged image record blocks it too.
	os.Remove(filepath.Join(bm.backupDir, bad))
	p, err := bm.CreateBackupWithDB(db, "manual")
	if err != nil {
		t.Fatal(err)
	}
	h = toAttic(t, bm, "icons", "orphan.png", "x")
	writeFile(t, bm.recordPath(filepath.Base(p)), "{damaged")
	if _, err := bm.SweepAttic(); err == nil || !exists(bm.atticHashPath("icons", h)) {
		t.Fatal("swept with a damaged record")
	}
	if !hasProblem(bm, ProblemAtticBlocked, "image record is damaged") {
		t.Fatalf("no notice: %+v", bm.Problems())
	}
	// Fixed: the next sweep works and the notice goes.
	os.Remove(bm.recordPath(filepath.Base(p)))
	if _, err := bm.SweepAttic(); err != nil {
		t.Fatal(err)
	}
	if exists(bm.atticHashPath("icons", h)) {
		t.Fatal("not swept once readable")
	}
	if hasProblem(bm, ProblemAtticBlocked, "") {
		t.Fatal("the notice stayed after a sweep that worked")
	}
}

func TestSweepDeleteFailureIsANotice(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	bm.SetLiveDB(openDB(t, dbPath))
	toAttic(t, bm, "icons", "orphan.png", "x")
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
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)
	setConfig(t, db, "/backgrounds/huge.jpg")
	h := toAttic(t, bm, "backgrounds", "huge.jpg", "big")
	if err := os.Truncate(bm.atticHashPath("backgrounds", h), AtticLargeBytes+1); err != nil {
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

// restoreAndApply restores a backup (staged), closes the live DB, applies it
// as the next start would, and runs AfterRestore.
func restoreAndApply(t *testing.T, bm *BackupManager, db *sql.DB, dbPath, name string) RestoredImages {
	t.Helper()
	if err := bm.RestoreBackup(db, name); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if applied, err := ApplyPendingRestore(dbPath); err != nil || !applied {
		t.Fatalf("apply: %v %v", applied, err)
	}
	return bm.AfterRestore(true)
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
	setConfig(t, db)
	if _, err := bm.MoveToAttic("icons", "a.png"); err != nil {
		t.Fatal(err)
	}
	if _, err := bm.MoveToAttic("backgrounds", "b.jpg"); err != nil {
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
	if applied, err := ApplyPendingRestore(dbPath); err != nil || !applied {
		t.Fatalf("apply: %v %v", applied, err)
	}
	res := bm.AfterRestore(true)
	if got := readString(t, filepath.Join(dir, "icons", "a.png")); got != "A" {
		t.Fatalf("a.png %q", got)
	}
	if got := readString(t, filepath.Join(dir, "backgrounds", "b.jpg")); got != "B" {
		t.Fatalf("b.jpg %q", got)
	}
	if len(res.Installed) != 2 || strings.Join(res.Missing, ",") != "icons/lost.png" {
		t.Fatalf("result %+v", res)
	}
	if !hasProblem(bm, ProblemRestoreImages, "icons/lost.png") {
		t.Fatalf("missing image not a visible notice: %+v", bm.Problems())
	}
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

// The review's scenario: B1 uses x.png = A. x.png is deleted, a new x.png (C)
// is uploaded and deleted too. Restoring B1 must give A, never C.
func TestRestoreGivesTheExactVersionTheBackupUsed(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)
	setConfig(t, db, "/icons/x.png")
	writeFile(t, bm.liveImagePath("icons", "x.png"), "version A")
	b1, err := bm.CreateBackupWithDB(db, "manual")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := bm.MoveToAttic("icons", "x.png"); err != nil {
		t.Fatal(err)
	}
	writeFile(t, bm.liveImagePath("icons", "x.png"), "version C")
	if _, err := bm.CreateBackupWithDB(db, "manual"); err != nil {
		t.Fatal(err)
	}
	if _, err := bm.MoveToAttic("icons", "x.png"); err != nil {
		t.Fatal(err)
	}
	// The download of B1 holds A.
	f, _, done, err := bm.BuildBackupArchive(filepath.Base(b1))
	if err != nil {
		t.Fatal(err)
	}
	if got := string(readZip(t, f)["icons/x.png"]); got != "version A" {
		t.Fatalf("B1's archive holds %q", got)
	}
	done()
	res := restoreAndApply(t, bm, db, dbPath, filepath.Base(b1))
	if got := readString(t, bm.liveImagePath("icons", "x.png")); got != "version A" {
		t.Fatalf("restored %q, want version A (%+v)", got, res)
	}
	if hasProblem(bm, ProblemRestoreImages, "") {
		t.Fatalf("unexpected notice: %+v", bm.Problems())
	}
}

func TestRestoreNeverReplacesADifferentVersionInPlace(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)
	setConfig(t, db, "/icons/x.png")
	writeFile(t, bm.liveImagePath("icons", "x.png"), "version A")
	b1, err := bm.CreateBackupWithDB(db, "manual")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := bm.MoveToAttic("icons", "x.png"); err != nil {
		t.Fatal(err)
	}
	writeFile(t, bm.liveImagePath("icons", "x.png"), "version C")
	res := restoreAndApply(t, bm, db, dbPath, filepath.Base(b1))
	if got := readString(t, bm.liveImagePath("icons", "x.png")); got != "version C" {
		t.Fatalf("a file in place was replaced: %q", got)
	}
	if strings.Join(res.Clashes, ",") != "icons/x.png" || !hasProblem(bm, ProblemRestoreImages, "different version") {
		t.Fatalf("clash not visible: %+v %+v", res, bm.Problems())
	}
}

func TestBackupWithoutARecordRestoresNothingAmbiguous(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)
	setConfig(t, db, "/icons/x.png", "/icons/one.png")
	writeFile(t, bm.liveImagePath("icons", "x.png"), "version A")
	writeFile(t, bm.liveImagePath("icons", "one.png"), "only")
	b1, err := bm.CreateBackupWithDB(db, "manual")
	if err != nil {
		t.Fatal(err)
	}
	// As if made before records existed.
	os.Remove(bm.recordPath(filepath.Base(b1)))
	if _, err := bm.MoveToAttic("icons", "x.png"); err != nil {
		t.Fatal(err)
	}
	toAttic(t, bm, "icons", "x.png", "version C")
	if _, err := bm.MoveToAttic("icons", "one.png"); err != nil {
		t.Fatal(err)
	}
	// Its download leaves out the ambiguous image and says so.
	plan, err := bm.PlanBackupImages(filepath.Base(b1))
	if err != nil || strings.Join(plan.Ambiguous, ",") != "icons/x.png" || strings.Join(plan.Included, ",") != "icons/one.png" {
		t.Fatalf("plan %+v %v", plan, err)
	}
	res := restoreAndApply(t, bm, db, dbPath, filepath.Base(b1))
	if exists(bm.liveImagePath("icons", "x.png")) {
		t.Fatal("an ambiguous image was restored")
	}
	if readString(t, bm.liveImagePath("icons", "one.png")) != "only" {
		t.Fatal("the unambiguous image wasn't restored")
	}
	if strings.Join(res.Ambiguous, ",") != "icons/x.png" || !hasProblem(bm, ProblemRestoreImages, "can't tell which version") {
		t.Fatalf("not visible: %+v %+v", res, bm.Problems())
	}
}

func TestInstallFailureLeavesNoPartialFileAndIsANotice(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)
	setConfig(t, db, "/icons/x.png")
	writeFile(t, bm.liveImagePath("icons", "x.png"), "version A, long enough to be cut part-way")
	b1, err := bm.CreateBackupWithDB(db, "manual")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := bm.MoveToAttic("icons", "x.png"); err != nil {
		t.Fatal(err)
	}
	installHook = func(string) error { return errors.New("power cut") }
	t.Cleanup(func() { installHook = nil })
	res := restoreAndApply(t, bm, db, dbPath, filepath.Base(b1))
	if exists(bm.liveImagePath("icons", "x.png")) {
		t.Fatal("a partial image was left under the real name")
	}
	if m, _ := filepath.Glob(filepath.Join(filepath.Dir(dbPath), "icons", ".install-*")); len(m) != 0 {
		t.Fatalf("temp left: %v", m)
	}
	if len(res.Failed) != 1 || !hasProblem(bm, ProblemRestoreImages, "power cut") {
		t.Fatalf("failure not visible: %+v %+v", res, bm.Problems())
	}
}

func TestDeleteRemovesTheBackupFirstAndTheSweepCleansLeftovers(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores directory permissions")
	}
	bm, _ := setupBackupTest(t)
	z := buildZip(t, []zipEntry{{name: "hops.db", data: hopsDBBytes(t, "/icons/a.png")}, {name: "icons/a.png", data: []byte("A")}}, nil)
	res, err := bm.StoreUpload(bytes.NewReader(z), UploadCaps{Total: 8 << 20, PerImage: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	staged := filepath.Join(bm.stagedImagesPath(res.Name), "icons")
	os.Chmod(staged, 0o555)
	t.Cleanup(func() { os.Chmod(staged, 0o755) })
	if err := bm.DeleteBackup(res.Name); err != nil {
		t.Fatal(err)
	}
	if exists(filepath.Join(bm.backupDir, res.Name)) {
		t.Fatal("the backup wasn't deleted")
	}
	if !hasProblem(bm, ProblemAtticDeleteFailed, res.Name) {
		t.Fatalf("leftover not visible: %+v", bm.Problems())
	}
	os.Chmod(staged, 0o755)
	if _, err := bm.SweepAttic(); err != nil {
		t.Fatal(err)
	}
	if exists(bm.stagedImagesPath(res.Name)) || hasProblem(bm, ProblemAtticDeleteFailed, "") {
		t.Fatal("leftover not swept")
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
	writeFile(t, filepath.Join(dir, "backgrounds", "b.jpg"), "B-attic")
	writeFile(t, filepath.Join(dir, "icons", "unrelated.png"), "U")
	p, err := bm.CreateBackupWithDB(db, "manual")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := bm.MoveToAttic("backgrounds", "b.jpg"); err != nil {
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
	if !hasProblem(bm, ProblemRestoreImages, "icons/c.png") || !hasProblem(bm, ProblemRestoreImages, "different version") {
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

func TestUploadRefusesDuplicateEntriesAndSizeBombs(t *testing.T) {
	bm, _ := setupBackupTest(t)
	os.MkdirAll(bm.backupDir, 0o755)
	good := hopsDBBytes(t, "/icons/a.png")
	caps := UploadCaps{Total: 8 << 20, PerImage: 64 << 10}
	before := dirSnapshot(t, bm.backupDir)
	expectRefused := func(name string, z []byte, want string) {
		t.Helper()
		_, err := bm.StoreUpload(bytes.NewReader(z), caps)
		var ibe *InvalidBackupError
		if !errors.As(err, &ibe) || !strings.Contains(ibe.Reason, want) {
			t.Errorf("%s: got %v, want a reason containing %q", name, err, want)
		}
		if after := dirSnapshot(t, bm.backupDir); after != before {
			t.Errorf("%s: left files behind:\n%s", name, after)
		}
	}

	// The same name twice.
	expectRefused("duplicate", buildZip(t, []zipEntry{{name: "hops.db", data: good}, {name: "icons/a.png", data: []byte("1")}, {name: "icons/a.png", data: []byte("2")}}, nil), "twice")

	// A declared-size bomb: the header says 10 bytes, the data inflates to 1 MiB.
	big := bytes.Repeat([]byte{0}, 1<<20)
	var comp bytes.Buffer
	fw, _ := flate.NewWriter(&comp, flate.BestCompression)
	fw.Write(big)
	fw.Close()
	man := ArchiveManifest{Format: ArchiveFormat, FormatVersion: 1, Files: []ArchiveFile{
		{Path: "hops.db", Size: int64(len(good)), SHA256: sum(good)},
		{Path: "icons/bomb.png", Size: 10, SHA256: sum(big[:10])},
	}}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("hops.db")
	w.Write(good)
	rw, err := zw.CreateRaw(&zip.FileHeader{Name: "icons/bomb.png", Method: zip.Deflate, CRC32: crc32.ChecksumIEEE(big),
		CompressedSize64: uint64(comp.Len()), UncompressedSize64: 10})
	if err != nil {
		t.Fatal(err)
	}
	rw.Write(comp.Bytes())
	raw, _ := json.Marshal(man)
	w, _ = zw.Create("manifest.json")
	w.Write(raw)
	zw.Close()
	expectRefused("declared-size bomb", buf.Bytes(), "icons/bomb.png")

	// A declared size over the cap: refused before anything is extracted.
	expectRefused("declared too big", buildZip(t, []zipEntry{{name: "hops.db", data: good}, {name: "icons/a.png", data: make([]byte, 65<<10)}}, nil), "larger than")
}

func TestZeroCapsRefuse(t *testing.T) {
	bm, _ := setupBackupTest(t)
	good := hopsDBBytes(t)
	if _, err := bm.StoreUpload(bytes.NewReader(good), UploadCaps{Total: 0, PerImage: 1 << 20}); err == nil || !strings.Contains(err.Error(), "turned off") {
		t.Fatalf("total 0: %v", err)
	}
	z := buildZip(t, []zipEntry{{name: "hops.db", data: good}, {name: "icons/a.png", data: []byte("A")}}, nil)
	if _, err := bm.StoreUpload(bytes.NewReader(z), UploadCaps{Total: 8 << 20, PerImage: 0}); err == nil || !strings.Contains(err.Error(), "images are turned off") {
		t.Fatalf("per-image 0: %v", err)
	}
}

func TestUploadedImagesGoThroughTheUploadProcessing(t *testing.T) {
	bm, _ := setupBackupTest(t)
	good := hopsDBBytes(t, "/icons/a.png")
	z := buildZip(t, []zipEntry{{name: "hops.db", data: good}, {name: "icons/a.png", data: []byte("raw")}}, nil)
	refuse := func(kind, name string, data []byte) ([]byte, error) { return nil, errors.New("not an image") }
	if _, err := bm.StoreUpload(bytes.NewReader(z), UploadCaps{Total: 8 << 20, PerImage: 1 << 20, Process: refuse}); err == nil || !strings.Contains(err.Error(), "isn't a usable image (not an image)") {
		t.Fatalf("refusing processor: %v", err)
	}
	normalise := func(kind, name string, data []byte) ([]byte, error) { return []byte("normalised"), nil }
	res, err := bm.StoreUpload(bytes.NewReader(z), UploadCaps{Total: 8 << 20, PerImage: 1 << 20, Process: normalise})
	if err != nil {
		t.Fatal(err)
	}
	if got := readString(t, filepath.Join(bm.stagedImagesPath(res.Name), "icons", "a.png")); got != "normalised" {
		t.Fatalf("staged %q", got)
	}
	rec, err := bm.readRecord(res.Name)
	if err != nil || rec == nil || rec.Images["icons/a.png"] != sum([]byte("normalised")) {
		t.Fatalf("record %+v %v", rec, err)
	}
}

// Fix round 2 (I1): a lost or damaged attic index is never read as "empty":
// it is rebuilt from the backups' records; versions it can't match to a name
// are kept, and that is a visible notice.
func TestLostAtticIndexIsRebuiltAndNothingIsLost(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)
	// live.png: only the live DB uses it (no record names its hash).
	setConfig(t, db, "/icons/live.png")
	hLive := toAttic(t, bm, "icons", "live.png", "LIVE")
	// rec.png: a backup's record names it.
	writeFile(t, bm.liveImagePath("icons", "rec.png"), "REC")
	setConfig(t, db, "/icons/live.png", "/icons/rec.png")
	if _, err := bm.CreateBackupWithDB(db, "manual"); err != nil {
		t.Fatal(err)
	}
	hRec, err := bm.MoveToAttic("icons", "rec.png")
	if err != nil {
		t.Fatal(err)
	}
	for _, damage := range []string{"missing", "damaged"} {
		idxPath := filepath.Join(filepath.Dir(dbPath), "attic", "index.json")
		if damage == "missing" {
			os.Remove(idxPath)
		} else {
			writeFile(t, idxPath, "{not json")
		}
		if _, err := bm.SweepAttic(); err != nil {
			t.Fatalf("%s: %v", damage, err)
		}
		for _, h := range []string{hLive, hRec} {
			if !exists(bm.atticHashPath("icons", h)) {
				t.Fatalf("%s index: a kept version was deleted", damage)
			}
		}
		bm.atticMu.Lock()
		idx, err := bm.loadIndexLocked()
		bm.atticMu.Unlock()
		if err != nil || strings.Join(idx.Names["icons/rec.png"], ",") != hRec {
			t.Fatalf("%s: index not rebuilt from the records: %+v %v", damage, idx, err)
		}
		if !hasProblem(bm, ProblemAtticIndexRebuilt, "1 image version") {
			t.Fatalf("%s: no visible notice: %+v", damage, bm.Problems())
		}
		bm.DismissProblem(ProblemAtticIndexRebuilt)
	}
	// A record that can't be read: the rebuild fails, and the sweep is blocked.
	list, _ := bm.ListBackups()
	writeFile(t, bm.recordPath(list[0].Name), "{damaged")
	os.Remove(filepath.Join(filepath.Dir(dbPath), "attic", "index.json"))
	if _, err := bm.SweepAttic(); err == nil || !hasProblem(bm, ProblemAtticBlocked, "index") {
		t.Fatalf("not blocked: %v %+v", err, bm.Problems())
	}
	if !exists(bm.atticHashPath("icons", hLive)) || !exists(bm.atticHashPath("icons", hRec)) {
		t.Fatal("deleted while blocked")
	}
}

// Fix round 2 (I2): an uploaded backup's staged images are the only copy;
// deleting the backup moves them into the attic, so a restore staged before
// the delete still gets them.
func TestStagedImagesSurviveTheirBackup(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)
	z := buildZip(t, []zipEntry{{name: "hops.db", data: hopsDBBytes(t, "/icons/up.png")}, {name: "icons/up.png", data: []byte("UPLOADED")}}, nil)
	res, err := bm.StoreUpload(bytes.NewReader(z), UploadCaps{Total: 8 << 20, PerImage: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	if err := bm.RestoreBackup(db, res.Name); err != nil {
		t.Fatal(err)
	}
	if err := bm.DeleteBackup(res.Name); err != nil {
		t.Fatal(err)
	}
	if exists(bm.stagedImagesPath(res.Name)) {
		t.Fatal("staged images left in place")
	}
	if !exists(bm.atticHashPath("icons", sum([]byte("UPLOADED")))) {
		t.Fatal("staged images weren't moved to the attic")
	}
	if _, err := bm.SweepAttic(); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if applied, err := ApplyPendingRestore(dbPath); err != nil || !applied {
		t.Fatal(err)
	}
	r := bm.AfterRestore(true)
	if got := readString(t, bm.liveImagePath("icons", "up.png")); got != "UPLOADED" {
		t.Fatalf("image %q (%+v)", got, r)
	}
}

// M1: a name the record couldn't pin down, with a file in place, is reported
// as ambiguous, never kept silently. M3: the attic's only version isn't
// recorded as fact.
func TestUnresolvedNamesAreReportedAsAmbiguous(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)
	setConfig(t, db, "/icons/x.png")
	toAttic(t, bm, "icons", "x.png", "ONLY")
	p, err := bm.CreateBackupWithDB(db, "manual")
	if err != nil {
		t.Fatal(err)
	}
	rec, _ := bm.readRecord(filepath.Base(p))
	if _, ok := rec.Images["icons/x.png"]; ok || strings.Join(rec.Unresolved, ",") != "icons/x.png" {
		t.Fatalf("the attic's only version was recorded as fact: %+v", rec)
	}
	writeFile(t, bm.liveImagePath("icons", "x.png"), "SOMETHING ELSE")
	plan, err := bm.PlanBackupImages(filepath.Base(p))
	if err != nil || strings.Join(plan.Ambiguous, ",") != "icons/x.png" {
		t.Fatalf("plan %+v %v", plan, err)
	}
	r := restoreAndApply(t, bm, db, dbPath, filepath.Base(p))
	if strings.Join(r.Ambiguous, ",") != "icons/x.png" || !hasProblem(bm, ProblemRestoreImages, "can't tell which version") {
		t.Fatalf("not reported: %+v %+v", r, bm.Problems())
	}
	if readString(t, bm.liveImagePath("icons", "x.png")) != "SOMETHING ELSE" {
		t.Fatal("the file in place was changed")
	}
}

// Cache: a record hashes the file as it is now, even when a replacement
// keeps the same size and modification time.
func TestRecordHashesFresh(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	db := openDB(t, dbPath)
	bm.SetLiveDB(db)
	setConfig(t, db, "/icons/x.png")
	p := bm.liveImagePath("icons", "x.png")
	writeFile(t, p, "AAAA")
	mt := time.Unix(1700000000, 0)
	os.Chtimes(p, mt, mt)
	if _, err := bm.CreateBackupWithDB(db, "manual"); err != nil {
		t.Fatal(err)
	}
	writeFile(t, p, "BBBB")
	os.Chtimes(p, mt, mt)
	b2, err := bm.CreateBackupWithDB(db, "manual")
	if err != nil {
		t.Fatal(err)
	}
	rec, _ := bm.readRecord(filepath.Base(b2))
	if rec.Images["icons/x.png"] != sum([]byte("BBBB")) {
		t.Fatal("a stale cached hash was recorded")
	}
}
