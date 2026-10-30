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
		euid: os.Geteuid,
		owner: func(path string) (int, int, bool) {
			st, err := os.Stat(path)
			if err != nil {
				return 0, 0, false
			}
			sys, ok := st.Sys().(*syscall.Stat_t)
			if !ok {
				return 0, 0, false
			}
			return int(sys.Uid), int(sys.Gid), true
		},
		userName: func(uid int) string {
			if u, err := user.LookupId(strconv.Itoa(uid)); err == nil && u.Username != "" {
				return u.Username
			}
			return ""
		},
		switchTo: switchUser,
		writable: func(path string) bool { return syscall.Access(path, 2) == nil }, // 2 = W_OK
	}
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
