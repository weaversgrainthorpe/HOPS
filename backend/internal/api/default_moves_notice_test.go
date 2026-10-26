package api

import (
	"strconv"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/settings"
)

// Ruling 21: an install whose upload limits were still at the old defaults
// (a v2.2.1 settings table) gets the new defaults and a one-time notice that
// says so, which stays until dismissed — across restarts — and then is gone.
func TestNotices_UploadDefaultsMovedShowsUntilDismissed(t *testing.T) {
	rows := map[string]string{
		settings.KeyUploadMaxBytesImport:     "52428800",
		settings.KeyUploadMaxBytesBackground: "52428800",
		settings.KeyUploadMaxBytesIcon:       "8388608",
	}
	router, db := setupTestRouterWithSettingsRows(t, "", nil, rows)
	c := newClient(t, router)

	ns := noticesOf(t, getView(t, c))
	if len(ns) != 1 || ns[0]["id"] != noticeUploadDefaultsMoved {
		t.Fatalf("notices = %v, want the one upload-defaults notice", ns)
	}
	want := "Upload limits updated to the new defaults: Largest background upload 50 MB → 25 MB; Largest icon upload 8 MB → 2 MB. Limits you had changed yourself were left as they were."
	if ns[0]["text"] != want {
		t.Errorf("text = %q\nwant  %q", ns[0]["text"], want)
	}

	// A restart before dismissing: still shown, values not moved twice.
	c2 := newClient(t, restartRouter(t, db))
	if ns := noticesOf(t, getView(t, c2)); len(ns) != 1 || ns[0]["text"] != want {
		t.Fatalf("after restart: %v", ns)
	}

	if code, resp := c2.do("POST", "/api/notices/"+noticeUploadDefaultsMoved+"/dismiss", nil); code != 200 {
		t.Fatalf("dismiss: %d %v", code, resp)
	}
	if ns := noticesOf(t, getView(t, c2)); len(ns) != 0 {
		t.Errorf("after dismiss: %v", ns)
	}
	c3 := newClient(t, restartRouter(t, db))
	if ns := noticesOf(t, getView(t, c3)); len(ns) != 0 {
		t.Errorf("after dismiss + restart: %v", ns)
	}
}

func TestNotices_NoUploadDefaultsNoticeWhenNothingMoved(t *testing.T) {
	rows := map[string]string{
		settings.KeyUploadMaxBytesBackground: strconv.Itoa(30 * settings.MB),
		settings.KeyUploadMaxBytesIcon:       strconv.Itoa(4 * settings.MB),
	}
	router, _ := setupTestRouterWithSettingsRows(t, "", nil, rows)
	if ns := noticesOf(t, getView(t, newClient(t, router))); len(ns) != 0 {
		t.Errorf("notices = %v, want none", ns)
	}
	fresh, _ := setupTestRouter(t)
	if ns := noticesOf(t, getView(t, newClient(t, fresh))); len(ns) != 0 {
		t.Errorf("fresh install notices = %v, want none", ns)
	}
}

// Only one of the two moved: the notice names only that one.
func TestNotices_UploadDefaultsNamesOnlyWhatMoved(t *testing.T) {
	rows := map[string]string{
		settings.KeyUploadMaxBytesBackground: "52428800",
		settings.KeyUploadMaxBytesIcon:       strconv.Itoa(4 * settings.MB),
	}
	router, _ := setupTestRouterWithSettingsRows(t, "", nil, rows)
	ns := noticesOf(t, getView(t, newClient(t, router)))
	want := "Upload limits updated to the new defaults: Largest background upload 50 MB → 25 MB. Limits you had changed yourself were left as they were."
	if len(ns) != 1 || ns[0]["text"] != want {
		t.Errorf("notices = %v\nwant text %q", ns, want)
	}
}
