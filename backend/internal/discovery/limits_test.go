package discovery

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/database"
	"github.com/weaversgrainthorpe/HOPS/internal/settings"
	_ "modernc.org/sqlite"
)

func newLimitsOrchestrator(t *testing.T) (*Orchestrator, *Store, *settings.Service) {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	db.SetMaxOpenConns(1)
	if err := database.RunMigrations(db); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	svc, err := settings.New(db)
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(db)
	o := NewOrchestrator(store, svc)
	t.Cleanup(o.Stop)
	return o, store, svc
}

// §1 item 6: the limits are GUI settings (registered definitions with sane
// defaults and bounds), and they are enforced.
func TestScanLimitsAreSettingsWithSaneDefaults(t *testing.T) {
	want := map[string][3]int{ // default, min, max
		settings.KeyDiscoveryMaxParallelProbes:  {128, 1, 1024},
		settings.KeyDiscoveryPerHostTimeoutSecs: {1, 1, 60},
		settings.KeyDiscoveryMaxScanMinutes:     {30, 1, 240},
	}
	found := 0
	for _, d := range settings.Definitions {
		w, ok := want[d.Key]
		if !ok {
			continue
		}
		found++
		if d.Default != strconv.Itoa(w[0]) || d.Min != w[1] || d.Max != w[2] {
			t.Errorf("%s: default=%s min=%d max=%d, want %v", d.Key, d.Default, d.Min, d.Max, w)
		}
	}
	if found != len(want) {
		t.Fatalf("found %d of %d discovery limit settings", found, len(want))
	}
}

func TestOneScanAtATime(t *testing.T) {
	o, _, _ := newLimitsOrchestrator(t)
	if !o.Reserve() {
		t.Fatal("first Reserve refused")
	}
	if o.Reserve() {
		t.Fatal("second Reserve allowed while a scan holds the slot")
	}
	o.Release()
	if !o.Reserve() {
		t.Fatal("Reserve after Release refused")
	}
	o.Release()
}

func TestScanStopsAtMaxDurationAndSaysSo(t *testing.T) {
	o, store, svc := newLimitsOrchestrator(t)
	if err := svc.Set(settings.KeyDiscoveryMaxScanMinutes, "1"); err != nil {
		t.Fatal(err)
	}
	o.minute = 50 * time.Millisecond
	// A passive source that takes its whole listen window (as real mDNS does), with no network.
	old := browseMDNS
	browseMDNS = func(ctx context.Context, _ hostAllowlist) ([]mdnsInstance, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	t.Cleanup(func() { browseMDNS = old })
	if _, err := store.CreateScan("lim", "127.0.0.1", IntensityPassive, "", "", 0); err != nil {
		t.Fatal(err)
	}
	if !o.Reserve() {
		t.Fatal("reserve")
	}
	start := time.Now()
	o.Submit("lim")
	var sc *Scan
	for time.Since(start) < 20*time.Second {
		sc, _ = store.GetScan("lim")
		if sc != nil && sc.State != StatePending && sc.State != StateRunning {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if sc == nil || sc.State != StateFailed || !strings.Contains(sc.ErrorMessage, "1-minute limit") {
		t.Fatalf("scan = %+v, want failed with the time-limit message", sc)
	}
	if el := time.Since(start); el > 10*time.Second {
		t.Errorf("scan ran %v past a 50ms limit", el)
	}
	// The slot is freed when the scan ends.
	deadline := time.Now().Add(2 * time.Second)
	for !o.Reserve() {
		if time.Now().After(deadline) {
			t.Fatal("slot not released after the scan ended")
		}
		time.Sleep(10 * time.Millisecond)
	}
	o.Release()
}
