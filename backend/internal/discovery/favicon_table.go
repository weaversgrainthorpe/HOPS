package discovery

// Bundled favicon-hash → suggested-tile lookup table. After the
// specific fingerprint detectors run, the orchestrator computes a
// Shodan-style MMH3 hash of /favicon.ico on each unclaimed HTTP port
// and consults this table. A hit emits a Result with the table's
// suggested name + icon + category — useful for catching services
// hidden behind reverse proxies that strip identifying body content
// but still pass the favicon through.
//
// Seeding strategy: the values below are starter entries for the
// homelab apps where (a) the favicon is part of the application
// itself (not the underlying nginx default) and (b) we've verified
// the hash either from a live install or a published source. Hashes
// are signed 32-bit (matches `mmh3.hash(..., signed=True)` and the
// Shodan corpus convention).
//
// Phase 4 (GUI-managed detectors) will let admins add their own
// entries from the hashes their scans already log to slog. Until
// then this table is the authoritative set; it intentionally grows
// over time as we verify more hashes from real installs.
//
// Adding an entry safely:
//   1. Run a scan that finds the app. Look in the server log for
//      `discovery: favicon hashed` lines — the hash is in the
//      `mmh3` field.
//   2. Confirm by checking https://shodan.io/search?query=http.favicon.hash:<hash>
//      and visually verifying the icon matches the app.
//   3. Add an entry below with category from categories.go.

// FaviconMatch is the tile suggestion attached to a known favicon
// hash. SuggestedDesc defaults to "<Name> (favicon match)" when blank.
type FaviconMatch struct {
	Name     string
	Icon     string
	Category string
	Desc     string
}

// faviconHashTable maps int32 MMH3 hashes to suggestions.
//
// Empty by default — see seedFaviconHashTable for the starter entries.
// We keep this var separately so tests / Phase-4 can mutate it without
// touching the seed function.
var faviconHashTable = seedFaviconHashTable()

func seedFaviconHashTable() map[int32]FaviconMatch {
	return map[int32]FaviconMatch{
		// Starter set is intentionally empty — published favicon hash
		// corpora are noisy and an unverified entry that emits the
		// wrong icon for the wrong service is worse than no entry.
		// The user's first scan will log every hash it sees; verified
		// entries land here as they're confirmed against real installs.
	}
}

// lookupFaviconHash returns the FaviconMatch for a hash, or (zero, false)
// if not in the table.
func lookupFaviconHash(h int32) (FaviconMatch, bool) {
	m, ok := faviconHashTable[h]
	return m, ok
}
