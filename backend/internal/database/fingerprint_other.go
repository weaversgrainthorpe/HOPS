//go:build !linux && !darwin

package database

import "os"

// No reliable change time here: images are always hashed fresh.
const fingerprintSupported = false

func fileFingerprint(fi os.FileInfo) (fingerprint, bool) { return fingerprint{}, false }
