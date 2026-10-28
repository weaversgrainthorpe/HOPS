package discovery

import (
	"errors"
	"testing"
)

// fetchRoot's plain-HTTP fallback on TLS-expected ports, with the shapes
// seen on real containers.
func TestFetchRootPlainFallback(t *testing.T) {
	tlsErr := errors.New("tls: first record does not look like a TLS handshake")
	page := &HTTPSnapshot{Status: 200, Body: []byte("<MediaContainer/>")}
	nginx400 := &HTTPSnapshot{Status: 400, Body: []byte("<html><head><title>400 The plain HTTP request was sent to HTTPS port</title></head></html>")}
	cases := []struct {
		name        string
		tlsExpected bool
		tlsResp     *HTTPSnapshot
		tlsErr      error
		plainResp   *HTTPSnapshot
		plainErr    error
		wantSnap    *HTTPSnapshot
		wantPlain   bool
		wantErr     bool
	}{
		{"TLS answers", true, page, nil, nil, nil, page, false, false},
		{"fresh Plex on 32400: no TLS, plain page", true, nil, tlsErr, page, nil, page, true, false},
		{"NPM on 443 without certs: plain gets nginx 400", true, nil, tlsErr, nginx400, nil, nil, false, true},
		{"neither scheme answers", true, nil, tlsErr, nil, errors.New("reset"), nil, false, true},
		{"plain port failing is not retried as TLS", false, nil, tlsErr, page, nil, nil, false, true},
	}
	for _, c := range cases {
		calls := 0
		snap, plain, err := fetchRoot(c.tlsExpected, func(tlsOn bool) (*HTTPSnapshot, error) {
			calls++
			if tlsOn == c.tlsExpected && calls == 1 {
				return c.tlsResp, c.tlsErr
			}
			return c.plainResp, c.plainErr
		})
		if snap != c.wantSnap || plain != c.wantPlain || (err != nil) != c.wantErr {
			t.Errorf("%s: snap=%v plain=%v err=%v", c.name, snap, plain, err)
		}
	}
}
