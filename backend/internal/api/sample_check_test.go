package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/database"
)

// The shipped Sample passes every check a dashboard save applies.
func TestSample_PassesSaveChecks(t *testing.T) {
	r, _, _ := setupTestRouterCore(t, "", nil, nil, t.TempDir())
	if err := sampleSaveProblem(r.settings); err != nil {
		t.Fatalf("the built-in Sample fails the save checks: %v", err)
	}
	if r.sampleProblem != "" {
		t.Fatalf("start-up recorded a Sample problem: %s", r.sampleProblem)
	}
	if _, ok := r.sampleNotice(); ok {
		t.Fatal("a valid Sample shows a notice")
	}
}

// The checks are the save checks: a reserved path, an over-long name, a bad
// settings override or a path clash is refused with a reason.
func TestSaveChecksProblem_RefusesWhatASaveRefuses(t *testing.T) {
	r, _, _ := setupTestRouterCore(t, "", nil, nil, t.TempDir())
	cases := map[string]func(d configdoc.Obj, doc configdoc.Obj){
		"reserved": func(d, _ configdoc.Obj) { d["path"] = "/settings" },
		"longer":   func(d, _ configdoc.Obj) { d["name"] = strings.Repeat("x", maxDashboardNameRunes+1) },
		"setting":  func(d, _ configdoc.Obj) { d["settings"].(configdoc.Obj)["statusCheckIntervalMinutes"] = -5 },
		"unknown":  func(d, _ configdoc.Obj) { d["settings"].(configdoc.Obj)["bogus"] = 1 },
		"already": func(d, doc configdoc.Obj) {
			doc["dashboards"] = append(doc["dashboards"].([]any), configdoc.Obj{"id": "other", "name": "O", "path": d["path"]})
		},
		"whitespace": func(d, _ configdoc.Obj) { d["path"] = " /sample" },
	}
	for want, mutate := range cases {
		doc, err := database.SampleDoc()
		if err != nil {
			t.Fatal(err)
		}
		mutate(doc["dashboards"].([]any)[0].(configdoc.Obj), doc)
		err = saveChecksProblem(r.settings, doc)
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: saveChecksProblem = %v, want a refusal mentioning %q", want, err, want)
		}
	}
}

// A Sample that fails the checks is never silent: a sticky warning notice on
// GET /api/config (the reset handler re-runs the checks and refuses).
func TestSampleProblem_StickyNotice(t *testing.T) {
	r, _, db := setupTestRouterCore(t, "", nil, nil, t.TempDir())
	r.sampleProblem = "sample dashboard \"sample\": injected"
	n, ok := r.sampleNotice()
	if !ok || !n.Sticky || n.Level != "warning" || !strings.Contains(n.Text, "injected") {
		t.Fatalf("sampleNotice = %+v, %v", n, ok)
	}
	stored, err := configdoc.Load(db)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, c := range r.currentNotices(stored) {
		found = found || c.ID == noticeSampleInvalid
	}
	if !found {
		t.Fatal("the Sample notice is not in the current notices")
	}
}

// Factory reset runs the save checks first (the real Sample passes them).
func TestResetConfig_RunsSaveChecks(t *testing.T) {
	router, _ := setupTestRouter(t)
	token, csrf := loginTestUserWithCSRF(t, router)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, authedRequest("POST", "/api/config/reset", nil, token, csrf))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"schemaVersion": 3`) {
		t.Fatalf("reset = %d %s", w.Code, w.Body.String()[:min(200, w.Body.Len())])
	}
}
