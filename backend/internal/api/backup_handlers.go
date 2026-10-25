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
			"backups":   backups,
			"problems":  problems,
			"retention": r.backupManager.Retention(),
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

// handleBackupActions handles, for /api/backups/{name}:
//   GET    → download the backup
//   POST   → RESTORE it (see the note in setupRoutes)
//   DELETE → delete it
// and two sentinels that are never valid backup names:
//   GET/POST /api/backups/cleanup → preview / confirmed "Clean up now"
//   POST     /api/backups/upload  → store an uploaded backup (not restored)
func (r *Router) handleBackupActions(w http.ResponseWriter, req *http.Request) {
	backupName, ok := backupNameFromPath(req.URL.Path)
	if !ok {
		writeJSONError(w, "Invalid backup name", http.StatusBadRequest)
		return
	}
	switch backupName {
	case "cleanup":
		r.handleBackupCleanup(w, req)
		return
	case "upload":
		if req.Method != http.MethodPost {
			writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		r.handleUploadBackup(w, req)
		return
	}

	switch req.Method {
	case http.MethodGet:
		r.handleDownloadBackup(w, req, backupName)

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

// handleDownloadBackup streams a backup file as an attachment. The name is
// strictly validated (no separators, no "..", regular files only), so it is
// also a safe download filename.
func (r *Router) handleDownloadBackup(w http.ResponseWriter, req *http.Request, name string) {
	f, fi, err := r.backupManager.OpenBackup(name)
	if err != nil {
		writeBackupNameError(w, err, "Couldn't read the backup: ")
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/vnd.sqlite3")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, req, name, fi.ModTime(), f)
}

// uploadBackupKind: an uploaded backup shares the import size limit.
var uploadBackupKind = uploadKind{uploadImport.key, "backup you can upload (it shares the import limit)"}

// handleUploadBackup stores an uploaded HOPS database as a new "…_uploaded"
// backup. It is validated (SQLite, HOPS tables) and never restored here:
// the admin restores it like any other backup.
func (r *Router) handleUploadBackup(w http.ResponseWriter, req *http.Request) {
	file, _, ok := r.readLimitedUpload(w, req, uploadBackupKind)
	if !ok {
		return
	}
	defer file.Close()
	name, err := r.backupManager.StoreUploadedBackup(file)
	if err != nil {
		var ibe *database.InvalidBackupError
		if errors.As(err, &ibe) {
			writeJSONError(w, "This file can't be used as a backup: "+ibe.Reason+". Nothing was stored.", http.StatusUnprocessableEntity)
			return
		}
		slog.Error("failed to store uploaded backup", "component", "backup", "error", err)
		writeJSONError(w, "Couldn't store the uploaded backup: "+err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{
		"success": true,
		"name":    name,
		"message": "Backup uploaded. It is listed with the others; restore it from there when you want to.",
	})
}

// handleBackupCleanup serves "Clean up now": GET returns exactly what the
// retention rules would delete now, and why; POST {"names": [...]} deletes
// those of the confirmed names that the rules still delete (re-planned, so
// nothing outside the rules is ever deleted).
func (r *Router) handleBackupCleanup(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		plan, err := r.backupManager.PlanCleanup()
		if err != nil {
			writeJSONError(w, "Couldn't work out what to clean up: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if plan == nil {
			plan = []database.RetentionDeletion{}
		}
		writeJSON(w, map[string]interface{}{"deletions": plan, "retention": r.backupManager.Retention()})
	case http.MethodPost:
		var body struct {
			Names []string `json:"names"`
		}
		if ae := decodeBody(w, req, maxSmallBodyBytes, &body); ae != nil {
			writeAPIError(w, ae)
			return
		}
		deleted, err := r.backupManager.CleanupConfirmed(body.Names)
		if deleted == nil {
			deleted = []string{}
		}
		if err != nil {
			writeJSON(w, map[string]interface{}{"deleted": deleted, "error": "Some backups couldn't be deleted: " + err.Error()})
			return
		}
		writeJSON(w, map[string]interface{}{"deleted": deleted})
	default:
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
