package discovery

import (
	"context"
	"errors"
	"os"
	"testing"
)

// The tests never send mDNS or SSDP to the LAN: a scan in a test gets these no-network stand-ins.
func TestMain(m *testing.M) {
	off := errors.New("LAN multicast is off in tests")
	browseMDNS = func(context.Context, hostAllowlist) ([]mdnsInstance, error) { return nil, off }
	browseSSDP = func(context.Context, hostAllowlist) ([]ssdpDevice, error) { return nil, off }
	os.Exit(m.Run())
}
