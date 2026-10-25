package logbuf

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"
	"time"
)

// newTestLogger returns a logger teeing into a fresh buffer of the given
// capacity, with the stderr side captured in out.
func newTestLogger(capacity int, level slog.Level) (*slog.Logger, *Buffer, *bytes.Buffer, *slog.LevelVar) {
	var out bytes.Buffer
	lv := &slog.LevelVar{}
	lv.Set(level)
	buf := New(capacity, time.Now())
	inner := slog.NewTextHandler(&out, &slog.HandlerOptions{Level: lv})
	return slog.New(NewHandler(inner, buf, lv)), buf, &out, lv
}

func messages(s Snapshot) []string {
	var m []string
	for _, r := range s.Records {
		m = append(m, r.Message)
	}
	return m
}

func attr(r Record, key string) (string, bool) {
	for _, a := range r.Attrs {
		if a.Key == key {
			return a.Value, true
		}
	}
	return "", false
}

func TestRingBufferWrapsAndCountsDropped(t *testing.T) {
	log, buf, _, _ := newTestLogger(3, slog.LevelDebug)
	for i := 1; i <= 2; i++ {
		log.Info(fmt.Sprintf("m%d", i))
	}
	s := buf.Snapshot()
	if got := strings.Join(messages(s), ","); got != "m1,m2" {
		t.Fatalf("before wrap: %s", got)
	}
	if s.Dropped != 0 || s.Capacity != 3 {
		t.Fatalf("dropped %d capacity %d", s.Dropped, s.Capacity)
	}
	for i := 3; i <= 7; i++ {
		log.Info(fmt.Sprintf("m%d", i))
	}
	s = buf.Snapshot()
	if got := strings.Join(messages(s), ","); got != "m5,m6,m7" {
		t.Fatalf("after wrap, oldest first: %s", got)
	}
	if s.Dropped != 4 {
		t.Fatalf("dropped = %d, want 4", s.Dropped)
	}
	// The snapshot is a copy: later records don't change it.
	log.Info("m8")
	if got := strings.Join(messages(s), ","); got != "m5,m6,m7" {
		t.Fatalf("snapshot changed: %s", got)
	}
}

func TestCapacityConstantIsSmall(t *testing.T) {
	if Capacity != 2000 {
		t.Fatalf("Capacity = %d, want 2000", Capacity)
	}
	if Shared().Snapshot().Capacity != Capacity {
		t.Fatal("the shared buffer uses Capacity")
	}
}

func TestCapturesAtTheConfiguredLevelAndStderrStillGetsEverything(t *testing.T) {
	log, buf, out, lv := newTestLogger(10, slog.LevelWarn)
	log.Debug("dbg")
	log.Info("inf")
	log.Warn("wrn", "component", "test")
	log.Error("err", "error", errors.New("boom"))
	s := buf.Snapshot()
	if got := strings.Join(messages(s), ","); got != "wrn,err" {
		t.Fatalf("captured %s", got)
	}
	if s.Records[0].Level != "warn" || s.Records[1].Level != "error" {
		t.Fatalf("levels %s %s", s.Records[0].Level, s.Records[1].Level)
	}
	if v, _ := attr(s.Records[1], "error"); v != "boom" {
		t.Fatalf("error attr %q", v)
	}
	if s.Records[0].Time.IsZero() {
		t.Fatal("time not stored")
	}
	text := out.String()
	if !strings.Contains(text, "msg=wrn") || !strings.Contains(text, "msg=err") || strings.Contains(text, "msg=inf") {
		t.Fatalf("stderr: %s", text)
	}
	// A level change applies to both at once.
	lv.Set(slog.LevelDebug)
	log.Debug("dbg2")
	if got := messages(buf.Snapshot()); got[len(got)-1] != "dbg2" {
		t.Fatalf("after level change: %v", got)
	}
	if !strings.Contains(out.String(), "msg=dbg2") {
		t.Fatal("stderr missed dbg2")
	}
}

type secretValuer struct{}

func (secretValuer) LogValue() slog.Value { return slog.StringValue("hunter2-valuer") }

