package configdoc

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func newStoreDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	for _, q := range []string{
		`CREATE TABLE config (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE config_archive (id INTEGER PRIMARY KEY AUTOINCREMENT, schema INTEGER NOT NULL, data TEXT NOT NULL, archived_at DATETIME DEFAULT CURRENT_TIMESTAMP, notes TEXT)`,
		`CREATE TABLE status_cache (entry_id TEXT PRIMARY KEY, status TEXT NOT NULL, response_time INTEGER, last_checked DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE armed_notices (id TEXT PRIMARY KEY, armed_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE dismissed_notices (id TEXT PRIMARY KEY, dismissed_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func seed(t *testing.T, db *sql.DB, data string) {
	t.Helper()
	if _, err := db.Exec(`INSERT OR REPLACE INTO config (id, data) VALUES (1, ?)`, data); err != nil {
		t.Fatal(err)
	}
}

func rawRow(t *testing.T, db *sql.DB) string {
	t.Helper()
	var s string
	if err := db.QueryRow(`SELECT data FROM config WHERE id = 1`).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func archiveCount(t *testing.T, db *sql.DB) int {
	t.Helper()
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM config_archive`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func v2Bytes(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("testdata/v2_basic.json")
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestMigrateOnStartup_V2(t *testing.T) {
	db := newStoreDB(t)
	orig := v2Bytes(t)
	seed(t, db, orig)

	res, err := MigrateOnStartup(db)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Migrated || res.Failed {
		t.Fatalf("result = %+v, want Migrated", res)
	}
	if _, err := Load(db); err != nil {
		t.Fatalf("row not v3 after migration: %v", err)
	}
	var schema int
	var data string
	if err := db.QueryRow(`SELECT schema, data FROM config_archive`).Scan(&schema, &data); err != nil {
		t.Fatalf("expected exactly one archive row: %v", err)
	}
	if schema != 2 || data != orig {
		t.Fatalf("archive schema=%d, data equal=%v", schema, data == orig)
	}
	if n := archiveCount(t, db); n != 1 {
		t.Fatalf("archive rows = %d, want 1", n)
	}
}

func TestMigrateOnStartup_AlreadyV3(t *testing.T) {
	db := newStoreDB(t)
	if err := Save(db, Obj{"dashboards": []any{}}); err != nil {
		t.Fatal(err)
	}
	before := rawRow(t, db)
	res, err := MigrateOnStartup(db)
	if err != nil {
		t.Fatal(err)
	}
	if res.Migrated || res.Failed {
		t.Fatalf("result = %+v, want no-op", res)
	}
	if archiveCount(t, db) != 0 || rawRow(t, db) != before {
		t.Fatal("no-op migration changed state")
	}
}

func TestMigrateOnStartup_VerifyFailureWritesNothing(t *testing.T) {
	db := newStoreDB(t)
	// Duplicate ids are now renamed, so use an id Verify must reject: an
	// entry whose id is not a string converts but cannot be verified.
	bad := `{"dashboards":[{"id":"d1","name":"D","tabs":[{"id":"t1","name":"T","groups":[` +
		`{"id":"g1","name":"G","entries":[{"id":"ok","name":"A"},{"id":7,"name":"B"}]}]}]}]}`
	seed(t, db, bad)

	res, err := MigrateOnStartup(db)
	if err != nil {
		t.Fatalf("bad document must not yield a Go error: %v", err)
	}
	if !res.Failed || res.Migrated {
		t.Fatalf("result = %+v, want Failed", res)
	}
	if !strings.Contains(res.Detail, "verification failed") || !strings.Contains(res.Detail, "want non-empty string") {
		t.Fatalf("Detail %q does not describe the bad id", res.Detail)
	}
	if rawRow(t, db) != bad {
		t.Fatal("stored row was modified")
	}
	if n := archiveCount(t, db); n != 0 {
		t.Fatalf("archive rows = %d, want 0 (rolled back)", n)
	}
}

func TestMigrateOnStartup_InvalidJSONFails(t *testing.T) {
	db := newStoreDB(t)
	seed(t, db, `{not json`)
	res, err := MigrateOnStartup(db)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Failed || res.Detail == "" {
		t.Fatalf("result = %+v, want Failed with detail", res)
	}
	if rawRow(t, db) != `{not json` || archiveCount(t, db) != 0 {
		t.Fatal("state changed on failure")
	}
}

func TestMigrateOnStartup_V2RestoredOverV3Archive(t *testing.T) {
	db := newStoreDB(t)
	orig := v2Bytes(t)
	seed(t, db, orig)
	if res, err := MigrateOnStartup(db); err != nil || !res.Migrated {
		t.Fatalf("first migrate: %+v %v", res, err)
	}
	seed(t, db, orig) // simulate a backup restore of v2 bytes
	res, err := MigrateOnStartup(db)
	if err != nil || !res.Migrated {
		t.Fatalf("second migrate: %+v %v", res, err)
	}
	if n := archiveCount(t, db); n != 2 {
		t.Fatalf("archive rows = %d, want 2", n)
	}
}

func TestMigrateOnStartup_NoRowIsDBError(t *testing.T) {
	db := newStoreDB(t)
	if _, err := MigrateOnStartup(db); err == nil {
		t.Fatal("missing config row must be returned as an error")
	}
}

func TestLoad_RejectsV2(t *testing.T) {
	db := newStoreDB(t)
	seed(t, db, v2Bytes(t))
	if _, err := Load(db); !errors.Is(err, ErrNotV3) {
		t.Fatalf("err = %v, want ErrNotV3", err)
	}
}

func TestSaveLoad_RoundTrip(t *testing.T) {
	db := newStoreDB(t)
	if err := Save(db, Obj{"dashboards": []any{}, "x": "y"}); err != nil {
		t.Fatal(err)
	}
	doc, err := Load(db)
	if err != nil {
		t.Fatal(err)
	}
	if doc["x"] != "y" {
		t.Fatalf("doc = %v", doc)
	}
}

func TestMigrateWithBackup_V2BacksUpFirst(t *testing.T) {
	db := newStoreDB(t)
	seed(t, db, v2Bytes(t))
	var sawV2 bool
	res, backedUp, err := MigrateWithBackup(db, func() error {
		_, lerr := Load(db)
		sawV2 = errors.Is(lerr, ErrNotV3) // backup must see pre-migration data
		return nil
	})
	if err != nil || !res.Migrated || !backedUp || !sawV2 {
		t.Fatalf("res=%+v backedUp=%v sawV2=%v err=%v", res, backedUp, sawV2, err)
	}
}

func TestMigrateWithBackup_BackupFailureBlocksMigration(t *testing.T) {
	db := newStoreDB(t)
	orig := v2Bytes(t)
	seed(t, db, orig)
	res, backedUp, err := MigrateWithBackup(db, func() error { return errors.New("disk full") })
	if err != nil {
		t.Fatal(err)
	}
	// Kind "backup" makes the page say no copy was saved (it must never claim one was).
	if !res.Failed || backedUp || res.Kind != MigrationFailBackup || !strings.Contains(res.Detail, "backup") || !strings.Contains(res.Detail, "disk full") {
		t.Fatalf("res=%+v backedUp=%v", res, backedUp)
	}
	if rawRow(t, db) != orig || archiveCount(t, db) != 0 {
		t.Fatal("state changed despite backup failure")
	}
}

func TestMigrateWithBackup_V3NoSyncBackup(t *testing.T) {
	db := newStoreDB(t)
	if err := Save(db, Obj{LayoutVersionKey: LayoutVersion, "dashboards": []any{}}); err != nil {
		t.Fatal(err)
	}
	called := false
	res, backedUp, err := MigrateWithBackup(db, func() error { called = true; return nil })
	if err != nil || called || backedUp || res.Migrated || res.Failed {
		t.Fatalf("res=%+v called=%v backedUp=%v err=%v", res, called, backedUp, err)
	}
}

func TestMigrateOnStartup_RenamesDuplicateIDs(t *testing.T) {
	db := newStoreDB(t)
	b, err := os.ReadFile("testdata/v2_dup_ids.json")
	if err != nil {
		t.Fatal(err)
	}
	orig := string(b)
	seed(t, db, orig)

	res, err := MigrateOnStartup(db)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Migrated || res.Failed {
		t.Fatalf("result = %+v, want Migrated", res)
	}
	want := []Rename{
		{Path: "dashboards[1].tabs[0]", Kind: "tab", DashboardID: "heimdall", OldID: "main", NewID: "main-heimdall"},
		{Path: "dashboards[1].tabs[0].groups[0]", Kind: "folder", DashboardID: "heimdall", OldID: "services", NewID: "services-heimdall"},
	}
	if !reflect.DeepEqual(res.Renames, want) {
		t.Fatalf("Renames = %+v", res.Renames)
	}
	doc, err := Load(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyIDs(doc); err != nil {
		t.Fatalf("stored doc: %v", err)
	}
	var data string
	var notes sql.NullString
	if err := db.QueryRow(`SELECT data, notes FROM config_archive`).Scan(&data, &notes); err != nil {
		t.Fatal(err)
	}
	if data != orig {
		t.Fatal("archive does not hold the original bytes")
	}
	if !notes.Valid {
		t.Fatal("archive notes is NULL, want the renames as JSON")
	}
	var got []Rename
	if err := json.Unmarshal([]byte(notes.String), &got); err != nil {
		t.Fatalf("notes %q: %v", notes.String, err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("notes = %+v", got)
	}
}

func TestMigrateOnStartup_NoRenamesLeavesNotesNull(t *testing.T) {
	db := newStoreDB(t)
	seed(t, db, v2Bytes(t))
	res, err := MigrateOnStartup(db)
	if err != nil || !res.Migrated || len(res.Renames) != 0 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	var notes sql.NullString
	if err := db.QueryRow(`SELECT notes FROM config_archive`).Scan(&notes); err != nil {
		t.Fatal(err)
	}
	if notes.Valid {
		t.Fatalf("notes = %q, want NULL", notes.String)
	}
}

// A cached status for a duplicated tile id may belong to either tile, so the
// migration drops it (and any row under the new id); the next check refills.
func TestMigrateOnStartup_DropsAmbiguousStatusRows(t *testing.T) {
	db := newStoreDB(t)
	seed(t, db, `{"dashboards":[`+
		`{"id":"a","tabs":[{"id":"ta","groups":[{"id":"ga","entries":[{"id":"plex","name":"P1"},{"id":"keep","name":"K"}]}]}]},`+
		`{"id":"b","tabs":[{"id":"tb","groups":[{"id":"gb","entries":[{"id":"plex","name":"P2"}]}]}]}]}`)
	for _, id := range []string{"plex", "plex-b", "keep"} {
		if _, err := db.Exec(`INSERT INTO status_cache (entry_id, status) VALUES (?, 'up')`, id); err != nil {
			t.Fatal(err)
		}
	}
	res, err := MigrateOnStartup(db)
	if err != nil || !res.Migrated {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	rows, err := db.Query(`SELECT entry_id FROM status_cache ORDER BY entry_id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var left []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		left = append(left, id)
	}
	if !reflect.DeepEqual(left, []string{"keep"}) {
		t.Fatalf("status_cache rows = %v, want [keep]", left)
	}
}
