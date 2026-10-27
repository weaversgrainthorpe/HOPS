package api

import (
	"fmt"
	"log/slog"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/database"
	"github.com/weaversgrainthorpe/HOPS/internal/settings"
)

// noticeSampleInvalid is the sticky warning shown when the built-in Sample
// (what a fresh install and a factory reset write) fails the checks a save
// through the API applies. It goes when a build with a valid Sample runs.
const noticeSampleInvalid = "sample-fails-save-checks"

// sampleSaveProblem runs, on every dashboard of the built-in Sample, the same
// checks a dashboard save applies (dashboard_v3.go handlePutDashboardV3 and
// the settings endpoint): a safe, unreserved path no other dashboard uses,
// name bounds, VerifyDashboard and the settings overrides. database.SampleDoc
// has already checked ids and the layout version. nil means the Sample would
// be accepted by a save exactly as it ships.
func sampleSaveProblem(svc *settings.Service) error {
	doc, err := database.SampleDoc()
	if err != nil {
		return err
	}
	return saveChecksProblem(svc, doc)
}

// saveChecksProblem is sampleSaveProblem's checks on any v3 document.
func saveChecksProblem(svc *settings.Service, doc configdoc.Obj) error {
	ds, _ := doc["dashboards"].([]any)
	for _, x := range ds {
		d, _ := x.(configdoc.Obj)
		id, _ := d["id"].(string)
		p, _ := d["path"].(string)
		if pe := unsafePathError(d); pe != nil {
			return fmt.Errorf("sample dashboard %q: %w", id, pe)
		}
		if ce := pathClash(doc, id, p); ce != nil {
			return fmt.Errorf("sample dashboard %q: %v", id, ce.body["detail"])
		}
		if ne := nameBoundsError(d); ne != nil {
			return fmt.Errorf("sample dashboard %q: %w", id, ne)
		}
		if err := configdoc.VerifyDashboard(d); err != nil {
			return fmt.Errorf("sample dashboard %q: %w", id, err)
		}
		s, _ := d["settings"].(configdoc.Obj)
		if err := configdoc.ValidateOverrides(svc, s); err != nil {
			return fmt.Errorf("sample dashboard %q: %w", id, err)
		}
	}
	return nil
}

// checkSample runs sampleSaveProblem at start-up; a failure is logged at
// ERROR and kept for the sticky notice (sampleNotice), never only logged.
func (r *Router) checkSample() {
	if err := sampleSaveProblem(r.settings); err != nil {
		slog.Error("the built-in Sample fails the save checks; a fresh install or factory reset would write it", "component", "api", "error", err)
		r.sampleProblem = err.Error()
	}
}

func (r *Router) sampleNotice() (notice, bool) {
	if r.sampleProblem == "" {
		return notice{}, false
	}
	return notice{
		ID: noticeSampleInvalid,
		Text: "The built-in Sample dashboard in this build fails HOPS's own save checks (" + r.sampleProblem +
			"). Factory reset is refused until a fixed build is installed; please report this.",
		Level:  "warning",
		Sticky: true,
	}, true
}
