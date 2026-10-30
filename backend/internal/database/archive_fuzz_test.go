package database

import (
	"bytes"
	"errors"
	"image"
	"image/png"
	"path/filepath"
	"testing"
)

// Security pass: the backup upload reader (StoreUpload: archive or legacy
// .db) is fuzzed. Any input must give a stored backup or an error, never a
// panic. Seeds are synthetic archives built here. Run as a normal test, the
// seeds are checked; `go test -fuzz=FuzzStoreUpload` explores further.
func FuzzStoreUpload(f *testing.F) {
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	var pb bytes.Buffer
	png.Encode(&pb, img)
	good := hopsDBBytes(f, "/icons/a.png")
	f.Add(buildZip(f, []zipEntry{{name: "hops.db", data: good}, {name: "icons/a.png", data: pb.Bytes()}}, nil))
	f.Add(buildZip(f, []zipEntry{{name: "hops.db", data: good}}, nil))
	f.Add(buildZip(f, []zipEntry{{name: "../evil", data: []byte("x")}}, nil))
	f.Add(buildZip(f, []zipEntry{{name: "icons/a.png", data: []byte("x"), symlink: true}}, nil))
	f.Add(buildZip(f, []zipEntry{{name: "hops.db", data: []byte("SQLite format 3\x00 not really")}}, nil))
	f.Add([]byte("PK\x03\x04"))
	f.Add([]byte("SQLite format 3\x00"))
	f.Add([]byte("plain text"))

	dir := f.TempDir()
	bm := NewBackupManager(filepath.Join(dir, "live.db"))
	caps := UploadCaps{Total: 8 << 20, PerImage: 1 << 20}
	f.Fuzz(func(t *testing.T, data []byte) {
		res, err := bm.StoreUpload(bytes.NewReader(data), caps)
		if err == nil && res.Name == "" {
			t.Fatal("success without a stored backup name")
		}
		var ibe *InvalidBackupError
		if err != nil && errors.As(err, &ibe) && ibe.Reason == "" {
			t.Fatal("refused without a reason")
		}
	})
}
