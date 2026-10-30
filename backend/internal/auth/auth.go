package auth

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

// Service handles authentication operations
type Service struct {
	db  *sql.DB
	now func() time.Time
	// idleLimit returns the idle sign-out limit (auth.session_idle_hours);
	// 0 or less means off.
	idleLimit func() time.Duration
}

// NewService creates a new auth service
func NewService(db *sql.DB) *Service {
	return &Service{db: db, now: time.Now, idleLimit: func() time.Duration { return 0 }}
}

// SetClock replaces the clock (tests).
func (s *Service) SetClock(now func() time.Time) { s.now = now }

// SetIdleLimit sets where the idle sign-out limit is read from (the router
// passes the auth.session_idle_hours setting, read on every validation so a
// change applies at once).
func (s *Service) SetIdleLimit(f func() time.Duration) { s.idleLimit = f }

// touchEvery bounds how often an activity request rewrites last_used_at: at
// most once a minute per session, never on every request.
const touchEvery = time.Minute

// ErrSessionIdle: the session was not used for longer than the idle limit.
var ErrSessionIdle = errors.New("session idle too long")

// LoginResult holds the result of a successful login
type LoginResult struct {
	SessionID          string
	MustChangePassword bool
}

// Password policy for a new password. The minimum is a length floor, not a
// complexity rule: HOPS has one admin and is meant for a LAN or behind an
// auth-aware proxy. The maximum
// is bcrypt's: it ignores (and x/crypto rejects) input past 72 bytes.
const (
	MinPasswordLength   = 8
	MaxPasswordBytes    = 72
	passwordHashingCost = bcrypt.DefaultCost // 10; checked by TestPasswordHashCost
)

// Errors a caller may show the user as-is; any other error is internal.
var (
	ErrInvalidCredentials     = errors.New("invalid credentials")
	ErrInvalidCurrentPassword = errors.New("current password is incorrect")
	ErrPasswordTooShort       = fmt.Errorf("new password must be at least %d characters", MinPasswordLength)
	ErrPasswordTooLong        = fmt.Errorf("new password must be at most %d bytes", MaxPasswordBytes)
	ErrPasswordUnchanged      = errors.New("new password must be different from the current password")
)

// ValidateNewPassword applies the password policy.
func ValidateNewPassword(newPassword string) error {
	if utf8.RuneCountInString(newPassword) < MinPasswordLength {
		return ErrPasswordTooShort
	}
	if len(newPassword) > MaxPasswordBytes {
		return ErrPasswordTooLong
	}
	return nil
}

// Login authenticates a user and creates a session. See LoginReplacing.
func (s *Service) Login(username, password string, lifetimeHours int) (LoginResult, error) {
	return s.LoginReplacing(username, password, lifetimeHours, "")
}

// LoginReplacing authenticates a user and creates a session with a fresh
// random id. The id is always new (never one the client supplied), and
// priorSessionID, the session the client presented with the login request if
// any, is deleted in the same transaction, so no pre-login session id survives
// a login (no session fixation).
//
// lifetimeHours controls how long the session row stays valid in the DB —
// it must match the cookie MaxAge the caller sets, otherwise a long-lived
// cookie can outlive its DB row (or vice versa) and the user gets kicked
// out at the shorter of the two. The caller derives this from the
// auth.session_lifetime_hours admin setting.
func (s *Service) LoginReplacing(username, password string, lifetimeHours int, priorSessionID string) (LoginResult, error) {
	var userID int
	var passwordHash string
	var mustChange int

	err := s.db.QueryRow(
		"SELECT id, password_hash, must_change_password FROM users WHERE username = ?",
		username,
	).Scan(&userID, &passwordHash, &mustChange)

	if err == sql.ErrNoRows {
		return LoginResult{}, ErrInvalidCredentials
	}
	if err != nil {
		return LoginResult{}, fmt.Errorf("database error: %w", err)
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)); err != nil {
		return LoginResult{}, ErrInvalidCredentials
	}

	tx, err := s.db.Begin()
	if err != nil {
		return LoginResult{}, fmt.Errorf("failed to create session: %w", err)
	}
	defer tx.Rollback()
	if priorSessionID != "" {
		if _, err := tx.Exec("DELETE FROM sessions WHERE id = ?", priorSessionID); err != nil {
			return LoginResult{}, fmt.Errorf("failed to end the previous session: %w", err)
		}
	}
	sessionID, err := insertSession(tx, userID, lifetimeHours, s.now())
	if err != nil {
		return LoginResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return LoginResult{}, fmt.Errorf("failed to create session: %w", err)
	}

	return LoginResult{
		SessionID:          sessionID,
		MustChangePassword: mustChange == 1,
	}, nil
}

