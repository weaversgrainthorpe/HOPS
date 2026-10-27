package discovery

import (
	"fmt"
)

// Diff states for a result in a re-scan.
const (
	DiffNew       = "new"       // host:port not in the baseline scan
	DiffChanged   = "changed"   // same host:port, different detector or name
	DiffUnchanged = "unchanged" // same host:port, same detector and name
)

// DiffScanRef is a short reference to a scan used in a comparison.
type DiffScanRef struct {
	ID        string `json:"id"`
	CreatedAt string `json:"createdAt"`
	CIDR      string `json:"cidr"`
	State     string `json:"state"`
	Label     string `json:"label,omitempty"`
}

// DiffPrevious is what a changed service was in the baseline scan.
type DiffPrevious struct {
	DetectorID    string `json:"detectorId"`
	SuggestedName string `json:"suggestedName"`
}

// DiffGone is a service present in the baseline scan but not in this one.
type DiffGone struct {
	Host          string `json:"host"`
	Hostname      string `json:"hostname,omitempty"`
	Port          int    `json:"port"`
	DetectorID    string `json:"detectorId"`
	SuggestedName string `json:"suggestedName"`
	SuggestedURL  string `json:"suggestedUrl"`
	// WasPromoted: it had become a dashboard tile, which may now be dead.
	WasPromoted bool `json:"wasPromoted"`
}

// DiffCounts are the header numbers.
type DiffCounts struct {
	New       int `json:"new"`
	Changed   int `json:"changed"`
	Unchanged int `json:"unchanged"`
	Gone      int `json:"gone"`
}

// Diff is the comparison of one scan against the most recent earlier
// completed scan of the same CIDR.
type Diff struct {
	ScanID     string `json:"scanId"`
	Comparable bool   `json:"comparable"`
	// Reason when not comparable: "first" (no earlier usable scan of this
	// range) or "unfinished" (this scan has not completed).
	Reason string `json:"reason,omitempty"`
	// Baseline is the scan compared against; nil when not comparable.
	Baseline *DiffScanRef `json:"baseline"`
	// Ignored lists earlier scans of the same range that failed or were
	// cancelled and so were NOT used (newer than the baseline).
	Ignored  []DiffScanRef           `json:"ignored"`
	States   map[string]string       `json:"states"`
	Previous map[string]DiffPrevious `json:"previous"`
	Gone     []DiffGone              `json:"gone"`
	Counts   DiffCounts              `json:"counts"`
}

// ComputeDiff compares cur against prev. Identity is host:port; a row is
// unchanged if the baseline has the same detector at that host:port (and the
// same name), changed if the baseline has the host:port but not this
// detector, or the name differs, new otherwise. A baseline host:port with no
// row at all in cur is gone.
func ComputeDiff(prev, cur []*Result) (states map[string]string, previous map[string]DiffPrevious, gone []DiffGone) {
	states = map[string]string{}
	previous = map[string]DiffPrevious{}
	gone = []DiffGone{}
	type hp struct {
		h string
		p int
	}
	prevBy := map[hp][]*Result{}
	for _, r := range prev {
		k := hp{r.Host, r.Port}
		prevBy[k] = append(prevBy[k], r)
	}
	curKeys := map[hp]bool{}
	for _, r := range cur {
		k := hp{r.Host, r.Port}
		curKeys[k] = true
		ps := prevBy[k]
		if len(ps) == 0 {
			states[r.ID] = DiffNew
			continue
		}
		var same *Result
		for _, p := range ps {
			if p.DetectorID == r.DetectorID {
				same = p
				break
			}
		}
		switch {
		case same == nil:
			states[r.ID] = DiffChanged
			previous[r.ID] = DiffPrevious{ps[0].DetectorID, ps[0].SuggestedName}
		case same.SuggestedName != r.SuggestedName:
			states[r.ID] = DiffChanged
			previous[r.ID] = DiffPrevious{same.DetectorID, same.SuggestedName}
		default:
			states[r.ID] = DiffUnchanged
		}
	}
	for _, r := range prev {
		if curKeys[hp{r.Host, r.Port}] {
			continue
		}
		gone = append(gone, DiffGone{
			Host: r.Host, Hostname: r.Hostname, Port: r.Port, DetectorID: r.DetectorID,
			SuggestedName: r.SuggestedName, SuggestedURL: r.SuggestedURL,
			WasPromoted: r.CurateState == CuratePromoted,
		})
	}
	return
}

func isUsableBaseline(state string) bool {
	return state == StateComplete || state == StatePromoted
}

// DiffFor compares a scan against the most recent earlier complete (or
// promoted) scan of exactly the same CIDR. Same-CIDR only: an overlapping but
// different range would report every host outside the overlap as new or gone,
// which is noise, not change. Failed and cancelled scans are never a baseline
// (their results are partial); they are reported in Ignored so the UI can say
// so. Returns sql.ErrNoRows if the scan does not exist.
func (s *Store) DiffFor(scanID string) (*Diff, error) {
	sc, err := s.GetScan(scanID)
	if err != nil {
		return nil, err
	}
	d := &Diff{ScanID: scanID, Ignored: []DiffScanRef{}, States: map[string]string{},
		Previous: map[string]DiffPrevious{}, Gone: []DiffGone{}}
	if !isUsableBaseline(sc.State) {
		d.Reason = "unfinished"
		return d, nil
	}
	rows, err := s.db.Query(`
		SELECT id, created_at, cidr, state, label FROM scans
		WHERE cidr = ? AND id != ? AND created_at < ?
		ORDER BY created_at DESC`, sc.CIDR, sc.ID, sc.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("find baseline: %w", err)
	}
	var earlier []DiffScanRef
	for rows.Next() {
		var ref DiffScanRef
		if err := rows.Scan(&ref.ID, &ref.CreatedAt, &ref.CIDR, &ref.State, &ref.Label); err != nil {
			rows.Close() // #nosec G104 -- Close on an error path or after a read-only/bounded read; the primary error is already surfaced and nothing was written
			return nil, err
		}
		earlier = append(earlier, ref)
	}
	err = rows.Err()
	rows.Close() // #nosec G104 -- Close on an error path or after a read-only/bounded read; the primary error is already surfaced and nothing was written (note: release the connection before the result queries below)
	if err != nil {
		return nil, err
	}
	for _, ref := range earlier {
		if isUsableBaseline(ref.State) {
			r := ref
			d.Baseline = &r
			break
		}
		if ref.State == StateFailed || ref.State == StateCancelled {
			d.Ignored = append(d.Ignored, ref)
		}
	}
	if d.Baseline == nil {
		d.Reason = "first"
		return d, nil
	}
	prev, err := s.ListResults(d.Baseline.ID)
	if err != nil {
		return nil, fmt.Errorf("load baseline results: %w", err)
	}
	cur, err := s.ListResults(scanID)
	if err != nil {
		return nil, fmt.Errorf("load results: %w", err)
	}
	d.Comparable = true
	d.States, d.Previous, d.Gone = ComputeDiff(prev, cur)
	for _, st := range d.States {
		switch st {
		case DiffNew:
			d.Counts.New++
		case DiffChanged:
			d.Counts.Changed++
		default:
			d.Counts.Unchanged++
		}
	}
	d.Counts.Gone = len(d.Gone)
	return d, nil
}
