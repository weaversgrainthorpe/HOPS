package api

import (
	"strings"
	"testing"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/status"
)

func TestStatusNotices(t *testing.T) {
	t0 := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	five := 5 * time.Minute
	cases := []struct {
		name string
		h    status.Health
		now  time.Time
		want []string // the notice ids, then a phrase each must contain
	}{
		{"all well", status.Health{Took: time.Minute, Interval: five, Total: 10, Done: 10}, t0, nil},
		{"a long pass in progress", status.Health{Running: true, Started: t0, Total: 1129, Done: 412, Interval: five}, t0.Add(12 * time.Minute),
			[]string{"status-checks-behind", "Checking 1129 tiles has taken 12 minutes so far (412 done), longer than the check interval (5 minutes)"}},
		{"the last pass was slow", status.Health{Took: 22 * time.Minute, Total: 1129, Done: 1129, Interval: five}, t0,
			[]string{"status-checks-behind", "took 22 minutes for 1129 tiles"}},
		{"saving failed", status.Health{SaveError: "database is locked", SaveErrorAt: t0, Took: time.Second, Interval: five}, t0,
			[]string{"status-save-failed", "database is locked"}},
	}
	for _, c := range cases {
		r := &Router{}
		if got := r.statusNotices(c.now); got != nil {
			t.Fatalf("%s: notices without a checker: %v", c.name, got)
		}
		h := c.h
		r.SetStatusHealth(func() status.Health { return h })
		got := r.statusNotices(c.now)
		if len(c.want) == 0 {
			if len(got) != 0 {
				t.Errorf("%s: unexpected notices %v", c.name, got)
			}
			continue
		}
		if len(got) != 1 || got[0].ID != c.want[0] || !strings.Contains(got[0].Text, c.want[1]) || !got[0].Sticky || got[0].Level != "warning" {
			t.Errorf("%s: got %+v", c.name, got)
		}
	}
}

func TestRoughDuration(t *testing.T) {
	for d, want := range map[time.Duration]string{
		40 * time.Second: "40 seconds", time.Minute: "1 minute", 22 * time.Minute: "22 minutes",
		time.Hour: "1 hour", 65 * time.Minute: "1 hour 5 minutes",
	} {
		if got := roughDuration(d); got != want {
			t.Errorf("roughDuration(%v) = %q, want %q", d, got, want)
		}
	}
}
