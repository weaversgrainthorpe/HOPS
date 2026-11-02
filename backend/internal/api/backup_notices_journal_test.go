package api

import (
	"strings"
	"testing"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/database"
)

func TestBackupProblemNotice_JournalMode(t *testing.T) {
	n := backupProblemNotice(database.BackupProblem{Kind: database.ProblemJournalMode, At: time.Now(),
		Reason: "the database is using journal mode \"delete\" instead of WAL (data folder /x)"})
	if n.Level != "warning" || !n.Sticky {
		t.Errorf("want a sticky warning, got %+v", n)
	}
	if !strings.Contains(n.Text, "delete") || strings.HasPrefix(n.Text, "A backup problem") {
		t.Errorf("text should be its own wording naming the mode: %q", n.Text)
	}
}
