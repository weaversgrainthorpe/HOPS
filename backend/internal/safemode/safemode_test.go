package safemode

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/database"
)

// unsafeState builds a real refuse-to-start error: files moved aside with no journal.
func unsafeState(t *testing.T) (*database.UnsafeStartError, string) {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "hops.db")
	os.WriteFile(dbPath+".pre-apply", []byte("original"), 0o644)
	_, err := database.RecoverAndApplyRestore(dbPath)
	var u *database.UnsafeStartError
	if !errors.As(err, &u) {
		t.Fatalf("want UnsafeStartError, got %v", err)
	}
	return u, dir
}

func TestSafeModeServerAnswers503WithTheMessage(t *testing.T) {
	u, dir := unsafeState(t)
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	addr := ln.Addr().String()
	ln.Close()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- Serve(ctx, addr, u) }()
	defer func() { cancel(); <-done }()

	var resp *http.Response
	var err error
	for i := 0; i < 50; i++ {
		if resp, err = http.Get("http://" + addr + "/"); err == nil {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 503 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	page := string(body)
	for _, want := range []string{"HOPS can't start safely", "Nothing was deleted", filepath.Join(dir, "hops.db.pre-apply"), "start HOPS again"} {
		if !strings.Contains(page, want) {
			t.Errorf("page lacks %q", want)
		}
	}
	if strings.Contains(page, "http://") || strings.Contains(page, "https://") || strings.Contains(page, "<script") || strings.Contains(page, "<link") {
		t.Error("the page loads external assets or script")
	}
	// Any route: 503 too.
	for _, p := range []string{"/settings", "/some/dashboard", "/api/config"} {
		r, err := http.Get("http://" + addr + p)
		if err != nil || r.StatusCode != 503 {
			t.Fatalf("%s: %v %v", p, r, err)
		}
		r.Body.Close()
	}
	// Health: 503 JSON with the reason.
	r, err := http.Get("http://" + addr + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	var h map[string]interface{}
	json.NewDecoder(r.Body).Decode(&h)
	r.Body.Close()
	if r.StatusCode != 503 || h["status"] != "unsafe-to-start" || !strings.Contains(fmt.Sprint(h["reason"]), "Nothing was deleted") {
		t.Fatalf("health: %d %v", r.StatusCode, h)
	}
	// The database was never created.
	if _, err := os.Stat(filepath.Join(dir, "hops.db")); !os.IsNotExist(err) {
		t.Fatal("safe mode created a database")
	}
}

func TestPortRemembered(t *testing.T) {
	dir := t.TempDir()
	if Port(dir) != DefaultPort {
		t.Fatal("default")
	}
	if err := RememberPort(dir, 18123); err != nil {
		t.Fatal(err)
	}
	if Port(dir) != 18123 {
		t.Fatal("not remembered")
	}
	os.WriteFile(filepath.Join(dir, LastPortFile), []byte("junk"), 0o644)
	if Port(dir) != DefaultPort {
		t.Fatal("junk accepted")
	}
}
