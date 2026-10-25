package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/database"
)

// Download, upload, retention settings and "Clean up now" (M6 §11 and the
// backups additions). All admin-only; POSTs need CSRF.

func (c *apiClient) rawReq(method, path string, body []byte, contentType string) *httptest.ResponseRecorder {
	c.t.Helper()
	req := authedRequest(method, path, bytes.NewReader(body), c.token, c.csrf)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	w := httptest.NewRecorder()
	c.h.ServeHTTP(w, req)
	return w
}

func backupMultipart(t *testing.T, name string, data []byte) ([]byte, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	fw.Write(data)
	mw.Close()
	return buf.Bytes(), mw.FormDataContentType()
}

func TestDownloadBackup(t *testing.T) {
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	_, _, name := backupsOf(t, c)

	w := c.rawReq("GET", "/api/backups/"+name, nil, "")
	if w.Code != 200 {
		t.Fatalf("download: %d %s", w.Code, w.Body.String())
	}
	if cd := w.Header().Get("Content-Disposition"); cd != `attachment; filename="`+name+`"` {
		t.Fatalf("Content-Disposition %q", cd)
	}
	if !bytes.HasPrefix(w.Body.Bytes(), []byte("SQLite format 3\x00")) {
		t.Fatal("download is not the SQLite file")
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("download may be cached")
	}

	// Not signed in: refused.
	req := httptest.NewRequest("GET", "/api/backups/"+name, nil)
	rw := httptest.NewRecorder()
	router.ServeHTTP(rw, req)
	if rw.Code != 401 {
		t.Fatalf("anonymous download: %d", rw.Code)
	}
	// Traversal and junk names: never a file outside the backups folder.
	for _, p := range []string{"/api/backups/hops.db", "/api/backups/..%2Fhops.db", "/api/backups/hops-backup-x%2F..%2F..%2Fhops.db", "/api/backups/hops-backup-..%5Chops.db", "/api/backups/%2Fetc%2Fpasswd"} {
		w := c.rawReq("GET", p, nil, "")
		if w.Code == 200 {
			t.Errorf("GET %s served a file", p)
		}
		if bytes.HasPrefix(w.Body.Bytes(), []byte("SQLite")) {
			t.Errorf("GET %s leaked a database", p)
		}
	}
	if w := c.rawReq("GET", "/api/backups/hops-backup-2099-01-01_00-00-00_none.db", nil, ""); w.Code != 404 {
		t.Fatalf("missing backup: %d", w.Code)
	}
}

