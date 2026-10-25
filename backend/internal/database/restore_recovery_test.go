package database

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Fix round 2: an interrupted or half-failed restore never serves an empty
// database and never deletes the originals unless the restored file is
// provably in place. Every outcome is visible.

// restoreFixture is a data dir with a current DB (with a value in its WAL)
// and a staged restore of another DB.
func restoreFixture(t *testing.T) (dbPath string) {
	t.Helper()
	_, src := setupBackupTest(t)
	db := openDB(t, src)
	db.Exec(`PRAGMA wal_autocheckpoint=0`)
	if _, err := db.Exec(`INSERT OR REPLACE INTO config (id, data) VALUES (1, '{"v":"current-in-wal"}')`); err != nil {
		t.Fatal(err)
	}
	dbPath = copyLiveDB(t, src, t.TempDir())
	_, other := setupBackupTest(t)
	odb := openDB(t, other)
	odb.Exec(`INSERT OR REPLACE INTO config (id, data) VALUES (1, '{"v":"restored"}')`)
	odb.Close()
	if err := copyFile(other, PendingRestorePath(dbPath)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { renameFile = os.Rename; crashAfter = nil })
	return dbPath
}

func configValue(t *testing.T, dbPath string) string {
	t.Helper()
	var v string
	db := openDB(t, dbPath)
	if err := db.QueryRow(`SELECT data FROM config WHERE id = 1`).Scan(&v); err != nil {
		t.Fatalf("read config: %v", err)
	}
	db.Close()
	return v
}

func asideFiles(dbPath string) []string {
	m, _ := filepath.Glob(dbPath + preApplySuffix + "*")
	return m
}

func wantUnsafe(t *testing.T, err error, mention string) {
	t.Helper()
	var u *UnsafeStartError
	if !errors.As(err, &u) {
		t.Fatalf("want an UnsafeStartError (refuse to start), got %v", err)
	}
	if mention != "" && !strings.Contains(err.Error(), mention) {
		t.Fatalf("error does not name %q: %v", mention, err)
	}
}

// The rename-in fails and so does moving hops.db back: refuse to start, keep
// every original, never leave an empty DB path to be created.
func TestRestoreRenameAndMoveBackFailRefusesToStart(t *testing.T) {
	dbPath := restoreFixture(t)
	renameFile = func(from, to string) error {
		if from == PendingRestorePath(dbPath) || from == dbPath+preApplySuffix {
			return errors.New("injected")
		}
		return os.Rename(from, to)
	}
	_, err := RecoverAndApplyRestore(dbPath)
	wantUnsafe(t, err, dbPath+preApplySuffix)
	if _, err := os.Stat(dbPath + preApplySuffix); err != nil {
		t.Fatal("the original database was not kept")
	}
	// The next start (renames work again) undoes it and the data is intact.
	renameFile = os.Rename
	res, err := RecoverAndApplyRestore(dbPath)
	if err != nil {
		t.Fatalf("recovery: %v", err)
	}
	if res.Outcome != OutcomeUndone {
		t.Fatalf("outcome %v, want undone", res.Outcome)
	}
	if v := configValue(t, dbPath); !strings.Contains(v, "current-in-wal") {
		t.Fatalf("current data lost: %q", v)
	}
	if len(asideFiles(dbPath)) != 0 {
		t.Fatalf("aside files left: %v", asideFiles(dbPath))
	}
}

// Only moving the WAL back fails: refuse to start, never delete it.
func TestRestoreWALMoveBackFailRefusesToStart(t *testing.T) {
	dbPath := restoreFixture(t)
	renameFile = func(from, to string) error {
		if from == PendingRestorePath(dbPath) || from == dbPath+preApplySuffix+"-wal" {
			return errors.New("injected")
		}
		return os.Rename(from, to)
	}
	_, err := RecoverAndApplyRestore(dbPath)
	wantUnsafe(t, err, preApplySuffix+"-wal")
	if _, err := os.Stat(dbPath + preApplySuffix + "-wal"); err != nil {
		t.Fatal("the WAL was not kept")
	}
	renameFile = os.Rename
	if _, err := RecoverAndApplyRestore(dbPath); err != nil {
		t.Fatalf("recovery: %v", err)
	}
	if v := configValue(t, dbPath); !strings.Contains(v, "current-in-wal") {
		t.Fatalf("uncheckpointed WAL write lost: %q", v)
	}
}