func TestRedactsSensitiveKeysInBufferAndStderr(t *testing.T) {
	log, buf, out, _ := newTestLogger(20, slog.LevelDebug)
	secrets := []string{"hunter2-password", "hash-$2a$10$abc", "sess-tok-123", "csrf-tok-456",
		"cookie-val", "Bearer abc.def", "s3cr3t", "api-key-1", "grouped-pass", "group-whole", "with-attrs-tok", "hunter2-valuer"}
	log.Info("login attempt",
		"username", "admin",
		"password", secrets[0],
		"password_hash", secrets[1],
		"session_id", secrets[2],
		"X-CSRF-Token", secrets[3],
		"Cookie", secrets[4],
		"Authorization", secrets[5],
		"clientSecret", secrets[6],
		"api_key", secrets[7],
		slog.Group("req", slog.String("path", "/api/x"), slog.Group("form", slog.String("newPassword", secrets[8]))),
		slog.Group("session", slog.String("id", secrets[9])),
		"token", secretValuer{},
	)
	log.With("auth_token", secrets[10]).WithGroup("g").Info("with attrs", "count", 3)

	s := buf.Snapshot()
	var all strings.Builder
	for _, r := range s.Records {
		all.WriteString(r.Message)
		for _, a := range r.Attrs {
			fmt.Fprintf(&all, " %s=%s", a.Key, a.Value)
		}
		all.WriteString("\n")
	}
	for _, sec := range secrets {
		if strings.Contains(all.String(), sec) {
			t.Errorf("buffer leaked %q:\n%s", sec, all.String())
		}
		if strings.Contains(out.String(), sec) {
			t.Errorf("stderr leaked %q:\n%s", sec, out.String())
		}
	}
	r := s.Records[0]
	if v, _ := attr(r, "username"); v != "admin" {
		t.Errorf("non-sensitive attr changed: %q", v)
	}
	if v, _ := attr(r, "req.path"); v != "/api/x" {
		t.Errorf("nested non-sensitive attr: %q", v)
	}
	for _, k := range []string{"password", "session_id", "req.form.newPassword", "session.id", "token"} {
		if v, ok := attr(r, k); !ok || v != Redacted {
			t.Errorf("%s = %q (present %v), want %s", k, v, ok, Redacted)
		}
	}
	r2 := s.Records[1]
	if v, _ := attr(r2, "auth_token"); v != Redacted {
		t.Errorf("WithAttrs attr not redacted: %q", v)
	}
	if v, _ := attr(r2, "g.count"); v != "3" {
		t.Errorf("WithGroup attr: %q", v)
	}
}

func TestIsSensitiveKey(t *testing.T) {
	for _, k := range []string{"password", "Password", "old_password", "passwd", "secret", "token", "csrfToken", "X-CSRF-Token",
		"cookie", "Set-Cookie", "authorization", "session", "session_id", "sessionID", "api_key", "apiKey", "credentials", "private_key"} {
		if !IsSensitiveKey(k) {
			t.Errorf("%q should be sensitive", k)
		}
	}
	for _, k := range []string{"component", "error", "path", "status", "user_id", "key", "hash", "host", "name", "level", "value"} {
		if IsSensitiveKey(k) {
			t.Errorf("%q should not be sensitive", k)
		}
	}
}

func TestLongValuesAreTruncatedVisibly(t *testing.T) {
	log, buf, out, _ := newTestLogger(5, slog.LevelDebug)
	long := strings.Repeat("x", MaxValueBytes+500)
	log.Error("panic in handler", "stack", long)
	v, _ := attr(buf.Snapshot().Records[0], "stack")
	if len(v) >= len(long) || !strings.Contains(v, "truncated") {
		t.Fatalf("not truncated visibly: len %d", len(v))
	}
	if !strings.Contains(out.String(), long) {
		t.Fatal("stderr must keep the full value")
	}
}

func TestParseAndNameLevels(t *testing.T) {
	for in, want := range map[string]slog.Level{"debug": slog.LevelDebug, "INFO": slog.LevelInfo, "warn": slog.LevelWarn, "warning": slog.LevelWarn, "error": slog.LevelError} {
		got, ok := ParseLevel(in)
		if !ok || got != want {
			t.Errorf("ParseLevel(%q) = %v %v", in, got, ok)
		}
	}
	if _, ok := ParseLevel("loud"); ok {
		t.Error("unknown level accepted")
	}
	if LevelName(slog.LevelWarn) != "warn" || LevelName(slog.LevelDebug) != "debug" || LevelName(slog.LevelError+4) != "error" {
		t.Error("LevelName")
	}
}

func TestHandlerEnabledFollowsLevel(t *testing.T) {
	_, buf, _, lv := newTestLogger(5, slog.LevelError)
	h := NewHandler(slog.NewTextHandler(&bytes.Buffer{}, &slog.HandlerOptions{Level: lv}), buf, lv)
	if h.Enabled(context.Background(), slog.LevelWarn) {
		t.Fatal("warn enabled at error level")
	}
	if !h.Enabled(context.Background(), slog.LevelError) {
		t.Fatal("error not enabled")
	}
}
