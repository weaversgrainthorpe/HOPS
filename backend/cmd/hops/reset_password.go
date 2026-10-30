package main

import (
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/weaversgrainthorpe/HOPS/internal/auth"
	"github.com/weaversgrainthorpe/HOPS/internal/database"

	_ "modernc.org/sqlite"
)

const resetPasswordCommand = "reset-password"

// usage prints the command-line help, including the subcommand.
func usage() {
	out := flag.CommandLine.Output()
	fmt.Fprintf(out, "Usage:\n  hops [options]                  start HOPS\n  hops %s [--data <folder>]   forgotten password: print a one-time temporary password\n\nOptions:\n", resetPasswordCommand)
	flag.PrintDefaults()
}

// accountOps are the user lookups reset-password needs, so tests can stand
// in for root. euid is -1 where users are not switched (Windows); a nil
// writable skips the check.
type accountOps struct {
	euid       func() int
	stat       func(path string, follow bool) (fileInfo, error)
	lookupUser func(uid int) (name string, gid int, err error)
	switchTo   func(uid, gid int) error
	writable   func(path string) bool
}

// fileInfo is a file's owner and identity.
type fileInfo struct {
	uid, gid         int
	dev, ino         uint64
	symlink, regular bool
}

// runResetPassword is `hops reset-password`: args are what follows the
// subcommand; dataDir is --data if it came before it ("" if not given). It
// returns the process exit code. It never creates a database, runs
// migrations or starts the server.
func runResetPassword(dataDir string, args []string, stdout, stderr io.Writer) int {
	return resetPassword(dataDir, args, stdout, stderr, defaultDataSearch(), defaultAccountOps())
}

func resetPassword(dataDir string, args []string, stdout, stderr io.Writer, search dataSearch, acct accountOps) int {
	flags := flag.NewFlagSet("hops "+resetPasswordCommand, flag.ContinueOnError)
	flags.SetOutput(stderr)
	data := flags.String("data", "", "Data folder holding hops.db (default: found automatically)")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() > 0 {
		fmt.Fprintf(stderr, "unexpected argument %q\nusage: hops %s [--data <folder>]\n", flags.Arg(0), resetPasswordCommand)
		return 2
	}
	if *data != "" {
		dataDir = *data
	}
	program := "hops"
	if search.exe != "" {
		program = search.exe
		if real, err := filepath.EvalSymlinks(search.exe); err == nil {
			program = real
		}
	}

	if dataDir == "" {
		res := search.find()
		switch {
		case len(res.found) == 0 || (res.blocked > 0 && len(res.found) == 1):
			if len(res.found) == 0 && res.blocked == 0 {
				fmt.Fprintf(stderr, "Found no HOPS database (hops.db), so nothing was changed. Looked at:\n")
			} else {
				fmt.Fprintf(stderr, "Could not look inside %d folder(s), so it cannot tell where your data is and nothing was changed. Run it with sudo. Looked at:\n", res.blocked)
			}
			for _, c := range res.found {
				fmt.Fprintf(stderr, "  %s (%s): has hops.db\n", c.dir, strings.Join(c.found, "; "))
			}
			for _, l := range res.looked {
				fmt.Fprintf(stderr, "  %s\n", l)
			}
			fmt.Fprintf(stderr, "If your data is in another folder, run it again with --data <folder>:\n  %s %s --data <folder>\n", shellQuote(program), resetPasswordCommand)
			return 1
		case len(res.found) == 1:
			dataDir = res.found[0].dir
			fmt.Fprintf(stdout, "Data folder: %s (%s)\n", dataDir, strings.Join(res.found[0].found, "; "))
		default:
			fmt.Fprintf(stderr, "Found HOPS data in %d folders, so nothing was changed:\n", len(res.found))
			for _, c := range res.found {
				fmt.Fprintf(stderr, "  %s (%s)\n", c.dir, strings.Join(c.found, "; "))
			}
			if res.blocked > 0 {
				fmt.Fprintf(stderr, "and could not look inside %d more (run it with sudo to see them):\n", res.blocked)
				for _, l := range res.looked {
					if strings.Contains(l, "cannot look inside") {
						fmt.Fprintf(stderr, "  %s\n", l)
					}
				}
			}
			fmt.Fprintf(stderr, "Choose one and run it again with that folder:\n  %s %s --data <folder>\n", shellQuote(program), resetPasswordCommand)
			return 1
		}
	}

	dbPath := filepath.Join(dataDir, "hops.db")
	if st, err := os.Stat(dbPath); errors.Is(err, fs.ErrNotExist) || (err == nil && !st.Mode().IsRegular()) {
		fmt.Fprintf(stderr, "no HOPS database (hops.db) in %s, so nothing was changed.\nIf your data is in another folder, run it again with --data <folder>.\n", dataDir)
		return 1
	} else if err != nil {
		fmt.Fprintf(stderr, "cannot look inside %s (%s), so nothing was changed.\nRun it with sudo:\n  sudo %s %s --data %s\n", dataDir, errReason(err), shellQuote(program), resetPasswordCommand, shellQuote(dataDir))
		return 1
	}

	first, verify, ok := runAsOwner(dbPath, dataDir, program, acct, stdout, stderr)
	if !ok {
		return 1
	}
	// As root, the file opened must be the one checked: not swapped for a
	// link or another file in between.
	same := func() bool {
		if !verify {
			return true
		}
		fi, err := acct.stat(dbPath, false)
		if err == nil && !fi.symlink && fi.dev == first.dev && fi.ino == first.ino && fi.uid == first.uid {
			return true
		}
		fmt.Fprintf(stderr, "%s changed while it was being checked, so nothing was changed.\n", dbPath)
		return false
	}
	if !same() {
		return 1
	}

	// mode=rw never creates a file; the immediate transaction takes the
	// write lock up front so a running server's writes only make it wait.
	// The path is escaped (a #, ? or % in a folder name would otherwise end
	// it early and open a different, new file).
	dsn, err := database.SQLiteFileURI(dbPath, "mode=rw&_txlock=immediate")
	if err != nil {
		fmt.Fprintf(stderr, "cannot open %s: %v\n", dbPath, err)
		return 1
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		fmt.Fprintf(stderr, "cannot open %s: %v\n", dbPath, err)
		return 1
	}
	defer db.Close()
	// Same wait-for-lock setting and single connection as the app.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec("PRAGMA busy_timeout=5000"); err != nil {
		fmt.Fprintf(stderr, "cannot open %s: %v\n", dbPath, err)
		return 1
	}
	if !same() {
		return 1
	}

	username, temp, users, err := auth.ResetPassword(db)
	if err != nil {
		if errors.Is(err, auth.ErrNoUser) {
			fmt.Fprintf(stderr, "the database in %s has no user, so nothing was changed.\n", dataDir)
		} else {
			fmt.Fprintf(stderr, "could not reset the password in %s: %v\nNothing was changed.\n", dbPath, err)
		}
		return 1
	}

	if users > 1 {
		fmt.Fprintf(stdout, "Note: there are %d users in this database; the password of %q (the admin user) was reset.\n", users, username)
	}
	fmt.Fprintf(stdout, "Username:           %s\nTemporary password: %s\n\nSign in with this, then choose a new password.\nEvery browser has been signed out.\n", username, temp)
	slog.Info("admin password reset from the command line; every session ended", "component", "auth", "username", username, "data_dir", dataDir)
	return 0
}