// A crash after each step: the next start either undoes (data as before) or
// completes (restored data), never deletes originals wrongly, never fails.
func TestRestoreCrashAfterEachStep(t *testing.T) {
	steps := []struct {
		step string
		want Outcome
		val  string
	}{
		{"journal", OutcomeUndone, "current-in-wal"},
		{"aside", OutcomeUndone, "current-in-wal"},
		{"aside-wal", OutcomeUndone, "current-in-wal"},
		{"aside-shm", OutcomeUndone, "current-in-wal"},
		{"rename-in", OutcomeRecoveredApplied, "restored"},
		{"mark-applied", OutcomeRecoveredApplied, "restored"},
		{"cleanup", OutcomeNone, "restored"}, // only the journal was left: the restore had finished
	}
	for _, tc := range steps {
		t.Run(tc.step, func(t *testing.T) {
			dbPath := restoreFixture(t)
			crashAfter = func(step string) bool { return step == tc.step }
			if _, err := RecoverAndApplyRestore(dbPath); !errors.Is(err, errSimulatedCrash) {
				t.Fatalf("no crash at %s: %v", tc.step, err)
			}
			crashAfter = nil
			res, err := RecoverAndApplyRestore(dbPath)
			if err != nil {
				t.Fatalf("restart after a crash at %s: %v", tc.step, err)
			}
			if res.Outcome != tc.want {
				t.Fatalf("outcome %v, want %v", res.Outcome, tc.want)
			}
			if v := configValue(t, dbPath); !strings.Contains(v, tc.val) {
				t.Fatalf("data %q, want %q", v, tc.val)
			}
			if len(asideFiles(dbPath)) != 0 {
				t.Fatalf("aside files left: %v", asideFiles(dbPath))
			}
			if _, err := os.Stat(dbPath + restoreJournalSuffix); !os.IsNotExist(err) {
				t.Fatal("journal left behind")
			}
			if tc.want == OutcomeUndone {
				if _, err := os.Stat(PendingRestorePath(dbPath)); !os.IsNotExist(err) {
					t.Fatal("an undone restore is still pending (it would be retried silently)")
				}
				if _, err := os.Stat(dbPath + FailedRestoreSuffix); err != nil {
					t.Fatal("the undone stage was not kept as .restore-failed")
				}
			}
		})
	}
}

// Ambiguous states refuse to start and delete nothing.
func TestRestoreAmbiguousStatesRefuse(t *testing.T) {
	t.Run("aside files without a journal", func(t *testing.T) {
		dbPath := restoreFixture(t)
		os.Rename(dbPath+"-wal", dbPath+preApplySuffix+"-wal")
		_, err := RecoverAndApplyRestore(dbPath)
		wantUnsafe(t, err, preApplySuffix+"-wal")
		if _, err := os.Stat(dbPath + preApplySuffix + "-wal"); err != nil {
			t.Fatal("deleted")
		}
	})
	t.Run("stage pending, original aside AND a database in place", func(t *testing.T) {
		dbPath := restoreFixture(t)
		crashAfter = func(step string) bool { return step == "aside" }
		RecoverAndApplyRestore(dbPath)
		crashAfter = nil
		os.WriteFile(dbPath, []byte("someone made a new file"), 0o644) // e.g. an old build created an empty DB
		_, err := RecoverAndApplyRestore(dbPath)
		wantUnsafe(t, err, dbPath+preApplySuffix)
		if _, err := os.Stat(dbPath + preApplySuffix); err != nil {
			t.Fatal("original deleted")
		}
	})
	t.Run("stage gone but the database is not the restored file", func(t *testing.T) {
		dbPath := restoreFixture(t)
		crashAfter = func(step string) bool { return step == "rename-in" }
		RecoverAndApplyRestore(dbPath)
		crashAfter = nil
		os.WriteFile(dbPath, []byte("changed"), 0o644)
		_, err := RecoverAndApplyRestore(dbPath)
		wantUnsafe(t, err, dbPath+preApplySuffix)
		if len(asideFiles(dbPath)) == 0 {
			t.Fatal("originals deleted while the restored file is unproven")
		}
	})
	t.Run("no database and no stage", func(t *testing.T) {
		dbPath := restoreFixture(t)
		crashAfter = func(step string) bool { return step == "aside" }
		RecoverAndApplyRestore(dbPath)
		crashAfter = nil
		os.Remove(PendingRestorePath(dbPath))
		_, err := RecoverAndApplyRestore(dbPath)
		wantUnsafe(t, err, "")
	})
}

