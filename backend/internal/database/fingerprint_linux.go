//go:build linux

package database

import (
	"os"
	"syscall"
)

const fingerprintSupported = true

// fileFingerprint identifies a file's exact state: device, inode, size and
// modification and change times in ns. Any write changes ctime, so a match
// means the content is the one hashed before.
func fileFingerprint(fi os.FileInfo) (fingerprint, bool) {
	st, ok := fi.Sys().(*syscall.Stat_t)
	if !ok {
		return fingerprint{}, false
	}
	return fingerprint{
		dev: uint64(st.Dev), ino: uint64(st.Ino), size: st.Size,
		mtimeNs: st.Mtim.Sec*1e9 + int64(st.Mtim.Nsec),
		ctimeNs: st.Ctim.Sec*1e9 + int64(st.Ctim.Nsec),
	}, true
}
