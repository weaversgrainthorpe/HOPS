package api

import (
	"database/sql"
	"fmt"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/discovery"
)

// diffScan seeds a scan of cidr with the given created_at and state. rows are
// "host:port:detector:name"-style tuples passed as [4]string{host, port, detector, name}.
func diffScan(t *testing.T, db *sql.DB, id, cidr, createdAt, state string, rows ...[5]interface{}) {
	t.Helper()
	st := discovery.NewStore(db)
	if _, err := st.CreateScan(id, cidr, "light", "", "", 1); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE scans SET created_at = ? WHERE id = ?`, createdAt, id); err != nil {
		t.Fatal(err)
	}
	for i, r := range rows {
		cur := discovery.CuratePending
		if r[4] != nil {
			cur = r[4].(string)
		}
		if err := st.InsertResult(&discovery.Result{
			ID: fmt.Sprintf("%s-r%d", id, i), ScanID: id, Host: r[0].(string), Port: r[1].(int),
			DetectorID: r[2].(string), Confidence: "high", Category: discovery.CategoryOther,
			SuggestedName: r[3].(string), SuggestedURL: "http://" + r[0].(string), CurateState: cur,
		}); err != nil {
			t.Fatal(err)
		}
	}
	if state != discovery.StatePending {
		if err := st.SetScanState(id, state, ""); err != nil {
			t.Fatal(err)
		}
	}
}

func rowSet(host string, port int, det, name string) [5]interface{} {
	return [5]interface{}{host, port, det, name, nil}
}

func TestDiff_NewGoneChangedUnchanged(t *testing.T) {
	_, db := setupTestRouter(t)
	diffScan(t, db, "old", "192.0.2.0/24", "2026-10-12T10:00:00Z", discovery.StateComplete,
		rowSet("192.0.2.1", 80, "a/web", "Web"),
		rowSet("192.0.2.2", 8080, "a/grafana", "Grafana"),
		rowSet("192.0.2.3", 443, "a/nas", "NAS"),
		[5]interface{}{"192.0.2.4", 9000, "a/portainer", "Portainer", discovery.CuratePromoted},
		rowSet("192.0.2.5", 80, "a/old", "Old name"),
	)
	diffScan(t, db, "new", "192.0.2.0/24", "2026-10-20T10:00:00Z", discovery.StateComplete,
		rowSet("192.0.2.1", 80, "a/web", "Web"),         // unchanged
		rowSet("192.0.2.2", 8080, "a/other", "Other"),   // changed detector
		rowSet("192.0.2.5", 80, "a/old", "Renamed"),     // changed name
		rowSet("192.0.2.9", 3000, "a/gitea", "Gitea"),   // new
		rowSet("192.0.2.9", 3001, "a/gitea", "Gitea 2"), // new
	)
	d, err := discovery.NewStore(db).DiffFor("new")
	if err != nil {
		t.Fatal(err)
	}
	if !d.Comparable || d.Baseline == nil || d.Baseline.ID != "old" {
		t.Fatalf("baseline wrong: %+v", d)
	}
	want := map[string]string{"new-r0": "unchanged", "new-r1": "changed", "new-r2": "changed", "new-r3": "new", "new-r4": "new"}
	for id, s := range want {
		if d.States[id] != s {
			t.Errorf("%s = %q, want %q", id, d.States[id], s)
		}
	}
	if d.Counts.New != 2 || d.Counts.Changed != 2 || d.Counts.Unchanged != 1 || d.Counts.Gone != 2 {
		t.Errorf("counts = %+v", d.Counts)
	}
	gone := map[string]bool{}
	for _, g := range d.Gone {
		gone[g.Host] = g.WasPromoted
	}
	if len(gone) != 2 || gone["192.0.2.3"] != false || gone["192.0.2.4"] != true {
		t.Errorf("gone = %+v", d.Gone)
	}
	if d.Previous["new-r1"].DetectorID != "a/grafana" {
		t.Errorf("previous for changed row = %+v", d.Previous["new-r1"])
	}
}

func TestDiff_FirstScanHasNothingToCompare(t *testing.T) {
	_, db := setupTestRouter(t)
	// Different range and a later scan must not count as a baseline.
	diffScan(t, db, "other", "198.51.100.0/24", "2026-10-01T10:00:00Z", discovery.StateComplete, rowSet("198.51.100.1", 80, "a/web", "Web"))
	diffScan(t, db, "first", "192.0.2.0/24", "2026-10-10T10:00:00Z", discovery.StateComplete, rowSet("192.0.2.1", 80, "a/web", "Web"))
	diffScan(t, db, "later", "192.0.2.0/24", "2026-10-15T10:00:00Z", discovery.StateComplete)
	d, err := discovery.NewStore(db).DiffFor("first")
	if err != nil {
		t.Fatal(err)
	}
	if d.Comparable || d.Baseline != nil || d.Reason != "first" || len(d.Gone) != 0 {
		t.Fatalf("expected first-scan result, got %+v", d)
	}
}

func TestDiff_FailedAndCancelledPreviousIgnoredAndReported(t *testing.T) {
	_, db := setupTestRouter(t)
	diffScan(t, db, "good", "192.0.2.0/24", "2026-10-01T10:00:00Z", discovery.StateComplete,
		rowSet("192.0.2.1", 80, "a/web", "Web"), rowSet("192.0.2.2", 80, "a/web", "Web2"))
	diffScan(t, db, "bad", "192.0.2.0/24", "2026-10-05T10:00:00Z", discovery.StateFailed, rowSet("192.0.2.1", 80, "a/web", "Web"))
	diffScan(t, db, "cut", "192.0.2.0/24", "2026-10-06T10:00:00Z", discovery.StateCancelled)
	diffScan(t, db, "cur", "192.0.2.0/24", "2026-10-10T10:00:00Z", discovery.StateComplete, rowSet("192.0.2.1", 80, "a/web", "Web"))
	d, err := discovery.NewStore(db).DiffFor("cur")
	if err != nil {
		t.Fatal(err)
	}
	if d.Baseline == nil || d.Baseline.ID != "good" {
		t.Fatalf("baseline should skip failed/cancelled: %+v", d.Baseline)
	}
	if len(d.Ignored) != 2 || d.Counts.Gone != 1 {
		t.Fatalf("ignored=%+v counts=%+v", d.Ignored, d.Counts)
	}

	// Only failed predecessors: no comparison, but they are reported.
	diffScan(t, db, "solo-bad", "203.0.113.0/24", "2026-10-01T10:00:00Z", discovery.StateFailed)
	diffScan(t, db, "solo", "203.0.113.0/24", "2026-10-02T10:00:00Z", discovery.StateComplete)
	d2, _ := discovery.NewStore(db).DiffFor("solo")
	if d2.Comparable || len(d2.Ignored) != 1 {
		t.Fatalf("expected not comparable with 1 ignored: %+v", d2)
	}
}

func TestDiff_UnfinishedScanIsNotCompared(t *testing.T) {
	_, db := setupTestRouter(t)
	diffScan(t, db, "run", "192.0.2.0/24", "2026-10-10T10:00:00Z", discovery.StateRunning)
	d, err := discovery.NewStore(db).DiffFor("run")
	if err != nil {
		t.Fatal(err)
	}
	if d.Comparable || d.Reason != "unfinished" {
		t.Fatalf("running scan must not be compared: %+v", d)
	}
}

func TestDiffEndpoint(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	diffScan(t, db, "old", "192.0.2.0/24", "2026-10-12T10:00:00Z", discovery.StateComplete, rowSet("192.0.2.1", 80, "a/web", "Web"))
	diffScan(t, db, "new", "192.0.2.0/24", "2026-10-20T10:00:00Z", discovery.StateComplete, rowSet("192.0.2.7", 80, "a/web", "Web"))
	code, resp := c.do("GET", "/api/discovery/scans/new/diff", nil)
	if code != 200 {
		t.Fatalf("diff: %d %v", code, resp)
	}
	counts := resp["counts"].(map[string]interface{})
	if counts["new"] != float64(1) || counts["gone"] != float64(1) {
		t.Fatalf("counts = %v", counts)
	}
	if code, _ := c.do("GET", "/api/discovery/scans/missing/diff", nil); code != 404 {
		t.Fatalf("missing scan diff = %d, want 404", code)
	}
	// The list carries a per-scan summary.
	code, resp = c.do("GET", "/api/discovery/scans", nil)
	if code != 200 {
		t.Fatal(code)
	}
	sum := resp["changes"].(map[string]interface{})["new"].(map[string]interface{})
	if sum["new"] != float64(1) || sum["gone"] != float64(1) {
		t.Fatalf("list summary = %v", sum)
	}
}
