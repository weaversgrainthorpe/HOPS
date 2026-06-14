package auth

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log/slog"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Service handles authentication operations
type Service struct {
	db *sql.DB
}

// NewService creates a new auth service
func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

// LoginResult holds the result of a successful login
type LoginResult struct {
	SessionID          string
	MustChangePassword bool
}

// Login authenticates a user and creates a session.
//
// lifetimeHours controls how long the session row stays valid in the DB —
// it must match the cookie MaxAge the caller sets, otherwise a long-lived
// cookie can outlive its DB row (or vice versa) and the user gets kicked
// out at the shorter of the two. The caller derives this from the
// auth.session_lifetime_hours admin setting.
func (s *Service) Login(username, password string, lifetimeHours int) (LoginResult, error) {
	var userID int
	var passwordHash string
	var mustChange int

	err := s.db.QueryRow(
		"SELECT id, password_hash, must_change_password FROM users WHERE username = ?",
		username,
	).Scan(&userID, &passwordHash, &mustChange)

	if err == sql.ErrNoRows {
		return LoginResult{}, fmt.Errorf("invalid credentials")
	}
	if err != nil {
		return LoginResult{}, fmt.Errorf("database error: %w", err)
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)); err != nil {
		return LoginResult{}, fmt.Errorf("invalid credentials")
	}

	// Create session
	sessionID, err := generateSessionID()
	if err != nil {
		return LoginResult{}, fmt.Errorf("failed to generate session: %w", err)
	}

	// Belt-and-braces: if a caller passes 0 or negative we still produce
	// a sane non-immediate-expiry row rather than handing back a session
	// the DB will reject on the very next request.
	if lifetimeHours <= 0 {
		lifetimeHours = 24
	}
	expiresAt := time.Now().Add(time.Duration(lifetimeHours) * time.Hour)

	_, err = s.db.Exec(
		"INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
		sessionID, userID, expiresAt,
	)
	if err != nil {
		return LoginResult{}, fmt.Errorf("failed to create session: %w", err)
	}

	return LoginResult{
		SessionID:          sessionID,
		MustChangePassword: mustChange == 1,
	}, nil
}

// MustChangePassword returns true if the user is required to change their password
func (s *Service) MustChangePassword(userID int) (bool, error) {
	var mustChange int
	err := s.db.QueryRow(
		"SELECT must_change_password FROM users WHERE id = ?",
		userID,
	).Scan(&mustChange)
	if err != nil {
		return false, err
	}
	return mustChange == 1, nil
}

// ValidateSession checks if a session is valid
func (s *Service) ValidateSession(sessionID string) (int, error) {
	var userID int
	var expiresAt time.Time

	err := s.db.QueryRow(
		"SELECT user_id, expires_at FROM sessions WHERE id = ?",
		sessionID,
	).Scan(&userID, &expiresAt)

	if err == sql.ErrNoRows {
		return 0, fmt.Errorf("invalid session")
	}
	if err != nil {
		return 0, fmt.Errorf("database error: %w", err)
	}

	if time.Now().After(expiresAt) {
		// Clean up expired session
		if _, err := s.db.Exec("DELETE FROM sessions WHERE id = ?", sessionID); err != nil {
			slog.Warn("failed to delete expired session", "component", "auth", "session_id", sessionID, "error", err)
		}
		return 0, fmt.Errorf("session expired")
	}

	return userID, nil
}

// Logout removes a session
func (s *Service) Logout(sessionID string) error {
	_, err := s.db.Exec("DELETE FROM sessions WHERE id = ?", sessionID)
	return err
}

// ChangePassword updates a user's password
func (s *Service) ChangePassword(userID int, oldPassword, newPassword string) error {
	var currentHash string
	err := s.db.QueryRow(
		"SELECT password_hash FROM users WHERE id = ?",
		userID,
	).Scan(&currentHash)

	if err != nil {
		return fmt.Errorf("user not found: %w", err)
	}

	// Verify old password
	if err := bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(oldPassword)); err != nil {
		return fmt.Errorf("invalid current password")
	}

	// Hash new password
	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	_, err = s.db.Exec(
		"UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
		newHash, userID,
	)
	if err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	return nil
}

// InvalidateOtherSessions revokes every session belonging to a user except
// the one supplied (typically the caller's current session). Use this after
// a password change so that any session stolen beforehand stops working,
// while the user who just changed their password stays logged in.
func (s *Service) InvalidateOtherSessions(userID int, keepSessionID string) error {
	_, err := s.db.Exec(
		"DELETE FROM sessions WHERE user_id = ? AND id != ?",
		userID, keepSessionID,
	)
	return err
}

// generateSessionID creates a random session ID
func generateSessionID() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// CleanupExpiredSessions removes all expired sessions
func (s *Service) CleanupExpiredSessions() error {
	_, err := s.db.Exec("DELETE FROM sessions WHERE expires_at < ?", time.Now())
	return err
}

// StartCleanupRoutine starts a background goroutine that periodically cleans up expired sessions
// StartCleanupRoutine launches the session-expiry sweeper and returns
// a wait function the caller MUST invoke after closing `stop` and
// before closing the database. Without that wait, a cleanup tick
// in-flight when the process exits would issue a DELETE against an
// already-closed db.
func (s *Service) StartCleanupRoutine(interval time.Duration, stop <-chan struct{}) (wait func()) {
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		// Run cleanup immediately on start
		if err := s.CleanupExpiredSessions(); err != nil {
			// Log error but don't fail
			slog.Error("session cleanup error", "component", "auth", "error", err)
		}

		for {
			select {
			case <-ticker.C:
				if err := s.CleanupExpiredSessions(); err != nil {
					slog.Error("session cleanup error", "component", "auth", "error", err)
				}
			case <-stop:
				return
			}
		}
	}()
	return func() { <-done }
}