// runAsOwner makes sure the database can be changed by this process and
// that any file SQLite creates beside it belongs to its owner: as root it
// becomes the database's owner; as anyone else it checks it may write there.
// When it cannot, it says why (and which command to run instead) and returns
// ok=false, having changed nothing. As root it returns the file it checked
// and verify=true, so the caller can make sure it opens that same file.
func runAsOwner(dbPath, dataDir, program string, acct accountOps, stdout, stderr io.Writer) (first fileInfo, verify, ok bool) {
	if acct.euid == nil || acct.stat == nil {
		return fileInfo{}, false, true
	}
	euid := acct.euid()
	if euid < 0 {
		return fileInfo{}, false, true
	}
	fi, err := acct.stat(dbPath, euid != 0)
	if err != nil {
		fmt.Fprintf(stderr, "cannot check %s (%v), so nothing was changed.\n", dbPath, err)
		return fileInfo{}, false, false
	}
	name, gid, lookupErr := "", 0, error(nil)
	if acct.lookupUser != nil {
		name, gid, lookupErr = acct.lookupUser(fi.uid)
	} else {
		lookupErr = errors.New("no user lookup")
	}
	sudoUser := name
	if lookupErr != nil || name == "" {
		name = fmt.Sprintf("user id %d", fi.uid)
		sudoUser = fmt.Sprintf("#%d", fi.uid)
	}
	command := fmt.Sprintf("sudo -u %s %s %s --data %s", shellQuote(sudoUser), shellQuote(program), resetPasswordCommand, shellQuote(dataDir))

	if euid != 0 {
		if acct.writable == nil || (acct.writable(dbPath) && acct.writable(dataDir)) {
			return fileInfo{}, false, true
		}
		fmt.Fprintf(stderr, "%s belongs to %s, and this user cannot change it, so nothing was changed.\nRun this instead:\n  %s\n", dbPath, name, command)
		return fileInfo{}, false, false
	}

	if fi.symlink {
		fmt.Fprintf(stderr, "%s is a symbolic link, which is not followed when run as root, so nothing was changed.\nRun it with --data on the folder that really holds hops.db.\n", dbPath)
		return fileInfo{}, false, false
	}
	if !fi.regular {
		fmt.Fprintf(stderr, "%s is not a regular file, so nothing was changed.\n", dbPath)
		return fileInfo{}, false, false
	}
	if fi.uid == 0 {
		di, err := acct.stat(dataDir, true)
		if err != nil {
			fmt.Fprintf(stderr, "cannot check %s (%v), so nothing was changed.\n", dataDir, err)
			return fileInfo{}, false, false
		}
		if di.uid != 0 {
			owner := fmt.Sprintf("user id %d", di.uid)
			if acct.lookupUser != nil {
				if n, _, err := acct.lookupUser(di.uid); err == nil && n != "" {
					owner = n
				}
			}
			fmt.Fprintf(stderr, "%s belongs to root, but its folder %s belongs to %s, so nothing was changed.\nHOPS normally runs as the folder's owner; give hops.db back to that user (for example sudo chown %s %s) and run it again.\n", dbPath, dataDir, owner, shellQuote(owner), shellQuote(dbPath))
			return fileInfo{}, false, false
		}
		return fi, true, true
	}
	if lookupErr != nil {
		fmt.Fprintf(stderr, "%s belongs to %s, and that account could not be looked up (%v), so nothing was changed.\nRun this instead:\n  %s\n", dbPath, name, lookupErr, command)
		return fileInfo{}, false, false
	}
	if err := acct.switchTo(fi.uid, gid); err != nil {
		fmt.Fprintf(stderr, "%s belongs to %s, and could not switch to that user (%v), so nothing was changed.\nRun this instead:\n  %s\n", dbPath, name, err, command)
		return fileInfo{}, false, false
	}
	fmt.Fprintf(stdout, "Running as %s\n", name)
	return fi, true, true
}
