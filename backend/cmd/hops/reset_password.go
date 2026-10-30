package main

import (
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"io"
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
	euid     func() int
	owner    func(path string) (uid, gid int, ok bool)
	userName func(uid int) string
	switchTo func(uid, gid int) error
	writable func(path string) bool
}

// runResetPassword is `hops reset-password`: args are what follows the
// subcommand; dataDir is --data if it came before it ("" if not given). It
// returns the process exit code. It never creates a database, runs
// migrations or starts the server.
func runResetPassword(dataDir string, args []string, stdout, stderr io.Writer) int {
	return resetPassword(dataDir, args, stdout, stderr, defaultDataSearch(), defaultAccountOps())
}

func resetPassword(dataDir string, args []string, stdout, stderr io.Writer, search dataSearch, acct accountOps) int {
	fs := flag.NewFlagSet("hops "+resetPasswordCommand, flag.ContinueOnError)
	fs.SetOutput(stderr)
	data := fs.String("data", "", "Data folder holding hops.db (default: found automatically)")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if fs.NArg() > 0 {
		fmt.Fprintf(stderr, "unexpected argument %q\nusage: hops %s [--data <folder>]\n", fs.Arg(0), resetPasswordCommand)
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
		found, looked := search.find()
		switch len(found) {
		case 0:
			fmt.Fprintf(stderr, "Found no HOPS database (hops.db), so nothing was changed. Looked at:\n")
			for _, l := range looked {
				fmt.Fprintf(stderr, "  %s\n", l)
			}
			fmt.Fprintf(stderr, "If your data is in another folder, run it again with --data <folder>:\n  %s %s --data <folder>\n", shellQuote(program), resetPasswordCommand)
			return 1
		case 1:
			dataDir = found[0].dir
			fmt.Fprintf(stdout, "Data folder: %s\n", dataDir)
		default:
			fmt.Fprintf(stderr, "Found HOPS data in %d folders, so nothing was changed:\n", len(found))
			for _, c := range found {
				fmt.Fprintf(stderr, "  %s (%s)\n", c.dir, strings.Join(c.found, "; "))
			}
			fmt.Fprintf(stderr, "Choose one and run it again with that folder:\n  %s %s --data <folder>\n", shellQuote(program), resetPasswordCommand)
			return 1
		}
	}

	dbPath := filepath.Join(dataDir, "hops.db")
	if st, err := os.Stat(dbPath); err != nil || !st.Mode().IsRegular() {
		fmt.Fprintf(stderr, "no HOPS database (hops.db) in %s, so nothing was changed.\nIf your data is in another folder, run it again with --data <folder>.\n", dataDir)
		return 1
	}

	if !runAsOwner(dbPath, dataDir, program, acct, stdout, stderr) {
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
// When it cannot, it says which command to run instead and returns false,
// having changed nothing.
func runAsOwner(dbPath, dataDir, program string, acct accountOps, stdout, stderr io.Writer) bool {
	if acct.euid == nil || acct.owner == nil {
		return true
	}
	euid := acct.euid()
	if euid < 0 {
		return true
	}
	uid, gid, ok := acct.owner(dbPath)
	if !ok {
		return true
	}
	name := ""
	if acct.userName != nil {
		name = acct.userName(uid)
	}
	sudoUser := name
	if sudoUser == "" {
		name = fmt.Sprintf("user id %d", uid)
		sudoUser = fmt.Sprintf("#%d", uid)
	}
	command := fmt.Sprintf("sudo -u %s %s %s --data %s", shellQuote(sudoUser), shellQuote(program), resetPasswordCommand, shellQuote(dataDir))

	if euid == 0 {
		if uid == 0 {
			return true
		}
		if err := acct.switchTo(uid, gid); err != nil {
			fmt.Fprintf(stderr, "%s belongs to %s, and could not switch to that user (%v), so nothing was changed.\nRun this instead:\n  %s\n", dbPath, name, err, command)
			return false
		}
		fmt.Fprintf(stdout, "Running as %s\n", name)
		return true
	}
	if acct.writable == nil || (acct.writable(dbPath) && acct.writable(dataDir)) {
		return true
	}
	fmt.Fprintf(stderr, "%s belongs to %s, and this user cannot change it, so nothing was changed.\nRun this instead:\n  %s\n", dbPath, name, command)
	return false
}
