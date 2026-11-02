package database

import (
	"bytes"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// These tests cover the backup rules that must never fail silently: a restore
// that cannot take its safety backup first is refused, every automatic
// backup failure and every rotation failure is recorded for the UI, and a
// restore is applied only on the next start (never under the open WAL DB).

// unwritableBackups makes the backups dir read-only so creating a backup in
// it fails for real (the test skips when it runs as root, which ignores it).
func unwritableBackups(t *testing.T, bm *BackupManager) {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Skip("root ignores directory permissions")
	}
	if err := os.MkdirAll(bm.backupDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(bm.backupDir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(bm.backupDir, 0o755) })
}

func openDB(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := Initialize(path)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestRestoreRefusedWhenSafetyBackupFails(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	p, err := bm.CreateBackup("manual")
	if err != nil {
		t.Fatal(err)
	}
	name := filepath.Base(p)
	bm.SetFailureHooks(FailureHooks{Create: func(reason string) error {
		if reason == "pre-restore" {
			return errors.New("disk full")
		}
		return nil
	}})
	err = bm.RestoreBackup(nil, name)
	var sbe *SafetyBackupError
	if !errors.As(err, &sbe) {
		t.Fatalf("want a SafetyBackupError, got %v", err)
	}
	if !strings.Contains(err.Error(), "disk full") {
		t.Fatalf("the reason is lost: %v", err)
	}
	if _, err := os.Stat(PendingRestorePath(dbPath)); !os.IsNotExist(err) {
		t.Fatalf("a refused restore staged a pending restore (stat err %v)", err)
	}
	probs := bm.Problems()
	if len(probs) != 1 || probs[0].Kind != ProblemBackupFailed || probs[0].Trigger != "pre-restore" {
		t.Fatalf("the failed safety backup is not recorded: %+v", probs)
	}
}

func TestRestoreRefusedWithUnwritableBackupsDir(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	p, err := bm.CreateBackup("manual")
	if err != nil {
		t.Fatal(err)
	}
	unwritableBackups(t, bm)
	db := openDB(t, dbPath)
	err = bm.RestoreBackup(db, filepath.Base(p))
	var sbe *SafetyBackupError
	if !errors.As(err, &sbe) {
		t.Fatalf("want a SafetyBackupError, got %v", err)
	}
	if _, err := os.Stat(PendingRestorePath(dbPath)); !os.IsNotExist(err) {
		t.Fatalf("a refused restore staged a pending restore")
	}
}

func TestRestoreStagesAndAppliesOnNextStart(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	db := openDB(t, dbPath)
	if _, err := db.Exec(`INSERT OR REPLACE INTO config (id, data) VALUES (1, '{"v":"old"}')`); err != nil {
		t.Fatal(err)
	}
	p, err := bm.CreateBackupWithDB(db, "manual")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE config SET data = '{"v":"new"}' WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
	if err := bm.RestoreBackup(db, filepath.Base(p)); err != nil {
		t.Fatalf("restore: %v", err)
	}
	// Nothing is replaced under the open DB: the live data is unchanged until the restart.
	var v string
	if err := db.QueryRow(`SELECT data FROM config WHERE id = 1`).Scan(&v); err != nil || !strings.Contains(v, "new") {
		t.Fatalf("live DB changed before restart: %q %v", v, err)
	}
	// The safety backup exists.
	list, _ := bm.ListBackups()
	found := false
	for _, b := range list {
		if strings.HasSuffix(b.Name, "_pre-restore.db") {
			found = true
		}
	}
	if !found {
		t.Fatal("no pre-restore safety backup")
	}
	db.Close()

	applied, err := ApplyPendingRestore(dbPath)
	if err != nil || !applied {
		t.Fatalf("apply: %v %v", applied, err)
	}
	if _, err := os.Stat(PendingRestorePath(dbPath)); !os.IsNotExist(err) {
		t.Fatal("pending restore left behind")
	}
	db2 := openDB(t, dbPath)
	if err := db2.QueryRow(`SELECT data FROM config WHERE id = 1`).Scan(&v); err != nil || !strings.Contains(v, "old") {
		t.Fatalf("restore not applied: %q %v", v, err)
	}
}

func TestApplyPendingRestoreNothingPending(t *testing.T) {
	_, dbPath := setupBackupTest(t)
	applied, err := ApplyPendingRestore(dbPath)
	if err != nil || applied {
		t.Fatalf("want (false, nil), got (%v, %v)", applied, err)
	}
}

func TestRestoreRefusesNonHOPSFile(t *testing.T) {
	bm, _ := setupBackupTest(t)
	if err := os.MkdirAll(bm.backupDir, 0o755); err != nil {
		t.Fatal(err)
	}
	name := BackupPrefix + "2026-01-01_00-00-00_manual" + BackupSuffix
	if err := os.WriteFile(filepath.Join(bm.backupDir, name), []byte("not a database"), 0o644); err != nil {
		t.Fatal(err)
	}
	err := bm.RestoreBackup(nil, name)
	var ie *InvalidBackupError
	if !errors.As(err, &ie) {
		t.Fatalf("want InvalidBackupError, got %v", err)
	}
}

func TestBackupNameValidation(t *testing.T) {
	good := []string{
		"hops-backup-2026-01-01_00-00-00_manual.db",
		"hops-backup-2026-01-01_00-00-00-2_pre-config-update.db",
		"hops-backup-2026-01-01_00-00-00_uploaded.db",
	}
	for _, n := range good {
		if err := ValidateBackupName(n); err != nil {
			t.Errorf("%q refused: %v", n, err)
		}
	}
	bad := []string{
		"", "hops.db", "../hops.db", "hops-backup-../../etc/passwd.db", "hops-backup-x/../../y.db",
		"hops-backup-a\\b.db", "/etc/passwd", "hops-backup-..db", "hops-backup-x.db\x00", "hops-backup-x.txt",
		"hops-backup-" + strings.Repeat("a", 300) + ".db", ".hops-backup-x.db", "hops-backup-x .db",
	}
	for _, n := range bad {
		if err := ValidateBackupName(n); err == nil {
			t.Errorf("%q accepted", n)
		}
	}
}

func TestStartupBackupFailureRecordedUntilNextSuccess(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	db := openDB(t, dbPath)
	unwritableBackups(t, bm)
	if _, err := bm.CreateBackupWithDB(db, "startup"); err == nil {
		t.Fatal("backup into a read-only dir succeeded")
	}
	probs := bm.Problems()
	if len(probs) != 1 {
		t.Fatalf("want one problem, got %+v", probs)
	}
	p := probs[0]
	if p.Kind != ProblemBackupFailed || p.Trigger != "startup" || p.Reason == "" || time.Since(p.At) > time.Minute {
		t.Fatalf("problem lacks trigger/reason/time: %+v", p)
	}
	// Still there after another failure (now the newest failure is kept)…
	if _, err := bm.CreateBackupWithDB(db, "pre-config-update"); err == nil {
		t.Fatal("second backup succeeded")
	}
	if probs = bm.Problems(); len(probs) != 1 || probs[0].Trigger != "pre-config-update" {
		t.Fatalf("latest failure not kept: %+v", probs)
	}
	// …and gone after the next successful backup.
	os.Chmod(bm.backupDir, 0o755)
	if _, err := bm.CreateBackupWithDB(db, "manual"); err != nil {
		t.Fatal(err)
	}
	if probs = bm.Problems(); len(probs) != 0 {
		t.Fatalf("problem not cleared by a successful backup: %+v", probs)
	}
}

func TestRotationFailureRecorded(t *testing.T) {
	bm, _ := setupBackupTest(t)
	bm.SetRetention(func() RetentionPolicy { return RetentionPolicy{KeepCount: 3, MaxCount: 100} })
	if err := os.MkdirAll(bm.backupDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		name := filepath.Join(bm.backupDir, BackupPrefix+"2026-01-01_00-00-"+padZero(i)+"_startup"+BackupSuffix)
		if err := os.WriteFile(name, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		mt := time.Now().Add(time.Duration(i) * time.Second)
		os.Chtimes(name, mt, mt)
	}
	bm.SetFailureHooks(FailureHooks{Remove: func(path string) error { return errors.New("read-only file system") }})
	if err := bm.CleanupOldBackups(); err == nil {
		t.Fatal("a rotation that deleted nothing reported success")
	}
	probs := bm.Problems()
	if len(probs) != 1 || probs[0].Kind != ProblemRotationFailed || !strings.Contains(probs[0].Reason, "read-only file system") {
		t.Fatalf("rotation failure not recorded: %+v", probs)
	}
	if !strings.Contains(probs[0].Reason, "_startup.db") {
		t.Fatalf("the problem does not name the backups: %+v", probs[0])
	}
	// A later rotation that works clears it.
	bm.SetFailureHooks(FailureHooks{})
	if err := bm.CleanupOldBackups(); err != nil {
		t.Fatal(err)
	}
	if probs = bm.Problems(); len(probs) != 0 {
		t.Fatalf("not cleared: %+v", probs)
	}
	list, _ := bm.ListBackups()
	if len(list) != 3 {
		t.Fatalf("keep count 3 not applied: %d", len(list))
	}
}

func TestRetentionNormalizedAndProtectedNotCounted(t *testing.T) {
	bm, _ := setupBackupTest(t)
	if got := bm.Retention(); got != DefaultRetention {
		t.Fatalf("default retention %+v", got)
	}
	for _, tc := range []struct{ in, want RetentionPolicy }{
		{RetentionPolicy{0, -5, 0}, RetentionPolicy{MinKeepCount, 0, MinKeepCount}},
		{RetentionPolicy{7, 30, 5}, RetentionPolicy{7, 30, 7}}, // ceiling never below keep
		{RetentionPolicy{1000, 99999, 99999}, RetentionPolicy{MaxKeepCount, MaxKeepDays, MaxMaxCount}},
	} {
		in := tc.in
		bm.SetRetention(func() RetentionPolicy { return in })
		if got := bm.Retention(); got != tc.want {
			t.Errorf("%+v: got %+v want %+v", tc.in, got, tc.want)
		}
	}
	bm.SetRetention(func() RetentionPolicy { return RetentionPolicy{KeepCount: 3, MaxCount: 3} })
	os.MkdirAll(bm.backupDir, 0o755)
	old := time.Now().Add(-time.Hour)
	for _, reason := range []string{PreV3MigrationReason, "manual", UploadedReason} {
		p := filepath.Join(bm.backupDir, BackupPrefix+"2025-01-01_00-00-00_"+reason+BackupSuffix)
		os.WriteFile(p, []byte("x"), 0o644)
		os.Chtimes(p, old, old)
	}
	for i := 0; i < 5; i++ {
		name := filepath.Join(bm.backupDir, BackupPrefix+"2026-01-01_00-00-"+padZero(i)+"_startup"+BackupSuffix)
		os.WriteFile(name, []byte("x"), 0o644)
		mt := time.Now().Add(time.Duration(i) * time.Second)
		os.Chtimes(name, mt, mt)
	}
	if err := bm.CleanupOldBackups(); err != nil {
		t.Fatal(err)
	}
	list, _ := bm.ListBackups()
	if len(list) != 6 {
		t.Fatalf("want 3 newest + 3 protected, got %d", len(list))
	}
	for _, b := range list {
		if b.Protected != IsProtectedBackup(b.Name) {
			t.Fatalf("%s protected flag wrong", b.Name)
		}
	}
}

func TestValidateHOPSDatabase(t *testing.T) {
	_, dbPath := setupBackupTest(t)
	if err := ValidateHOPSDatabase(dbPath); err != nil {
		t.Fatalf("a real HOPS DB refused: %v", err)
	}
	dir := t.TempDir()
	text := filepath.Join(dir, "x.db")
	os.WriteFile(text, []byte("hello, this is not sqlite at all, just text"), 0o644)
	if err := ValidateHOPSDatabase(text); err == nil || !strings.Contains(err.Error(), "not a SQLite") {
		t.Fatalf("text file: %v", err)
	}
	other := filepath.Join(dir, "other.db")
	odb, err := sql.Open("sqlite", other)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := odb.Exec(`CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)`); err != nil {
		t.Fatal(err)
	}
	odb.Close()
	if err := ValidateHOPSDatabase(other); err == nil || !strings.Contains(err.Error(), "not a HOPS") {
		t.Fatalf("non-HOPS SQLite: %v", err)
	}
	// Validation never writes: the checked file is unchanged and no journal appears.
	st, _ := os.Stat(other)
	ValidateHOPSDatabase(other)
	st2, _ := os.Stat(other)
	if st.ModTime() != st2.ModTime() || st.Size() != st2.Size() {
		t.Fatal("validation modified the file")
	}
}

func TestManualReasonSanitised(t *testing.T) {
	for in, want := range map[string]string{
		"":                 "manual",
		"manual":           "manual",
		"My Reason/../x":   "my-reason----x",
		"pre-v3-migration": "",
		"uploaded":         "",
	} {
		got, err := SanitizeManualReason(in)
		if want == "" {
			if err == nil {
				t.Errorf("%q: reserved reason accepted as %q", in, got)
			}
			continue
		}
		if err != nil || got != want {
			t.Errorf("%q: got %q %v, want %q", in, got, err, want)
		}
	}
}

// storeDoc replaces the config row of the database at path.
func storeDoc(t *testing.T, path, doc string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT OR REPLACE INTO config (id, data) VALUES (1, ?)`, doc); err != nil {
		t.Fatal(err)
	}
}

const wholeV3 = `{"schemaVersion":3,"dashboards":[{"id":"a","path":"/a","tabs":[]}]}`

// A backup goes through the same whole-dashboard check as a write: restored, an
// index entry would block every read of the whole document. Old backups stay
// restorable: a v2 dashboard may have no tabs (the converter gives it an empty list).
func TestValidateHOPSDatabase_WholeDashboards(t *testing.T) {
	cases := []struct{ name, doc, want string }{
		{"v3 whole", wholeV3, ""},
		{"v2 with tabs", `{"dashboards":[{"id":"a","path":"/a","tabs":[]}]}`, ""},
		{"v2 no tabs", `{"dashboards":[{"id":"a","path":"/a"}]}`, ""},
		{"v2 null tabs", `{"dashboards":[{"id":"a","path":"/a","tabs":null}]}`, ""},
		{"v2 no dashboards", `{}`, ""},
		{"v3 partial", `{"schemaVersion":3,"dashboards":[{"id":"a","path":"/a","tabs":[]},{"id":"b","path":"/b","partial":true}]}`, `dashboard "b"`},
		{"v3 partial with tabs", `{"schemaVersion":3,"dashboards":[{"id":"c","path":"/c","tabs":[],"partial":false}]}`, `dashboard "c"`},
		{"v3 no tabs", `{"schemaVersion":3,"dashboards":[{"id":"d","path":"/d"}]}`, `dashboard "d"`},
		{"v3 not an object", `{"schemaVersion":3,"dashboards":["x"]}`, "not a dashboard"},
		{"v2 partial", `{"dashboards":[{"id":"e","path":"/e","partial":true}]}`, `dashboard "e"`},
		{"not json", `{nope`, "cannot be read"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, dbPath := setupBackupTest(t)
			storeDoc(t, dbPath, c.doc)
			err := ValidateHOPSDatabase(dbPath)
			if c.want == "" {
				if err != nil {
					t.Fatalf("refused: %v", err)
				}
				return
			}
			var ibe *InvalidBackupError
			if !errors.As(err, &ibe) || !strings.Contains(ibe.Reason, c.want) {
				t.Fatalf("got %v, want an InvalidBackupError naming %q", err, c.want)
			}
		})
	}
}

// No config row at all is left to start-up, as before: there is no document to check.
func TestValidateHOPSDatabase_NoConfigRow(t *testing.T) {
	_, dbPath := setupBackupTest(t)
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`DELETE FROM config`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if err := ValidateHOPSDatabase(dbPath); err != nil {
		t.Fatalf("refused: %v", err)
	}
}

// A backup holding a partial dashboard is refused at restore with nothing changed:
// no stage, no safety backup, and the live document as it was.
func TestRestoreRefusesPartialDashboard_LiveUntouched(t *testing.T) {
	bm, dbPath := setupBackupTest(t)
	storeDoc(t, dbPath, wholeV3)
	name, err := func() (string, error) {
		p, err := bm.CreateBackup("manual")
		return filepath.Base(p), err
	}()
	if err != nil {
		t.Fatal(err)
	}
	storeDoc(t, filepath.Join(bm.backupDir, name), `{"schemaVersion":3,"dashboards":[{"id":"a","path":"/a","partial":true}]}`)
	before, err := os.ReadFile(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	backups, _ := bm.ListBackups()

	err = bm.RestoreBackup(nil, name)
	var ibe *InvalidBackupError
	if !errors.As(err, &ibe) {
		t.Fatalf("got %v, want an InvalidBackupError", err)
	}
	for _, leftover := range []string{PendingRestorePath(dbPath), PendingRestorePath(dbPath) + ".tmp"} {
		if _, err := os.Stat(leftover); !os.IsNotExist(err) {
			t.Fatalf("%s left behind: %v", leftover, err)
		}
	}
	if bm.PendingRestore() {
		t.Fatal("a refused restore is staged")
	}
	after, err := os.ReadFile(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("the live database changed")
	}
	if now, _ := bm.ListBackups(); len(now) != len(backups) {
		t.Fatalf("backups went from %d to %d: a safety backup ran for a refused restore", len(backups), len(now))
	}
}

// One staged by an older build is caught at start-up: set aside, the live database stays.
func TestStagedPartialDashboardIsSetAside(t *testing.T) {
	_, dbPath := setupBackupTest(t)
	storeDoc(t, dbPath, wholeV3)
	before, err := os.ReadFile(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(PendingRestorePath(dbPath), before, 0o600); err != nil {
		t.Fatal(err)
	}
	storeDoc(t, PendingRestorePath(dbPath), `{"schemaVersion":3,"dashboards":[{"id":"a","path":"/a","partial":true}]}`)

	_, err = RecoverAndApplyRestore(dbPath)
	if err == nil || !strings.Contains(err.Error(), "marked partial") {
		t.Fatalf("got %v", err)
	}
	after, err := os.ReadFile(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("the live database changed")
	}
	if _, err := os.Stat(dbPath + FailedRestoreSuffix); err != nil {
		t.Fatalf("not set aside: %v", err)
	}
}
