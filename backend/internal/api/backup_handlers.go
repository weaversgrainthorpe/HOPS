package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/database"
)

// handleBackups serves GET /api/backups (the list, plus any backup problem
// the admin must see) and POST /api/backups (a manual backup).
func (r *Router) handleBackups(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		backups, err := r.backupManager.ListBackups()
		if err != nil {
			slog.Error("failed to list backups", "component", "backup", "error", err)
			writeJSONError(w, "Couldn't list the backups: "+err.Error(), http.StatusInternalServerError)
			return
		}
		problems := r.backupManager.Problems()
		if problems == nil {
			problems = []database.BackupProblem{}
		}
		writeJSON(w, map[string]interface{}{
			"backups":  backups,
			"problems": problems,
		})

	case http.MethodPost:
		var reqData struct {
			Reason string `json:"reason"`
		}
		// An empty or unreadable body is a plain manual backup.
		_ = json.NewDecoder(http.MaxBytesReader(w, req.Body, maxSmallBodyBytes)).Decode(&reqData)
		reason, err := database.SanitizeManualReason(reqData.Reason)
		if err != nil {
			writeJSONError(w, "Invalid backup reason: "+err.Error(), http.StatusBadRequest)
			return
		}

		backupPath, err := r.backupManager.CreateBackupWithDB(r.db, reason)
		if err != nil {
			slog.Error("failed to create backup", "component", "backup", "error", err)
			writeJSONError(w, "Couldn't create the backup: "+err.Error(), http.StatusInternalServerError)
			return
		}

		writeJSON(w, map[string]interface{}{
			"success": true,
			"path":    backupPath,
			"message": "Backup created successfully",
		})

	default:
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// backupNameFromPath takes the {name} of /api/backups/{name}. A name with
// any further path is refused here; the name itself is validated strictly
// by the backup manager (database.ValidateBackupName).
func backupNameFromPath(p string) (string, bool) {
	name := strings.TrimPrefix(p, "/api/backups/")
	if name == "" || strings.ContainsAny(name, "/\\\x00") {
		return "", false
	}
	return name, true
}

// writeBackupNameError maps a name/lookup error to 400/404, else 500 with msg.
func writeBackupNameError(w http.ResponseWriter, err error, msg string) {
	switch {
	case errors.Is(err, database.ErrInvalidBackupName):
		writeJSONError(w, "Invalid backup name", http.StatusBadRequest)
	case errors.Is(err, database.ErrBackupNotFound):
		writeJSONError(w, "Backup not found", http.StatusNotFound)
	default:
		writeJSONError(w, msg+err.Error(), http.StatusInternalServerError)
	}
}

// handleBackupActions handles POST /api/backups/{name} (restore) and
// DELETE /api/backups/{name}.
func (r *Router) handleBackupActions(w http.ResponseWriter, req *http.Request) {
	backupName, ok := backupNameFromPath(req.URL.Path)
	if !ok {
		writeJSONError(w, "Invalid backup name", http.StatusBadRequest)
		return
	}

	switch req.Method {
	case http.MethodPost:
		r.handleRestoreBackup(w, backupName)

	case http.MethodDelete:
		if err := r.backupManager.DeleteBackup(backupName); err != nil {
			slog.Error("failed to delete backup", "component", "backup", "name", backupName, "error", err)
			writeBackupNameError(w, err, "Couldn't delete the backup: ")
			return
		}
		writeJSON(w, map[string]interface{}{
			"success": true,
			"message": "Backup deleted successfully",
		})

	default:
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleRestoreBackup stages a restore (database.BackupManager.RestoreBackup)
// and restarts the server so it is applied before the database is opened.
// It is refused, with nothing changed, when the backup is not a HOPS
// database or the safety backup of the current data cannot be taken.
func (r *Router) handleRestoreBackup(w http.ResponseWriter, backupName string) {
	err := r.backupManager.RestoreBackup(r.db, backupName)
	if err != nil {
		slog.Error("restore refused", "component", "backup", "name", backupName, "error", err)
		var sbe *database.SafetyBackupError
		var ibe *database.InvalidBackupError
		switch {
		case errors.As(err, &sbe):
			writeJSONError(w, "Couldn't take a safety backup first, so nothing was restored: "+sbe.Err.Error(), http.StatusInternalServerError)
		case errors.As(err, &ibe):
			writeJSONError(w, "This backup can't be restored ("+ibe.Reason+"), so nothing was restored.", http.StatusUnprocessableEntity)
		default:
			writeBackupNameError(w, err, "Couldn't restore the backup, so nothing was restored: ")
		}
		return
	}

	writeJSON(w, map[string]interface{}{
		"success":    true,
		"restarting": true,
		"message":    "Restoring the backup: the server is restarting to apply it — it should be back in a few seconds.",
	})

	// The restore is applied on the next start (main.go, before the DB is
	// opened). Shut down gracefully 1 s after the response flushes; the
	// service manager (systemd / docker compose / launchd) restarts the
	// process. Documented requirement: Restart=on-failure or similar.
	go func() {
		time.Sleep(1 * time.Second)
		slog.Info("triggering shutdown after backup restore",
			"component", "backup", "name", backupName)
		r.RequestShutdown()
	}()
}
