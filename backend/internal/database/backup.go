package database

import (
	"database/sql"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	// MaxBackups is the maximum number of backup files to keep
	MaxBackups = 10
	// BackupPrefix is the prefix for backup files
	BackupPrefix = "hops-backup-"
	// BackupSuffix is the suffix for backup files
	BackupSuffix = ".db"
)

// BackupManager handles database backup operations
type BackupManager struct {
	dbPath    string
	backupDir string
}

// NewBackupManager creates a new backup manager
func NewBackupManager(dbPath string) *BackupManager {
	backupDir := filepath.Join(filepath.Dir(dbPath), "backups")
	return &BackupManager{
		dbPath:    dbPath,
		backupDir: backupDir,
	}
}

// CreateBackup creates a backup of the database with a timestamp
func (bm *BackupManager) CreateBackup(reason string) (string, error) {
	// Ensure backup directory exists
	if err := os.MkdirAll(bm.backupDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create backup directory: %w", err)
	}

	// Generate backup filename with timestamp and reason
	timestamp := time.Now().Format("2006-01-02_15-04-05")
	safeReason := strings.ReplaceAll(reason, " ", "-")
	safeReason = strings.ReplaceAll(safeReason, "/", "-")
	backupName := fmt.Sprintf("%s%s_%s%s", BackupPrefix, timestamp, safeReason, BackupSuffix)
	backupPath := filepath.Join(bm.backupDir, backupName)

	// Copy the database file
	if err := copyFile(bm.dbPath, backupPath); err != nil {
		return "", fmt.Errorf("failed to copy database: %w", err)
	}

	log.Printf("[Backup] Created backup: %s", backupName)

	// Cleanup old backups
	if err := bm.CleanupOldBackups(); err != nil {
		log.Printf("[Backup] Warning: failed to cleanup old backups: %v", err)
	}

	return backupPath, nil
}

// CreateBackupWithDB creates a backup using an open database connection
// This ensures the database is in a consistent state
func (bm *BackupManager) CreateBackupWithDB(db *sql.DB, reason string) (string, error) {
	// Ensure backup directory exists
	if err := os.MkdirAll(bm.backupDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create backup directory: %w", err)
	}

	// Generate backup filename
	timestamp := time.Now().Format("2006-01-02_15-04-05")
	safeReason := strings.ReplaceAll(reason, " ", "-")
	safeReason = strings.ReplaceAll(safeReason, "/", "-")
	backupName := fmt.Sprintf("%s%s_%s%s", BackupPrefix, timestamp, safeReason, BackupSuffix)
	backupPath := filepath.Join(bm.backupDir, backupName)

	// Use SQLite's backup API via VACUUM INTO (SQLite 3.27+)
	_, err := db.Exec(fmt.Sprintf("VACUUM INTO '%s'", backupPath))
	if err != nil {
		// Fallback to file copy if VACUUM INTO is not supported
		log.Printf("[Backup] VACUUM INTO not supported, falling back to file copy")
		if err := copyFile(bm.dbPath, backupPath); err != nil {
			return "", fmt.Errorf("failed to copy database: %w", err)
		}
	}

	log.Printf("[Backup] Created backup: %s", backupName)

	// Cleanup old backups
	if err := bm.CleanupOldBackups(); err != nil {
		log.Printf("[Backup] Warning: failed to cleanup old backups: %v", err)
	}

	return backupPath, nil
}

// ListBackups returns a list of available backups sorted by date (newest first)
func (bm *BackupManager) ListBackups() ([]BackupInfo, error) {
	entries, err := os.ReadDir(bm.backupDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []BackupInfo{}, nil
		}
		return nil, fmt.Errorf("failed to read backup directory: %w", err)
	}

	var backups []BackupInfo
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasPrefix(name, BackupPrefix) || !strings.HasSuffix(name, BackupSuffix) {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		backups = append(backups, BackupInfo{
			Name:      name,
			Path:      filepath.Join(bm.backupDir, name),
			Size:      info.Size(),
			CreatedAt: info.ModTime(),
		})
	}

	// Sort by creation time (newest first)
	sort.Slice(backups, func(i, j int) bool {
		return backups[i].CreatedAt.After(backups[j].CreatedAt)
	})

	return backups, nil
}

// RestoreBackup restores the database from a backup file
func (bm *BackupManager) RestoreBackup(backupName string) error {
	backupPath := filepath.Join(bm.backupDir, backupName)

	// Verify backup exists
	if _, err := os.Stat(backupPath); os.IsNotExist(err) {
		return fmt.Errorf("backup not found: %s", backupName)
	}

	// Create a backup of current state before restoring
	_, err := bm.CreateBackup("pre-restore")
	if err != nil {
		log.Printf("[Backup] Warning: failed to create pre-restore backup: %v", err)
	}

	// Copy backup to database path
	if err := copyFile(backupPath, bm.dbPath); err != nil {
		return fmt.Errorf("failed to restore backup: %w", err)
	}

	log.Printf("[Backup] Restored from backup: %s", backupName)
	return nil
}

// CleanupOldBackups removes backups beyond MaxBackups limit
func (bm *BackupManager) CleanupOldBackups() error {
	backups, err := bm.ListBackups()
	if err != nil {
		return err
	}

	if len(backups) <= MaxBackups {
		return nil
	}

	// Remove oldest backups
	for _, backup := range backups[MaxBackups:] {
		if err := os.Remove(backup.Path); err != nil {
			log.Printf("[Backup] Warning: failed to remove old backup %s: %v", backup.Name, err)
		} else {
			log.Printf("[Backup] Removed old backup: %s", backup.Name)
		}
	}

	return nil
}

// BackupInfo contains information about a backup file
type BackupInfo struct {
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"createdAt"`
}

// copyFile copies a file from src to dst
func copyFile(src, dst string) error {
	sourceFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	destFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, sourceFile)
	if err != nil {
		return err
	}

	return destFile.Sync()
}
