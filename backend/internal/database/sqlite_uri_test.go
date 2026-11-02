package database

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

// Found on Windows: every backup failed with "out of memory",
// because C:\… became file://C:%5C… and SQLite couldn't open it.
func TestSqliteURI(t *testing.T) {
	cases := []struct{ in, want string }{
		{"/home/x/data/hops.db", "file:///home/x/data/hops.db?mode=ro"},
		{"C:/Temp/data/backups/hops-backup.db", "file:///C:/Temp/data/backups/hops-backup.db?mode=ro"},
		{"C:/My Data/a#b.db", "file:///C:/My%20Data/a%23b.db?mode=ro"},
		{"/home/x/a?b/hops.db", "file:///home/x/a%3Fb/hops.db?mode=ro"},
		{"/home/x/100%/hops.db", "file:///home/x/100%25/hops.db?mode=ro"},
		// A network share. \\server\share\… reaches sqliteURI through filepath.ToSlash as //server/share/….
		{"//server/share/data/hops.db", "file:////server/share/data/hops.db?mode=ro"},
		{"//nas.local/my share/a#b/hops.db", "file:////nas.local/my%20share/a%23b/hops.db?mode=ro"},
	}
	for _, c := range cases {
		if got := sqliteURI(c.in, "mode=ro"); got != c.want {
			t.Errorf("sqliteURI(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// SQLite reads what follows "file://" up to the next slash as an authority and
// refuses any but "" and "localhost". So a share must keep its host in the
// path: file:////server/share/x.db (empty authority, path //server/share/x.db),
// never file://server/share/x.db. This runs SQLite's own URI parser; Linux
// treats the leading // as /, so the file is really opened and created.
func TestSqliteURI_ShareFormPassesSQLitesParser(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "my share#1")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "hops.db")
	db, err := sql.Open("sqlite", sqliteURI("/"+filepath.ToSlash(path), "mode=rwc"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec("CREATE TABLE t (id INTEGER)"); err != nil {
		t.Fatalf("the share form did not open: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("not created where the path says: %v", err)
	}

	bad, err := sql.Open("sqlite", "file://server/share/hops.db?mode=rwc")
	if err != nil {
		t.Fatal(err)
	}
	defer bad.Close()
	if err := bad.Ping(); err == nil {
		t.Fatal("the form that keeps the host as an authority should be refused")
	}
}
