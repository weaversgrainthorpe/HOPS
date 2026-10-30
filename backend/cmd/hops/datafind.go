package main

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
)

// dataSearch is where `hops reset-password` looks for a data folder when it
// is not given --data. Every root is a field so tests can point it at a fake
// tree; defaultDataSearch fills it in for the platform it runs on.
type dataSearch struct {
	exe       string                                     // this program ("" when unknown)
	procDir   string                                     // Linux /proc; "" skips it
	selfPID   int                                        // this process, never a candidate
	ps        func() ([]byte, error)                     // macOS `ps -axo pid=,command=`; nil skips it
	unitDirs  []string                                   // systemd unit folders, highest priority first
	systemctl func(args ...string) ([]byte, error)       // nil when there is no systemctl
	services  func() ([]serviceCommand, []string, error) // Windows services and problems; nil skips it
	wellKnown []string                                   // the folders the installers use
}

// serviceCommand is how a running program or a service starts HOPS: the
// program, its arguments, and the folder a relative --data is taken from.
type serviceCommand struct {
	name string // the service's name, for messages
	exe  string
	args []string
	dir  string
}

// dataCandidate is a folder holding a hops.db, and every way it was found.
type dataCandidate struct {
	dir   string
	found []string
}

// dataSearchResult is what a search found: the folders with a hops.db, a
// line for every place it looked, and how many folders it could not look
// inside (so a miss there is not taken for "no data").
type dataSearchResult struct {
	found   []dataCandidate
	looked  []string
	blocked int
	// blockedDirs names each folder it could not look inside, with how it
	// was found.
	blockedDirs []string
}

// find returns every folder with a hops.db, in search order and each once,
// and a line for every place it looked.
func (s dataSearch) find() dataSearchResult {
	var res dataSearchResult
	index := map[string]int{}
	checked := map[string]bool{}
	note := func(format string, a ...any) { res.looked = append(res.looked, fmt.Sprintf(format, a...)) }
	consider := func(dir, how string) {
		abs, err := filepath.Abs(dir)
		if err != nil {
			note("%s (%s): cannot make it a full path (%v)", dir, how, err)
			return
		}
		key := abs
		if real, err := filepath.EvalSymlinks(abs); err == nil {
			key = real
		}
		if i, ok := index[key]; ok {
			res.found[i].found = append(res.found[i].found, how)
			return
		}
		if checked[key] {
			return
		}
		checked[key] = true
		st, err := os.Stat(filepath.Join(key, "hops.db"))
		switch {
		case errors.Is(err, fs.ErrNotExist):
			note("%s (%s): no hops.db", abs, how)
		case err != nil:
			res.blocked++
			res.blockedDirs = append(res.blockedDirs, fmt.Sprintf("%s (%s)", abs, how))
			note("%s (%s): cannot look inside (%s) — run it with sudo", abs, how, errReason(err))
		case !st.Mode().IsRegular():
			note("%s (%s): hops.db is not a regular file", abs, how)
		default:
			index[key] = len(res.found)
			res.found = append(res.found, dataCandidate{dir: key, found: []string{how}})
		}
	}
	command := func(c serviceCommand, how string) {
		if d := c.dataDir(); d != "" {
			consider(d, how)
		} else {
			note("%s: couldn't tell its data folder", how)
		}
	}

	if s.exe != "" {
		if d, err := dataDirBeside(s.exe); err == nil {
			consider(d, "the default, next to this program")
		} else {
			note("next to this program: cannot find where it is (%v)", err)
		}
	}

	if s.procDir != "" {
		cmds, err := runningFromProc(s.procDir, s.selfPID)
		if err != nil {
			note("couldn't list running programs (%s)", errReason(err))
		} else if len(cmds) == 0 {
			note("running programs: no other HOPS is running (or none this user may see)")
		}
		for _, c := range cmds {
			command(c.serviceCommand, fmt.Sprintf("running HOPS, process %d", c.pid))
		}
	}
	if s.ps != nil {
		out, err := s.ps()
		cmds := runningFromPS(out, s.selfPID)
		if err != nil {
			note("couldn't list running programs (%v)", err)
		} else if len(cmds) == 0 {
			note("running programs: no other HOPS is running")
		}
		for _, c := range cmds {
			command(c.serviceCommand, fmt.Sprintf("running HOPS, process %d", c.pid))
		}
	}

	if len(s.unitDirs) > 0 || s.systemctl != nil {
		units, problems := s.systemdUnits()
		res.looked = append(res.looked, problems...)
		if len(units) == 0 {
			note("HOPS services (hops*.service): none")
		}
		for _, u := range units {
			if len(u.cmds) == 0 {
				note("service %s: does not start a HOPS program", u.name)
			}
			for _, c := range u.cmds {
				command(c, "service "+u.name)
			}
		}
	}
	if s.services != nil {
		cmds, problems, err := s.services()
		res.looked = append(res.looked, problems...)
		if err != nil {
			note("Windows services: couldn't list them (%v)", err)
		} else if len(cmds) == 0 {
			note("Windows services: none runs HOPS")
		}
		for _, c := range cmds {
			command(c, "Windows service "+c.name)
		}
	}

	for _, d := range s.wellKnown {
		consider(d, "usual install location")
	}
	return res
}

