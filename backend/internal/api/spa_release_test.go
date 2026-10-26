//go:build !dev

package api

import (
	"net/http/httptest"
	"testing"
)

// Release builds must not contain the on-disk UI server.
func TestReleaseBuildHasNoDiskSPA(t *testing.T) {
	if _, ok := devSPAIndexHTML(); ok {
		t.Fatal("release build exposes the dev disk SPA index")
	}
	if serveSPADev(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil)) {
		t.Fatal("release build serves the UI from disk")
	}
}
