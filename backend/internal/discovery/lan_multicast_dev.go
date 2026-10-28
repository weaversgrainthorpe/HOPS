//go:build dev

package discovery

import (
	"context"
	"errors"
)

var errLANMulticastOff = errors.New("LAN multicast is switched off in this dev test build (--no-lan-multicast)")

// DisableLANMulticast stops mDNS and SSDP sending to the LAN, for the test server: a test run
// must not touch the real network. Each scan says so in its warnings (never silently nothing).
func DisableLANMulticast() {
	browseMDNS = func(context.Context, hostAllowlist) ([]mdnsInstance, error) { return nil, errLANMulticastOff }
	browseSSDP = func(context.Context, hostAllowlist) ([]ssdpDevice, error) { return nil, errLANMulticastOff }
}
