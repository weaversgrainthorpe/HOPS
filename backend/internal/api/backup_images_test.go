package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/database"
)

// M6 §12 (Option B) through the API: deletes move images to the attic,
// downloads are archives with the images, uploads are validated archives (or
// a legacy .db with a warning). Admin-only; POST/DELETE need CSRF (covered by
// the route audit and TestUploadBackup). Synthetic data only.

func unzipBody(t *testing.T, body []byte) map[string][]byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	out := map[string][]byte{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		out[f.Name] = b
	}
	return out
}

func rezip(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, b := range files {
		w, _ := zw.Create(name)
		w.Write(b)
	}
	zw.Close()
	return buf.Bytes()
}

func TestIconDeleteMovesTheFileToTheAttic(t *testing.T) {
	dir := t.TempDir()
	_, router, db := setupTestRouterInDir(t, dir)
	c := newClient(t, router)
	seedIconRows(t, db)
	id, url := uploadedID(t, uploadIconForm(t, c, "mine.png", pngBytes(t), map[string]string{"categoryId": "mine"}))
	file := strings.TrimPrefix(url, "/icons/")
	// A backup refers to it (the icon library row).
	if code, r := c.do("POST", "/api/backups", map[string]string{"reason": "manual"}); code != 200 {
		t.Fatalf("backup: %d %v", code, r)
	}
	if code, b := c.do("DELETE", "/api/icons/"+id, nil); code != 200 {
		t.Fatalf("delete: %d %v", code, b)
	}
	if _, err := os.Stat(filepath.Join(dir, "icons", file)); !os.IsNotExist(err) {
		t.Fatal("the live file is still there")
	}
	if _, err := os.Stat(filepath.Join(dir, "attic", "icons", file)); err != nil {
		t.Fatalf("not moved to the attic: %v", err)
	}
	// The Backups list shows the attic's size.
	_, list := c.do("GET", "/api/backups", nil)
	attic, _ := list["attic"].(map[string]interface{})
	if attic == nil || attic["files"].(float64) != 1 || attic["bytes"].(float64) <= 0 {
		t.Fatalf("attic usage %v", list["attic"])
	}
}

