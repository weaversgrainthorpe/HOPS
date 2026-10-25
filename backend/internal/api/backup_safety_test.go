package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/database"
)

// Backups never fail silently: a restore or factory reset that cannot take
// its safety backup first is refused with a reason the UI shows; a failed
// automatic backup (startup, before a save) and a rotation that cannot
// delete old backups become a visible admin notice, until fixed.

// backupsOf creates a backup and returns the router's backups dir and its
// (shared) manager, for injecting failures.
func backupsOf(t *testing.T, c *apiClient) (string, *database.BackupManager, string) {
	t.Helper()
	code, resp := c.do("POST", "/api/backups", map[string]string{"reason": "manual"})
	if code != 200 {
		t.Fatalf("create backup: %d %v", code, resp)
	}
	p, _ := resp["path"].(string)
	dir := filepath.Dir(p)
	bm := database.SharedBackupManager(filepath.Join(filepath.Dir(dir), "hops.db"))
	t.Cleanup(func() { bm.SetFailureHooks(database.FailureHooks{}) })
	return dir, bm, filepath.Base(p)
}

func failReason(reason string) database.FailureHooks {
	return database.FailureHooks{Create: func(r string) error {
		if r == reason {
			return errors.New("simulated disk full")
		}
		return nil
	}}
}

func backupNotice(t *testing.T, c *apiClient) map[string]interface{} {
	t.Helper()
	for _, n := range noticesOf(t, getView(t, c)) {
		if id, _ := n["id"].(string); strings.HasPrefix(id, "backup-") {
			return n
		}
	}
	return nil
}

func TestRestoreRefusedWithoutSafetyBackup(t *testing.T) {
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	_, bm, name := backupsOf(t, c)
	bm.SetFailureHooks(failReason("pre-restore"))

	code, resp := c.do("POST", "/api/backups/"+name, nil)
	if code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d %v", code, resp)
	}
	msg, _ := resp["error"].(string)
	if !strings.HasPrefix(msg, "Couldn't take a safety backup first, so nothing was restored: ") || !strings.Contains(msg, "simulated disk full") {
		t.Fatalf("message: %q", msg)
	}
	if _, err := os.Stat(database.PendingRestorePath(filepath.Join(filepath.Dir(filepath.Dir(bmDir(t, c))), "hops.db"))); !os.IsNotExist(err) {
		t.Fatal("a refused restore was staged")
	}
	// The failed safety backup is also a visible admin notice.
	n := backupNotice(t, c)
	if n == nil || !strings.Contains(n["text"].(string), "nothing was restored") || n["sticky"] != true {
		t.Fatalf("no sticky notice for the failed safety backup: %v", n)
	}
}

func bmDir(t *testing.T, c *apiClient) string {
	t.Helper()
	_, resp := c.do("GET", "/api/backups", nil)
	l, _ := resp["backups"].([]interface{})
	if len(l) == 0 {
		t.Fatal("no backups")
	}
	return l[0].(map[string]interface{})["path"].(string)
}

func TestRestoreRefusedWithUnwritableBackupsDir(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores directory permissions")
	}
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	dir, _, name := backupsOf(t, c)
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(dir, 0o755) })
	code, resp := c.do("POST", "/api/backups/"+name, nil)
	msg, _ := resp["error"].(string)
	if code != 500 || !strings.HasPrefix(msg, "Couldn't take a safety backup first, so nothing was restored") {
		t.Fatalf("got %d %q", code, msg)
	}
}

func TestRestoreStagesAndRequestsRestart(t *testing.T) {
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	dir, _, name := backupsOf(t, c)
	code, resp := c.do("POST", "/api/backups/"+name, nil)
	if code != 200 || resp["restarting"] != true {
		t.Fatalf("restore: %d %v", code, resp)
	}
	if _, err := os.Stat(database.PendingRestorePath(filepath.Join(filepath.Dir(dir), "hops.db"))); err != nil {
		t.Fatalf("restore not staged: %v", err)
	}
}

func TestRestoreRefusesNonHOPSBackup(t *testing.T) {
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	dir, _, _ := backupsOf(t, c)
	bad := "hops-backup-2026-01-01_00-00-00_manual.db"
	if err := os.WriteFile(filepath.Join(dir, bad), []byte("plain text, not sqlite"), 0o644); err != nil {
		t.Fatal(err)
	}
	code, resp := c.do("POST", "/api/backups/"+bad, nil)
	msg, _ := resp["error"].(string)
	if code != http.StatusUnprocessableEntity || !strings.Contains(msg, "not a SQLite database") || !strings.Contains(msg, "nothing was restored") {
		t.Fatalf("got %d %q", code, msg)
	}
}

func TestBackupNamesValidatedOnRestoreAndDelete(t *testing.T) {
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	backupsOf(t, c)
	for _, p := range []string{
		"/api/backups/hops.db",
		"/api/backups/..%2Fhops.db",
		"/api/backups/hops-backup-x%2F..%2F..%2Fhops.db",
		"/api/backups/hops-backup-..%5C..%5Cx.db",
		"/api/backups/.hops-backup-x.db",
	} {
		for _, m := range []string{"POST", "DELETE"} {
			code, resp := c.do(m, p, nil)
			if code != 400 && code != 404 && code != 301 {
				t.Errorf("%s %s: %d %v", m, p, code, resp)
			}
			if code == 200 {
				t.Errorf("%s %s accepted", m, p)
			}
		}
	}
	code, _ := c.do("POST", "/api/backups/hops-backup-2099-01-01_00-00-00_none.db", nil)
	if code != 404 {
		t.Errorf("missing backup: %d", code)
	}
}

