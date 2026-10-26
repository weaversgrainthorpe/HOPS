//go:build darwin

package database

import (
	"os"
	"syscall"
)

const fingerprintSupported = true

// fileFingerprint: see fingerprint_linux.go.
func fileFingerprint(fi os.FileInfo) (fingerprint, bool) {
	st, ok := fi.Sys().(*syscall.Stat_t)
	if !ok {
		return fingerprint{}, false
	}
	return fingerprint{
		dev: uint64(st.Dev), ino: uint64(st.Ino), size: st.Size,
		mtimeNs: st.Mtimespec.Sec*1e9 + int64(st.Mtimespec.Nsec),
		ctimeNs: st.Ctimespec.Sec*1e9 + int64(st.Ctimespec.Nsec),
	}, true
}