// errReason is the short reason in an error ("permission denied").
func errReason(err error) string {
	var pe *fs.PathError
	if errors.As(err, &pe) {
		return pe.Err.Error()
	}
	return err.Error()
}

// systemdUnit is a hops*.service and the HOPS commands it starts.
type systemdUnit struct {
	name string
	cmds []serviceCommand
}

// systemdUnits finds the hops*.service units, by name in the unit folders
// and from systemctl, and reads each one's effective ExecStart: from
// `systemctl cat` (the unit with its drop-ins, quoting kept) when there is
// a systemctl, else from the unit file and its .d/*.conf drop-ins.
func (s dataSearch) systemdUnits() ([]systemdUnit, []string) {
	var problems []string
	seen := map[string]bool{}
	var names []string
	add := func(n string) {
		if !seen[n] {
			seen[n] = true
			names = append(names, n)
		}
	}
	for _, d := range s.unitDirs {
		entries, err := os.ReadDir(d)
		if err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				problems = append(problems, fmt.Sprintf("%s: couldn't read the folder (%s)", d, errReason(err)))
			}
			continue
		}
		for _, e := range entries {
			if ok, _ := filepath.Match("hops*.service", e.Name()); ok {
				add(e.Name())
			}
		}
	}
	if s.systemctl != nil {
		out, err := s.systemctl("list-unit-files", "--no-legend", "--plain", "hops*.service")
		if err != nil {
			problems = append(problems, fmt.Sprintf("systemctl: couldn't list units (%v); reading the unit files instead", err))
		}
		sc := bufio.NewScanner(bytes.NewReader(out))
		for sc.Scan() {
			if f := strings.Fields(sc.Text()); len(f) > 0 && strings.HasSuffix(f[0], ".service") {
				add(f[0])
			}
		}
	}
	sort.Strings(names)

	var units []systemdUnit
	for _, n := range names {
		if s.systemctl != nil {
			if out, err := s.systemctl("cat", "--", n); err == nil {
				units = append(units, systemdUnit{name: n, cmds: unitCommands(out)})
				continue
			} else {
				problems = append(problems, fmt.Sprintf("service %s: systemctl cat failed (%v); reading its files instead", n, err))
			}
		}
		b, errs := s.unitFiles(n)
		problems = append(problems, errs...)
		if b == nil {
			continue
		}
		units = append(units, systemdUnit{name: n, cmds: unitCommands(b)})
	}
	return units, problems
}

