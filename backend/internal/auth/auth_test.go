package auth

import (
	"database/sql"
	"testing"
	"time"

	_ "modernc.org/sqlite"
	"golang.org/x/crypto/bcrypt"
)

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	schema := []string{
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			must_change_password INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			expires_at DATETIME NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id)
		)`,
	}
	for _, s := range schema {
		if _, err := db.Exec(s); err != nil {
			t.Fatal(err)
		}
	}

	// Create test user with password "testpass"
	hash, _ := bcrypt.GenerateFromPassword([]byte("testpass"), bcrypt.MinCost)
	if _, err := db.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", "admin", string(hash)); err != nil {
		t.Fatal(err)
	}

	return db
}

func TestLoginSuccess(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)

	result, err := svc.Login("admin", "testpass")
	if err != nil {
		t.Fatalf("expected successful login, got: %v", err)
	}
	if result.SessionID == "" {
		t.Fatal("expected non-empty session ID")
	}
	if result.MustChangePassword {
		t.Fatal("test user should not require password change")
	}
}

func TestLoginWrongPassword(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)

	_, err := svc.Login("admin", "wrong")
	if err == nil {
		t.Fatal("expected error for wrong password")
	}
}

func TestLoginUnknownUser(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)

	_, err := svc.Login("nobody", "testpass")
	if err == nil {
		t.Fatal("expected error for unknown user")
	}
}

func TestValidateSession(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)

	result, _ := svc.Login("admin", "testpass")

	userID, err := svc.ValidateSession(result.SessionID)
	if err != nil {
		t.Fatalf("expected valid session, got: %v", err)
	}
	if userID != 1 {
		t.Fatalf("expected userID 1, got %d", userID)
	}
}

func TestValidateInvalidSession(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)

	_, err := svc.ValidateSession("nonexistent")
	if err == nil {
		t.Fatal("expected error for invalid session")
	}
}

func TestValidateExpiredSession(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)

	// Insert an already-expired session
	expired := time.Now().Add(-1 * time.Hour)
	if _, err := db.Exec("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", "expired-token", 1, expired); err != nil {
		t.Fatal(err)
	}

	_, err := svc.ValidateSession("expired-token")
	if err == nil {
		t.Fatal("expected error for expired session")
	}
}

func TestLogout(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)

	result, _ := svc.Login("admin", "testpass")

	if err := svc.Logout(result.SessionID); err != nil {
		t.Fatalf("logout failed: %v", err)
	}

	_, err := svc.ValidateSession(result.SessionID)
	if err == nil {
		t.Fatal("expected error after logout")
	}
}

func TestChangePassword(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)

	if err := svc.ChangePassword(1, "testpass", "newpass"); err != nil {
		t.Fatalf("change password failed: %v", err)
	}

	// Old password should fail
	_, err := svc.Login("admin", "testpass")
	if err == nil {
		t.Fatal("expected old password to fail")
	}

	// New password should work
	_, err = svc.Login("admin", "newpass")
	if err != nil {
		t.Fatalf("expected new password to work, got: %v", err)
	}
}

func TestChangePasswordWrongOld(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)

	err := svc.ChangePassword(1, "wrong", "newpass")
	if err == nil {
		t.Fatal("expected error for wrong old password")
	}
}

func TestLoginReturnsMustChangePasswordFlag(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)

	// Mark user as needing password change
	if _, err := db.Exec("UPDATE users SET must_change_password = 1 WHERE id = 1"); err != nil {
		t.Fatal(err)
	}

	result, err := svc.Login("admin", "testpass")
	if err != nil {
		t.Fatalf("login failed: %v", err)
	}
	if !result.MustChangePassword {
		t.Fatal("expected MustChangePassword to be true")
	}
}

func TestChangePasswordClearsMustChangeFlag(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)

	// Mark user as needing password change
	if _, err := db.Exec("UPDATE users SET must_change_password = 1 WHERE id = 1"); err != nil {
		t.Fatal(err)
	}

	if err := svc.ChangePassword(1, "testpass", "newpass"); err != nil {
		t.Fatalf("change password failed: %v", err)
	}

	mustChange, err := svc.MustChangePassword(1)
	if err != nil {
		t.Fatalf("MustChangePassword failed: %v", err)
	}
	if mustChange {
		t.Fatal("expected must_change_password to be cleared after change")
	}

	// Subsequent login should not require password change
	result, _ := svc.Login("admin", "newpass")
	if result.MustChangePassword {
		t.Fatal("expected fresh login to not require password change")
	}
}

func TestMustChangePasswordDefault(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)

	// Default test user shouldn't need password change
	mustChange, err := svc.MustChangePassword(1)
	if err != nil {
		t.Fatalf("MustChangePassword failed: %v", err)
	}
	if mustChange {
		t.Fatal("default test user should not require password change")
	}
}

func TestCleanupExpiredSessions(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)

	// Create a valid session
	valid, _ := svc.Login("admin", "testpass")

	// Insert an expired session
	expired := time.Now().Add(-1 * time.Hour)
	if _, err := db.Exec("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", "old-session", 1, expired); err != nil {
		t.Fatal(err)
	}

	if err := svc.CleanupExpiredSessions(); err != nil {
		t.Fatalf("cleanup failed: %v", err)
	}

	// Valid session should still work
	if _, err := svc.ValidateSession(valid.SessionID); err != nil {
		t.Fatal("valid session should survive cleanup")
	}

	// Expired session should be gone
	var count int
	db.QueryRow("SELECT COUNT(*) FROM sessions WHERE id = 'old-session'").Scan(&count)
	if count != 0 {
		t.Fatal("expired session should have been cleaned up")
	}
}
