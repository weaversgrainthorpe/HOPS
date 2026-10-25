package database

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Fix round 1: a restore never loses its target or the current data, a
// broken stage doesn't retry forever, and dismissible backup notices
// survive a restart.

// C1: restoring the oldest kept automatic backup used to delete it (the
// safety backup's cleanup ran before the target was staged).
func TestRestoreOldestKeptBackupKeepsTarget(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	bm.SetRetention(func() RetentionPolicy { return RetentionPolicy{KeepCount: 3, MaxCount: 3} })
	db := openDB(t, dbPath)
	var names []string
	for i := 0; i < 3; i++ {
		p, err := bm.CreateBackupWithDB(db, "startup")
		if err != nil {
			t.Fatal(err)
		}
		mt := time.Now().Add(time.Duration(i-10) * time.Minute) // oldest first
		os.Chtimes(p, mt, mt)
		names = append(names, filepath.Base(p))
	}
	oldest := names[0]
	if err := bm.RestoreBackup(db, oldest); err != nil {
		t.Fatalf("restore of the oldest kept backup: %v", err)
	}
	if _, err := os.Stat(PendingRestorePath(dbPath)); err != nil {
		t.Fatalf("restore not staged: %v", err)
	}
	if err := ValidateHOPSDatabase(PendingRestorePath(dbPath)); err != nil {
		t.Fatalf("the staged copy is not the target: %v", err)
	}
}

// C1 (order): a refused restore (safety backup failed) leaves no stage or temp file.
func TestRefusedRestoreLeavesNoStage(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	p, err := bm.CreateBackup("manual")
	if err != nil {
		t.Fatal(err)
	}
	bm.SetFailureHooks(FailureHooks{Create: func(r string) error {
		if r == "pre-restore" {
			return errors.New("disk full")
		}
		return nil
	}})
	if err := bm.RestoreBackup(nil, filepath.Base(p)); err == nil {
		t.Fatal("restore not refused")
	}
	for _, f := range []string{PendingRestorePath(dbPath), PendingRestorePath(dbPath) + ".tmp"} {
		if _, err := os.Stat(f); !os.IsNotExist(err) {
			t.Fatalf("%s left behind", f)
		}
	}
}

// copyLiveDB copies a database, its WAL and shm while a connection is still
// open (the state after a crash): the WAL holds writes not yet checkpointed.
func copyLiveDB(t *testing.T, src, dstDir string) string {
	t.Helper()
	dst := filepath.Join(dstDir, "hops.db")
	for _, suf := range []string{"", "-wal", "-shm"} {
		in, err := os.Open(src + suf)
		if err != nil {
			if os.IsNotExist(err) && suf != "" {
				continue
			}
			t.Fatal(err)
		}
		out, err := os.Create(dst + suf)
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(out, in)
		in.Close()
		out.Close()
	}
	return dst
}