func TestUploadBackup(t *testing.T) {
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	_, _, name := backupsOf(t, c)
	good := c.rawReq("GET", "/api/backups/"+name, nil, "").Body.Bytes()
	n := backupCount(t, c)

	body, ct := backupMultipart(t, "mine.db", good)
	w := c.rawReq("POST", "/api/backups/upload", body, ct)
	if w.Code != 200 {
		t.Fatalf("upload: %d %s", w.Code, w.Body.String())
	}
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	up, _ := resp["name"].(string)
	if !strings.HasSuffix(up, "_uploaded.db") {
		t.Fatalf("stored as %q", up)
	}
	if backupCount(t, c) != n+1 {
		t.Fatal("upload not listed")
	}
	// Not restored: nothing staged, the server isn't restarting.
	_, lr := c.do("GET", "/api/backups", nil)
	dir := filepath.Dir(lr["backups"].([]interface{})[0].(map[string]interface{})["path"].(string))
	if _, err := os.Stat(database.PendingRestorePath(filepath.Join(filepath.Dir(dir), "hops.db"))); !os.IsNotExist(err) {
		t.Fatal("an upload staged a restore")
	}

	// A non-SQLite file and a SQLite file that isn't HOPS: refused, with the reason.
	other := filepath.Join(t.TempDir(), "notes.db")
	odb, _ := sql.Open("sqlite", other)
	odb.Exec(`CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)`)
	odb.Close()
	otherBytes, _ := os.ReadFile(other)
	for _, tc := range []struct {
		data []byte
		want string
	}{
		{[]byte("just some text pretending to be a database"), "not a SQLite database"},
		{otherBytes, "not a HOPS database"},
	} {
		body, ct := backupMultipart(t, "x.db", tc.data)
		w := c.rawReq("POST", "/api/backups/upload", body, ct)
		if w.Code != http.StatusUnprocessableEntity || !strings.Contains(w.Body.String(), tc.want) || !strings.Contains(w.Body.String(), "Nothing was stored") {
			t.Errorf("%q: %d %s", tc.want, w.Code, w.Body.String())
		}
	}
	if backupCount(t, c) != n+1 {
		t.Fatal("an invalid upload was listed")
	}

	// Too big: refused with 413, naming the limit.
	if code, r := c.do("PUT", "/api/settings/upload.max_bytes_import", map[string]string{"value": "1048576"}); code != 200 {
		t.Fatalf("set limit: %d %v", code, r)
	}
	big, ct := backupMultipart(t, "big.db", append(good, make([]byte, 2<<20)...))
	if w := c.rawReq("POST", "/api/backups/upload", big, ct); w.Code != http.StatusRequestEntityTooLarge || !strings.Contains(w.Body.String(), "backup you can upload") {
		t.Fatalf("oversize: %d %s", w.Code, w.Body.String())
	}

	// Without CSRF: refused. Not signed in: refused.
	req := httptest.NewRequest("POST", "/api/backups/upload", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", ct)
	rw := httptest.NewRecorder()
	router.ServeHTTP(rw, req)
	if rw.Code != http.StatusForbidden {
		t.Fatalf("upload without CSRF: %d", rw.Code)
	}
	req = httptest.NewRequest("POST", "/api/backups/upload", bytes.NewReader(body))
	req.Header.Set("Content-Type", ct)
	rw = httptest.NewRecorder()
	router.ServeHTTP(rw, req)
	if rw.Code != 401 {
		t.Fatalf("anonymous upload: %d", rw.Code)
	}
	// GET on the sentinel is not a download.
	if w := c.rawReq("GET", "/api/backups/upload", nil, ""); w.Code != 405 {
		t.Fatalf("GET upload: %d", w.Code)
	}
}

// writeStartupBackups puts n synthetic automatic backups in dir, the newest
// `start` ago and one hour apart.
func writeStartupBackups(t *testing.T, dir string, n int, start time.Duration) {
	t.Helper()
	for i := 0; i < n; i++ {
		at := time.Now().Add(-start - time.Duration(i)*time.Hour)
		p := filepath.Join(dir, "hops-backup-"+at.Format("2006-01-02_15-04-05")+"_startup.db")
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		os.Chtimes(p, at, at)
	}
}

func TestRetentionSettingsAndCleanupPreview(t *testing.T) {
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	dir, _, manual := backupsOf(t, c)

	// The ceiling can't go below keep_count.
	if code, _ := c.do("PUT", "/api/settings/backup.max_count", map[string]string{"value": "5"}); code != 400 {
		t.Fatalf("ceiling below keep accepted: %d", code)
	}
	for k, v := range map[string]string{"backup.keep_count": "3"} {
		if code, r := c.do("PUT", "/api/settings/"+k, map[string]string{"value": v}); code != 200 {
			t.Fatalf("%s: %d %v", k, code, r)
		}
	}
	_, list := c.do("GET", "/api/backups", nil)
	ret, _ := list["retention"].(map[string]interface{})
	if ret["keepCount"] != float64(3) || ret["keepDays"] != float64(0) || ret["maxCount"] != float64(100) {
		t.Fatalf("retention %v", ret)
	}

	writeStartupBackups(t, dir, 6, time.Hour)
	code, prev := c.do("GET", "/api/backups/cleanup", nil)
	if code != 200 {
		t.Fatalf("preview: %d %v", code, prev)
	}
	dels, _ := prev["deletions"].([]interface{})
	if len(dels) != 3 {
		t.Fatalf("preview should list 3 (6 automatic, keep 3): %v", dels)
	}
	var toDelete []string
	for _, d := range dels {
		m := d.(map[string]interface{})
		if m["reason"] == "" {
			t.Fatalf("no reason: %v", m)
		}
		toDelete = append(toDelete, m["name"].(string))
	}
	// The preview deleted nothing.
	if backupCount(t, c) != 7 {
		t.Fatalf("preview changed the backups: %d", backupCount(t, c))
	}
	// Confirm with one extra name that the rules don't delete (the manual backup): it stays.
	code, done := c.do("POST", "/api/backups/cleanup", map[string]interface{}{"names": append(toDelete, manual)})
	if code != 200 || len(done["deleted"].([]interface{})) != 3 {
		t.Fatalf("cleanup: %d %v", code, done)
	}
	if _, err := os.Stat(filepath.Join(dir, manual)); err != nil {
		t.Fatal("a protected (manual) backup was deleted by Clean up now")
	}
	// Protected backups are flagged for the "kept until you delete it" label.
	_, list = c.do("GET", "/api/backups", nil)
	for _, b := range list["backups"].([]interface{}) {
		m := b.(map[string]interface{})
		if m["protected"] != database.IsProtectedBackup(m["name"].(string)) {
			t.Fatalf("protected flag wrong: %v", m)
		}
	}
}

func TestCeilingDeletionNotice(t *testing.T) {
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	dir, _, _ := backupsOf(t, c)
	for k, v := range map[string]string{"backup.keep_count": "3", "backup.keep_days": "3650"} {
		if code, r := c.do("PUT", "/api/settings/"+k, map[string]string{"value": v}); code != 200 {
			t.Fatalf("%s: %d %v", k, code, r)
		}
	}
	if code, r := c.do("PUT", "/api/settings/backup.max_count", map[string]string{"value": "5"}); code != 200 {
		t.Fatalf("max: %d %v", code, r)
	}
	writeStartupBackups(t, dir, 8, time.Hour)
	if code, r := c.do("POST", "/api/backups", map[string]string{"reason": "manual"}); code != 200 {
		t.Fatalf("%d %v", code, r)
	}
	n := backupNotice(t, c)
	if n == nil || !strings.Contains(n["text"].(string), "Deleted 3 backup(s) newer than 3650 days to stay under the 5-backup ceiling") {
		t.Fatalf("no ceiling notice: %v", n)
	}
	if n["sticky"] == true {
		t.Fatal("the ceiling notice should be dismissible")
	}
	if code, r := c.do("POST", "/api/notices/"+n["id"].(string)+"/dismiss", nil); code != 200 {
		t.Fatalf("dismiss: %d %v", code, r)
	}
	if n := backupNotice(t, c); n != nil {
		t.Fatalf("still there: %v", n)
	}
}

func TestFewerBackupsThanKeepIsSilent(t *testing.T) {
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	backupsOf(t, c)
	if n := backupNotice(t, c); n != nil {
		t.Fatalf("a notice with fewer backups than keep_count: %v", n)
	}
	_, prev := c.do("GET", "/api/backups/cleanup", nil)
	if d, _ := prev["deletions"].([]interface{}); len(d) != 0 {
		t.Fatalf("something to clean up: %v", d)
	}
}

func TestDailyBackupCleanupRuns(t *testing.T) {
	_, dbPath := tempBackupDB(t)
	bm := database.NewBackupManager(dbPath)
	bm.SetRetention(func() database.RetentionPolicy { return database.RetentionPolicy{KeepCount: 3, MaxCount: 100} })
	dir := filepath.Join(filepath.Dir(dbPath), "backups")
	os.MkdirAll(dir, 0o755)
	writeStartupBackups(t, dir, 6, time.Hour)
	r := &Router{backupManager: bm}
	stop := make(chan struct{})
	go r.dailyBackupCleanup(10*time.Millisecond, stop)
	defer close(stop)
	deadline := time.Now().Add(5 * time.Second)
	for {
		l, _ := bm.ListBackups()
		if len(l) == 3 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("daily cleanup didn't apply retention: %d backups", len(l))
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func tempBackupDB(t *testing.T) (*sql.DB, string) {
	t.Helper()
	p := filepath.Join(t.TempDir(), "hops.db")
	db, err := database.Initialize(p)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db, p
}

// Fix round 1, M1: a GET /api/config carrying admin notices is never cached.
func TestConfigWithAdminNoticesNotCached(t *testing.T) {
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	_, bm, _ := backupsOf(t, c)
	w := c.rawReq("GET", "/api/config", nil, "")
	if w.Header().Get("Cache-Control") == "private, no-store" {
		t.Fatal("no-store without admin notices (offline copy would be lost for nothing)")
	}
	bm.SetFailureHooks(failReason("startup"))
	bm.CreateBackupWithDB(db, "startup")
	w = c.rawReq("GET", "/api/config", nil, "")
	if w.Header().Get("Cache-Control") != "private, no-store" || !strings.Contains(w.Header().Get("Vary"), "Cookie") {
		t.Fatalf("admin notices cacheable: %q / %q", w.Header().Get("Cache-Control"), w.Header().Get("Vary"))
	}
}

// Fix round 1, I2: a staged restore can be discarded; a restore-failed notice can be dismissed.
func TestDiscardStagedRestoreAndDismissRestoreFailed(t *testing.T) {
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	_, bm, name := backupsOf(t, c)
	if code, _ := c.do("DELETE", "/api/backups/pending-restore", nil); code != 404 {
		t.Fatalf("discard with nothing staged: %d", code)
	}
	if code, r := c.do("POST", "/api/backups/"+name, nil); code != 200 {
		t.Fatalf("restore: %d %v", code, r)
	}
	_, l := c.do("GET", "/api/backups", nil)
	if l["pendingRestore"] != true {
		t.Fatalf("pending restore not reported: %v", l["pendingRestore"])
	}
	if code, r := c.do("DELETE", "/api/backups/pending-restore", nil); code != 200 {
		t.Fatalf("discard: %d %v", code, r)
	}
	if _, l = c.do("GET", "/api/backups", nil); l["pendingRestore"] != false {
		t.Fatal("still pending after discard")
	}

	bm.RecordRestoreFailure(errors.New("the staged restore is not usable"))
	n := backupNotice(t, c)
	if n == nil || !strings.Contains(n["text"].(string), "couldn't be applied") || n["sticky"] == true {
		t.Fatalf("restore-failed notice: %v", n)
	}
	if code, r := c.do("POST", "/api/notices/"+n["id"].(string)+"/dismiss", nil); code != 200 {
		t.Fatalf("dismiss: %d %v", code, r)
	}
	if n := backupNotice(t, c); n != nil {
		t.Fatalf("still shown: %v", n)
	}
}

// Fix round 2: what startup did with an interrupted restore is a visible, dismissible notice.
func TestRestoreRecoveryNotice(t *testing.T) {
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	_, bm, _ := backupsOf(t, c)
	bm.RecordRestoreRecovery(database.OutcomeUndone)
	n := backupNotice(t, c)
	if n == nil || !strings.Contains(n["text"].(string), "An interrupted restore was undone") || n["sticky"] == true {
		t.Fatalf("recovery notice: %v", n)
	}
	if code, r := c.do("POST", "/api/notices/"+n["id"].(string)+"/dismiss", nil); code != 200 {
		t.Fatalf("dismiss: %d %v", code, r)
	}
	if n := backupNotice(t, c); n != nil {
		t.Fatalf("still shown: %v", n)
	}
}

// Fix round 3: a restore journal that couldn't be removed is a sticky notice.
func TestJournalLeftNotice(t *testing.T) {
	router, db := setupTestRouter(t)
	seed(t, db)
	c := newClient(t, router)
	_, bm, _ := backupsOf(t, c)
	bm.RecordJournalLeft("permission denied")
	n := backupNotice(t, c)
	if n == nil || !strings.Contains(n["text"].(string), "restore journal") || !strings.Contains(n["text"].(string), "permission denied") || n["sticky"] != true {
		t.Fatalf("journal-left notice: %v", n)
	}
}
