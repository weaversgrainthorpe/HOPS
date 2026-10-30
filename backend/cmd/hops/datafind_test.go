package main

import (
	"bytes"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeProgram makes an empty "hops" program file in a new folder and returns
// its path; the default data folder is "data" beside it.
func fakeProgram(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	exe := filepath.Join(dir, "hops")
	if err := os.WriteFile(exe, nil, 0o755); err != nil {
		t.Fatal(err)
	}
	return exe
}

// dataFolder makes dir (and parents) holding a hops.db with an admin user.
func dataFolder(t *testing.T, dir string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	makeResetDB(t, dir, true)
	return dir
}

// fakeProc adds a process to a fake /proc tree.
func fakeProc(t *testing.T, proc, pid string, argv []string, cwd string) {
	t.Helper()
	d := filepath.Join(proc, pid)
	if err := os.MkdirAll(d, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(d, "cmdline"), []byte(strings.Join(argv, "\x00")+"\x00"), 0o644); err != nil {
		t.Fatal(err)
	}
	if cwd != "" {
		if err := os.Symlink(cwd, filepath.Join(d, "cwd")); err != nil {
			t.Fatal(err)
		}
	}
}

// notRoot is an ordinary user who may write anywhere.
var notRoot = accountOps{
	euid:       func() int { return 1000 },
	stat:       func(string, bool) (fileInfo, error) { return fileInfo{uid: 1000, gid: 1000, regular: true}, nil },
	lookupUser: func(int) (string, int, error) { return "me", 1000, nil },
	writable:   func(string) bool { return true },
}

func mustChange(t *testing.T, dir string) int {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(dir, "hops.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var must int
	if err := db.QueryRow("SELECT must_change_password FROM users").Scan(&must); err != nil {
		t.Fatal(err)
	}
	return must
}

func TestFindDataDefaultOnly(t *testing.T) {
	exe := fakeProgram(t)
	want := dataFolder(t, filepath.Join(filepath.Dir(exe), "data"))
	var out, errb bytes.Buffer
	s := dataSearch{exe: exe, procDir: filepath.Join(t.TempDir(), "proc"), unitDirs: []string{t.TempDir()}, wellKnown: []string{filepath.Join(t.TempDir(), "none")}}
	if code := resetPassword("", nil, &out, &errb, s, notRoot); code != 0 {
		t.Fatalf("exit %d: %s", code, errb.String())
	}
	if !strings.HasPrefix(out.String(), "Data folder: "+want+" (the default, next to this program)\n") {
		t.Errorf("output should start with the folder: %q", out.String())
	}
	if mustChange(t, want) != 1 {
		t.Error("password not reset")
	}
}

func TestFindDataRunningProcess(t *testing.T) {
	proc := t.TempDir()
	work := t.TempDir()
	want := dataFolder(t, filepath.Join(work, "rel", "data"))
	fakeProc(t, proc, "4321", []string{"/opt/hops/hops", "--data", "rel/data"}, work)
	fakeProc(t, proc, "77", []string{"/usr/bin/python3", "--data", "rel/data"}, work)                       // not HOPS
	fakeProc(t, proc, "88", []string{"/opt/hops/hops", "reset-password", "--data", "rel/data"}, work)       // not a server
	fakeProc(t, proc, "99", []string{"/opt/hops/hops", "--data", filepath.Join(work, "rel", "data")}, work) // this process
	if err := os.MkdirAll(filepath.Join(proc, "self"), 0o755); err != nil {
		t.Fatal(err)
	}
	found := dataSearch{procDir: proc, selfPID: 99}.find().found
	if len(found) != 1 || found[0].dir != want || !strings.Contains(found[0].found[0], "process 4321") {
		t.Fatalf("found %+v, want %s from process 4321", found, want)
	}
}

func TestFindDataSystemdUnit(t *testing.T) {
	units := t.TempDir()
	plain := dataFolder(t, filepath.Join(t.TempDir(), "plain"))
	spaced := dataFolder(t, filepath.Join(t.TempDir(), "with spaces", "data"))
	other := dataFolder(t, filepath.Join(t.TempDir(), "other"))
	files := map[string]string{
		"hops.service":      "[Service]\nUser=hops\nExecStart=/opt/hops/hops --data " + plain + "\n",
		"hops-two.service":  "[Service]\nExecStart=\"/opt/my hops/hops\" \"--data=" + spaced + "\"\n",
		"other.service":     "[Service]\nExecStart=/opt/hops/hops --data " + other + "\n", // not a hops*.service
		"hops-cron.service": "[Service]\nExecStart=/usr/bin/curl --data " + other + "\n",  // not HOPS
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(units, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	found := dataSearch{unitDirs: []string{units}}.find().found
	var dirs []string
	for _, c := range found {
		dirs = append(dirs, c.dir)
	}
	if len(dirs) != 2 || !contains(dirs, plain) || !contains(dirs, spaced) {
		t.Fatalf("found %v, want %s and %s", dirs, plain, spaced)
	}
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

func TestFindDataWellKnown(t *testing.T) {
	want := dataFolder(t, filepath.Join(t.TempDir(), "var-lib-hops"))
	found := dataSearch{wellKnown: []string{filepath.Join(t.TempDir(), "missing"), want}}.find().found
	if len(found) != 1 || found[0].dir != want {
		t.Fatalf("found %+v, want %s", found, want)
	}
}

// The same folder found by a running process (through a symlink) and by a
// service is one candidate, not two.
func TestFindDataDedupe(t *testing.T) {
	real := dataFolder(t, filepath.Join(t.TempDir(), "data"))
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}
	proc, units := t.TempDir(), t.TempDir()
	fakeProc(t, proc, "10", []string{"hops-linux-amd64", "--data=" + link}, "/")
	if err := os.WriteFile(filepath.Join(units, "hops.service"), []byte("ExecStart=/opt/hops/hops --data "+real+"/\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var out, errb bytes.Buffer
	s := dataSearch{procDir: proc, unitDirs: []string{units}, wellKnown: []string{real}}
	if code := resetPassword("", nil, &out, &errb, s, notRoot); code != 0 {
		t.Fatalf("exit %d: %s", code, errb.String())
	}
	if !strings.HasPrefix(out.String(), "Data folder: "+real+" (running HOPS, process 10; service hops.service; usual install location)\n") {
		t.Errorf("output: %q", out.String())
	}
}

func TestFindDataSeveralChangesNothing(t *testing.T) {
	exe := fakeProgram(t)
	def := dataFolder(t, filepath.Join(filepath.Dir(exe), "data"))
	other := dataFolder(t, filepath.Join(t.TempDir(), "other"))
	var out, errb bytes.Buffer
	s := dataSearch{exe: exe, wellKnown: []string{other}}
	if code := resetPassword("", nil, &out, &errb, s, notRoot); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
	msg := errb.String()
	for _, want := range []string{"Found HOPS data in 2 folders, so nothing was changed", def, other, "--data"} {
		if !strings.Contains(msg, want) {
			t.Errorf("message lacks %q: %s", want, msg)
		}
	}
	if out.Len() != 0 {
		t.Errorf("unexpected stdout %q", out.String())
	}
	if mustChange(t, def) != 0 || mustChange(t, other) != 0 {
		t.Error("a database was changed")
	}
}

func TestFindDataNoneListsPlaces(t *testing.T) {
	exe := fakeProgram(t)
	units := t.TempDir()
	missing := filepath.Join(t.TempDir(), "var-lib-hops")
	var out, errb bytes.Buffer
	s := dataSearch{exe: exe, procDir: t.TempDir(), unitDirs: []string{units}, wellKnown: []string{missing}}
	if code := resetPassword("", nil, &out, &errb, s, notRoot); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
	msg := errb.String()
	for _, want := range []string{"Found no HOPS database (hops.db), so nothing was changed", filepath.Join(filepath.Dir(exe), "data"), "no other HOPS is running", "HOPS services (hops*.service): none", missing, "--data <folder>"} {
		if !strings.Contains(msg, want) {
			t.Errorf("message lacks %q: %s", want, msg)
		}
	}
	if entries, _ := os.ReadDir(filepath.Dir(exe)); len(entries) != 1 {
		t.Errorf("something was created beside the program: %v", entries)
	}
}

func TestFindDataExplicitSkipsSearch(t *testing.T) {
	dir := dataFolder(t, t.TempDir())
	s := dataSearch{services: func() ([]serviceCommand, []string, error) {
		t.Error("searched although --data was given")
		return nil, nil, nil
	}}
	var out, errb bytes.Buffer
	if code := resetPassword("", []string{"--data", dir}, &out, &errb, s, notRoot); code != 0 {
		t.Fatalf("exit %d: %s", code, errb.String())
	}
	if strings.Contains(out.String(), "Data folder:") {
		t.Errorf("explicit --data should not announce a found folder: %q", out.String())
	}
}

func TestSplitCommandLine(t *testing.T) {
	got := splitCommandLine(`/opt/hops/hops --data "/a b/c" '--x=y z' p\ q`, true)
	want := []string{"/opt/hops/hops", "--data", "/a b/c", "--x=y z", "p q"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("posix: %q", got)
	}
	got = splitCommandLine(`--data "C:\HOPS data\data"`, false)
	if len(got) != 2 || got[1] != `C:\HOPS data\data` {
		t.Errorf("windows: %q", got)
	}
}

// fakeSystemctl answers list-unit-files and cat from fixed text; a unit with
// no cat text fails, as systemctl does for an unknown unit.
func fakeSystemctl(list string, cat map[string]string) func(...string) ([]byte, error) {
	return func(args ...string) ([]byte, error) {
		switch args[0] {
		case "list-unit-files":
			return []byte(list), nil
		case "cat":
			if body, ok := cat[args[len(args)-1]]; ok {
				return []byte(body), nil
			}
			return nil, errors.New("exit status 1")
		}
		return nil, errors.New("unexpected systemctl call")
	}
}

// A drop-in from `systemctl edit` that resets ExecStart wins over the unit
// file, and the found folder is announced with the service's name.
func TestFindDataSystemctlDropIn(t *testing.T) {
	old := dataFolder(t, filepath.Join(t.TempDir(), "old"))
	edited := dataFolder(t, filepath.Join(t.TempDir(), "edited data"))
	cat := "# /etc/systemd/system/hops.service\n[Service]\nExecStart=/opt/hops/hops --data " + old + "\n\n" +
		"# /etc/systemd/system/hops.service.d/override.conf\n[Service]\nExecStart=\nExecStart=/opt/hops/hops --data \"" + edited + "\"\n"
	s := dataSearch{systemctl: fakeSystemctl("hops.service enabled enabled\n", map[string]string{"hops.service": cat})}
	var out, errb bytes.Buffer
	if code := resetPassword("", nil, &out, &errb, s, notRoot); code != 0 {
		t.Fatalf("exit %d: %s", code, errb.String())
	}
	if !strings.HasPrefix(out.String(), "Data folder: "+edited+" (service hops.service)\n") {
		t.Errorf("output: %q", out.String())
	}
	if mustChange(t, old) != 0 {
		t.Error("the overridden folder was changed")
	}
}

// Without systemctl the unit file and its drop-ins are read, with the same
// ExecStart reset; a failing systemctl cat falls back to the files too.
func TestFindDataUnitFileDropInFallback(t *testing.T) {
	for name, ctl := range map[string]func(...string) ([]byte, error){
		"no systemctl": nil,
		"cat fails":    fakeSystemctl("", nil),
	} {
		t.Run(name, func(t *testing.T) {
			etc, lib := t.TempDir(), t.TempDir()
			old := dataFolder(t, filepath.Join(t.TempDir(), "old"))
			edited := dataFolder(t, filepath.Join(t.TempDir(), "edited"))
			write := func(path, body string) {
				if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			write(filepath.Join(lib, "hops.service"), "[Service]\nExecStart=/opt/hops/hops --data "+old+"\n")
			write(filepath.Join(etc, "hops.service.d", "override.conf"), "[Service]\nExecStart=\nExecStart=/opt/hops/hops --data "+edited+"\n")
			found := dataSearch{unitDirs: []string{etc, lib}, systemctl: ctl}.find().found
			if len(found) != 1 || found[0].dir != edited || found[0].found[0] != "service hops.service" {
				t.Fatalf("found %+v, want only %s", found, edited)
			}
		})
	}
}

func TestFindDataReportsGaps(t *testing.T) {
	proc := t.TempDir()
	fakeProc(t, proc, "55", []string{"hops", "--host", "127.0.0.1"}, "") // relative program, no --data, no cwd
	looked := strings.Join(dataSearch{procDir: proc}.find().looked, "\n")
	if !strings.Contains(looked, "process 55: couldn't tell its data folder") {
		t.Errorf("looked: %s", looked)
	}
	looked = strings.Join(dataSearch{procDir: filepath.Join(t.TempDir(), "no-proc")}.find().looked, "\n")
	if !strings.Contains(looked, "couldn't list running programs") || strings.Contains(looked, "no other HOPS") {
		t.Errorf("looked: %s", looked)
	}
}
