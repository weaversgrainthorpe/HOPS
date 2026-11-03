package discovery

import "testing"

// The live results view polls with the newest created_at it has seen. created_at has one-second
// resolution, so a row written later in that same second must still come back on the next poll;
// a strictly-newer cursor dropped it from the page for good (found while checking 3.1 item 14).
func TestResultsSinceIncludesRowsFromTheCursorSecond(t *testing.T) {
	_, store, _ := newLimitsOrchestrator(t)
	if _, err := store.CreateScan("s1", "192.0.2.0/24", "light", "", "", 0); err != nil {
		t.Fatal(err)
	}
	if err := store.InsertResult(&Result{ID: "r1", ScanID: "s1", Host: "192.0.2.1", Port: 80, DetectorID: "x/a", Confidence: "high", CurateState: CuratePending}); err != nil {
		t.Fatal(err)
	}
	first, err := store.ListResultsSince("s1", "")
	if err != nil || len(first) != 1 {
		t.Fatalf("first poll: %v rows, err %v", len(first), err)
	}
	cursor := first[0].CreatedAt
	// A second row in the same second (force the timestamp so the test does not depend on timing).
	if err := store.InsertResult(&Result{ID: "r2", ScanID: "s1", Host: "192.0.2.2", Port: 80, DetectorID: "x/a", Confidence: "high", CurateState: CuratePending}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`UPDATE scan_results SET created_at = ? WHERE id = 'r2'`, cursor); err != nil {
		t.Fatal(err)
	}
	next, err := store.ListResultsSince("s1", cursor)
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, r := range next {
		ids[r.ID] = true
	}
	if !ids["r2"] {
		t.Fatalf("a row from the cursor's own second was dropped; got %v", ids)
	}
}
