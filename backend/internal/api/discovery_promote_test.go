package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/discovery"
)

// seedScan inserts a complete scan with one pending result and returns the ids.
func seedScan(t *testing.T, db *sql.DB) (scanID, resultID string) {
	t.Helper()
	st := discovery.NewStore(db)
	scanID, resultID = "scan-0001", "result-0001"
	if _, err := st.CreateScan(scanID, "10.0.0.0/24", "passive", "t", "", 1); err != nil {
		t.Fatal(err)
	}
	if err := st.InsertResult(&discovery.Result{
		ID: resultID, ScanID: scanID, Host: "10.0.0.5", Port: 80, DetectorID: "x",
		Confidence: "high", Category: discovery.CategoryOther, SuggestedName: "Thing",
		SuggestedURL: "http://10.0.0.5", CurateState: discovery.CuratePending,
	}); err != nil {
		t.Fatal(err)
	}
	if err := st.SetScanState(scanID, discovery.StateComplete, ""); err != nil {
		t.Fatal(err)
	}
	return
}

func promoteBody(resultID string) map[string]interface{} {
	return map[string]interface{}{
		"target":    map[string]interface{}{"dashboardId": "d1", "tabId": "t1"},
		"resultIds": []string{resultID},
	}
}

func storedDash(t *testing.T, db *sql.DB, id string) configdoc.Obj {
	t.Helper()
	doc, err := configdoc.Load(db)
	if err != nil {
		t.Fatal(err)
	}
	d, ok := storedDashboards(doc)[id]
	if !ok {
		t.Fatalf("dashboard %s missing", id)
	}
	return d
}

func TestPromoteBumpsRevision(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	// Add a second dashboard so we can prove its revision is untouched.
	addD2(t, db)
	scanID, rid := seedScan(t, db)

	code, resp := c.do("POST", "/api/discovery/scans/"+scanID+"/promote", promoteBody(rid))
	if code != 200 {
		t.Fatalf("promote: %d %v", code, resp)
	}

	d1 := storedDash(t, db, "d1")
	if d1["revision"] != float64(2) {
		t.Fatalf("d1 revision = %v, want 2", d1["revision"])
	}
	if r := storedDash(t, db, "d2")["revision"]; r != float64(1) {
		t.Fatalf("d2 revision = %v, want 1 (untouched)", r)
	}
	root := d1["tabs"].([]interface{})[0].(map[string]interface{})["root"].(map[string]interface{})
	var found bool
	for _, ch := range root["children"].([]interface{}) {
		f := ch.(map[string]interface{})
		if f["kind"] != "folder" || f["name"] != "Other" {
			continue
		}
		found = true
		tiles := f["content"].(map[string]interface{})["children"].([]interface{})
		if len(tiles) != 1 {
			t.Fatalf("folder tiles = %v", tiles)
		}
		tile := tiles[0].(map[string]interface{})
		if _, placed := tile["placement"]; tile["kind"] != "tile" || placed {
			t.Fatalf("tile kind/placement wrong (folder contents are unplaced): %v", tile)
		}
	}
	if !found {
		b, _ := json.Marshal(root)
		t.Fatalf("new folder not found: %s", b)
	}
}

func TestPromote_MigrationFailed503(t *testing.T) {
	router, db := setupTestRouterWithMigration(t, &configdoc.MigrationResult{Failed: true, Detail: "boom"})
	c := newClient(t, router)
	scanID, rid := seedScan(t, db)
	var before string
	_ = db.QueryRow(`SELECT data FROM config WHERE id = 1`).Scan(&before)
	code, resp := c.do("POST", "/api/discovery/scans/"+scanID+"/promote", promoteBody(rid))
	if code != http.StatusServiceUnavailable || resp["error"] != "migration_failed" {
		t.Fatalf("got %d %v", code, resp)
	}
	var after string
	_ = db.QueryRow(`SELECT data FROM config WHERE id = 1`).Scan(&after)
	if before != after {
		t.Fatal("config row changed under migration failure")
	}
}

func TestPromote_UnreadableRevisionIs500AndWritesNothing(t *testing.T) {
	router, db := setupTestRouter(t)
	c := newClient(t, router)
	seed(t, db)
	doc, err := configdoc.Load(db)
	if err != nil {
		t.Fatal(err)
	}
	storedDashboards(doc)["d1"]["revision"] = "bogus"
	if err := configdoc.Save(db, doc); err != nil {
		t.Fatal(err)
	}
	var before string
	_ = db.QueryRow(`SELECT data FROM config WHERE id = 1`).Scan(&before)
	scanID, rid := seedScan(t, db)

	code, resp := c.do("POST", "/api/discovery/scans/"+scanID+"/promote", promoteBody(rid))
	if code != 500 {
		t.Fatalf("got %d %v, want 500", code, resp)
	}
	var after string
	_ = db.QueryRow(`SELECT data FROM config WHERE id = 1`).Scan(&after)
	if before != after {
		t.Fatal("config changed despite error")
	}
	res, err := discovery.NewStore(db).GetResult(scanID, rid)
	if err != nil || res.CurateState == discovery.CuratePromoted {
		t.Fatalf("result marked promoted despite error: %v %v", res, err)
	}
}
