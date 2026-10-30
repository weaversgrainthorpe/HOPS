//go:build !windows

package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// asRoot is root with the real file checks, but hops.db shown as owned by
// uid 1234 (account "hops", primary group 4321) and no real user switch.
func asRoot(t *testing.T, switched *[][2]int) accountOps {
	t.Helper()
	return accountOps{
		euid: func() int { return 0 },
		stat: func(p string, follow bool) (fileInfo, error) {
			fi, err := statFile(p, follow)
			if filepath.Base(p) == "hops.db" {
				fi.uid, fi.gid = 1234, 999
			}
			return fi, err
		},
		lookupUser: func(uid int) (string, int, error) {
			if uid == 1234 {
				return "hops", 4321, nil
			}
			return "", 0, errors.New("unknown user")
		},
		switchTo: func(uid, gid int) error {
			*switched = append(*switched, [2]int{uid, gid})
			return nil
		},
	}
}

// unreadable makes dir unreadable for the test's run and restores it after.
func unreadable(t *testing.T, dir string) {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Skip("root can read any folder")
	}
	if err := os.Chmod(dir, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })
}

func TestResetPasswordRootSwitchesToOwner(t *testing.T) {
	dir := dataFolder(t, t.TempDir())
	var calls [][2]int
	acct := asRoot(t, &calls)
	inner := acct.switchTo
	acct.switchTo = func(uid, gid int) error {
		if mustChange(t, dir) != 0 {
			t.Error("database changed before switching user")
		}
		return inner(uid, gid)
	}
	var out, errb bytes.Buffer
	if code := resetPassword("", []string{"--data", dir}, &out, &errb, dataSearch{}, acct); code != 0 {
		t.Fatalf("exit %d: %s", code, errb.String())
	}
	// The account's primary group, not the file's group.
	if len(calls) != 1 || calls[0] != [2]int{1234, 4321} {
		t.Errorf("switch calls %v, want one to 1234/4321", calls)
	}
	if !strings.HasPrefix(out.String(), "Running as hops\n") {
		t.Errorf("output: %q", out.String())
	}
	if mustChange(t, dir) != 1 {
		t.Error("password not reset")
	}
}

func TestResetPasswordSwitchFailureChangesNothing(t *testing.T) {
	exe := fakeProgram(t)
	dir := dataFolder(t, t.TempDir())
	var calls [][2]int
	acct := asRoot(t, &calls)
	acct.switchTo = func(int, int) error { return errors.New("operation not permitted") }
	var out, errb bytes.Buffer
	if code := resetPassword("", []string{"--data", dir}, &out, &errb, dataSearch{exe: exe}, acct); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
	want := "sudo -u hops " + exe + " reset-password --data " + dir
	if !strings.Contains(errb.String(), want) {
		t.Errorf("message lacks %q: %s", want, errb.String())
	}
	if mustChange(t, dir) != 0 {
		t.Error("database was changed")
	}
}

func TestResetPasswordOwnerLookupFailureChangesNothing(t *testing.T) {
	exe := fakeProgram(t)
	dir := dataFolder(t, t.TempDir())
	var calls [][2]int
	acct := asRoot(t, &calls)
	acct.lookupUser = func(int) (string, int, error) { return "", 0, errors.New("no such user") }
	var out, errb bytes.Buffer
	if code := resetPassword("", []string{"--data", dir}, &out, &errb, dataSearch{exe: exe}, acct); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
	want := "sudo -u '#1234' " + exe + " reset-password --data " + dir
	if !strings.Contains(errb.String(), want) || len(calls) != 0 {
		t.Errorf("calls %v; message lacks %q: %s", calls, want, errb.String())
	}
	if mustChange(t, dir) != 0 {
		t.Error("database was changed")
	}
}

func TestResetPasswordRootRefusesSymlink(t *testing.T) {
	real := dataFolder(t, t.TempDir())
	dir := t.TempDir()
	if err := os.Symlink(filepath.Join(real, "hops.db"), filepath.Join(dir, "hops.db")); err != nil {
		t.Fatal(err)
	}
	var calls [][2]int
	var out, errb bytes.Buffer
	if code := resetPassword("", []string{"--data", dir}, &out, &errb, dataSearch{}, asRoot(t, &calls)); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
	if !strings.Contains(errb.String(), "is a symbolic link") || len(calls) != 0 {
		t.Errorf("calls %v, message: %s", calls, errb.String())
	}
	if mustChange(t, real) != 0 {
		t.Error("database was changed")
	}
}

