package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/weaversgrainthorpe/HOPS/internal/database"
)

// Backup problems (database.BackupManager.Problems) reach the admin as
// sticky warning notices on GET /api/config: a failed backup, old backups
// that couldn't be deleted, or a restore that couldn't be applied. They are
// not dismissible; each goes when its condition clears (the next backup,
// rotation or restore that works). They name server paths and errors, so
// they are only sent to a signed-in admin (GET /api/config is public).

// noticeBackupPrefix starts the id of every backup notice.
const noticeBackupPrefix = "backup-"

// backupNoticeTime is how a notice shows when the problem happened.
const backupNoticeTime = "2 Jan 2006 15:04:05 MST"

// backupFailedWhat says which backup failed, and what that meant.
func backupFailedWhat(trigger string) string {
	switch trigger {
	case "startup":
		return "The automatic backup taken when HOPS started failed"
	case "pre-config-update":
		return "The safety backup before a save failed (the change was saved anyway)"
	case "pre-restore":
		return "The safety backup before a restore failed, so nothing was restored"
	case "pre-factory-reset":
		return "The safety backup before a factory reset failed, so nothing was reset"
	default:
		return fmt.Sprintf("A backup (%q) failed", trigger)
	}
}

// backupProblemNotice renders one problem as a sticky warning notice.
func backupProblemNotice(p database.BackupProblem) notice {
	at := p.At.Format(backupNoticeTime)
	var text string
	switch p.Kind {
	case database.ProblemBackupFailed:
		text = fmt.Sprintf("%s at %s: %s. There is no fresh backup until one succeeds. Check the free disk space and that HOPS "+
			"can write to its backups folder, then take one with Create Backup in Settings › Backups.", backupFailedWhat(p.Trigger), at, p.Reason)
	case database.ProblemRotationFailed:
		text = fmt.Sprintf("HOPS couldn't delete old backups at %s: %s. Old backups will keep piling up and may fill the disk. "+
			"Delete them in Settings › Backups, or check that HOPS can write to its backups folder.", at, p.Reason)
	case database.ProblemRestoreFailed:
		text = fmt.Sprintf("The restore you asked for couldn't be applied when HOPS restarted (%s): %s. HOPS is still running on "+
			"the data it had before the restore.", at, p.Reason)
	default:
		text = fmt.Sprintf("A backup problem at %s: %s.", at, p.Reason)
	}
	return notice{
		ID:     fmt.Sprintf("%s%s-%d", noticeBackupPrefix, p.Kind, p.At.Unix()),
		Text:   text,
		Level:  "warning",
		Sticky: true,
	}
}

// backupNotices are the backup notices for this request: none unless it
// comes from a signed-in admin.
func (r *Router) backupNotices(req *http.Request) []notice {
	if r.backupManager == nil || !r.isAdminRequest(req) {
		return nil
	}
	var out []notice
	for _, p := range r.backupManager.Problems() {
		out = append(out, backupProblemNotice(p))
	}
	return out
}

// isAdminRequest reports whether req carries a valid session that owes no
// password change (the same bar as the protected routes).
func (r *Router) isAdminRequest(req *http.Request) bool {
	sid := extractSessionID(req)
	if sid == "" {
		return false
	}
	uid, err := r.authService.ValidateSession(sid)
	if err != nil {
		return false
	}
	must, err := r.authService.MustChangePassword(uid)
	return err == nil && !must
}

// isBackupNoticeID reports whether id names a backup notice (never dismissible).
func isBackupNoticeID(id string) bool { return strings.HasPrefix(id, noticeBackupPrefix) }
