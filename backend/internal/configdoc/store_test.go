package configdoc

import (
	"database/sql"
	"errors"
	"os"
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
		`CREATE TABLE config_archive (id INTEGER PRIMARY KEY AUTOINCREMENT, schema INTEGER NOT NULL, data TEXT NOT NULL, archived_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
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
	bad := `{"dashboards":[{"id":"d1","name":"D","tabs":[{"id":"t1","name":"T","groups":[` +
		`{"id":"g1","name":"G","entries":[{"id":"dupID","name":"A"},{"id":"dupID","name":"B"}]}]}]}]}`
	seed(t, db, bad)

	res, err := MigrateOnStartup(db)
	if err != nil {
		t.Fatalf("bad document must not yield a Go error: %v", err)
	}
	if !res.Failed || res.Migrated {
		t.Fatalf("result = %+v, want Failed", res)
	}
	if !strings.Contains(res.Detail, "dupID") {
		t.Fatalf("Detail %q does not mention the duplicate ID", res.Detail)
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
