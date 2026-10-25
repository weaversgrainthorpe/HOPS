package database

import (
	"fmt"
	"regexp"
	"time"
)

// Backup retention (M6 §11, Jonathan 2026-10-25). When the rules conflict the
// SAFEST reading wins: never delete what might be the last good copy, and
// never complain about having fewer backups than the target.
//
// PlanRetention is the ONE function that decides what is deleted; every
// cleanup (after a backup, daily, and "Clean up now") uses it.

// Retention bounds; the settings registry enforces the same.
const (
	MinKeepDays     = 0
	MaxKeepDays     = 3650
	MaxMaxCount     = 1000
	DefaultMaxCount = 100
	DefaultKeepDays = 0
)

// automaticReasons are the backups HOPS takes by itself. Only these are ever
// deleted automatically: anything else (the pre-v3-migration backup, a
// manual "Create", an upload, or a name HOPS doesn't recognise) is protected.
var automaticReasons = map[string]bool{
	"startup":           true,
	"pre-config-update": true,
	"pre-restore":       true,
	"pre-factory-reset": true,
}

// backupReasonPattern takes the reason out of
// "hops-backup-YYYY-MM-DD_HH-MM-SS[-n]_<reason>.db".
var backupReasonPattern = regexp.MustCompile(`^hops-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d+)?_(.+)\.db$`)

// BackupReason is the reason part of a backup's name ("" if unrecognised).
func BackupReason(name string) string {
	m := backupReasonPattern.FindStringSubmatch(name)
	if m == nil {
		return ""
	}
	return m[1]
}

// IsProtectedBackup reports whether a backup is never deleted automatically
// (and so doesn't count toward keep_count or max_count): every backup that
// is not one HOPS takes by itself.
func IsProtectedBackup(name string) bool {
	return !automaticReasons[BackupReason(name)]
}

// RetentionPolicy is the three retention settings.
type RetentionPolicy struct {
	KeepCount int `json:"keepCount"` // always keep the newest N (whatever their age)
	KeepDays  int `json:"keepDays"`  // also keep any newer than D days; 0 = off
	MaxCount  int `json:"maxCount"`  // hard ceiling on auto-deletable backups (never below KeepCount)
}

// DefaultRetention is the settings' defaults.
var DefaultRetention = RetentionPolicy{KeepCount: DefaultKeepCount, KeepDays: DefaultKeepDays, MaxCount: DefaultMaxCount}

// Normalized clamps the policy to its bounds, the safe way: KeepCount to
// [MinKeepCount, MaxKeepCount], KeepDays to [0, MaxKeepDays], MaxCount to
// [KeepCount, MaxMaxCount].
func (p RetentionPolicy) Normalized() RetentionPolicy {
	p.KeepCount = clampInt(p.KeepCount, MinKeepCount, MaxKeepCount)
	p.KeepDays = clampInt(p.KeepDays, MinKeepDays, MaxKeepDays)
	p.MaxCount = clampInt(p.MaxCount, p.KeepCount, MaxMaxCount)
	return p
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// RetentionDeletion is one backup the policy deletes, and why.
type RetentionDeletion struct {
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	Size      int64     `json:"size"`
	Reason    string    `json:"reason"`
	// OverCeiling: deleted although newer than KeepDays, to stay under MaxCount.
	OverCeiling bool `json:"overCeiling"`
}

// PlanRetention returns the backups the policy deletes, oldest last. A
// backup is deleted only if it is not protected, not among the newest
// KeepCount auto-deletable backups, and older than KeepDays (or KeepDays is
// 0). If the auto-deletable backups that remain still exceed MaxCount, the
// oldest beyond MaxCount are deleted too even if newer than KeepDays (never
// one of the newest KeepCount: MaxCount >= KeepCount). It is pure: the
// backups' order in the input doesn't matter, and nothing is touched.
func PlanRetention(backups []BackupInfo, policy RetentionPolicy, now time.Time) []RetentionDeletion {
	p := policy.Normalized()
	auto := make([]BackupInfo, 0, len(backups))
	for _, b := range backups {
		if !IsProtectedBackup(b.Name) {
			auto = append(auto, b)
		}
	}
	sortNewestFirst(auto)

	var out []RetentionDeletion
	var inWindow []BackupInfo // beyond the newest KeepCount but newer than KeepDays, newest first
	window := time.Duration(p.KeepDays) * 24 * time.Hour
	for i, b := range auto {
		if i < p.KeepCount {
			continue
		}
		if p.KeepDays == 0 {
			out = append(out, RetentionDeletion{Name: b.Name, CreatedAt: b.CreatedAt, Size: b.Size,
				Reason: fmt.Sprintf("not among the newest %d", p.KeepCount)})
			continue
		}
		if now.Sub(b.CreatedAt) > window {
			out = append(out, RetentionDeletion{Name: b.Name, CreatedAt: b.CreatedAt, Size: b.Size,
				Reason: fmt.Sprintf("older than %d days and not among the newest %d", p.KeepDays, p.KeepCount)})
			continue
		}
		inWindow = append(inWindow, b)
	}

	if kept := len(auto) - len(out); kept > p.MaxCount {
		excess := kept - p.MaxCount // <= len(inWindow), since MaxCount >= KeepCount
		for _, b := range inWindow[len(inWindow)-excess:] {
			out = append(out, RetentionDeletion{Name: b.Name, CreatedAt: b.CreatedAt, Size: b.Size, OverCeiling: true,
				Reason: fmt.Sprintf("newer than %d days, but over the ceiling of %d backups", p.KeepDays, p.MaxCount)})
		}
	}
	sortDeletionsNewestFirst(out)
	return out
}

func sortNewestFirst(b []BackupInfo) {
	for i := 1; i < len(b); i++ { // insertion sort: stable, tiny lists
		for j := i; j > 0 && newer(b[j], b[j-1]); j-- {
			b[j], b[j-1] = b[j-1], b[j]
		}
	}
}

// newer orders by time, then by name (the name holds the timestamp), so the
// plan is deterministic when two files share a modification time.
func newer(a, b BackupInfo) bool {
	if !a.CreatedAt.Equal(b.CreatedAt) {
		return a.CreatedAt.After(b.CreatedAt)
	}
	return a.Name > b.Name
}

func sortDeletionsNewestFirst(d []RetentionDeletion) {
	for i := 1; i < len(d); i++ {
		for j := i; j > 0 && newer(BackupInfo{Name: d[j].Name, CreatedAt: d[j].CreatedAt}, BackupInfo{Name: d[j-1].Name, CreatedAt: d[j-1].CreatedAt}); j-- {
			d[j], d[j-1] = d[j-1], d[j]
		}
	}
}
