package api

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"gopkg.in/yaml.v3"
)

// One layoutVersion marks the stored layout form. Every write
// that carries placements must carry the current one (a 409 otherwise); GET
// and every export carry it; an import of a v3 export at another version is
// refused naming both versions. v2, Homer, Dashy and Heimdall imports go
// through the v2→v3 converter and come out in the current form.

// assertCurrentDashboard checks d is in the current layout form: it verifies, and
// every folder child is placement-free in an ordered list.
func assertCurrentDashboard(t *testing.T, d configdoc.Obj) {
	t.Helper()
	if err := configdoc.VerifyDashboard(d); err != nil {
		t.Fatalf("dashboard %v is not in the current layout form: %v", d["id"], err)
	}
	for _, k := range []string{"defaultLayout"} {
		if _, has := d[k]; has {
			t.Errorf("dashboard %v has %q", d["id"], k)
		}
	}
	configdoc.Walk(configdoc.Obj{"dashboards": []any{d}}, func(_, _ configdoc.Obj, path []configdoc.Obj, n configdoc.Obj) bool {
		if _, placed := n["placement"]; placed == (len(path) > 0) {
			t.Errorf("node %v at depth %d: placement present=%v", n["id"], len(path), placed)
		}
		if n["kind"] == "folder" && (n["size"] == nil || n["contentSize"] == nil) {
			t.Errorf("folder %v lacks size/contentSize", n["id"])
		}
		return true
	})
}

func TestLayoutVersionGuard_RefusesMismatchedWrites(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db)
	tabID := v3Body(t, c, "d2")["tabs"].([]interface{})[0].(map[string]interface{})["id"].(string)
	target := map[string]interface{}{"tabId": tabID}

	saveBody := func() map[string]interface{} {
		d := v3Body(t, c, "d1")
		d["name"] = "Stale rename"
		return map[string]interface{}{"schema": 3, "dashboard": d, "revision": 1, "layoutVersion": configdoc.LayoutVersion}
	}
	without := func(b map[string]interface{}) map[string]interface{} {
		delete(b, "layoutVersion")
		return b
	}
	with := func(b map[string]interface{}, k string, v interface{}) map[string]interface{} {
		delete(b, "layoutVersion")
		b[k] = v
		return b
	}
	cases := []struct {
		name, method, path string
		body               map[string]interface{}
	}{
		{"save, no layoutVersion", "PUT", "/api/dashboards/d1", without(saveBody())},
		{"save, old gridUnit only", "PUT", "/api/dashboards/d1", with(saveBody(), "gridUnit", 2)},
		{"save, layoutVersion 0", "PUT", "/api/dashboards/d1", with(saveBody(), "layoutVersion", 0)},
		{"save, layoutVersion 1", "PUT", "/api/dashboards/d1", with(saveBody(), "layoutVersion", 1)},
		{"save, newer layoutVersion", "PUT", "/api/dashboards/d1", with(saveBody(), "layoutVersion", configdoc.LayoutVersion+1)},
		{"save, layoutVersion as a string", "PUT", "/api/dashboards/d1", with(saveBody(), "layoutVersion", fmt.Sprint(configdoc.LayoutVersion))},
		{"save, layoutVersion null", "PUT", "/api/dashboards/d1", with(saveBody(), "layoutVersion", nil)},
		{"copy, no layoutVersion", "POST", "/api/dashboards/transfer", without(transferBody(map[string]interface{}{"target": target}))},
		{"move, gridUnit only", "POST", "/api/dashboards/transfer", with(transferBody(map[string]interface{}{"mode": "move", "target": target}), "gridUnit", 2)},
		{"move, layoutVersion 1", "POST", "/api/dashboards/transfer", with(transferBody(map[string]interface{}{"mode": "move", "target": target}), "layoutVersion", 1)},
	}
	before := storedRaw(db)
	backups := backupCount(t, c)
	for _, tc := range cases {
		code, resp := c.do(tc.method, tc.path, tc.body)
		if code != 409 {
			t.Errorf("%s: %d %v, want 409", tc.name, code, resp)
			continue
		}
		if resp["error"] != "layout_version_mismatch" {
			t.Errorf("%s: error %v, want layout_version_mismatch", tc.name, resp["error"])
		}
		detail, _ := resp["detail"].(string)
		if !strings.Contains(detail, "Reload") || !strings.Contains(detail, "HOPS was updated") {
			t.Errorf("%s: detail %q does not say HOPS was updated and to reload", tc.name, detail)
		}
		if resp["layoutVersion"] != float64(configdoc.LayoutVersion) {
			t.Errorf("%s: layoutVersion %v, want %d", tc.name, resp["layoutVersion"], configdoc.LayoutVersion)
		}
		if storedRaw(db) != before {
			t.Fatalf("%s: a refused write changed the stored document", tc.name)
		}
	}
	if n := backupCount(t, c); n != backups {
		t.Errorf("refused writes took %d backups", n-backups)
	}
	// The same writes carrying the current layoutVersion go through.
	if code, resp := c.do("PUT", "/api/dashboards/d1", saveBody()); code != 200 {
		t.Fatalf("save with the current layoutVersion: %d %v", code, resp)
	}
	if code, resp := c.do("POST", "/api/dashboards/transfer", transferBody(map[string]interface{}{
		"sourceRevision": 2, "target": target})); code != 200 {
		t.Fatalf("copy with the current layoutVersion: %d %v", code, resp)
	}
}

