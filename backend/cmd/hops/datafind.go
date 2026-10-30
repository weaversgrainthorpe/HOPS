package main

import (
	"bufio"
	"bytes"
	"fmt"
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
	exe       string                           // this program ("" when unknown)
	procDir   string                           // Linux /proc; "" skips it
	selfPID   int                              // this process, never a candidate
	ps        func() ([]byte, error)           // macOS `ps -axo pid=,command=`; nil skips it
	unitDirs  []string                         // systemd unit folders
	services  func() ([]serviceCommand, error) // Windows services; nil skips it
	wellKnown []string                         // the folders the installers use
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

// find returns every folder with a hops.db, in search order and each once,
// and a line for every place it looked.
func (s dataSearch) find() (found []dataCandidate, looked []string) {
	index := map[string]int{}
	checked := map[string]bool{}
	consider := func(dir, how string) {
		if dir == "" {
			return
		}
		abs, err := filepath.Abs(dir)
		if err != nil {
			return
		}
		key := abs
		if real, err := filepath.EvalSymlinks(abs); err == nil {
			key = real
		}
		if i, ok := index[key]; ok {
			found[i].found = append(found[i].found, how)
			return
		}
		st, err := os.Stat(filepath.Join(key, "hops.db"))
		if err != nil || !st.Mode().IsRegular() {
			if !checked[key] {
				checked[key] = true
				looked = append(looked, fmt.Sprintf("%s (%s): no hops.db", abs, how))
			}
			return
		}
		index[key] = len(found)
		found = append(found, dataCandidate{dir: key, found: []string{how}})
	}

	if s.exe != "" {
		if d, err := dataDirBeside(s.exe); err == nil {
			consider(d, "the default, next to this program")
		} else {
			looked = append(looked, fmt.Sprintf("next to this program: cannot find where it is (%v)", err))
		}
	}

	if s.procDir != "" {
		cmds := runningFromProc(s.procDir, s.selfPID)
		if len(cmds) == 0 {
			looked = append(looked, "running programs: no other HOPS is running (or none this user may see)")
		}
		for _, c := range cmds {
			consider(c.dataDir, fmt.Sprintf("used by the running HOPS, process %d", c.pid))
		}
	}
	if s.ps != nil {
		out, err := s.ps()
		cmds := runningFromPS(out)
		if err != nil {
			looked = append(looked, fmt.Sprintf("running programs: cannot list them (%v)", err))
		} else if len(cmds) == 0 {
			looked = append(looked, "running programs: no other HOPS is running")
		}
		for _, c := range cmds {
			if c.pid != s.selfPID {
				consider(c.dataDir, fmt.Sprintf("used by the running HOPS, process %d", c.pid))
			}
		}
	}

	if len(s.unitDirs) > 0 {
		units := 0
		for _, d := range s.unitDirs {
			files, _ := filepath.Glob(filepath.Join(d, "hops*.service"))
			sort.Strings(files)
			for _, f := range files {
				b, err := os.ReadFile(f) // #nosec G304 -- a systemd unit file found by name
				if err != nil {
					looked = append(looked, fmt.Sprintf("%s: cannot read it (%v)", f, err))
					continue
				}
				units++
				for _, c := range unitCommands(b) {
					consider(c.dataDir(), "in the service "+f)
				}
			}
		}
		if units == 0 {
			looked = append(looked, "HOPS services (hops*.service) in "+strings.Join(s.unitDirs, ", ")+": none")
		}
	}
	if s.services != nil {
		cmds, err := s.services()
		if err != nil {
			looked = append(looked, fmt.Sprintf("Windows services: cannot list them (%v)", err))
		} else if len(cmds) == 0 {
			looked = append(looked, "Windows services: none runs HOPS")
		}
		for _, c := range cmds {
			consider(c.dataDir(), "in the Windows service "+c.name)
		}
	}

	for _, d := range s.wellKnown {
		consider(d, "a usual install location")
	}
	return found, looked
}

// runningHOPS is a running HOPS program and the data folder it uses.
type runningHOPS struct {
	pid     int
	dataDir string
}

// runningFromProc reads a Linux /proc tree for running HOPS programs:
// processes whose program name starts with "hops", other than this one and
// other reset-password runs. Entries it cannot read are skipped.
func runningFromProc(procDir string, selfPID int) []runningHOPS {
	entries, err := os.ReadDir(procDir)
	if err != nil {
		return nil
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
		if exe == "" && filepath.IsAbs(argv[0]) {
			exe = argv[0]
		}
		cwd, _ := os.Readlink(filepath.Join(dir, "cwd"))
		c := serviceCommand{exe: exe, args: argv[1:], dir: cwd}
		if d := c.dataDir(); d != "" {
			out = append(out, runningHOPS{pid: pid, dataDir: d})
		}
	}
	return out
}

// runningFromPS reads `ps -axo pid=,command=` output (macOS). It is a best
// effort: a path with a space in it is cut at the space, and a relative
// --data is skipped (ps does not say which folder the program runs in).
func runningFromPS(out []byte) []runningHOPS {
	var res []runningHOPS
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 2 {
			continue
		}
		pid, err := strconv.Atoi(f[0])
		if err != nil || !isHOPSProgram(f[1]) {
			continue
		}
		exe := ""
		if filepath.IsAbs(f[1]) {
			exe = f[1]
		}
		c := serviceCommand{exe: exe, args: f[2:]}
		if d := c.dataDir(); d != "" {
			res = append(res, runningHOPS{pid: pid, dataDir: d})
		}
	}
	return res
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
	data, given := "", false
	for i := 0; i < len(c.args); i++ {
		a := c.args[i]
		switch {
		case a == "--":
			i = len(c.args)
		case a == resetPasswordCommand:
			return ""
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

// unitCommands reads the ExecStart lines of a systemd unit file that start
// HOPS, with the unit's WorkingDirectory (systemd's default is /).
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
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		switch strings.TrimSpace(k) {
		case "ExecStart":
			execs = append(execs, strings.TrimSpace(v))
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
