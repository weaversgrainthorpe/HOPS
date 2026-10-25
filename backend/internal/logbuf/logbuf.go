// Package logbuf keeps the most recent log records in memory so an admin can
// read them on Settings › Logs without shell access.
//
// Every slog record goes to stderr exactly as before (journald still gets
// everything) and is also copied into a fixed-size ring buffer. Both copies
// pass through the same redaction first: an attribute whose key names a
// secret (password, token, cookie, session, csrf, authorization, …) has its
// value replaced, in nested groups too. The buffer records at the configured
// log level, i.e. exactly what stderr gets.
//
// The buffer is small and fixed (Capacity records, values capped at
// MaxValueBytes) so it costs little on a Pi Zero. It starts empty at each
// process start; when it is full the oldest record is discarded and counted,
// so the page can say how many lines it no longer has.
package logbuf

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"
)

// Capacity is how many records the shared buffer keeps. It is a constant,
// not a setting.
const Capacity = 2000

// MaxValueBytes caps one attribute value (or message) in the buffer, so a
// burst of huge values (panic stacks) can't grow memory. stderr keeps the
// full value; the buffered copy says it was cut.
const MaxValueBytes = 4096

// Redacted replaces a sensitive attribute's value.
const Redacted = "[REDACTED]"

// Attr is one attribute of a buffered record, groups flattened to dotted keys.
type Attr struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// Record is one buffered log record.
type Record struct {
	Time    time.Time `json:"time"`
	Level   string    `json:"level"`
	Message string    `json:"message"`
	Attrs   []Attr    `json:"attrs"`
	level   slog.Level
}

// AtLeast reports whether the record's level is at or above min.
func (r Record) AtLeast(min slog.Level) bool { return r.level >= min }

// Buffer is a fixed-capacity ring of the most recent records.
type Buffer struct {
	mu        sync.Mutex
	recs      []Record // grows to capacity, then used as a ring
	start     int      // index of the oldest record once full
	capacity  int
	dropped   uint64
	startedAt time.Time
}

// New returns an empty buffer holding at most capacity records.
func New(capacity int, startedAt time.Time) *Buffer {
	if capacity < 1 {
		capacity = 1
	}
	return &Buffer{capacity: capacity, startedAt: startedAt}
}

func (b *Buffer) add(r Record) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.recs) < b.capacity {
		b.recs = append(b.recs, r)
		return
	}
	b.recs[b.start] = r
	b.start = (b.start + 1) % b.capacity
	b.dropped++
}

// Snapshot is a copy of the buffer's contents and what is missing from it.
type Snapshot struct {
	StartedAt time.Time
	Capacity  int
	Dropped   uint64
	Records   []Record // oldest first
}

// Snapshot copies the buffer, oldest record first.
func (b *Buffer) Snapshot() Snapshot {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]Record, 0, len(b.recs))
	out = append(out, b.recs[b.start:]...)
	out = append(out, b.recs[:b.start]...)
	return Snapshot{StartedAt: b.startedAt, Capacity: b.capacity, Dropped: b.dropped, Records: out}
}

// ---- sensitive keys ----

// sensitiveParts are matched against the key lowercased with everything but
// letters and digits removed ("X-CSRF-Token" → "xcsrftoken").
var sensitiveParts = []string{
	"password", "passwd", "passphrase", "secret", "token", "cookie",
	"authorization", "csrf", "session", "apikey", "credential", "privatekey",
}

// IsSensitiveKey reports whether an attribute with this key must never be
// logged with its value.
func IsSensitiveKey(key string) bool {
	var b strings.Builder
	for _, c := range strings.ToLower(key) {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
			b.WriteRune(c)
		}
	}
	k := b.String()
	if k == "pwd" {
		return true
	}
	for _, p := range sensitiveParts {
		if strings.Contains(k, p) {
			return true
		}
	}
	return false
}

// redact returns a with every sensitive value replaced, descending into
// groups. force redacts everything (the attr sits inside a sensitive group).
func redact(a slog.Attr, force bool) slog.Attr {
	a.Value = a.Value.Resolve()
	sensitive := force || (a.Key != "" && IsSensitiveKey(a.Key))
	if a.Value.Kind() == slog.KindGroup {
		group := a.Value.Group()
		out := make([]slog.Attr, len(group))
		for i, g := range group {
			out[i] = redact(g, sensitive)
		}
		a.Value = slog.GroupValue(out...)
		return a
	}
	if sensitive {
		a.Value = slog.StringValue(Redacted)
	}
	return a
}