// insertSession creates a session row with a fresh random id.
func insertSession(tx *sql.Tx, userID, lifetimeHours int, now time.Time) (string, error) {
	sessionID, err := generateSessionID()
	if err != nil {
		return "", fmt.Errorf("failed to generate session: %w", err)
	}
	// Belt-and-braces: if a caller passes 0 or negative we still produce
	// a sane non-immediate-expiry row rather than handing back a session
	// the DB will reject on the very next request.
	if lifetimeHours <= 0 {
		lifetimeHours = 24
	}
	expiresAt := now.Add(time.Duration(lifetimeHours) * time.Hour)
	if _, err := tx.Exec(
		"INSERT INTO sessions (id, user_id, expires_at, last_used_at) VALUES (?, ?, ?, ?)",
		sessionID, userID, expiresAt, now,
	); err != nil {
		return "", fmt.Errorf("failed to create session: %w", err)
	}
	return sessionID, nil
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

// ValidateSession checks that a session exists, is within its absolute
// lifetime and, when idle sign-out is on, was used recently enough. It does
// NOT count as activity: background reads (polling, the auth check, the
// public config's admin notices) use it, so they never keep a session alive.
func (s *Service) ValidateSession(sessionID string) (int, error) {
	return s.validate(sessionID, false)
}

// ValidateSessionActivity is ValidateSession for a request that counts as
// the admin using HOPS (see Router.authMiddleware): it also records the use,
// at most once a minute.
func (s *Service) ValidateSessionActivity(sessionID string) (int, error) {
	return s.validate(sessionID, true)
}

func (s *Service) validate(sessionID string, activity bool) (int, error) {
	var userID int
	var expiresAt time.Time
	var lastUsed sql.NullTime

	err := s.db.QueryRow(
		"SELECT user_id, expires_at, last_used_at FROM sessions WHERE id = ?",
		sessionID,
	).Scan(&userID, &expiresAt, &lastUsed)

	if err == sql.ErrNoRows {
		return 0, fmt.Errorf("invalid session")
	}
	if err != nil {
		return 0, fmt.Errorf("database error: %w", err)
	}

	now := s.now()
	if now.After(expiresAt) {
		s.deleteSession(sessionID, "expired")
		return 0, fmt.Errorf("session expired")
	}
	if idle := s.idleLimit(); idle > 0 && lastUsed.Valid && now.Sub(lastUsed.Time) > idle {
		s.deleteSession(sessionID, "idle")
		return 0, ErrSessionIdle
	}

	// A row from before last_used_at existed counts from its first use; an
	// activity request refreshes the time at most once a minute.
	if !lastUsed.Valid || (activity && now.Sub(lastUsed.Time) >= touchEvery) {
		if _, err := s.db.Exec("UPDATE sessions SET last_used_at = ? WHERE id = ?", now, sessionID); err != nil {
			// The request itself is fine; the cost is an earlier idle sign-out.
			slog.Warn("failed to record session use", "component", "auth", "error", err)
		}
	}

	return userID, nil
}

func (s *Service) deleteSession(sessionID, why string) {
	if _, err := s.db.Exec("DELETE FROM sessions WHERE id = ?", sessionID); err != nil {
		// Never log the session ID: it is the bearer secret. The session is
		// refused either way.
		slog.Warn("failed to delete session", "component", "auth", "reason", why, "error", err)
	}
}

// Logout removes a session
func (s *Service) Logout(sessionID string) error {
	_, err := s.db.Exec("DELETE FROM sessions WHERE id = ?", sessionID)
	return err
}

// ChangePassword verifies the current password, applies the password policy
// and stores the new hash. In the same transaction it ends EVERY session of
// the user, the caller's included, and creates one fresh session, whose id it
// returns: a session stolen before the change stops working, and the caller's
// own session id is rotated rather than kept (the caller sets the new cookie).
func (s *Service) ChangePassword(userID int, oldPassword, newPassword string, lifetimeHours int) (string, error) {
	var currentHash string
	err := s.db.QueryRow(
		"SELECT password_hash FROM users WHERE id = ?",
		userID,
	).Scan(&currentHash)

	if err != nil {
		return "", fmt.Errorf("user not found: %w", err)
	}

	// Verify old password
	if err := bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(oldPassword)); err != nil {
		return "", ErrInvalidCurrentPassword
	}
	if err := ValidateNewPassword(newPassword); err != nil {
		return "", err
	}
	if newPassword == oldPassword {
		return "", ErrPasswordUnchanged
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), passwordHashingCost)
	if err != nil {
		return "", fmt.Errorf("failed to hash password: %w", err)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return "", fmt.Errorf("failed to update password: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(
		"UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
		newHash, userID,
	); err != nil {
		return "", fmt.Errorf("failed to update password: %w", err)
	}
	if _, err := tx.Exec("DELETE FROM sessions WHERE user_id = ?", userID); err != nil {
		return "", fmt.Errorf("failed to end sessions: %w", err)
	}
	sessionID, err := insertSession(tx, userID, lifetimeHours, s.now())
	if err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("failed to update password: %w", err)
	}
	return sessionID, nil
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
	_, err := s.db.Exec("DELETE FROM sessions WHERE expires_at < ?", s.now())
	if err != nil {
		return err
	}
	if idle := s.idleLimit(); idle > 0 {
		_, err = s.db.Exec("DELETE FROM sessions WHERE last_used_at IS NOT NULL AND last_used_at < ?", s.now().Add(-idle))
	}
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