func TestGetConfig_CarriesLayoutVersion(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	v := getView(t, c)
	if v["layoutVersion"] != float64(configdoc.LayoutVersion) {
		t.Errorf("GET /api/config layoutVersion = %v, want %d", v["layoutVersion"], configdoc.LayoutVersion)
	}
	if _, has := v["gridUnit"]; has {
		t.Error("GET /api/config still serves gridUnit")
	}
}

func TestExport_CarriesLayoutVersion(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	for _, q := range []string{"", "?dashboardId=d1", "?format=yaml", "?dashboardId=d1&format=yaml"} {
		var env map[string]any
		raw := c.export(q)
		var err error
		if strings.Contains(q, "yaml") {
			err = yaml.Unmarshal(raw, &env)
		} else {
			err = json.Unmarshal(raw, &env)
		}
		if err != nil {
			t.Fatalf("export%s: %v", q, err)
		}
		cfg, _ := env["config"].(map[string]any)
		if n, ok := configdoc.LayoutVersionOf(cfg); !ok || n != configdoc.LayoutVersion {
			t.Errorf("export%s: config.layoutVersion = %v, want %d", q, cfg["layoutVersion"], configdoc.LayoutVersion)
		}
		if _, has := cfg["gridUnit"]; has {
			t.Errorf("export%s: still carries gridUnit", q)
		}
	}
}

func TestImport_CurrentV3ExportRoundTrips(t *testing.T) {
	for _, q := range []string{"", "?dashboardId=d1", "?format=yaml"} {
		t.Run("q"+q, func(t *testing.T) {
			router, db := setupTestRouter(t)
			c := newClient(t, router)
			seed(t, db)
			if code, resp := c.importFile(c.export(q)); code != 200 {
				t.Fatalf("import: %d %v", code, resp)
			}
			ds := dashList(storedDoc(t, db))
			assertCurrentDashboard(t, ds[len(ds)-1])
		})
	}
}

