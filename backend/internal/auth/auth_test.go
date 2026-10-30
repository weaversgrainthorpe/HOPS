package auth

import (
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
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
			last_used_at DATETIME,
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

	result, err := svc.Login("admin", "testpass", 24)
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

	_, err := svc.Login("admin", "wrong", 24)
	if err == nil {
		t.Fatal("expected error for wrong password")
	}
}

func TestLoginUnknownUser(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)

	_, err := svc.Login("nobody", "testpass", 24)
	if err == nil {
		t.Fatal("expected error for unknown user")
	}
}

func TestValidateSession(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)

	result, _ := svc.Login("admin", "testpass", 24)

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

	result, _ := svc.Login("admin", "testpass", 24)

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

	if _, err := svc.ChangePassword(1, "testpass", "newpass1", 24); err != nil {
		t.Fatalf("change password failed: %v", err)
	}

	// Old password should fail
	_, err := svc.Login("admin", "testpass", 24)
	if err == nil {
		t.Fatal("expected old password to fail")
	}

	// New password should work
	_, err = svc.Login("admin", "newpass1", 24)
	if err != nil {
		t.Fatalf("expected new password to work, got: %v", err)
	}
}

func TestChangePasswordWrongOld(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)

	_, err := svc.ChangePassword(1, "wrong", "newpass1", 24)
	if !errors.Is(err, ErrInvalidCurrentPassword) {
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

	result, err := svc.Login("admin", "testpass", 24)
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

	if _, err := svc.ChangePassword(1, "testpass", "newpass1", 24); err != nil {
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
	result, _ := svc.Login("admin", "newpass1", 24)
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
	valid, _ := svc.Login("admin", "testpass", 24)

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

// A password change ends every session of the user, the caller's too, and
// hands back one fresh session (the caller's id is rotated, not kept).
func TestChangePasswordEndsAllSessionsAndRotates(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)
	a, _ := svc.Login("admin", "testpass", 24)
	b, _ := svc.Login("admin", "testpass", 24)

	fresh, err := svc.ChangePassword(1, "testpass", "newpass1", 24)
	if err != nil {
		t.Fatal(err)
	}
	if fresh == "" || fresh == a.SessionID || fresh == b.SessionID {
		t.Fatalf("expected a new session id, got %q", fresh)
	}
	for _, old := range []string{a.SessionID, b.SessionID} {
		if _, err := svc.ValidateSession(old); err == nil {
			t.Error("a session from before the password change still works")
		}
	}
	if _, err := svc.ValidateSession(fresh); err != nil {
		t.Errorf("the rotated session does not work: %v", err)
	}
}

// A refused change leaves the password and every session as they were.
func TestChangePasswordPolicy(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)
	a, _ := svc.Login("admin", "testpass", 24)
	cases := []struct {
		old, new string
		want     error
	}{
		{"wrong", "newpass1", ErrInvalidCurrentPassword},
		{"", "newpass1", ErrInvalidCurrentPassword},
		{"testpass", "short7c", ErrPasswordTooShort},
		{"testpass", "", ErrPasswordTooShort},
		{"testpass", strings.Repeat("x", MaxPasswordBytes+1), ErrPasswordTooLong},
		{"testpass", "testpass", ErrPasswordUnchanged},
	}
	for _, c := range cases {
		if _, err := svc.ChangePassword(1, c.old, c.new, 24); !errors.Is(err, c.want) {
			t.Errorf("ChangePassword(%q, %q) = %v, want %v", c.old, c.new, err, c.want)
		}
	}
	if _, err := svc.ValidateSession(a.SessionID); err != nil {
		t.Error("a refused password change ended the session")
	}
	if _, err := svc.Login("admin", "testpass", 24); err != nil {
		t.Error("a refused password change altered the password")
	}
}

// bcrypt cost: stored hashes use the library default (10), never MinCost.
func TestPasswordHashCost(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)
	if _, err := svc.ChangePassword(1, "testpass", "newpass1", 24); err != nil {
		t.Fatal(err)
	}
	var hash string
	db.QueryRow("SELECT password_hash FROM users WHERE id = 1").Scan(&hash)
	cost, err := bcrypt.Cost([]byte(hash))
	if err != nil || cost < 10 {
		t.Fatalf("bcrypt cost = %d (%v), want >= 10", cost, err)
	}
}

