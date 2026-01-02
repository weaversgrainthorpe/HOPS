package auth

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
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

// Login authenticates a user and creates a session
func (s *Service) Login(username, password string) (string, error) {
	var userID int
	var passwordHash string

	err := s.db.QueryRow(
		"SELECT id, password_hash FROM users WHERE username = ?",
		username,
	).Scan(&userID, &passwordHash)

	if err == sql.ErrNoRows {
		return "", fmt.Errorf("invalid credentials")
	}
	if err != nil {
		return "", fmt.Errorf("database error: %w", err)
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)); err != nil {
		return "", fmt.Errorf("invalid credentials")
	}

	// Create session
	sessionID, err := generateSessionID()
	if err != nil {
		return "", fmt.Errorf("failed to generate session: %w", err)
	}

	expiresAt := time.Now().Add(24 * time.Hour)

	_, err = s.db.Exec(
		"INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
		sessionID, userID, expiresAt,
	)
	if err != nil {
		return "", fmt.Errorf("failed to create session: %w", err)
	}

	return sessionID, nil
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
		s.db.Exec("DELETE FROM sessions WHERE id = ?", sessionID)
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
		"UPDATE users SET password_hash = ? WHERE id = ?",
		newHash, userID,
	)
	if err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	return nil
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