// I1: a failed apply puts back the original database, including its WAL.
func TestApplyFailureKeepsOriginalIncludingWAL(t *testing.T) {
	_, srcPath := setupBackupTest(t)
	db := openDB(t, srcPath)
	if _, err := db.Exec(`PRAGMA wal_autocheckpoint=0`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT OR REPLACE INTO config (id, data) VALUES (1, '{"v":"in-wal"}')`); err != nil {
		t.Fatal(err)
	}
	if st, err := os.Stat(srcPath + "-wal"); err != nil || st.Size() == 0 {
		t.Fatalf("no WAL to protect: %v", err)
	}
	dir := t.TempDir()
	dbPath := copyLiveDB(t, srcPath, dir)
	// Stage a valid restore (another HOPS DB).
	_, other := setupBackupTest(t)
	if err := copyFile(other, PendingRestorePath(dbPath)); err != nil {
		t.Fatal(err)
	}

	renameFile = func(from, to string) error {
		if from == PendingRestorePath(dbPath) {
			return errors.New("injected rename failure")
		}
		return os.Rename(from, to)
	}
	t.Cleanup(func() { renameFile = os.Rename })

	applied, err := ApplyPendingRestore(dbPath)
	if err == nil || applied {
		t.Fatalf("apply should fail: %v %v", applied, err)
	}
	for _, suf := range []string{"", "-wal"} {
		if _, err := os.Stat(dbPath + suf); err != nil {
			t.Fatalf("original %q not put back: %v", suf, err)
		}
	}
	got := openDB(t, dbPath)
	var v string
	if err := got.QueryRow(`SELECT data FROM config WHERE id = 1`).Scan(&v); err != nil || !strings.Contains(v, "in-wal") {
		t.Fatalf("uncheckpointed WAL write lost: %q %v", v, err)
	}
	if left, _ := filepath.Glob(dbPath + ".pre-apply*"); len(left) != 0 {
		t.Fatalf("aside files left: %v", left)
	}
}

// I1: a successful apply leaves no aside files and no old WAL.
func TestApplySuccessCleansAside(t *testing.T) {
	_, dbPath := setupBackupTest(t)
	db := openDB(t, dbPath)
	db.Exec(`INSERT OR REPLACE INTO config (id, data) VALUES (1, '{"v":"old"}')`)
	db.Close()
	_, other := setupBackupTest(t)
	odb := openDB(t, other)
	odb.Exec(`INSERT OR REPLACE INTO config (id, data) VALUES (1, '{"v":"restored"}')`)
	odb.Close()
	copyFile(other, PendingRestorePath(dbPath))
	if applied, err := ApplyPendingRestore(dbPath); err != nil || !applied {
		t.Fatalf("%v %v", applied, err)
	}
	if left, _ := filepath.Glob(dbPath + ".pre-apply*"); len(left) != 0 {
		t.Fatalf("aside files left: %v", left)
	}
	var v string
	openDB(t, dbPath).QueryRow(`SELECT data FROM config WHERE id = 1`).Scan(&v)
	if !strings.Contains(v, "restored") {
		t.Fatalf("not applied: %q", v)
	}
}

// I1: an apply interrupted after moving the database aside is recovered at the next start.
func TestApplyRecoversInterruptedAside(t *testing.T) {
	_, dbPath := setupBackupTest(t)
	if err := os.Rename(dbPath, dbPath+".pre-apply"); err != nil {
		t.Fatal(err)
	}
	if _, err := ApplyPendingRestore(dbPath); err != nil {
		t.Fatal(err)
	}
	if err := ValidateHOPSDatabase(dbPath); err != nil {
		t.Fatalf("interrupted apply not recovered: %v", err)
	}
}

// I2: a broken stage is set aside as .restore-failed (no retry loop).
func TestBrokenStageSetAside(t *testing.T) {
	_, dbPath := setupBackupTest(t)
	os.WriteFile(PendingRestorePath(dbPath), []byte("broken"), 0o644)
	if _, err := ApplyPendingRestore(dbPath); err == nil {
		t.Fatal("a broken stage applied")
	}
	if _, err := os.Stat(PendingRestorePath(dbPath)); !os.IsNotExist(err) {
		t.Fatal("broken stage still pending: it would be retried on every start")
	}
	if _, err := os.Stat(dbPath + FailedRestoreSuffix); err != nil {
		t.Fatalf("broken stage not kept as .restore-failed: %v", err)
	}
	if applied, err := ApplyPendingRestore(dbPath); applied || err != nil {
		t.Fatalf("second start retried: %v %v", applied, err)
	}
}

// I2: a staged restore can be discarded.
func TestDiscardPendingRestore(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	if bm.PendingRestore() {
		t.Fatal("pending without a stage")
	}
	if err := bm.DiscardPendingRestore(); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("discard with nothing staged: %v", err)
	}
	p, _ := bm.CreateBackup("manual")
	if err := bm.RestoreBackup(nil, filepath.Base(p)); err != nil {
		t.Fatal(err)
	}
	if !bm.PendingRestore() {
		t.Fatal("stage not reported")
	}
	if err := bm.DiscardPendingRestore(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(PendingRestorePath(dbPath)); !os.IsNotExist(err) {
		t.Fatal("not discarded")
	}
}

// I2 + I3: the restore-failed and ceiling notices are dismissible and
// survive a restart (backups/.notices.json) until dismissed.
func TestDismissibleNoticesPersist(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	bm.RecordRestoreFailure(errors.New("stage broken"))
	bm.SetRetention(func() RetentionPolicy { return RetentionPolicy{KeepCount: 3, KeepDays: 3650, MaxCount: 3} })
	os.MkdirAll(bm.backupDir, 0o755)
	for i := 0; i < 5; i++ {
		name := filepath.Join(bm.backupDir, BackupPrefix+"2026-01-01_00-00-"+padZero(i)+"_startup"+BackupSuffix)
		os.WriteFile(name, []byte("x"), 0o644)
		mt := time.Now().Add(-time.Duration(i) * time.Minute)
		os.Chtimes(name, mt, mt)
	}
	if err := bm.CleanupOldBackups(); err != nil {
		t.Fatal(err)
	}
	kinds := func(b *BackupManager) map[string]BackupProblem {
		m := map[string]BackupProblem{}
		for _, p := range b.Problems() {
			m[p.Kind] = p
		}
		return m
	}
	if k := kinds(bm); len(k) != 2 {
		t.Fatalf("want restore-failed + ceiling, got %+v", k)
	}

	// "Restart": a fresh manager for the same DB loads them.
	again := NewBackupManager(dbPath)
	k := kinds(again)
	if _, ok := k[ProblemCeilingDeleted]; !ok {
		t.Fatalf("ceiling notice lost on restart: %+v", k)
	}
	if _, ok := k[ProblemRestoreFailed]; !ok {
		t.Fatalf("restore-failed notice lost on restart: %+v", k)
	}
	if !again.DismissProblem(ProblemCeilingDeleted) || !again.DismissProblem(ProblemRestoreFailed) {
		t.Fatal("dismiss reported nothing")
	}
	if k := kinds(NewBackupManager(dbPath)); len(k) != 0 {
		t.Fatalf("dismissed notices came back after a restart: %+v", k)
	}
	if again.DismissProblem(ProblemBackupFailed) {
		t.Fatal("a backup failure is not dismissible")
	}
}

// M2: stale temp files from an interrupted stage or upload are swept at startup.
func TestSweepStaleTempFiles(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	os.MkdirAll(bm.backupDir, 0o755)
	stale := []string{PendingRestorePath(dbPath) + ".tmp", filepath.Join(bm.backupDir, ".upload-123.tmp")}
	for _, f := range stale {
		os.WriteFile(f, []byte("x"), 0o644)
	}
	keep := filepath.Join(bm.backupDir, BackupPrefix+"2026-01-01_00-00-00_manual.db")
	os.WriteFile(keep, []byte("x"), 0o644)
	if err := SweepStaleTempFiles(dbPath); err != nil {
		t.Fatal(err)
	}
	for _, f := range stale {
		if _, err := os.Stat(f); !os.IsNotExist(err) {
			t.Fatalf("%s not swept", f)
		}
	}
	if _, err := os.Stat(keep); err != nil {
		t.Fatal("a real backup was swept")
	}
}