// Login always mints a new id and ends the session presented with it, so
// no pre-login session id survives (no fixation).
func TestLoginReplacingEndsPriorSession(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)
	prior, _ := svc.Login("admin", "testpass", 24)
	next, err := svc.LoginReplacing("admin", "testpass", 24, prior.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if next.SessionID == prior.SessionID {
		t.Fatal("login reused the presented session id")
	}
	if _, err := svc.ValidateSession(prior.SessionID); err == nil {
		t.Error("the session presented at login survived it")
	}
	// A failed login leaves the presented session alone.
	if _, err := svc.LoginReplacing("admin", "wrong", 24, next.SessionID); err == nil {
		t.Fatal("wrong password accepted")
	}
	if _, err := svc.ValidateSession(next.SessionID); err != nil {
		t.Error("a failed login ended the presented session")
	}
}

// Absolute expiry: the row's expires_at is login time + lifetime, and a
// session past it is refused (and deleted) server-side, whatever the cookie.
func TestAbsoluteExpiry(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)
	r, _ := svc.Login("admin", "testpass", 3)
	var exp time.Time
	db.QueryRow("SELECT expires_at FROM sessions WHERE id = ?", r.SessionID).Scan(&exp)
	if d := time.Until(exp); d < 3*time.Hour-time.Minute || d > 3*time.Hour+time.Minute {
		t.Fatalf("expires in %v, want ~3h", d)
	}
	db.Exec("UPDATE sessions SET expires_at = ? WHERE id = ?", time.Now().Add(-time.Second), r.SessionID)
	if _, err := svc.ValidateSession(r.SessionID); err == nil {
		t.Fatal("expired session accepted")
	}
	var n int
	db.QueryRow("SELECT COUNT(*) FROM sessions WHERE id = ?", r.SessionID).Scan(&n)
	if n != 0 {
		t.Error("expired session row was not deleted")
	}
}

// fakeClock is a settable clock for idle-expiry tests.
type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time          { return c.t }
func (c *fakeClock) advance(d time.Duration) { c.t = c.t.Add(d) }

func idleService(t *testing.T, idle time.Duration) (*Service, *fakeClock, *sql.DB) {
	db := setupTestDB(t)
	svc := NewService(db)
	clk := &fakeClock{t: time.Now()}
	svc.SetClock(clk.now)
	svc.SetIdleLimit(func() time.Duration { return idle })
	return svc, clk, db
}

// Idle sign-out: a session not used (by an activity request) for longer than
// the limit is refused and deleted.
func TestIdleExpiry(t *testing.T) {
	svc, clk, db := idleService(t, 2*time.Hour)
	r, _ := svc.Login("admin", "testpass", 24)
	clk.advance(2*time.Hour - time.Minute)
	if _, err := svc.ValidateSession(r.SessionID); err != nil {
		t.Fatalf("session refused before the idle limit: %v", err)
	}
	clk.advance(2 * time.Minute)
	if _, err := svc.ValidateSession(r.SessionID); !errors.Is(err, ErrSessionIdle) {
		t.Fatalf("idle session: err = %v, want ErrSessionIdle", err)
	}
	var n int
	db.QueryRow("SELECT COUNT(*) FROM sessions WHERE id = ?", r.SessionID).Scan(&n)
	if n != 0 {
		t.Error("idle session row was not deleted")
	}
}

// Activity resets the idle clock; non-activity (polling) reads do not.
func TestIdleActivityVersusPolling(t *testing.T) {
	svc, clk, _ := idleService(t, time.Hour)
	r, _ := svc.Login("admin", "testpass", 24)
	// Polling every 30s for 59 minutes does not count...
	for i := 0; i < 118; i++ {
		clk.advance(30 * time.Second)
		if _, err := svc.ValidateSession(r.SessionID); err != nil {
			t.Fatalf("poll %d refused: %v", i, err)
		}
	}
	// ...one activity request at 59 min resets it.
	if _, err := svc.ValidateSessionActivity(r.SessionID); err != nil {
		t.Fatal(err)
	}
	clk.advance(59 * time.Minute)
	if _, err := svc.ValidateSession(r.SessionID); err != nil {
		t.Fatalf("activity did not extend the session: %v", err)
	}
	// Only polling from here: it idles out at the hour.
	var err error
	for i := 0; i < 4 && err == nil; i++ {
		clk.advance(30 * time.Second)
		_, err = svc.ValidateSession(r.SessionID)
	}
	if !errors.Is(err, ErrSessionIdle) {
		t.Fatalf("polling kept the session alive: err = %v", err)
	}
}

