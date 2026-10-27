package database

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/assets"
	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// A fresh, empty data dir is seeded with the native v3 Sample: the stored
// document is v3 at the current layout version, verifies, and start-up's
// migration has nothing to do (no conversion, no archived "original").
func TestFreshInstall_SeedsNativeV3Sample(t *testing.T) {
	db, err := Initialize(filepath.Join(t.TempDir(), "fresh.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	doc, err := configdoc.Load(db)
	if err != nil {
		t.Fatalf("seeded config is not v3: %v", err)
	}
	if err := configdoc.CheckLayoutVersion(doc); err != nil {
		t.Fatal(err)
	}
	if err := configdoc.VerifyIDs(doc); err != nil {
		t.Fatal(err)
	}
	ds := doc["dashboards"].([]any)
	if len(ds) != 1 {
		t.Fatalf("seeded %d dashboards, want 1 (Sample)", len(ds))
	}
	d := ds[0].(map[string]any)
	if d["path"] != "/sample" || d["name"] != "Sample" {
		t.Fatalf("seeded dashboard is %v %v, want Sample at /sample", d["name"], d["path"])
	}
	if err := configdoc.VerifyDashboard(d); err != nil {
		t.Fatal(err)
	}

	backedUp := false
	res, took, err := configdoc.MigrateWithBackup(db, func() error { backedUp = true; return nil })
	if err != nil || res.Failed || res.Migrated || took || backedUp {
		t.Fatalf("fresh install ran a migration: res=%+v backedUp=%v err=%v", res, took || backedUp, err)
	}
	var archived int
	if err := db.QueryRow("SELECT COUNT(*) FROM config_archive").Scan(&archived); err != nil {
		t.Fatal(err)
	}
	if archived != 0 {
		t.Fatalf("fresh install archived %d config rows, want 0", archived)
	}
}

// An existing config row is never reseeded.
func TestInitialize_NeverReseedsExistingConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "existing.db")
	db, err := Initialize(path)
	if err != nil {
		t.Fatal(err)
	}
	const mine = `{"schemaVersion":2,"dashboards":[]}`
	if _, err := db.Exec("UPDATE config SET data = ? WHERE id = 1", mine); err != nil {
		t.Fatal(err)
	}
	db.Close()
	db, err = Initialize(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var got string
	if err := db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != mine {
		t.Fatalf("existing config was rewritten: %s", got)
	}
}

func sampleNodes(t *testing.T) []map[string]any {
	t.Helper()
	doc, err := SampleDoc()
	if err != nil {
		t.Fatal(err)
	}
	var out []map[string]any
	configdoc.Walk(doc, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		out = append(out, n)
		return true
	})
	if len(out) == 0 {
		t.Fatal("the Sample has no tiles or folders")
	}
	return out
}

// The Sample shows off v3: several tabs, every folder shape, small/medium/
// large folder contents, nesting, a minimised folder and every tile size.
func TestSample_ShowsV3Features(t *testing.T) {
	doc, _ := SampleDoc()
	tabs := doc["dashboards"].([]any)[0].(map[string]any)["tabs"].([]any)
	if len(tabs) < 3 {
		t.Errorf("Sample has %d tabs, want at least 3", len(tabs))
	}
	shapes, contents, sizes, displays := map[any]bool{}, map[any]bool{}, map[any]bool{}, map[any]bool{}
	nested := false
	configdoc.Walk(doc, func(_, _ configdoc.Obj, path []configdoc.Obj, n configdoc.Obj) bool {
		if n["kind"] == "folder" {
			shapes[n["shape"]] = true
			contents[n["contentSize"]] = true
			displays[n["display"]] = true
			if len(path) > 0 {
				nested = true
			}
		} else {
			sizes[n["size"]] = true
		}
		return true
	})
	for _, s := range []string{"rounded", "simple-tab", "folder-flat", "folder-paper", "folder-outline", "folder-cartoon", "folder-open"} {
		if !shapes[s] {
			t.Errorf("no folder with shape %q", s)
		}
	}
	for _, s := range []string{"small", "medium", "large"} {
		if !contents[s] {
			t.Errorf("no folder with %s contents", s)
		}
		if !sizes[s] {
			t.Errorf("no %s tile", s)
		}
	}
	if !nested || !displays["collapsed"] {
		t.Errorf("want a nested folder and a minimised folder: nested=%v displays=%v", nested, displays)
	}
}

// No real data: every tile URL host is *.example.lan.
func TestSample_HostsAreSynthetic(t *testing.T) {
	for _, n := range sampleNodes(t) {
		if n["kind"] != "tile" {
			continue
		}
		for _, k := range []string{"url", "awayUrl"} {
			raw, _ := n[k].(string)
			if raw == "" && k == "awayUrl" {
				continue
			}
			u, err := url.Parse(raw)
			if err != nil || !strings.HasSuffix(u.Hostname(), ".example.lan") {
				t.Errorf("tile %v: %s %q is not a synthetic *.example.lan host", n["id"], k, raw)
			}
		}
	}
}

// Offline: every icon is in the frontend's offline bundle and every
// background picture is a packaged preset.
func TestSample_IconsAndPicturesArePackaged(t *testing.T) {
	bundle, err := os.ReadFile("../../../frontend/src/lib/icons/offline-bundle.ts")
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range sampleNodes(t) {
		icon, _ := n["icon"].(string)
		if icon == "" {
			if n["kind"] == "tile" {
				t.Errorf("tile %v has no icon", n["id"])
			}
			continue
		}
		name := strings.TrimPrefix(icon, "mdi:")
		if name == icon || !strings.Contains(string(bundle), `"`+name+`":{"width"`) {
			t.Errorf("%v: icon %q is not in the offline bundle", n["id"], icon)
		}
	}
	var pics []string
	var find func(any)
	find = func(x any) {
		switch v := x.(type) {
		case map[string]any:
			for k, c := range v {
				if s, ok := c.(string); ok && (k == "value" || k == "url") && strings.HasPrefix(s, "/") {
					pics = append(pics, s)
				}
				find(c)
			}
		case []any:
			for _, c := range v {
				find(c)
			}
		}
	}
	doc, _ := SampleDoc()
	find(doc)
	if len(pics) == 0 {
		t.Fatal("the Sample has no background picture")
	}
	for _, p := range pics {
		if !strings.HasPrefix(p, "/presets/") {
			t.Errorf("picture %q is not a packaged preset", p)
			continue
		}
		if _, err := assets.Presets.ReadFile(strings.TrimPrefix(p, "/")); err != nil {
			t.Errorf("picture %q is not packaged: %v", p, err)
		}
	}
}