// unitFiles is a unit's file (from the first unit folder that has it) and
// then its drop-ins (<name>.d/*.conf from every folder, a name in an earlier
// folder hiding the same name in a later one, in name order), joined as
// systemd reads them. It is nil when no folder has the unit.
func (s dataSearch) unitFiles(name string) ([]byte, []string) {
	var problems []string
	var main []byte
	for _, d := range s.unitDirs {
		b, err := os.ReadFile(filepath.Join(d, name)) // #nosec G304 -- a systemd unit file found by name
		if err == nil {
			main = b
			break
		}
		if !errors.Is(err, fs.ErrNotExist) {
			problems = append(problems, fmt.Sprintf("%s: couldn't read it (%s)", filepath.Join(d, name), errReason(err)))
		}
	}
	if main == nil {
		return nil, problems
	}
	dropins := map[string]string{}
	for _, d := range s.unitDirs {
		dd := filepath.Join(d, name+".d")
		entries, err := os.ReadDir(dd)
		if err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				problems = append(problems, fmt.Sprintf("%s: couldn't read the folder (%s)", dd, errReason(err)))
			}
			continue
		}
		for _, e := range entries {
			if strings.HasSuffix(e.Name(), ".conf") {
				if _, ok := dropins[e.Name()]; !ok {
					dropins[e.Name()] = filepath.Join(dd, e.Name())
				}
			}
		}
	}
	keys := make([]string, 0, len(dropins))
	for k := range dropins {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	all := append([]byte{}, main...)
	for _, k := range keys {
		b, err := os.ReadFile(dropins[k]) // #nosec G304 -- a systemd drop-in found by name
		if err != nil {
			problems = append(problems, fmt.Sprintf("%s: couldn't read it (%s)", dropins[k], errReason(err)))
			continue
		}
		all = append(append(all, '\n'), b...)
	}
	return all, problems
}

// runningHOPS is a running HOPS program and how it was started.
type runningHOPS struct {
	pid int
	serviceCommand
}

// runningFromProc reads a Linux /proc tree for running HOPS programs:
// processes whose program name starts with "hops", other than this one and
// other reset-password runs. Entries it cannot read are skipped; the error
// is for /proc itself.
func runningFromProc(procDir string, selfPID int) ([]runningHOPS, error) {
	entries, err := os.ReadDir(procDir)
	if err != nil {
		return nil, err
	}
	var out []runningHOPS
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil || pid == selfPID {
			continue
		}
		dir := filepath.Join(procDir, e.Name())
		raw, err := os.ReadFile(filepath.Join(dir, "cmdline")) // #nosec G304 -- a /proc entry
		if err != nil || len(raw) == 0 {
			continue
		}
		argv := strings.Split(strings.TrimRight(string(raw), "\x00"), "\x00")
		exe, _ := os.Readlink(filepath.Join(dir, "exe"))
		exe = strings.TrimSuffix(exe, " (deleted)")
		if !isHOPSProgram(argv[0]) && (exe == "" || !isHOPSProgram(exe)) {
			continue
		}
		if isResetRun(argv[1:]) {
			continue
		}
		if exe == "" && filepath.IsAbs(argv[0]) {
			exe = argv[0]
		}
		cwd, _ := os.Readlink(filepath.Join(dir, "cwd"))
		out = append(out, runningHOPS{pid: pid, serviceCommand: serviceCommand{exe: exe, args: argv[1:], dir: cwd}})
	}
	return out, nil
}

// runningFromPS reads `ps -axo pid=,command=` output (macOS). It is a best
// effort: a path with a space in it is cut at the space, and a relative
// --data cannot be resolved (ps does not say which folder the program runs
// in).
func runningFromPS(out []byte, selfPID int) []runningHOPS {
	var res []runningHOPS
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 2 {
			continue
		}
		pid, err := strconv.Atoi(f[0])
		if err != nil || pid == selfPID || !isHOPSProgram(f[1]) || isResetRun(f[2:]) {
			continue
		}
		exe := ""
		if filepath.IsAbs(f[1]) {
			exe = f[1]
		}
		res = append(res, runningHOPS{pid: pid, serviceCommand: serviceCommand{exe: exe, args: f[2:]}})
	}
	return res
}

// isResetRun reports whether a HOPS command line is a reset-password run
// rather than a server.
func isResetRun(args []string) bool {
	for _, a := range args {
		if a == resetPasswordCommand {
			return true
		}
	}
	return false
}

// isHOPSProgram reports whether a program path names HOPS (hops,
// hops-linux-arm64, hops-windows-amd64.exe, ...).
func isHOPSProgram(p string) bool {
	return strings.HasPrefix(strings.ToLower(filepath.Base(p)), "hops")
}

