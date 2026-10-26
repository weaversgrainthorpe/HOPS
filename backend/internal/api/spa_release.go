//go:build !dev

package api

import "net/http"

// Release builds have no on-disk UI path: the UI is the copy embedded in the
// binary. The dev-only counterpart is spa_dev.go (-tags dev).

func serveSPADev(http.ResponseWriter, *http.Request) bool { return false }

func devSPAIndexHTML() ([]byte, bool) { return nil, false }