func capValue(s string) string {
	if len(s) <= MaxValueBytes {
		return s
	}
	return fmt.Sprintf("%s… [truncated: %d bytes in all; the full line is in the system log]", s[:MaxValueBytes], len(s))
}

// flatten appends a (already redacted) to dst with groups as dotted keys.
func flatten(dst []Attr, prefix string, a slog.Attr) []Attr {
	if a.Value.Kind() == slog.KindGroup {
		p := prefix
		if a.Key != "" {
			p = prefix + a.Key + "."
		}
		for _, g := range a.Value.Group() {
			dst = flatten(dst, p, g)
		}
		return dst
	}
	if a.Key == "" && a.Value.Any() == nil {
		return dst // slog ignores empty attrs
	}
	return append(dst, Attr{Key: prefix + a.Key, Value: capValue(a.Value.String())})
}

// ---- handler ----

type handler struct {
	inner     slog.Handler // stderr; WithAttrs/WithGroup already applied (redacted)
	buf       *Buffer
	level     slog.Leveler
	prefix    string // open groups as "a.b."
	sensitive bool   // an open group's name is sensitive: redact everything under it
	pre       []Attr // WithAttrs attributes, flattened and redacted
}

// NewHandler tees records into inner (unchanged apart from redaction) and buf.
// Records below level are dropped from both.
func NewHandler(inner slog.Handler, buf *Buffer, level slog.Leveler) slog.Handler {
	return &handler{inner: inner, buf: buf, level: level}
}

func (h *handler) Enabled(_ context.Context, l slog.Level) bool { return l >= h.level.Level() }

func (h *handler) Handle(ctx context.Context, r slog.Record) error {
	red := slog.NewRecord(r.Time, r.Level, r.Message, r.PC)
	attrs := make([]Attr, len(h.pre), len(h.pre)+r.NumAttrs())
	copy(attrs, h.pre)
	r.Attrs(func(a slog.Attr) bool {
		a = redact(a, h.sensitive)
		red.AddAttrs(a)
		attrs = flatten(attrs, h.prefix, a)
		return true
	})
	t := r.Time
	if t.IsZero() {
		t = time.Now()
	}
	h.buf.add(Record{Time: t, Level: LevelName(r.Level), Message: capValue(r.Message), Attrs: attrs, level: r.Level})
	return h.inner.Handle(ctx, red)
}

func (h *handler) WithAttrs(as []slog.Attr) slog.Handler {
	red := make([]slog.Attr, len(as))
	pre := append([]Attr(nil), h.pre...)
	for i, a := range as {
		red[i] = redact(a, h.sensitive)
		pre = flatten(pre, h.prefix, red[i])
	}
	return &handler{inner: h.inner.WithAttrs(red), buf: h.buf, level: h.level, prefix: h.prefix, sensitive: h.sensitive, pre: pre}
}

func (h *handler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	return &handler{inner: h.inner.WithGroup(name), buf: h.buf, level: h.level, prefix: h.prefix + name + ".",
		sensitive: h.sensitive || IsSensitiveKey(name), pre: h.pre}
}

// ---- levels ----

// ParseLevel reads debug / info / warn (warning) / error, any case.
func ParseLevel(s string) (slog.Level, bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return slog.LevelDebug, true
	case "info":
		return slog.LevelInfo, true
	case "warn", "warning":
		return slog.LevelWarn, true
	case "error":
		return slog.LevelError, true
	}
	return 0, false
}

// LevelName is the lower-case name of the band a level falls in.
func LevelName(l slog.Level) string {
	switch {
	case l >= slog.LevelError:
		return "error"
	case l >= slog.LevelWarn:
		return "warn"
	case l >= slog.LevelInfo:
		return "info"
	default:
		return "debug"
	}
}

// ---- the process-wide logger ----

var (
	shared      = New(Capacity, time.Now()) // created at process start
	sharedLevel = &slog.LevelVar{}
	installOnce sync.Once
)

// Shared is the process's buffer (what /api/logs serves).
func Shared() *Buffer { return shared }

// Level is the log level in effect.
func Level() slog.Level { return sharedLevel.Level() }

// Install makes the default slog logger write text to w (as before) and tee
// into the shared buffer, both redacted, at the given level. Later calls only
// change the level (the settings subscriber calls it on every change).
func Install(w io.Writer, level slog.Level) {
	sharedLevel.Set(level)
	installOnce.Do(func() {
		inner := slog.NewTextHandler(w, &slog.HandlerOptions{Level: sharedLevel})
		slog.SetDefault(slog.New(NewHandler(inner, shared, sharedLevel)))
	})
}
