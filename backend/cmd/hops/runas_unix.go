//go:build !windows

package main

import (
	"os"
	"os/user"
	"strconv"
	"syscall"
)

// defaultAccountOps are the real user lookups and switch for Linux and macOS.
func defaultAccountOps() accountOps {
	return accountOps{
		euid:       os.Geteuid,
		stat:       statFile,
		lookupUser: lookupUser,
		switchTo:   switchUser,
		writable:   func(path string) bool { return syscall.Access(path, 2) == nil }, // 2 = W_OK
	}
}

// statFile is os.Stat (follow) or os.Lstat with the owner and identity.
func statFile(path string, follow bool) (fileInfo, error) {
	st, err := os.Lstat(path)
	if follow {
		st, err = os.Stat(path)
	}
	if err != nil {
		return fileInfo{}, err
	}
	fi := fileInfo{symlink: st.Mode()&os.ModeSymlink != 0, regular: st.Mode().IsRegular()}
	if sys, ok := st.Sys().(*syscall.Stat_t); ok {
		fi.uid, fi.gid = int(sys.Uid), int(sys.Gid)
		fi.dev, fi.ino = uint64(sys.Dev), uint64(sys.Ino) // #nosec G115 -- device numbers are not negative
	}
	return fi, nil
}

// lookupUser is the account's name and primary group.
func lookupUser(uid int) (string, int, error) {
	u, err := user.LookupId(strconv.Itoa(uid))
	if err != nil {
		return "", 0, err
	}
	gid, err := strconv.Atoi(u.Gid)
	if err != nil {
		return "", 0, err
	}
	return u.Username, gid, nil
}

// switchUser makes this process run as uid: its groups, then gid, then uid
// (once the uid is dropped the others can no longer be changed). Go applies
// each to every thread of the process.
func switchUser(uid, gid int) error {
	groups := []int{}
	if u, err := user.LookupId(strconv.Itoa(uid)); err == nil {
		if ids, err := u.GroupIds(); err == nil {
			for _, s := range ids {
				if g, err := strconv.Atoi(s); err == nil {
					groups = append(groups, g)
				}
			}
		}
	}
	if err := syscall.Setgroups(groups); err != nil {
		return err
	}
	if err := syscall.Setgid(gid); err != nil {
		return err
	}
	return syscall.Setuid(uid)
}