// A clean failure (moves back fine) is an ordinary, recorded error; startup continues.
func TestRestoreCleanFailureIsNotFatal(t *testing.T) {
	dbPath := restoreFixture(t)
	renameFile = func(from, to string) error {
		if from == PendingRestorePath(dbPath) {
			return errors.New("injected")
		}
		return os.Rename(from, to)
	}
	_, err := RecoverAndApplyRestore(dbPath)
	var u *UnsafeStartError
	if err == nil || errors.As(err, &u) {
		t.Fatalf("want an ordinary error, got %v", err)
	}
	if v := configValue(t, dbPath); !strings.Contains(v, "current-in-wal") {
		t.Fatalf("data lost: %q", v)
	}
}

// Recovery outcomes become dismissible, persisted notices.
func TestRecoveryOutcomeNotice(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	bm.RecordRestoreRecovery(OutcomeUndone)
	again := NewBackupManager(dbPath)
	ps := again.Problems()
	if len(ps) != 1 || ps[0].Kind != ProblemRestoreRecovered || !strings.Contains(ps[0].Reason, "undone") {
		t.Fatalf("%+v", ps)
	}
	if !again.DismissProblem(ProblemRestoreRecovered) {
		t.Fatal("not dismissible")
	}
	bm.RecordRestoreRecovery(OutcomeRecoveredApplied)
	if ps := bm.Problems(); len(ps) != 1 || !strings.Contains(ps[0].Reason, "applied") {
		t.Fatalf("%+v", ps)
	}
}

// Fix round 2 items 3 + 4: notices-file problems.
func TestNoticesFileProblems(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	os.MkdirAll(bm.backupDir, 0o755)
	os.WriteFile(filepath.Join(bm.backupDir, noticesFile), []byte("{damaged"), 0o644)
	m := NewBackupManager(dbPath)
	has := func(b *BackupManager, kind string) bool {
		for _, p := range b.Problems() {
			if p.Kind == kind {
				return true
			}
		}
		return false
	}
	if !has(m, ProblemNoticesUnreadable) {
		t.Fatal("damaged notices file not shown")
	}
	// A cleanup that works doesn't clear it.
	if err := m.CleanupOldBackups(); err != nil {
		t.Fatal(err)
	}
	if !has(m, ProblemNoticesUnreadable) {
		t.Fatal("cleared by a cleanup success")
	}
	// A successful save doesn't clear it either: only dismissing does.
	m.RecordRestoreFailure(errors.New("x"))
	if !has(m, ProblemNoticesUnreadable) {
		t.Fatal("cleared by a save; it should stay until dismissed")
	}
	if !m.DismissProblem(ProblemNoticesUnreadable) || has(m, ProblemNoticesUnreadable) {
		t.Fatal("not dismissible")
	}

	// A save that fails is a non-dismissible notice until a save works.
	if os.Geteuid() == 0 {
		t.Skip("root ignores permissions")
	}
	os.Chmod(m.backupDir, 0o555)
	t.Cleanup(func() { os.Chmod(m.backupDir, 0o755) })
	m.RecordRestoreFailure(errors.New("y"))
	if !has(m, ProblemNoticesUnsaved) {
		t.Fatal("failed save not shown")
	}
	if m.DismissProblem(ProblemNoticesUnsaved) {
		t.Fatal("a failed save notice was dismissible")
	}
	os.Chmod(m.backupDir, 0o755)
	m.DismissProblem(ProblemRestoreFailed) // triggers a save (clearing → remove file)
	if has(m, ProblemNoticesUnsaved) {
		t.Fatal("not cleared by the next successful save")
	}
}

