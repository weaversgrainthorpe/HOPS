package database

import (
	"strings"
	"testing"
)

func TestJournalModeWarning(t *testing.T) {
	if got := journalModeWarning("wal", "/data/hops.db"); got != "" {
		t.Errorf("wal: got %q, want no warning", got)
	}
	if got := journalModeWarning("WAL", "/data/hops.db"); got != "" {
		t.Errorf("WAL (any case): got %q, want no warning", got)
	}
	got := journalModeWarning("delete", "/data/hops.db")
	if got == "" {
		t.Fatal("delete: want a warning")
	}
	if !strings.Contains(got, "delete") || !strings.Contains(got, "/data") {
		t.Errorf("warning must name the mode and the data folder: %q", got)
	}
	if got := journalModeWarning("", "/data/hops.db"); got == "" {
		t.Error("an unreadable (empty) mode must warn too")
	}
}

func TestInitialize_RecordsNoProblemInWAL(t *testing.T) {
	path := t.TempDir() + "/hops.db"
	db, err := Initialize(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, p := range SharedBackupManager(path).Problems() {
		if p.Kind == ProblemJournalMode {
			t.Errorf("unexpected journal-mode problem on a normal folder: %+v", p)
		}
	}
}