// Old v3 exports and exports from a newer layout form are refused
// visibly, naming both versions, and nothing is written.
func TestImport_OtherLayoutVersionRefused(t *testing.T) {
	cur := fmt.Sprintf("layout version %d", configdoc.LayoutVersion)
	cases := map[string]struct {
		set  func(cfg map[string]any)
		want []string
	}{
		"old layout (gridUnit, no layoutVersion)": {func(cfg map[string]any) {
			delete(cfg, "layoutVersion")
			cfg["gridUnit"] = 2
		}, []string{cur, "pre-release"}},
		"no marker at all":        {func(cfg map[string]any) { delete(cfg, "layoutVersion") }, []string{cur}},
		"layout version 1 export": {func(cfg map[string]any) { cfg["layoutVersion"] = 1 }, []string{"layout version 1", cur}},
		"newer":                   {func(cfg map[string]any) { cfg["layoutVersion"] = configdoc.LayoutVersion + 1 }, []string{fmt.Sprintf("layout version %d", configdoc.LayoutVersion+1), cur}},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			router, db := setupTestRouter(t)
			c := newClient(t, router)
			seed(t, db)
			var env map[string]any
			if err := json.Unmarshal(c.export(""), &env); err != nil {
				t.Fatal(err)
			}
			cfg := env["config"].(map[string]any)
			tc.set(cfg)
			before := storedRaw(db)
			code, resp := c.importFile(v3ExportOf(t, cfg))
			msg, _ := resp["error"].(string)
			if code != 400 {
				t.Fatalf("import: %d %v, want 400", code, resp)
			}
			for _, w := range tc.want {
				if !strings.Contains(msg, w) {
					t.Errorf("error %q does not mention %q", msg, w)
				}
			}
			if storedRaw(db) != before {
				t.Error("config row changed")
			}
		})
	}
}

// The Showcase without its layoutVersion (as an older v3 build exported it)
// is refused visibly, naming the version this build reads; nothing changes.
func TestImport_OldLayoutShowcaseRefused(t *testing.T) {
	data, err := os.ReadFile("../configdoc/testdata/v3_showcase_export.json")
	if err != nil {
		t.Fatal(err)
	}
	var env map[string]any
	if err := json.Unmarshal(data, &env); err != nil {
		t.Fatal(err)
	}
	cfg := env["config"].(map[string]any)
	if _, has := cfg["layoutVersion"]; !has {
		t.Fatal("the Showcase fixture has no layoutVersion: it must be in the current form")
	}
	delete(cfg, "layoutVersion")
	pre, err := json.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	before := storedRaw(db)
	code, resp := c.importFile(pre)
	if cur := fmt.Sprintf("layout version %d", configdoc.LayoutVersion); code != 400 || !strings.Contains(resp["error"].(string), cur) {
		t.Fatalf("import: %d %v, want 400 naming %s", code, resp, cur)
	}
	if storedRaw(db) != before {
		t.Error("config row changed")
	}
}

// Every release source lands in the current form.
func TestImport_ReleaseSourcesWriteCurrentForm(t *testing.T) {
	sample, err := os.ReadFile("../configdoc/testdata/real_sample.json")
	if err != nil {
		t.Fatal(err)
	}
	weavers, err := os.ReadFile("../configdoc/testdata/real_weavers.json")
	if err != nil {
		t.Fatal(err)
	}
	sources := map[string][]byte{
		"v2 Sample":  sample,
		"v2 Weavers": weavers,
		"Homer":      []byte("title: H\nservices:\n  - name: Media\n    items:\n      - name: Plex\n        url: https://plex\n      - name: Sonarr\n        url: https://sonarr\n"),
		"Dashy":      []byte("pageInfo:\n  title: D\nsections:\n  - name: Tools\n    items:\n      - title: Grafana\n        url: https://grafana\n      - title: Loki\n        url: https://loki\n"),
		"Heimdall":   []byte(`[{"title":"Plex","url":"http://plex"},{"title":"Sonarr","url":"http://sonarr"}]`),
	}
	for name, data := range sources {
		t.Run(name, func(t *testing.T) {
			router, db := setupTestRouter(t)
			c := newClient(t, router)
			if code, resp := c.importFile(data); code != 200 {
				t.Fatalf("import: %d %v", code, resp)
			}
			doc := storedDoc(t, db)
			if err := configdoc.CheckLayoutVersion(doc); err != nil {
				t.Fatal(err)
			}
			ds := dashList(doc)
			imp := ds[len(ds)-1]
			assertCurrentDashboard(t, imp)
			// Folder children keep the source's entry order.
			f := imp["tabs"].([]any)[0].(configdoc.Obj)["root"].(configdoc.Obj)["children"].([]any)[0].(configdoc.Obj)
			var got []string
			for _, k := range contentKids(f) {
				got = append(got, k.(configdoc.Obj)["name"].(string))
			}
			if want := firstGroupNames(t, name, data); strings.Join(got, "|") != strings.Join(want, "|") {
				t.Errorf("first folder's children = %q, want the source order %q", got, want)
			}
		})
	}
}