// dataDir is the data folder this command uses: its --data made absolute
// against dir, or else the default next to the program. It is "" when that
// cannot be known, and for a reset-password run (not a server).
func (c serviceCommand) dataDir() string {
	if isResetRun(c.args) {
		return ""
	}
	data, given := "", false
	for i := 0; i < len(c.args); i++ {
		a := c.args[i]
		switch {
		case a == "--":
			i = len(c.args)
		case a == "--data" || a == "-data":
			if i+1 < len(c.args) {
				data, given = c.args[i+1], true
				i++
			}
		case strings.HasPrefix(a, "--data="):
			data, given = strings.TrimPrefix(a, "--data="), true
		case strings.HasPrefix(a, "-data="):
			data, given = strings.TrimPrefix(a, "-data="), true
		}
	}
	if given {
		if data == "" {
			return ""
		}
		if filepath.IsAbs(data) {
			return filepath.Clean(data)
		}
		if c.dir == "" || !filepath.IsAbs(c.dir) {
			return ""
		}
		return filepath.Join(c.dir, data)
	}
	if c.exe == "" || !filepath.IsAbs(c.exe) {
		return ""
	}
	d, err := dataDirBeside(c.exe)
	if err != nil {
		return ""
	}
	return d
}

// unitCommands reads the ExecStart lines of a systemd unit (its file, then
// its drop-ins) that start HOPS, with the unit's WorkingDirectory (systemd's
// default is /). An empty ExecStart= drops the ones before it.
func unitCommands(unit []byte) []serviceCommand {
	var execs []string
	wd := "/"
	sc := bufio.NewScanner(bytes.NewReader(unit))
	var cont strings.Builder
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if strings.HasSuffix(line, "\\") {
			cont.WriteString(strings.TrimSuffix(line, "\\") + " ")
			continue
		}
		if cont.Len() > 0 {
			line = cont.String() + line
			cont.Reset()
		}
		if strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		switch strings.TrimSpace(k) {
		case "ExecStart":
			if v = strings.TrimSpace(v); v == "" {
				execs = nil // an empty ExecStart= clears the earlier ones
			} else {
				execs = append(execs, v)
			}
		case "WorkingDirectory":
			if d := strings.TrimPrefix(strings.TrimSpace(v), "-"); filepath.IsAbs(d) {
				wd = d
			}
		}
	}
	var out []serviceCommand
	for _, e := range execs {
		e = strings.TrimLeft(e, "-@:+!")
		argv := splitCommandLine(e, true)
		if len(argv) == 0 || !isHOPSProgram(argv[0]) {
			continue
		}
		out = append(out, serviceCommand{exe: argv[0], args: argv[1:], dir: wd})
	}
	return out
}

// splitCommandLine splits a command line into words. posix: '...' and "..."
// quote and a backslash escapes the next character (systemd, sh). Otherwise
// only "..." quotes, as on Windows.
func splitCommandLine(s string, posix bool) []string {
	var words []string
	var cur strings.Builder
	inWord := false
	var quote rune
	runes := []rune(s)
	for i := 0; i < len(runes); i++ {
		r := runes[i]
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			} else if posix && r == '\\' && quote == '"' && i+1 < len(runes) {
				i++
				cur.WriteRune(runes[i])
			} else {
				cur.WriteRune(r)
			}
		case r == '"' || (posix && r == '\''):
			quote, inWord = r, true
		case posix && r == '\\' && i+1 < len(runes):
			i++
			cur.WriteRune(runes[i])
			inWord = true
		case r == ' ' || r == '\t':
			if inWord {
				words = append(words, cur.String())
				cur.Reset()
				inWord = false
			}
		default:
			cur.WriteRune(r)
			inWord = true
		}
	}
	if inWord {
		words = append(words, cur.String())
	}
	return words
}

// shellQuote quotes a word for a command line when it needs it: '...' for
// a Unix shell, "..." on Windows.
func shellQuote(s string) string {
	if runtime.GOOS == "windows" {
		if s != "" && !strings.ContainsAny(s, " \t&()^%!") {
			return s
		}
		return `"` + s + `"`
	}
	if s != "" && !strings.ContainsAny(s, " \t\n'\"\\$`!&;|<>()*?[]#~{}") {
		return s
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
