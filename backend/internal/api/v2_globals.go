package api

import (
	"fmt"
	"hash/fnv"
	"strings"
	"sync"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// HOPS 2 app-wide settings that HOPS 3 does not use (configdoc.V2Globals):
// told to the user, never dropped silently. The start-up upgrade shows them
// as a one-time notice; an import lists them with the things not carried over.

// noticeV2SettingsPrefix starts the id of the upgrade's not-carried notice;
// the rest is a hash of its text.
const noticeV2SettingsPrefix = "v2-settings-not-carried-"

// v2GlobalSource says where the HOPS 2 settings came from, which decides
// where the user's custom CSS can still be found.
type v2GlobalSource int

const (
	v2FromUpgrade v2GlobalSource = iota // the start-up v2→v3 migration
	v2FromImport                        // an imported file
)

// v2GlobalLines is one plain-English sentence per setting not carried over.
func v2GlobalLines(globals []configdoc.V2Global, from v2GlobalSource) []string {
	out := make([]string, 0, len(globals))
	for _, g := range globals {
		switch g.Setting {
		case configdoc.V2ThemeMode:
			out = append(out, fmt.Sprintf("HOPS 2's light/dark setting (%q) was not carried over: HOPS 3 sets the look in each browser, in Theme Settings (the sun/moon button at the top of a dashboard).", g.Value))
		case configdoc.V2CustomCSS:
			where := "Your CSS is kept in the backup taken before the upgrade (Settings › Backups, the one ending pre-v3-migration)."
			if from == v2FromImport {
				where = "Your CSS is still in the file you imported."
			}
			out = append(out, "HOPS 2's custom CSS was not carried over: HOPS 3 has no custom CSS. "+where)
		case configdoc.V2SearchHotkey:
			out = append(out, fmt.Sprintf("HOPS 2's search shortcut (%q) was not carried over: search now always opens with / (or the search button at the top of a dashboard).", g.Value))
		case configdoc.V2DefaultView:
			out = append(out, defaultViewLine(g))
		}
	}
	return out
}

// defaultViewLine tells the user how to get HOPS 2's default dashboard back.
// HOPS 3 opens the first dashboard in display order; this is the one place to
// change if the upgrade should instead move that dashboard to the top itself.
func defaultViewLine(g configdoc.V2Global) string {
	if g.Dashboard == "" {
		return fmt.Sprintf("HOPS 2's default dashboard (%s, which no dashboard uses) was not carried over: HOPS 3 opens the first dashboard in Settings › Dashboards; drag the one you want to the top there to open it first.", g.Value)
	}
	return fmt.Sprintf("HOPS 2's default dashboard (%q) was not carried over: HOPS 3 opens the first dashboard in Settings › Dashboards; drag %q to the top there to open it first.", g.Dashboard, g.Dashboard)
}

// v2NoteState holds, for this process, the upgrade's not-carried notice text
// until it is dismissed.
type v2NoteState struct {
	mu   sync.Mutex
	text string
}

func (s *v2NoteState) set(lines []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.text = strings.Join(lines, " ")
}

// notice returns the current notice, or false when there is none.
func (s *v2NoteState) notice() (notice, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.text == "" {
		return notice{}, false
	}
	h := fnv.New32a()
	h.Write([]byte(s.text)) // #nosec G104 -- hash.Hash.Write never returns an error
	return notice{ID: fmt.Sprintf("%s%08x", noticeV2SettingsPrefix, h.Sum32()), Text: s.text}, true
}

func (s *v2NoteState) isCurrent(id string) bool {
	n, ok := s.notice()
	return ok && n.ID == id
}

// clearIf drops the notice when id is still it (dismissed).
func (s *v2NoteState) clearIf(id string) {
	if s.isCurrent(id) {
		s.mu.Lock()
		s.text = ""
		s.mu.Unlock()
	}
}