func uploadBackgroundForm(t *testing.T, c *apiClient, data []byte) map[string]interface{} {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	h := map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="bg.png"`},
		"Content-Type":        {"image/png"},
	}
	fw, _ := mw.CreatePart(h)
	fw.Write(data)
	mw.Close()
	w := c.rawReq("POST", "/api/backgrounds", buf.Bytes(), mw.FormDataContentType())
	if w.Code != 200 {
		t.Fatalf("background upload: %d %s", w.Code, w.Body.String())
	}
	var r map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &r)
	return r
}

func TestBackgroundDeleteMovesTheFileToTheAttic(t *testing.T) {
	dir := t.TempDir()
	_, router, _ := setupTestRouterInDir(t, dir)
	c := newClient(t, router)
	r := uploadBackgroundForm(t, c, pngBytes(t))
	file := strings.TrimPrefix(r["url"].(string), "/backgrounds/")
	if code, b := c.do("DELETE", "/api/backgrounds/"+r["id"].(string), nil); code != 200 {
		t.Fatalf("delete: %d %v", code, b)
	}
	if _, err := os.Stat(filepath.Join(dir, "backgrounds", file)); !os.IsNotExist(err) {
		t.Fatal("the live file is still there")
	}
	if _, err := os.Stat(filepath.Join(dir, "attic", "backgrounds", file)); err != nil {
		t.Fatalf("not moved to the attic: %v", err)
	}
	// An untracked file on disk: the same.
	os.WriteFile(filepath.Join(dir, "backgrounds", "0123abcd.jpg"), []byte("x"), 0o644)
	if code, b := c.do("DELETE", "/api/backgrounds/0123abcd", nil); code != 200 {
		t.Fatalf("delete orphan: %d %v", code, b)
	}
	if _, err := os.Stat(filepath.Join(dir, "attic", "backgrounds", "0123abcd.jpg")); err != nil {
		t.Fatalf("orphan not moved to the attic: %v", err)
	}
}

func TestDownloadIsAnArchiveWithTheImages(t *testing.T) {
	dir := t.TempDir()
	_, router, db := setupTestRouterInDir(t, dir)
	c := newClient(t, router)
	seedIconRows(t, db) // also refers to /icons/a.png, b.png, c.png, which don't exist
	id, url := uploadedID(t, uploadIconForm(t, c, "mine.png", pngBytes(t), map[string]string{"categoryId": "mine"}))
	_, _, name := backupsOf(t, c)
	// Deleted after the backup: the archive takes it from the attic.
	if code, b := c.do("DELETE", "/api/icons/"+id, nil); code != 200 {
		t.Fatalf("delete: %d %v", code, b)
	}

	code, plan := c.do("GET", "/api/backups/"+name+"?images=1", nil)
	if code != 200 {
		t.Fatalf("image check: %d %v", code, plan)
	}
	if inc := plan["included"].([]interface{}); len(inc) != 1 || inc[0] != strings.TrimPrefix(url, "/") {
		t.Fatalf("included %v", plan["included"])
	}
	if miss := plan["missing"].([]interface{}); len(miss) != 3 {
		t.Fatalf("missing %v", plan["missing"])
	}

	w := c.rawReq("GET", "/api/backups/"+name, nil, "")
	if w.Code != 200 {
		t.Fatalf("download: %d %s", w.Code, w.Body.String())
	}
	if w.Header().Get("X-HOPS-Missing-Images") != "3" {
		t.Fatalf("missing header %q", w.Header().Get("X-HOPS-Missing-Images"))
	}
	files := unzipBody(t, w.Body.Bytes())
	if !bytes.Equal(files[strings.TrimPrefix(url, "/")], pngBytes(t)) {
		t.Fatalf("the image isn't in the archive: %v", keys(files))
	}
	var man database.ArchiveManifest
	if err := json.Unmarshal(files["manifest.json"], &man); err != nil {
		t.Fatal(err)
	}
	if strings.Join(man.Missing, ",") != "icons/a.png,icons/b.png,icons/c.png" {
		t.Fatalf("manifest missing %v", man.Missing)
	}
}

func keys(m map[string][]byte) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestUploadArchiveLegacyAndTampered(t *testing.T) {
	dir := t.TempDir()
	_, router, db := setupTestRouterInDir(t, dir)
	c := newClient(t, router)
	seedIconRows(t, db)
	_, url := uploadedID(t, uploadIconForm(t, c, "mine.png", pngBytes(t), map[string]string{"categoryId": "mine"}))
	_, _, name := backupsOf(t, c)
	archive := c.rawReq("GET", "/api/backups/"+name, nil, "").Body.Bytes()

	// The archive: stored with its image staged, and a warning for the images it was made without.
	body, ct := backupMultipart(t, "mine.zip", archive)
	w := c.rawReq("POST", "/api/backups/upload", body, ct)
	if w.Code != 200 {
		t.Fatalf("upload: %d %s", w.Code, w.Body.String())
	}
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	up := resp["name"].(string)
	if resp["images"].(float64) != 1 || !strings.Contains(resp["warning"].(string), "icons/a.png") {
		t.Fatalf("response %v", resp)
	}
	if _, err := os.Stat(filepath.Join(dir, "backups", ".images", up, strings.TrimPrefix(url, "/"))); err != nil {
		t.Fatalf("image not staged with the upload: %v", err)
	}

	// A legacy plain .db: accepted, with the warning.
	files := unzipBody(t, archive)
	body, ct = backupMultipart(t, "old.db", files["hops.db"])
	w = c.rawReq("POST", "/api/backups/upload", body, ct)
	json.Unmarshal(w.Body.Bytes(), &resp)
	if w.Code != 200 || resp["warning"] != database.LegacyUploadWarning {
		t.Fatalf("legacy: %d %s", w.Code, w.Body.String())
	}

	// Tampered: an image changed after the manifest was written; a path that leaves the folder.
	n := backupCount(t, c)
	tampered := map[string][]byte{}
	for k, v := range files {
		tampered[k] = v
	}
	// Same size, one byte changed: only the SHA-256 can tell.
	img := append([]byte(nil), files[strings.TrimPrefix(url, "/")]...)
	img[len(img)-1] ^= 0xff
	tampered[strings.TrimPrefix(url, "/")] = img
	traversal := map[string][]byte{"hops.db": files["hops.db"], "manifest.json": files["manifest.json"], "../../evil.png": []byte("x")}
	for _, tc := range []struct {
		zip  []byte
		want string
	}{
		{rezip(t, tampered), "SHA-256"},
		{rezip(t, traversal), "leaves its folder"},
	} {
		body, ct := backupMultipart(t, "bad.zip", tc.zip)
		w := c.rawReq("POST", "/api/backups/upload", body, ct)
		if w.Code != http.StatusUnprocessableEntity || !strings.Contains(w.Body.String(), tc.want) || !strings.Contains(w.Body.String(), "Nothing was stored") {
			t.Errorf("%s: %d %s", tc.want, w.Code, w.Body.String())
		}
	}
	if backupCount(t, c) != n {
		t.Fatal("a refused upload was stored")
	}
}

func TestRestoreImagesNoticeIsShownAndDismissible(t *testing.T) {
	n := backupProblemNotice(database.BackupProblem{Kind: database.ProblemRestoreImages, At: time.Now(),
		Reason: "After the restore, 1 image(s) the restored data uses couldn't be found anywhere and will show as broken: icons/x.png"})
	if n.Sticky || !strings.Contains(n.Text, "icons/x.png") {
		t.Fatalf("notice %+v", n)
	}
	if kind, ok := dismissibleBackupNotice(n.ID); !ok || kind != database.ProblemRestoreImages {
		t.Fatal("not dismissible")
	}
	for _, k := range []string{database.ProblemAtticBlocked, database.ProblemAtticDeleteFailed, database.ProblemAtticLarge} {
		n := backupProblemNotice(database.BackupProblem{Kind: k, At: time.Now(), Reason: "why it happened"})
		if !n.Sticky || !strings.Contains(strings.ToLower(n.Text), "why it happened") || strings.HasPrefix(n.Text, "A backup problem") {
			t.Errorf("%s: %+v", k, n)
		}
		if _, ok := dismissibleBackupNotice(n.ID); ok {
			t.Errorf("%s is dismissible", k)
		}
	}
}
