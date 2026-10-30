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

// runResetPassword is `hops reset-password`: args are what follows the
// subcommand; dataDir is --data if it came before it ("" if not given). It
// returns the process exit code. It never creates a database, runs
// migrations or starts the server.
func runResetPassword(dataDir string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("hops "+resetPasswordCommand, flag.ContinueOnError)
	fs.SetOutput(stderr)
	data := fs.String("data", "", "Data folder holding hops.db (default: a \"data\" folder next to the hops program)")
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
	if dataDir == "" {
		d, err := defaultDataDir()
		if err != nil {
			fmt.Fprintf(stderr, "cannot work out where the hops program is, so there is no default data folder: %v\nrun it again with --data <folder>\n", err)
			return 1
		}
		dataDir = d
	}

	dbPath := filepath.Join(dataDir, "hops.db")
	if st, err := os.Stat(dbPath); err != nil || !st.Mode().IsRegular() {
		fmt.Fprintf(stderr, "no HOPS database (hops.db) in %s, so nothing was changed.\nIf your data is in another folder, run it again with --data <folder>.\n", dataDir)
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
