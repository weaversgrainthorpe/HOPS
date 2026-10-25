package database

import (
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"
)

// PlanRetention is THE retention rule (M6 §11). Table tests, including
// Jonathan's own examples.

var now = time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)

// bk is an automatic backup made `days` days before now (i keeps names unique).
func bk(reason string, days float64, i int) BackupInfo {
	at := now.Add(-time.Duration(days * float64(24*time.Hour)))
	return BackupInfo{
		Name:      fmt.Sprintf("hops-backup-%s-%d_%s.db", at.Format("2006-01-02_15-04-05"), i, reason),
		CreatedAt: at,
	}
}

// series is n startup backups, the newest `start` days old, one every `every` days.
func series(n int, start, every float64) []BackupInfo {
	out := make([]BackupInfo, n)
	for i := range out {
		out[i] = bk("startup", start+float64(i)*every, i)
	}
	return out
}

func names(d []RetentionDeletion) []string {
	out := make([]string, len(d))
	for i, x := range d {
		out[i] = x.Name
	}
	sort.Strings(out)
	return out
}

func infoNames(b []BackupInfo) []string {
	out := make([]string, len(b))
	for i, x := range b {
		out[i] = x.Name
	}
	sort.Strings(out)
	return out
}

func TestPlanRetention(t *testing.T) {
	s10 := series(10, 0, 1)   // 0..9 days old
	s20 := series(20, 0, 1)   // 0..19 days old
	quiet := series(5, 90, 1) // 90..94 days old: nothing new for 90 days
	tests := []struct {
		name        string
		backups     []BackupInfo
		policy      RetentionPolicy
		wantDeleted []BackupInfo
		wantCeiling int
	}{
		{"Jonathan: 4 backups, keep 5 — nothing happens", series(4, 0, 1), RetentionPolicy{5, 0, 100}, nil, 0},
		{"Jonathan: keep 5 / 60 days after 90 quiet days — all 5 stay", quiet, RetentionPolicy{5, 60, 100}, nil, 0},
		{"empty", nil, RetentionPolicy{10, 0, 100}, nil, 0},
		{"exactly keep_count", s10, RetentionPolicy{10, 0, 100}, nil, 0},
		{"keep_days off: everything beyond the newest N goes", s20, RetentionPolicy{10, 0, 100}, s20[10:], 0},
		{"keep_days window keeps the newer extras", s20, RetentionPolicy{10, 14, 100}, s20[15:], 0},
		{"window covers all: nothing goes", s20, RetentionPolicy{10, 365, 100}, nil, 0},
		{"ceiling trims the window's oldest, never the newest N", s20, RetentionPolicy{5, 365, 12}, s20[12:], 8},
		{"ceiling equals keep_count", s20, RetentionPolicy{5, 365, 5}, s20[5:], 15},
		{"ceiling below keep_count is raised to it (safe)", s20, RetentionPolicy{8, 365, 3}, s20[8:], 12},
		{"ceiling and window together", s20, RetentionPolicy{5, 10, 8}, s20[8:], 3},
		{"keep_count below the minimum is raised to 3", s10, RetentionPolicy{1, 0, 100}, s10[3:], 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := PlanRetention(tc.backups, tc.policy, now)
			if g, w := names(got), infoNames(tc.wantDeleted); strings.Join(g, ",") != strings.Join(w, ",") {
				t.Fatalf("deleted\n got %v\nwant %v", g, w)
			}
			ceiling := 0
			for _, d := range got {
				if d.Reason == "" {
					t.Errorf("%s has no reason", d.Name)
				}
				if d.OverCeiling {
					ceiling++
				}
			}
			if ceiling != tc.wantCeiling {
				t.Errorf("over-ceiling deletions: got %d want %d", ceiling, tc.wantCeiling)
			}
		})
	}
}

func TestPlanRetentionNeverDeletesProtected(t *testing.T) {
	var all []BackupInfo
	for i, r := range []string{PreV3MigrationReason, "manual", UploadedReason, "my-custom-reason", "something-unknown"} {
		all = append(all, bk(r, 400+float64(i), 100+i)) // very old
	}
	all = append(all, series(8, 0, 1)...)
	got := PlanRetention(all, RetentionPolicy{3, 0, 3}, now)
	for _, d := range got {
		if IsProtectedBackup(d.Name) {
			t.Fatalf("protected backup deleted: %s", d.Name)
		}
	}
	if len(got) != 5 {
		t.Fatalf("protected backups counted toward keep_count: %d deleted, want 5", len(got))
	}
	// A name HOPS doesn't recognise is protected (the safe reading).
	if !IsProtectedBackup("hops-backup-weird.db") {
		t.Fatal("unrecognised name not protected")
	}
	for _, r := range []string{"startup", "pre-config-update", "pre-restore", "pre-factory-reset"} {
		if IsProtectedBackup(bk(r, 1, 1).Name) {
			t.Errorf("%s should be auto-deletable", r)
		}
	}
	if IsProtectedBackup("hops-backup-2026-01-01_00-00-00-3_startup.db") {
		t.Error("collision-suffixed startup backup not recognised")
	}
}

func TestPlanRetentionOrderIndependentAndPure(t *testing.T) {
	s := series(15, 0, 1)
	rev := make([]BackupInfo, len(s))
	for i := range s {
		rev[i] = s[len(s)-1-i]
	}
	a := PlanRetention(s, RetentionPolicy{5, 7, 100}, now)
	b := PlanRetention(rev, RetentionPolicy{5, 7, 100}, now)
	if strings.Join(names(a), ",") != strings.Join(names(b), ",") {
		t.Fatal("input order changed the plan")
	}
	if rev[0].Name != s[len(s)-1].Name {
		t.Fatal("PlanRetention reordered its input")
	}
}

func TestPlanRetentionReasons(t *testing.T) {
	s := series(20, 0, 1)
	got := PlanRetention(s, RetentionPolicy{5, 10, 8}, now)
	var old, ceil int
	for _, d := range got {
		switch {
		case d.OverCeiling && strings.Contains(d.Reason, "over the ceiling of 8"):
			ceil++
		case !d.OverCeiling && strings.Contains(d.Reason, "older than 10 days"):
			old++
		default:
			t.Errorf("unexpected reason %q", d.Reason)
		}
	}
	if old != 9 || ceil != 3 {
		t.Fatalf("old %d ceil %d", old, ceil)
	}
}