// firstGroupNames is the entry names of the source's first group, in order:
// read from the file for a v2 export, as written for the inline sources.
func firstGroupNames(t *testing.T, source string, data []byte) []string {
	t.Helper()
	switch source {
	case "Homer", "Heimdall":
		return []string{"Plex", "Sonarr"}
	case "Dashy":
		return []string{"Grafana", "Loki"}
	}
	var v2 map[string]any
	if err := json.Unmarshal(data, &v2); err != nil {
		t.Fatal(err)
	}
	tab := v2["dashboards"].([]any)[0].(map[string]any)["tabs"].([]any)[0].(map[string]any)
	var out []string
	for _, e := range tab["groups"].([]any)[0].(map[string]any)["entries"].([]any) {
		out = append(out, e.(map[string]any)["name"].(string))
	}
	if len(out) < 2 {
		t.Fatalf("%s: first group has %d entries; the order check needs at least 2", source, len(out))
	}
	return out
}

func TestNewDashboard_IsCurrentForm(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	code, resp := c.do("POST", "/api/dashboards", map[string]interface{}{"name": "New", "path": "/new"})
	if code != 200 {
		t.Fatalf("create: %d %v", code, resp)
	}
	d := storedDash(t, db, resp["id"].(string))
	assertCurrentDashboard(t, d)
	tab := d["tabs"].([]any)[0].(configdoc.Obj)
	if _, has := tab["layout"]; has {
		t.Error("new tab has a layout")
	}
}

// A transfer onto a tab places each item at the first free cells at its
// standard span; into a folder it appends, with no placement; a folder child
// moved onto a tab gets its size's span.
func TestTransfer_FolderPlacement(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	addD2(t, db)
	d2 := v3Body(t, c, "d2")
	tabID := d2["tabs"].([]interface{})[0].(map[string]interface{})["id"].(string)
	folderID := rootOf(d2)["children"].([]interface{})[0].(map[string]interface{})["id"].(string)

	// e1 (a folder child in d1, size absent: Medium) → d2's tab: 2×2.
	code, resp := c.do("POST", "/api/dashboards/transfer", transferBody(map[string]interface{}{
		"target": map[string]interface{}{"tabId": tabID}}))
	if code != 200 {
		t.Fatalf("copy to tab: %d %v", code, resp)
	}
	dst := storedDash(t, db, "d2")
	assertCurrentDashboard(t, dst)
	kids := dst["tabs"].([]any)[0].(configdoc.Obj)["root"].(configdoc.Obj)["children"].([]any)
	last := kids[len(kids)-1].(configdoc.Obj)
	p := last["placement"].(configdoc.Obj)
	if p["w"] != float64(2) || p["h"] != float64(2) {
		t.Errorf("tile copied onto the tab has placement %v, want a 2×2 Medium span", p)
	}

	// The whole d1 folder g1 → into d2's folder: appended last, no placement.
	code, resp = c.do("POST", "/api/dashboards/transfer", transferBody(map[string]interface{}{
		"nodeIds": []string{"g1"}, "targetRevision": 2,
		"target": map[string]interface{}{"tabId": tabID, "folderId": folderID}}))
	if code != 200 {
		t.Fatalf("copy into folder: %d %v", code, resp)
	}
	dst = storedDash(t, db, "d2")
	assertCurrentDashboard(t, dst)
	f := findOne(dst, folderID)
	fk := contentKids(f)
	lastIn := fk[len(fk)-1].(configdoc.Obj)
	if lastIn["kind"] != "folder" || lastIn["name"] != "Group" {
		t.Errorf("last child of the target folder = %v, want the copied folder", lastIn["name"])
	}
}