func TestResetPasswordRootRefusesRootFileInUsersFolder(t *testing.T) {
	dir := dataFolder(t, t.TempDir())
	var calls [][2]int
	acct := asRoot(t, &calls)
	acct.stat = func(p string, follow bool) (fileInfo, error) {
		fi, err := statFile(p, follow)
		fi.uid = 1234 // the folder
		if filepath.Base(p) == "hops.db" {
			fi.uid = 0
		}
		return fi, err
	}
	var out, errb bytes.Buffer
	if code := resetPassword("", []string{"--data", dir}, &out, &errb, dataSearch{}, acct); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
	if !strings.Contains(errb.String(), "belongs to root, but its folder") || len(calls) != 0 {
		t.Errorf("calls %v, message: %s", calls, errb.String())
	}
	if mustChange(t, dir) != 0 {
		t.Error("database was changed")
	}
}

// A hops.db swapped for another file between the check and the open is
// refused before anything is written.
func TestResetPasswordRootRefusesSwappedFile(t *testing.T) {
	dir := dataFolder(t, t.TempDir())
	var calls [][2]int
	acct := asRoot(t, &calls)
	inner := acct.stat
	n := 0
	acct.stat = func(p string, follow bool) (fileInfo, error) {
		fi, err := inner(p, follow)
		if filepath.Base(p) == "hops.db" {
			if n++; n > 1 {
				fi.ino++
			}
		}
		return fi, err
	}
	var out, errb bytes.Buffer
	if code := resetPassword("", []string{"--data", dir}, &out, &errb, dataSearch{}, acct); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
	if !strings.Contains(errb.String(), "changed while it was being checked") {
		t.Errorf("message: %s", errb.String())
	}
	if mustChange(t, dir) != 0 {
		t.Error("database was changed")
	}
}

func TestResetPasswordNotWritableNamesOwner(t *testing.T) {
	exe := fakeProgram(t)
	dir := dataFolder(t, t.TempDir())
	acct := notRoot
	acct.stat = func(string, bool) (fileInfo, error) { return fileInfo{uid: 999, gid: 999, regular: true}, nil }
	acct.lookupUser = func(int) (string, int, error) { return "hops", 999, nil }
	acct.writable = func(string) bool { return false }
	var out, errb bytes.Buffer
	if code := resetPassword("", []string{"--data", dir}, &out, &errb, dataSearch{exe: exe}, acct); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
	for _, want := range []string{"belongs to hops", "sudo -u hops " + exe + " reset-password --data " + dir} {
		if !strings.Contains(errb.String(), want) {
			t.Errorf("message lacks %q: %s", want, errb.String())
		}
	}
	if mustChange(t, dir) != 0 {
		t.Error("database was changed")
	}
}

// A folder that cannot be looked inside (install.sh's /var/lib/hops is 0750
// hops:hops) is never reported as having no hops.db.
func TestFindDataPermissionDeniedIsNotAMiss(t *testing.T) {
	blocked := dataFolder(t, filepath.Join(t.TempDir(), "var-lib-hops"))
	unreadable(t, blocked)

	var out, errb bytes.Buffer
	if code := resetPassword("", nil, &out, &errb, dataSearch{wellKnown: []string{blocked}}, notRoot); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
	msg := errb.String()
	if strings.Contains(msg, "Found no HOPS database") || strings.Contains(msg, "no hops.db") ||
		!strings.Contains(msg, blocked+" (usual install location): cannot look inside (permission denied) — run it with sudo") ||
		!strings.Contains(msg, "Run it with sudo") {
		t.Errorf("message: %s", msg)
	}

	// One readable folder plus one it cannot see into is not "exactly one".
	other := dataFolder(t, filepath.Join(t.TempDir(), "other"))
	out.Reset()
	errb.Reset()
	if code := resetPassword("", nil, &out, &errb, dataSearch{wellKnown: []string{other, blocked}}, notRoot); code != 1 {
		t.Fatalf("one found + one blocked: exit %d, want 1", code)
	}
	if mustChange(t, other) != 0 || out.Len() != 0 {
		t.Errorf("chose %s although another folder could not be checked: %q", other, out.String())
	}

	// The same rule for an explicit --data.
	errb.Reset()
	if code := resetPassword("", []string{"--data", blocked}, &out, &errb, dataSearch{}, notRoot); code != 1 {
		t.Fatalf("explicit: exit %d, want 1", code)
	}
	if !strings.Contains(errb.String(), "cannot look inside "+blocked+" (permission denied)") || strings.Contains(errb.String(), "no HOPS database") {
		t.Errorf("explicit message: %s", errb.String())
	}
}

func TestFindDataUnreadableUnitFolder(t *testing.T) {
	units := t.TempDir()
	unreadable(t, units)
	looked := strings.Join(dataSearch{unitDirs: []string{units}}.find().looked, "\n")
	if !strings.Contains(looked, units+": couldn't read the folder (permission denied)") {
		t.Errorf("looked: %s", looked)
	}
}
