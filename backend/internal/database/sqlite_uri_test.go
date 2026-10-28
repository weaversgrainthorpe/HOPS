package database

import "testing"

// Found in rc2 trial F: on Windows every backup failed with "out of memory",
// because C:\… became file://C:%5C… and SQLite couldn't open it.
func TestSqliteURI(t *testing.T) {
	cases := []struct{ in, want string }{
		{"/home/x/data/hops.db", "file:///home/x/data/hops.db?mode=ro"},
		{"C:/Temp/data/backups/hops-backup.db", "file:///C:/Temp/data/backups/hops-backup.db?mode=ro"},
		{"C:/My Data/a#b.db", "file:///C:/My%20Data/a%23b.db?mode=ro"},
	}
	for _, c := range cases {
		if got := sqliteURI(c.in, "mode=ro"); got != c.want {
			t.Errorf("sqliteURI(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