// Fix round 3: the journal that couldn't be removed is reported, and removed
// before the next restore is staged.
func TestJournalLeftReportedAndRetriedBeforeNextRestore(t *testing.T) {
	dbPath := restoreFixture(t)
	removeFile = func(p string) error {
		if strings.HasSuffix(p, restoreJournalSuffix) {
			return errors.New("injected")
		}
		return os.Remove(p)
	}
	t.Cleanup(func() { removeFile = os.Remove })
	res, err := RecoverAndApplyRestore(dbPath)
	if err != nil || res.Outcome != OutcomeApplied || !strings.Contains(res.JournalLeft, "injected") {
		t.Fatalf("%+v %v", res, err)
	}
	bm := NewBackupManager(dbPath)
	bm.RecordJournalLeft(res.JournalLeft)
	found := false
	for _, p := range bm.Problems() {
		if p.Kind == ProblemJournalLeft {
			found = true
		}
	}
	if !found || bm.DismissProblem(ProblemJournalLeft) {
		t.Fatal("journal-left notice missing or dismissible")
	}
	// The next restore removes it first (refused while it can't).
	p, err := bm.CreateBackup("manual")
	if err != nil {
		t.Fatal(err)
	}
	if err := bm.RestoreBackup(nil, filepath.Base(p)); err == nil || !strings.Contains(err.Error(), "journal") {
		t.Fatalf("a restore was staged over a journal that can't be removed: %v", err)
	}
	removeFile = os.Remove
	if err := bm.RestoreBackup(nil, filepath.Base(p)); err != nil {
		t.Fatalf("restore after the journal can be removed: %v", err)
	}
	if _, err := os.Stat(dbPath + restoreJournalSuffix); !os.IsNotExist(err) {
		t.Fatal("journal not removed before staging")
	}
	for _, p := range bm.Problems() {
		if p.Kind == ProblemJournalLeft {
			t.Fatal("journal-left notice not cleared")
		}
	}
}

// Fix round 3: on the undone path, a stage that can't be set aside is in the notice detail.
func TestUndoneStageSetAsideFailureInDetail(t *testing.T) {
	dbPath := restoreFixture(t)
	crashAfter = func(step string) bool { return step == "aside" }
	RecoverAndApplyRestore(dbPath)
	crashAfter = nil
	renameFile = func(from, to string) error {
		if strings.HasSuffix(to, FailedRestoreSuffix) {
			return errors.New("injected")
		}
		return os.Rename(from, to)
	}
	res, err := RecoverAndApplyRestore(dbPath)
	if err != nil || res.Outcome != OutcomeUndone || !strings.Contains(res.Detail, "injected") {
		t.Fatalf("%+v %v", res, err)
	}
	if _, err := os.Stat(PendingRestorePath(dbPath)); !os.IsNotExist(err) {
		t.Fatal("undone stage left pending")
	}
	bm := NewBackupManager(dbPath)
	bm.RecordRestoreRecovery(res.Outcome, res.Detail)
	if ps := bm.Problems(); len(ps) != 1 || !strings.Contains(ps[0].Reason, "injected") {
		t.Fatalf("%+v", ps)
	}
}

// Fix round 3: the refuse-to-start steps are tailored to the files present.
func TestUnsafeStartStepsTailored(t *testing.T) {
	dbPath := restoreFixture(t)
	renameFile = func(from, to string) error {
		if from == PendingRestorePath(dbPath) || from == dbPath+preApplySuffix+"-wal" {
			return errors.New("injected")
		}
		return os.Rename(from, to)
	}
	_, err := RecoverAndApplyRestore(dbPath)
	var u *UnsafeStartError
	if !errors.As(err, &u) {
		t.Fatal(err)
	}
	steps := strings.Join(u.Steps, "\n")
	for _, want := range []string{
		"rename " + dbPath + preApplySuffix + "-wal to " + dbPath + "-wal",
		"rename " + PendingRestorePath(dbPath) + " to " + dbPath + FailedRestoreSuffix,
		"delete " + dbPath + restoreJournalSuffix,
		"start HOPS again",
	} {
		if !strings.Contains(steps, want) {
			t.Errorf("missing step %q in:\n%s", want, steps)
		}
	}
	// hops.db was moved back, so it is not a step to rename it; and .pre-apply (main) isn't present.
	if strings.Contains(steps, "rename "+dbPath+preApplySuffix+" to") {
		t.Errorf("step for a file that isn't there:\n%s", steps)
	}
	if !strings.Contains(u.Msg, "Nothing was deleted") {
		t.Error("message doesn't say nothing was deleted")
	}
}
