package main

import (
	"bytes"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func makeResetDB(t *testing.T, dir string, withUser bool) {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(dir, "hops.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, s := range []string{
		`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, must_change_password INTEGER NOT NULL DEFAULT 0)`,
		`CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at DATETIME NOT NULL)`,
	} {
		if _, err := db.Exec(s); err != nil {
			t.Fatal(err)
		}
	}
	if withUser {
		h, _ := bcrypt.GenerateFromPassword([]byte("oldpass"), bcrypt.MinCost)
		if _, err := db.Exec("INSERT INTO users (username, password_hash) VALUES ('admin', ?)", string(h)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestResetPasswordNoDatabaseCreatesNothing(t *testing.T) {
	dir := t.TempDir()
	var out, errb bytes.Buffer
	if code := runResetPassword(dir, nil, &out, &errb); code == 0 {
		t.Fatal("expected a non-zero exit")
	}
	if !strings.Contains(errb.String(), dir) || !strings.Contains(errb.String(), "--data") {
		t.Errorf("message should name the folder and suggest --data: %q", errb.String())
	}
	if out.Len() != 0 {
		t.Errorf("unexpected stdout %q", out.String())
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Errorf("folder was modified: %v", entries)
	}
}

func TestResetPasswordNoUser(t *testing.T) {
	dir := t.TempDir()
	makeResetDB(t, dir, false)
	var out, errb bytes.Buffer
	if code := runResetPassword(dir, nil, &out, &errb); code == 0 || !strings.Contains(errb.String(), "no user") {
		t.Fatalf("code/err: %q", errb.String())
	}
}

func TestResetPasswordFlagBeforeAndAfter(t *testing.T) {
	for name, tc := range map[string]struct {
		dataBefore string
		args       func(dir string) []string
	}{
		"before": {"DIR", func(string) []string { return nil }},
		"after":  {"", func(dir string) []string { return []string{"--data", dir} }},
		"after=": {"", func(dir string) []string { return []string{"--data=" + dir} }},
	} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			makeResetDB(t, dir, true)
			before := ""
			if tc.dataBefore != "" {
				before = dir
			}
			var out, errb bytes.Buffer
			if code := runResetPassword(before, tc.args(dir), &out, &errb); code != 0 {
				t.Fatalf("exit %d: %s", code, errb.String())
			}
			if !strings.Contains(out.String(), "Username:           admin") || !strings.Contains(out.String(), "Sign in with this, then choose a new password.") {
				t.Errorf("output: %q", out.String())
			}
			var must int
			db, _ := sql.Open("sqlite", filepath.Join(dir, "hops.db"))
			defer db.Close()
			if err := db.QueryRow("SELECT must_change_password FROM users").Scan(&must); err != nil || must != 1 {
				t.Errorf("must=%d err=%v", must, err)
			}
		})
	}
}

func TestResetPasswordRejectsExtraArgs(t *testing.T) {
	var out, errb bytes.Buffer
	if code := runResetPassword("", []string{"bogus"}, &out, &errb); code != 2 {
		t.Errorf("code = %d", code)
	}
}
