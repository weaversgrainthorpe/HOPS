package api

import (
	"compress/gzip"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// seedTwo stores two dashboards, d1 at /first (order 1) and d2 at /second
// (order 0), plus the showcase: d2 is first in display order.
func seedTwo(t *testing.T, db *sql.DB) {
	t.Helper()
	a, b := legacyDash("First"), legacyDash("Second")
	a["path"], a["order"] = "/first", 1
	b["id"], b["path"], b["order"] = "d2", "/second", 0
	b["tabs"].([]interface{})[0].(map[string]interface{})["id"] = "t2"
	b["tabs"].([]interface{})[0].(map[string]interface{})["groups"].([]interface{})[0].(map[string]interface{})["id"] = "g2"
	b["tabs"].([]interface{})[0].(map[string]interface{})["groups"].([]interface{})[0].(map[string]interface{})["entries"].([]interface{})[0].(map[string]interface{})["id"] = "e2"
	doc, err := configdoc.MigrateV2(configdoc.Obj{"dashboards": []any{a, b}})
	if err != nil {
		t.Fatal(err)
	}
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
	addShowcase(t, db)
}

func anonGet(h http.Handler, path string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("GET", path, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func anonJSON(t *testing.T, h http.Handler, path string) (int, map[string]interface{}) {
	t.Helper()
	w := anonGet(h, path, nil)
	var out map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("%s: %v: %s", path, err, w.Body.String())
	}
	return w.Code, out
}

func dashByID(v map[string]interface{}) map[string]map[string]interface{} {
	out := map[string]map[string]interface{}{}
	for _, d := range v["dashboards"].([]interface{}) {
		dm := d.(map[string]interface{})
		out[dm["id"].(string)] = dm
	}
	return out
}

func TestConfigPartial_IndexPlusOne(t *testing.T) {
	router, db := setupTestRouter(t)
	seedTwo(t, db)
	_, full := anonJSON(t, router, "/api/config")
	code, part := anonJSON(t, router, "/api/config?dashboard=/first")
	if code != 200 {
		t.Fatalf("code %d", code)
	}
	fd, pd := dashByID(full), dashByID(part)
	if len(pd) < 3 {
		t.Fatalf("want sample + 2 dashboards, got %d", len(pd))
	}
	if !reflect.DeepEqual(pd["d1"], fd["d1"]) {
		t.Fatalf("requested dashboard is not equal to its /api/config copy")
	}
	if _, p := pd["d1"]["partial"]; p {
		t.Fatal("the requested dashboard must not be partial")
	}
	allowed := map[string]bool{"id": true, "name": true, "path": true, "order": true, "revision": true, "display": true, "settings": true, "header": true, "partial": true}
	for id, d := range pd {
		if id == "d1" {
			continue
		}
		if d["partial"] != true {
			t.Errorf("%s: not partial: %v", id, d)
		}
		for k := range d {
			if !allowed[k] {
				t.Errorf("%s: index entry carries %q", id, k)
			}
		}
		for _, k := range []string{"id", "name", "path", "revision"} {
			if d[k] != fd[id][k] {
				t.Errorf("%s: %s = %v, want %v", id, k, d[k], fd[id][k])
			}
		}
		if _, has := fd[id]["order"]; has && d["order"] != fd[id]["order"] {
			t.Errorf("%s: order differs", id)
		}
		if _, has := d["tabs"]; has {
			t.Errorf("%s: index entry carries tabs", id)
		}
	}
	if s, _ := part["configRevision"].(string); s == "" {
		t.Error("configRevision missing")
	}
	if _, has := full["configRevision"]; has {
		t.Error("plain /api/config must not change shape")
	}
	if part["schemaVersion"] != full["schemaVersion"] || part["layoutVersion"] != full["layoutVersion"] {
		t.Error("top-level keys differ from /api/config")
	}
	// By id, and the root default (first in display order = d2).
	_, byID := anonJSON(t, router, "/api/config?dashboard=d2")
	if _, p := dashByID(byID)["d2"]["partial"]; p {
		t.Error("lookup by id: d2 should be full")
	}
	for _, q := range []string{"", "/"} {
		_, def := anonJSON(t, router, "/api/config?dashboard="+q)
		if _, p := dashByID(def)["d2"]["partial"]; p {
			t.Errorf("dashboard=%q: the first dashboard in display order should be full", q)
		}
		if _, has := def["missing"]; has {
			t.Errorf("dashboard=%q: unexpected missing", q)
		}
	}
}

func TestConfigPartial_SameVisibilityAsFull(t *testing.T) {
	router, db := setupTestRouter(t)
	seedTwo(t, db)
	_, full := anonJSON(t, router, "/api/config")
	_, part := anonJSON(t, router, "/api/config?dashboard=first")
	names := func(v map[string]interface{}) map[string]interface{} {
		out := map[string]interface{}{}
		for id, d := range dashByID(v) {
			out[id] = d["name"]
		}
		return out
	}
	if !reflect.DeepEqual(names(full), names(part)) {
		t.Fatalf("ids/names differ: %v vs %v", names(full), names(part))
	}
	// A signed-out viewer gets the same notices key set as the full read.
	for _, k := range []string{"notices", "migrationNotices"} {
		_, a := full[k]
		_, b := part[k]
		if a != b {
			t.Errorf("%s present differs: full %v partial %v", k, a, b)
		}
	}
}

func TestConfigPartial_UnknownDashboard(t *testing.T) {
	router, db := setupTestRouter(t)
	seedTwo(t, db)
	code, v := anonJSON(t, router, "/api/config?dashboard=nope")
	if code != 200 || v["missing"] != "nope" {
		t.Fatalf("%d missing=%v", code, v["missing"])
	}
	for id, d := range dashByID(v) {
		if d["partial"] != true {
			t.Errorf("%s not partial", id)
		}
	}
}

func TestConfigDashboard_One(t *testing.T) {
	router, db := setupTestRouter(t)
	seedTwo(t, db)
	_, full := anonJSON(t, router, "/api/config")
	code, one := anonJSON(t, router, "/api/config/dashboard/d1")
	if code != 200 {
		t.Fatalf("code %d", code)
	}
	if !reflect.DeepEqual(one["dashboard"], dashByID(full)["d1"]) {
		t.Fatal("dashboard differs from its /api/config copy")
	}
	if one["revision"] != dashByID(full)["d1"]["revision"] || one["configRevision"] == nil {
		t.Fatalf("revision: %v / %v", one["revision"], one["configRevision"])
	}
	code, nf := anonJSON(t, router, "/api/config/dashboard/nope")
	if code != 404 || nf["error"] == nil {
		t.Fatalf("unknown: %d %v", code, nf)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("POST", "/api/config/dashboard/d1", nil))
	if w.Code < 400 {
		t.Fatalf("POST allowed: %d", w.Code)
	}
}

func TestConfigPartial_Gzip(t *testing.T) {
	router, db := setupTestRouter(t)
	seedTwo(t, db)
	for _, p := range []string{"/api/config?dashboard=d1", "/api/config/dashboard/d1"} {
		w := anonGet(router, p, map[string]string{"Accept-Encoding": "gzip"})
		if w.Header().Get("Content-Encoding") != "gzip" {
			t.Fatalf("%s: not gzipped", p)
		}
		zr, err := gzip.NewReader(w.Body)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(zr)
		if !json.Valid(b) {
			t.Fatalf("%s: body is not JSON", p)
		}
	}
}

func TestConfigPartial_MigrationGuard(t *testing.T) {
	router, _ := setupTestRouterWithMigration(t, &configdoc.MigrationResult{Failed: true, Detail: "boom"})
	for _, p := range []string{"/api/config", "/api/config?dashboard=d1", "/api/config/dashboard/d1"} {
		code, v := anonJSON(t, router, p)
		if code != 503 || v["error"] != "migration_failed" || v["detail"] != "boom" {
			t.Fatalf("%s: %d %v", p, code, v)
		}
	}
}

// The navbar reads a dashboard's header while it is fetched on its own, so an
// index entry carries it, unchanged.
func TestConfigIndex_CarriesHeader(t *testing.T) {
	router, db := setupTestRouter(t)
	seedTwo(t, db)
	c := newClient(t, router)
	d := v3Body(t, c, "d2")
	d["header"] = map[string]interface{}{"centerTitle": "Lab bench", "showLeft": false}
	if code, resp := v3Put(c, "d2", d, 1); code != 200 {
		t.Fatalf("%d %v", code, resp)
	}
	_, full := anonJSON(t, router, "/api/config")
	_, part := anonJSON(t, router, "/api/config?dashboard=/first")
	got := dashByID(part)["d2"]
	if got["partial"] != true || !reflect.DeepEqual(got["header"], dashByID(full)["d2"]["header"]) {
		t.Fatalf("index entry header: %v", got)
	}
}