func TestFactoryResetRefusedWithoutSafetyBackup(t *testing.T) {
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	_, bm, _ := backupsOf(t, c)
	before := storedRaw(db)
	bm.SetFailureHooks(failReason("pre-factory-reset"))
	code, resp := c.do("POST", "/api/config/reset", nil)
	msg, _ := resp["error"].(string)
	if code != 500 || !strings.HasPrefix(msg, "Couldn't take a safety backup first, so nothing was reset: ") || !strings.Contains(msg, "simulated disk full") {
		t.Fatalf("got %d %q", code, msg)
	}
	if storedRaw(db) != before {
		t.Fatal("the config was reset without a safety backup")
	}
	bm.SetFailureHooks(database.FailureHooks{})
	if code, resp := c.do("POST", "/api/config/reset", nil); code != 200 {
		t.Fatalf("reset with a working backup: %d %v", code, resp)
	}
}

func TestStartupBackupFailureNotice(t *testing.T) {
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	_, bm, _ := backupsOf(t, c)
	bm.SetFailureHooks(failReason("startup"))
	if _, err := bm.CreateBackupWithDB(db, "startup"); err == nil {
		t.Fatal("startup backup did not fail")
	}
	n := backupNotice(t, c)
	if n == nil {
		t.Fatal("no notice for the failed startup backup")
	}
	text, _ := n["text"].(string)
	if !strings.Contains(text, "when HOPS started") || !strings.Contains(text, "simulated disk full") || n["level"] != "warning" || n["sticky"] != true {
		t.Fatalf("notice lacks what/why/level: %v", n)
	}
	// It carries the time.
	if !strings.Contains(text, " at ") {
		t.Fatalf("notice has no time: %q", text)
	}
	// Never shown to a signed-out viewer (GET /api/config is public).
	req := httptest.NewRequest("GET", "/api/config", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if strings.Contains(w.Body.String(), "simulated disk full") {
		t.Fatal("the backup notice leaked to an anonymous viewer")
	}
	// It cannot be dismissed (it stays until a backup succeeds)…
	id := n["id"].(string)
	if code, _ := c.do("POST", "/api/notices/"+id+"/dismiss", nil); code == 200 {
		t.Fatal("a backup-failure notice was dismissed")
	}
	if backupNotice(t, c) == nil {
		t.Fatal("notice gone without a successful backup")
	}
	// …and goes once one does.
	bm.SetFailureHooks(database.FailureHooks{})
	if code, resp := c.do("POST", "/api/backups", map[string]string{"reason": "manual"}); code != 200 {
		t.Fatalf("%d %v", code, resp)
	}
	if n := backupNotice(t, c); n != nil {
		t.Fatalf("notice stayed after a successful backup: %v", n)
	}
}

func TestRotationFailureNotice(t *testing.T) {
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	dir, bm, _ := backupsOf(t, c)
	for i := 0; i < 12; i++ {
		os.WriteFile(filepath.Join(dir, "hops-backup-2020-01-01_00-00-"+twoDigits(i)+"_old.db"), []byte("x"), 0o644)
	}
	bm.SetFailureHooks(database.FailureHooks{Remove: func(string) error { return errors.New("read-only file system") }})
	if code, resp := c.do("POST", "/api/backups", map[string]string{"reason": "manual"}); code != 200 {
		t.Fatalf("%d %v", code, resp)
	}
	n := backupNotice(t, c)
	if n == nil || !strings.Contains(n["text"].(string), "couldn't delete old backups") || !strings.Contains(n["text"].(string), "read-only file system") {
		t.Fatalf("no rotation notice: %v", n)
	}
	// The list carries the problem too, for the Backups dialog.
	_, resp := c.do("GET", "/api/backups", nil)
	if probs, _ := resp["problems"].([]interface{}); len(probs) == 0 {
		t.Fatalf("GET /api/backups has no problems: %v", resp["problems"])
	}
}

func twoDigits(i int) string {
	return string(rune('0'+i/10)) + string(rune('0'+i%10))
}

func TestPreUpdateBackupFailureStillSavesAndWarns(t *testing.T) {
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	_, bm, _ := backupsOf(t, c)
	bm.SetFailureHooks(failReason("pre-config-update"))
	code, resp := v3Put(c, "d1", v3Body(t, c, "d1"), 1)
	if code != 200 {
		t.Fatalf("save blocked by a failed backup: %d %v", code, resp)
	}
	if w, _ := resp["warning"].(string); !strings.Contains(w, "simulated disk full") {
		t.Fatalf("no warning in the response: %v", resp)
	}
	if n := backupNotice(t, c); n == nil || !strings.Contains(n["text"].(string), "saved anyway") {
		t.Fatalf("no notice for the failed pre-save backup: %v", n)
	}
}

func TestManualBackupReasonSanitisedAndReservedRefused(t *testing.T) {
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	code, resp := c.do("POST", "/api/backups", map[string]string{"reason": "pre-v3-migration"})
	if code != 400 {
		t.Fatalf("reserved reason: %d %v", code, resp)
	}
	code, resp = c.do("POST", "/api/backups", map[string]string{"reason": "../../x y"})
	if code != 200 {
		t.Fatalf("%d %v", code, resp)
	}
	if p, _ := resp["path"].(string); !strings.HasSuffix(p, "_------x-y.db") {
		t.Fatalf("reason not sanitised: %q", p)
	}
}
