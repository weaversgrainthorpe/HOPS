package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// A file import can't use is refused with what is actually wrong with it:
// more than one file, a damaged JSON file, or an export from a newer HOPS.
// Nothing is written and no backup is taken.

// importRefused posts body and checks for a 400 naming every want, with the
// stored config and the backups unchanged.
func importRefused(t *testing.T, body []byte, contentType string, wants ...string) {
	t.Helper()
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	before, backups := storedRaw(db), backupCount(t, c)
	code, raw := c.raw("POST", "/api/config/import", body, contentType)
	var resp map[string]interface{}
	_ = json.Unmarshal(raw, &resp)
	msg, _ := resp["error"].(string)
	if code != 400 {
		t.Fatalf("import: %d %s, want 400", code, raw)
	}
	for _, w := range wants {
		if !strings.Contains(msg, w) {
			t.Errorf("error %q does not mention %q", msg, w)
		}
	}
	if storedRaw(db) != before {
		t.Error("config row changed")
	}
	if n := backupCount(t, c); n != backups {
		t.Errorf("backups %d -> %d: a refused import took a backup", backups, n)
	}
}

func importBody(t *testing.T, files ...[]byte) ([]byte, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for _, f := range files {
		fw, err := mw.CreateFormFile("file", "import.json")
		if err != nil {
			t.Fatal(err)
		}
		fw.Write(f)
	}
	mw.Close()
	return buf.Bytes(), mw.FormDataContentType()
}

func TestImport_SeveralFilesRefused(t *testing.T) {
	one := v2File(v2Dash("a", "Alpha", "/alpha"))
	two := v2File(v2Dash("b", "Beta", "/beta"))
	body, ct := importBody(t, one, two)
	importRefused(t, body, ct, "one file at a time", "2 files")
}

func TestImport_DamagedJSONNamedAsSuch(t *testing.T) {
	good := v2File(v2Dash("a", "Alpha", "/alpha"))
	cases := map[string][]byte{
		"truncated v2":   good[:len(good)/2],
		"truncated v3":   v3ExportOf(t, map[string]interface{}{"dashboards": []interface{}{}})[:40],
		"broken mid-way": []byte(`{"dashboards": [ {"name": "x",, } ]}`),
		"with BOM":       append([]byte("\xef\xbb\xbf  "), good[:30]...),
		"array":          []byte(`[{"title": "x", "url": "https://x"`),
	}
	for name, data := range cases {
		t.Run(name, func(t *testing.T) {
			body, ct := importBody(t, data)
			importRefused(t, body, ct, "damaged or incomplete", "byte")
		})
	}
}

// Valid JSON of another shape, and YAML, are still "not a format HOPS reads".
func TestImport_UnknownFormatStillSaysSo(t *testing.T) {
	for name, data := range map[string][]byte{
		"json object": []byte(`{"hello": 1}`),
		"yaml":        []byte("hello: world\nlist:\n  - a\n"),
	} {
		t.Run(name, func(t *testing.T) {
			body, ct := importBody(t, data)
			importRefused(t, body, ct, "Could not detect the file format")
		})
	}
}

func TestImport_EmptyFileNamedAsSuch(t *testing.T) {
	body, ct := importBody(t, []byte(" \n"))
	importRefused(t, body, ct, "empty")
}

func TestImport_NewerExportSchemaNamedAsSuch(t *testing.T) {
	for name, data := range map[string][]byte{
		"json": []byte(`{"format": "hops-export", "schemaVersion": 4, "exportType": "dashboards", "config": {"dashboards": []}}`),
		"yaml": []byte("format: hops-export\nschemaVersion: 4\nexportType: dashboards\nconfig:\n  dashboards: []\n"),
	} {
		t.Run(name, func(t *testing.T) {
			body, ct := importBody(t, data)
			importRefused(t, body, ct, "newer HOPS", "schema version 4", "Update HOPS")
		})
	}
}

// A stored dashboard with an empty id (only from hand-edited data) can't be
// the target of Replace or Keep both: refused with the reason, never a crash.
func TestImport_ReplaceOrKeepAgainstEmptyIDRefused(t *testing.T) {
	for _, choice := range []string{importReplace, importKeep} {
		t.Run(choice, func(t *testing.T) {
			router, db := setupTestRouter(t)
			c := newClient(t, router)
			seed(t, db)
			doc := storedDoc(t, db)
			dashList(doc)[0]["id"] = ""
			if err := configdoc.Save(db, doc); err != nil {
				t.Fatal(err)
			}
			before, backups := storedRaw(db), backupCount(t, c)
			code, resp := c.importFileWith(v2File(v2Dash("x", "First", "/first-x")), map[string]string{
				"choices": `["` + choice + `"]`, "targets": `[""]`,
			})
			msg, _ := resp["error"].(string)
			if code != 409 || !strings.Contains(msg, "has no id") || !strings.Contains(msg, "Skip") {
				t.Fatalf("import: %d %v, want 409 naming the missing id", code, resp)
			}
			if storedRaw(db) != before {
				t.Error("config row changed")
			}
			if n := backupCount(t, c); n != backups {
				t.Errorf("backups %d -> %d", backups, n)
			}
		})
	}
}
