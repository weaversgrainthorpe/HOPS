package discovery

import "testing"

// Names found by forward DNS all resolve to the same proxy address and port,
// so each is its own service: identical names in two scans are unchanged, not
// cross-compared against whichever name happened to come first.
func TestComputeDiffForwardNamesShareAProxy(t *testing.T) {
	fwd := func(id, name, label string) *Result {
		return &Result{ID: id, Host: "10.0.0.1", Hostname: name, Port: 443, DetectorID: "dns/forward", SuggestedName: label}
	}
	prev := []*Result{fwd("p1", "ha.example.test", "Home Assistant"), fwd("p2", "nas.example.test", "Nas"), fwd("p3", "old.example.test", "Old")}
	cur := []*Result{fwd("c1", "nas.example.test", "Nas"), fwd("c2", "ha.example.test", "Home Assistant"), fwd("c3", "new.example.test", "New")}

	states, _, gone := ComputeDiff(prev, cur)
	want := map[string]string{"c1": DiffUnchanged, "c2": DiffUnchanged, "c3": DiffNew}
	for id, st := range want {
		if states[id] != st {
			t.Errorf("%s: got %q, want %q", id, states[id], st)
		}
	}
	if len(gone) != 1 || gone[0].Hostname != "old.example.test" {
		t.Errorf("gone = %+v, want only old.example.test", gone)
	}
}

// A direct hit keeps host:port identity: a changed reverse-DNS name is not a
// new service.
func TestComputeDiffDirectHitIgnoresHostname(t *testing.T) {
	prev := []*Result{{ID: "p", Host: "10.0.0.5", Hostname: "a.lan", Port: 8080, DetectorID: "app/x", SuggestedName: "X"}}
	cur := []*Result{{ID: "c", Host: "10.0.0.5", Hostname: "b.lan", Port: 8080, DetectorID: "app/x", SuggestedName: "X"}}
	states, _, gone := ComputeDiff(prev, cur)
	if states["c"] != DiffUnchanged || len(gone) != 0 {
		t.Errorf("states=%v gone=%v, want unchanged and nothing gone", states, gone)
	}
}