// last_used_at is written at most once a minute per session.
func TestIdleTouchThrottled(t *testing.T) {
	svc, clk, db := idleService(t, time.Hour)
	r, _ := svc.Login("admin", "testpass", 24)
	read := func() time.Time {
		var tm time.Time
		db.QueryRow("SELECT last_used_at FROM sessions WHERE id = ?", r.SessionID).Scan(&tm)
		return tm
	}
	first := read()
	clk.advance(30 * time.Second)
	svc.ValidateSessionActivity(r.SessionID)
	if !read().Equal(first) {
		t.Error("last_used_at rewritten within a minute")
	}
	clk.advance(31 * time.Second)
	svc.ValidateSessionActivity(r.SessionID)
	if !read().After(first) {
		t.Error("last_used_at not updated after a minute")
	}
}

// Off (0, the default) means only the absolute expiry applies.
func TestIdleOff(t *testing.T) {
	svc, clk, _ := idleService(t, 0)
	r, _ := svc.Login("admin", "testpass", 24)
	clk.advance(23 * time.Hour)
	if _, err := svc.ValidateSession(r.SessionID); err != nil {
		t.Fatalf("idle off: session refused: %v", err)
	}
	clk.advance(2 * time.Hour)
	if _, err := svc.ValidateSession(r.SessionID); err == nil {
		t.Fatal("absolute expiry not applied")
	}
}

// A row from before last_used_at existed (NULL) counts from its first use.
func TestIdleLegacyRow(t *testing.T) {
	svc, clk, db := idleService(t, time.Hour)
	db.Exec("INSERT INTO sessions (id, user_id, expires_at) VALUES ('legacy', 1, ?)", clk.t.Add(24*time.Hour))
	if _, err := svc.ValidateSession("legacy"); err != nil {
		t.Fatalf("legacy row refused: %v", err)
	}
	clk.advance(61 * time.Minute)
	if _, err := svc.ValidateSession("legacy"); !errors.Is(err, ErrSessionIdle) {
		t.Fatalf("legacy row never idles: %v", err)
	}
}

func TestResetPassword(t *testing.T) {
	db := setupTestDB(t)
	svc := NewService(db)
	old, err := svc.Login("admin", "testpass", 24)
	if err != nil {
		t.Fatal(err)
	}

	user, temp, n, err := ResetPassword(db)
	if err != nil {
		t.Fatal(err)
	}
	if user != "admin" || n != 1 || len(temp) != tempPasswordLength {
		t.Fatalf("got user=%q users=%d temp=%q", user, n, temp)
	}
	for _, c := range temp {
		if !strings.ContainsRune(tempPasswordAlphabet, c) {
			t.Fatalf("temp password has %q outside the alphabet", c)
		}
	}
	var hash string
	var must int
	if err := db.QueryRow("SELECT password_hash, must_change_password FROM users WHERE username = 'admin'").Scan(&hash, &must); err != nil {
		t.Fatal(err)
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(temp)) != nil {
		t.Error("temporary password does not verify")
	}
	if cost, _ := bcrypt.Cost([]byte(hash)); cost != passwordHashingCost {
		t.Errorf("cost = %d, want %d", cost, passwordHashingCost)
	}
	if must != 1 {
		t.Error("must_change_password not set")
	}
	if _, err := svc.ValidateSession(old.SessionID); err == nil {
		t.Error("old session still valid")
	}
	res, err := svc.Login("admin", temp, 24)
	if err != nil || !res.MustChangePassword {
		t.Errorf("login with temp password: %+v, %v", res, err)
	}
	if _, err := svc.Login("admin", "testpass", 24); err == nil {
		t.Error("old password still works")
	}
}

func TestResetPasswordPicksAdminAmongSeveral(t *testing.T) {
	db := setupTestDB(t)
	if _, err := db.Exec("DELETE FROM users"); err != nil {
		t.Fatal(err)
	}
	for _, u := range []string{"zed", "admin", "amy"} {
		if _, err := db.Exec("INSERT INTO users (username, password_hash) VALUES (?, 'x')", u); err != nil {
			t.Fatal(err)
		}
	}
	user, _, n, err := ResetPassword(db)
	if err != nil || user != "admin" || n != 3 {
		t.Fatalf("user=%q users=%d err=%v", user, n, err)
	}
}

func TestResetPasswordNoUser(t *testing.T) {
	db := setupTestDB(t)
	if _, err := db.Exec("DELETE FROM users"); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := ResetPassword(db); !errors.Is(err, ErrNoUser) {
		t.Fatalf("err = %v, want ErrNoUser", err)
	}
}