// ErrNoUser means the users table has no user to reset.
var ErrNoUser = errors.New("there is no user in the database")

// tempPasswordAlphabet leaves out characters that are easy to misread
// (0/O, 1/l/I) so a password read off a screen can be typed back.
const (
	tempPasswordAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
	tempPasswordLength   = 16
)

func generateTempPassword() (string, error) {
	n := len(tempPasswordAlphabet)
	// Reject bytes past the largest multiple of n so every character is equally likely.
	limit := 256 - 256%n
	out := make([]byte, 0, tempPasswordLength)
	buf := make([]byte, 32)
	for len(out) < tempPasswordLength {
		if _, err := rand.Read(buf); err != nil {
			return "", fmt.Errorf("failed to generate a password: %w", err)
		}
		for _, b := range buf {
			if int(b) >= limit {
				continue
			}
			out = append(out, tempPasswordAlphabet[int(b)%n])
			if len(out) == tempPasswordLength {
				break
			}
		}
	}
	return string(out), nil
}

// ResetPassword is the forgotten-password recovery: it gives the admin user a
// new random temporary password (hashed like any password), requires a new
// one at the next sign-in, and ends every session. The admin user is the one
// named "admin", else the oldest; users is how many user rows there are
// (more than one is unexpected). It touches only the database, so it also
// works while the server runs: sessions are checked against the database on
// every request, so none survives the delete.
func ResetPassword(db *sql.DB) (username, temp string, users int, err error) {
	tx, err := db.Begin()
	if err != nil {
		return "", "", 0, fmt.Errorf("failed to start the reset: %w", err)
	}
	defer tx.Rollback() // #nosec G104 -- no-op after Commit; on an error path the primary error is returned

	if err := tx.QueryRow("SELECT COUNT(*) FROM users").Scan(&users); err != nil {
		return "", "", 0, fmt.Errorf("failed to read the users: %w", err)
	}
	if users == 0 {
		return "", "", 0, ErrNoUser
	}
	var id int
	if err := tx.QueryRow(
		"SELECT id, username FROM users ORDER BY (username = 'admin') DESC, id LIMIT 1",
	).Scan(&id, &username); err != nil {
		return "", "", 0, fmt.Errorf("failed to read the user: %w", err)
	}

	temp, err = generateTempPassword()
	if err != nil {
		return "", "", 0, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(temp), passwordHashingCost)
	if err != nil {
		return "", "", 0, fmt.Errorf("failed to hash the password: %w", err)
	}
	if _, err := tx.Exec(
		"UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?",
		string(hash), id,
	); err != nil {
		return "", "", 0, fmt.Errorf("failed to set the password: %w", err)
	}
	if _, err := tx.Exec("DELETE FROM sessions"); err != nil {
		return "", "", 0, fmt.Errorf("failed to end the sessions: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", "", 0, fmt.Errorf("failed to save the reset: %w", err)
	}
	return username, temp, users, nil
}
