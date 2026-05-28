package discovery

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/settings"
)

// Orchestrator runs scans in background goroutines. One goroutine per
// active scan; cancellation is via context.Context. A semaphore caps the
// total concurrent probes across all scans (the limit comes from the
// settings service and updates live).
//
// Phase 1 enqueues scans synchronously: Submit() spawns the worker right
// away. There's no central run-loop because there's no scheduling work to
// do — every scan is admin-initiated, runs to completion, and exits.
// Later phases (background recurring scans) might grow a scheduler here.
type Orchestrator struct {
	store    *Store
	settings *settings.Service
	registry *Registry

	mu      sync.Mutex
	running map[string]context.CancelFunc // scanID → cancel fn for the running scan

	// recent tracks the most recent in-flight hosts per running scan so
	// the UI can show live activity. Bounded ring (newest first), in
	// memory only — frequent updates on every probe would thrash SQLite
	// for no benefit beyond the scan's lifetime.
	recentMu sync.RWMutex
	recent   map[string][]string

	// phase tracks which discovery phase each running scan is in so the
	// UI can show "Passive discovery…" / "Probing X / Y" / "Forward DNS
	// enumeration…" / "Finalising…" instead of a progress bar that
	// stalls and jumps. In-memory only; cleared in clearRecent.
	phaseMu sync.RWMutex
	phase   map[string]string

	// warnings tracks per-scan non-fatal degradations — passive sources
	// that errored out, partial-result emissions skipped, etc. Surfaces
	// on the GetScan response so the UI can show "scan completed but
	// these enrichment sources failed" instead of a silent success.
	warningsMu sync.RWMutex
	warnings   map[string][]string

	// shutdownCtx is cancelled in Stop() so in-flight scans abort cleanly
	// on server shutdown.
	shutdownCtx    context.Context
	shutdownCancel context.CancelFunc

	// Wait group for in-flight scans, so Stop() can block until the last
	// worker exits and we don't leave orphaned goroutines after main returns.
	wg sync.WaitGroup
}

// recentHostsToTrack caps how many recent in-flight addresses the
// orchestrator remembers per scan. Big enough to show parallel activity,
// small enough that the UI doesn't get cluttered.
const recentHostsToTrack = 8

// NewOrchestrator constructs the orchestrator. Doesn't start any work —
// call Start() to spawn the recovery pass that cleans up orphaned
// "running" scans from a previous process.
func NewOrchestrator(store *Store, settingsSvc *settings.Service) *Orchestrator {
	ctx, cancel := context.WithCancel(context.Background())
	return &Orchestrator{
		store:          store,
		settings:       settingsSvc,
		registry:       NewRegistry(store),
		running:        make(map[string]context.CancelFunc),
		recent:         make(map[string][]string),
		phase:          make(map[string]string),
		warnings:       make(map[string][]string),
		shutdownCtx:    ctx,
		shutdownCancel: cancel,
	}
}

// pushRecent prepends a host to the recent-list for scanID and trims to
// recentHostsToTrack entries. Called from probeHost as soon as a host
// starts being probed (before TCP-connect) so the UI sees activity even
// for hosts that turn out to be dead.
func (o *Orchestrator) pushRecent(scanID, host string) {
	o.recentMu.Lock()
	defer o.recentMu.Unlock()
	list := o.recent[scanID]
	list = append([]string{host}, list...)
	if len(list) > recentHostsToTrack {
		list = list[:recentHostsToTrack]
	}
	o.recent[scanID] = list
}

// clearRecent drops the in-memory recent list when a scan finishes.
// Warnings are deliberately RETAINED — admins need to see them after
// the scan completes; they're cleared when the scan is deleted via
// the API.
func (o *Orchestrator) clearRecent(scanID string) {
	o.recentMu.Lock()
	delete(o.recent, scanID)
	o.recentMu.Unlock()
	o.phaseMu.Lock()
	delete(o.phase, scanID)
	o.phaseMu.Unlock()
}

// addWarning records a non-fatal degradation for a scan. Idempotent
// per-message — the same warning is recorded only once even if the
// underlying source fails repeatedly.
func (o *Orchestrator) addWarning(scanID, msg string) {
	if scanID == "" || msg == "" {
		return
	}
	o.warningsMu.Lock()
	defer o.warningsMu.Unlock()
	for _, existing := range o.warnings[scanID] {
		if existing == msg {
			return
		}
	}
	o.warnings[scanID] = append(o.warnings[scanID], msg)
}

// Warnings returns a snapshot of the per-scan warning list. Caller-
// owned; safe to mutate.
func (o *Orchestrator) Warnings(scanID string) []string {
	o.warningsMu.RLock()
	defer o.warningsMu.RUnlock()
	out := make([]string, len(o.warnings[scanID]))
	copy(out, o.warnings[scanID])
	return out
}

// ClearWarnings drops the per-scan warning list — called by the
// DeleteScan handler so we don't leak memory for old scans.
func (o *Orchestrator) ClearWarnings(scanID string) {
	o.warningsMu.Lock()
	delete(o.warnings, scanID)
	o.warningsMu.Unlock()
}

// setPhase records the current discovery phase for a running scan.
// Visible to the UI via the GetScan response so the progress bar's
// non-linear behaviour (passive does nothing visible, then dead hosts
// flash through, then the live-host tail crawls, then forward-enum
// keeps running) has a human-readable explanation.
func (o *Orchestrator) setPhase(scanID, phase string) {
	o.phaseMu.Lock()
	o.phase[scanID] = phase
	o.phaseMu.Unlock()
}

// Phase returns the current phase string for a running scan, or "" if
// the scan isn't running or hasn't reached a labelled phase yet.
func (o *Orchestrator) Phase(scanID string) string {
	o.phaseMu.RLock()
	defer o.phaseMu.RUnlock()
	return o.phase[scanID]
}

// RecentHosts returns a snapshot of the recent in-flight host addresses
// for a running scan, newest first. Returns nil when the scan isn't
// running. Caller-owned slice; safe to mutate.
func (o *Orchestrator) RecentHosts(scanID string) []string {
	o.recentMu.RLock()
	defer o.recentMu.RUnlock()
	list := o.recent[scanID]
	out := make([]string, len(list))
	copy(out, list)
	return out
}

// Start performs the one-time startup recovery pass: any scan left in
// StateRunning from a previous process is transitioned to StateFailed.
// Should be called once on app boot, before any HTTP traffic.
// (Pre-v1.8 also reopened legacy 'promoted' scans here; that migration
// was retired in v1.8 once all installs had upgraded.)
func (o *Orchestrator) Start() {
	if err := o.store.MarkOrphanedRunning(); err != nil {
		slog.Error("discovery: failed to clean up orphaned running scans",
			"component", "discovery", "error", err)
	}
	slog.Info("discovery orchestrator started", "component", "discovery")
}

// Registry returns the underlying detector registry. The API layer
// uses this for read-only introspection (the GET /detectors handler
// needs to surface bundled detectors alongside user ones).
func (o *Orchestrator) Registry() *Registry { return o.registry }

// Stop signals every in-flight scan to abort and blocks until they exit.
// Idempotent — calling twice is harmless.
func (o *Orchestrator) Stop() {
	o.shutdownCancel()
	o.wg.Wait()
	slog.Info("discovery orchestrator stopped", "component", "discovery")
}

// Submit kicks off the worker goroutine for an already-persisted scan
// (one created by the API handler). Returns immediately; the worker runs
// until completion, cancellation, or shutdown.
func (o *Orchestrator) Submit(scanID string) {
	o.wg.Add(1)
	go func() {
		defer o.wg.Done()
		o.runScan(scanID)
	}()
}

// Cancel signals a running scan to abort. No-op if the scan isn't
// running (already finished, never started, or never existed).
func (o *Orchestrator) Cancel(scanID string) {
	o.mu.Lock()
	cancel, ok := o.running[scanID]
	o.mu.Unlock()
	if ok {
		cancel()
	}
}

// runScan is the worker body. Drives one scan from StatePending through
// to a terminal state. All errors are logged + persisted as the scan's
// error_message; nothing here returns errors to the caller because the
// caller is a fire-and-forget goroutine.
func (o *Orchestrator) runScan(scanID string) {
	scan, err := o.store.GetScan(scanID)
	if err != nil {
		slog.Error("discovery: scan disappeared before worker started",
			"component", "discovery", "scan_id", scanID, "error", err)
		return
	}

	hosts, err := expandTargets(scan.CIDR)
	if err != nil {
		_ = o.store.SetScanState(scanID, StateFailed, "invalid targets: "+err.Error())
		return
	}
	// Build the in-scope host set for the passive prelude. mDNS / ARP
	// filtering use this as the "is this IP one we care about?" check.
	allow := newHostAllowlist(hosts)

	// Per-scan context — derives from shutdownCtx so a server stop
	// cancels everything in flight, but also has its own cancel fn the
	// API can hit via Cancel().
	ctx, cancel := context.WithCancel(o.shutdownCtx)
	defer cancel()

	o.mu.Lock()
	o.running[scanID] = cancel
	o.mu.Unlock()
	defer func() {
		o.mu.Lock()
		delete(o.running, scanID)
		o.mu.Unlock()
	}()

	total := len(hosts)
	if err := o.store.UpdateScanProgress(scanID, 0, total); err != nil {
		slog.Error("discovery: failed to persist initial progress",
			"component", "discovery", "scan_id", scanID, "error", err)
	}
	if err := o.store.SetScanState(scanID, StateRunning, ""); err != nil {
		slog.Error("discovery: failed to mark scan running",
			"component", "discovery", "scan_id", scanID, "error", err)
	}
	slog.Info("discovery scan started",
		"component", "discovery", "scan_id", scanID,
		"cidr", scan.CIDR, "intensity", scan.Intensity, "hosts", total)

	// Passive prelude — ARP + mDNS + DNS (PTR + AXFR), runs once per
	// scan regardless of intensity. Cheap and produces hostname hints
	// + (for hosts not in the active port list) standalone Results for
	// broadcast-only services. Errors are logged and ignored — passive
	// is enrichment, never a hard requirement.
	o.setPhase(scanID, "Passive discovery (ARP, mDNS, DNS, UPnP, SNMP)…")
	hints := o.runPassivePrelude(ctx, scanID, allow, scan.InternalDomain)

	// Forward-DNS enumeration of the admin-supplied internal domain.
	// Runs concurrently with the active loop (its DNS lookups + probes
	// overlap with active host probing) BUT does not emit Results to
	// the store directly. Candidates are collected in memory and only
	// inserted after the active loop completes, with a dedup pass to
	// drop any forward-enum hit whose matched-core detector was also
	// found directly. This avoids transient duplicates appearing in
	// the curate UI mid-scan.
	var scanWG sync.WaitGroup
	var forwardEnumCandidates []*Result
	var forwardEnumMu sync.Mutex
	if scan.InternalDomain != "" {
		scanWG.Add(1)
		go func() {
			defer scanWG.Done()
			// Don't override the active-loop phase text — set it only
			// when the active loop has finished and forward-enum is the
			// remaining work (handled below after scanWG.Wait).
			candidates, err := enumerateForwardDomain(ctx, scanID, scan.InternalDomain, o.registry)
			if err != nil {
				slog.Info("discovery: forward enum failed",
					"component", "discovery", "scan_id", scanID, "error", err)
				o.addWarning(scanID, "Forward DNS enumeration of "+scan.InternalDomain+" failed: "+err.Error())
				return
			}
			forwardEnumMu.Lock()
			forwardEnumCandidates = candidates
			forwardEnumMu.Unlock()
		}()
	}

	// Track which hosts the active loop produced any result for, so we
	// can emit mDNS-derived results only for the hosts no active
	// detector noticed (HomeKit / AirPlay / Chromecast devices that
	// don't speak HTTP on a well-known port).
	activeHits := struct {
		sync.Mutex
		hosts map[string]bool
	}{hosts: make(map[string]bool)}

	// Skip the active host probe entirely for passive-only scans.
	if scan.Intensity != IntensityPassive {
		o.setPhase(scanID, fmt.Sprintf("Probing %d hosts…", total))
		// Worker pool — semaphore-bounded by the live setting.
		maxParallel := o.settings.GetInt(settings.KeyDiscoveryMaxParallelProbes)
		if maxParallel <= 0 {
			maxParallel = 64
		}
		sem := make(chan struct{}, maxParallel)

		// Compute the effective port set ONCE per scan:
		//   intensity-set ∪ every port from every Specific detector
		// This means user detectors (Phase 4) automatically extend the
		// scan to their declared ports — you can create a detector for
		// "my app on 8003" and the next scan probes 8003 too without
		// editing the bundled allowlist.
		ports := effectivePortsForScan(scan.Intensity, o.registry.Specific())

		var (
			doneMu sync.Mutex
			done   int
		)

		var wg sync.WaitGroup
		for _, host := range hosts {
			// Cooperative cancellation — bail out of the loop quickly when
			// shutdown or user-cancel fires.
			if ctx.Err() != nil {
				break
			}

			wg.Add(1)
			sem <- struct{}{}
			go func(h string) {
				defer wg.Done()
				defer func() { <-sem }()

				gotHit := o.probeHost(ctx, scanID, h, ports, hints)
				if gotHit {
					activeHits.Lock()
					activeHits.hosts[h] = true
					activeHits.Unlock()
				}

				doneMu.Lock()
				done++
				persist := done
				doneMu.Unlock()
				if err := o.store.UpdateScanProgress(scanID, persist, total); err != nil {
					slog.Debug("discovery: progress update failed",
						"component", "discovery", "scan_id", scanID, "error", err)
				}
			}(host)
		}
		wg.Wait()
	} else {
		// Passive-only: mark progress at 100 % so the UI doesn't sit
		// at 0 / N forever.
		_ = o.store.UpdateScanProgress(scanID, total, total)
	}

	// Emit mDNS-derived Results for hosts no active detector picked up.
	// For passive-only scans, activeHits is empty so every mDNS hint
	// gets emitted; for light/full, mDNS supplements without duping.
	if ctx.Err() == nil {
		for _, ip := range hints.AllIPs() {
			activeHits.Lock()
			already := activeHits.hosts[ip]
			activeHits.Unlock()
			if already {
				continue
			}
			o.emitPassiveResults(scanID, ip, hints)
		}
	}

	// Wait for the forward-enum goroutine (if any) to finish gathering
	// candidates before we emit + dedup. We don't need every active
	// probe to finish first, but the candidate list needs to be ready.
	if scan.InternalDomain != "" {
		o.setPhase(scanID, "Forward DNS enumeration ("+scan.InternalDomain+")…")
	} else {
		o.setPhase(scanID, "Finalising…")
	}
	scanWG.Wait()
	o.setPhase(scanID, "Finalising…")

	// Insert forward-enum candidates with in-memory dedup against the
	// active-loop results we've already persisted. A forward-enum hit
	// whose matched-core detector was also found by a direct probe is
	// dropped — the direct URL is the resilient one (LAN IP, no proxy
	// dependency). Forward-enum hits with no matched core (generic
	// subdomains like git.<domain>) or for services we couldn't find
	// directly (Proxmox on a different subnet, etc.) get inserted —
	// those are the cases where the proxy URL is the only way in.
	if ctx.Err() == nil && len(forwardEnumCandidates) > 0 {
		emitted, dropped := o.emitForwardEnumDeduped(scanID, forwardEnumCandidates)
		slog.Info("discovery forward enum complete",
			"component", "discovery", "scan_id", scanID,
			"domain", scan.InternalDomain,
			"emitted", emitted, "dropped_as_duplicate", dropped)
	}

	// Decide terminal state.
	state := StateComplete
	errMsg := ""
	switch {
	case errors.Is(o.shutdownCtx.Err(), context.Canceled):
		// shutdownCtx was cancelled — the server is going down.
		state = StateFailed
		errMsg = "scan was interrupted by a server shutdown"
	case errors.Is(ctx.Err(), context.Canceled):
		// per-scan ctx cancelled — admin pressed Cancel.
		state = StateCancelled
	}
	if err := o.store.SetScanState(scanID, state, errMsg); err != nil {
		slog.Error("discovery: failed to set terminal scan state",
			"component", "discovery", "scan_id", scanID, "state", state, "error", err)
	}
	o.clearRecent(scanID)
	slog.Info("discovery scan finished",
		"component", "discovery", "scan_id", scanID, "state", state)
}

// matchUserDetectorByFavicon checks every Specific detector for a
// declared favicon hash that matches. Returns the first match, or
// nil. Only user/* and override-overridden detectors carry favicon
// hashes today; bundled built-ins leave the field empty.
func matchUserDetectorByFavicon(hash int32, detectors []Detector) Detector {
	for _, d := range detectors {
		hp, ok := d.(httpFingerprintDetector)
		if !ok {
			continue
		}
		for _, h := range hp.faviconHashes {
			if h == hash {
				return d
			}
		}
	}
	return nil
}

// detectorCategory + detectorIcon extract fields from a Detector via
// the same DetectorWireView introspection — saves duplicating the
// type-assertion logic at every call site.
func detectorCategory(d Detector) string {
	if v := DetectorWireView(d); v != nil && v.Category != "" {
		return v.Category
	}
	return CategoryOther
}
func detectorIcon(d Detector) string {
	if v := DetectorWireView(d); v != nil {
		return v.Icon
	}
	return ""
}
func schemeForPort(tlsOn bool) string {
	if tlsOn {
		return "https"
	}
	return "http"
}

// effectivePortsForScan returns the union of the intensity port set
// and every port declared by every Specific detector. User detectors
// can therefore extend the scan to ports the bundled allowlist
// doesn't cover, without code changes — a Phase 4 detector for
// "my-app on 8003" automatically gets 8003 probed on every host.
func effectivePortsForScan(intensity string, detectors []Detector) []int {
	base := portsForIntensity(intensity)
	if intensity == IntensityPassive {
		return nil
	}
	seen := make(map[int]bool, len(base))
	out := make([]int, 0, len(base))
	for _, p := range base {
		if !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	for _, d := range detectors {
		hp, ok := d.(httpFingerprintDetector)
		if !ok {
			continue
		}
		for _, p := range hp.ports {
			if p < 1 || p > 65535 {
				continue
			}
			if !seen[p] {
				seen[p] = true
				out = append(out, p)
			}
		}
	}
	return out
}

// probeHost runs the Phase 1 probe pipeline against one host: TCP-connect
// each allowlisted port, GET / on each port that answered, then run every
// detector against the resulting Probe. Returns true if any detector
// matched (used by the orchestrator to skip mDNS emission for that host).
func (o *Orchestrator) probeHost(ctx context.Context, scanID, host string, ports []int, hints *PassiveHints) bool {
	if ctx.Err() != nil {
		return false
	}
	o.pushRecent(scanID, host)
	timeout := time.Duration(o.settings.GetInt(settings.KeyDiscoveryPerHostTimeoutSecs)) * time.Second
	if timeout <= 0 {
		timeout = 3 * time.Second
	}

	// Per-host total budget. The per-request timeout above bounds each
	// individual call, but a single host with many open ports + detector
	// path probes + favicon fetches can serialise into 30-60s of work.
	// Cap the whole probe pipeline at 15 × the per-request budget so a
	// slow tail (NPM, NAS) doesn't keep the active loop sitting at
	// 250/254 for two minutes.
	hostBudget := 15 * timeout
	if hostBudget < 10*time.Second {
		hostBudget = 10 * time.Second
	}
	hctx, hcancel := context.WithTimeout(ctx, hostBudget)
	defer hcancel()
	ctx = hctx

	probe := &Probe{
		Host:          host,
		HTTPResponses: make(map[int]*HTTPSnapshot),
		HTTP: func(c context.Context, port int, path string) (*HTTPSnapshot, error) {
			return httpGetProbe(c, host, port, path, isTLSExpectedPort(port), timeout)
		},
	}

	// Hostname enrichment: prefer mDNS-derived names (already
	// human-friendly), fall back to ARP-derived, then reverse DNS as
	// last resort because LookupAddr can be slow.
	if hints != nil {
		probe.Hostname = hints.Hostname(host)
	}
	if probe.Hostname == "" {
		rctx, rcancel := context.WithTimeout(ctx, 500*time.Millisecond)
		defer rcancel()
		if names, err := (&net.Resolver{}).LookupAddr(rctx, host); err == nil && len(names) > 0 {
			probe.Hostname = sanitiseHostname(names[0])
		}
	}

	if len(ports) == 0 {
		return false
	}

	// Probe the port allowlist in parallel rather than serially: a
	// /24 of mostly-closed hosts used to be N × timeout per host
	// (worst case = ports × timeout). With this small per-host
	// semaphore that drops to ceil(ports / sem) × timeout. The
	// per-host concurrency stays modest so a /24 doesn't multiply
	// up into thousands of in-flight sockets.
	//
	// A TCP-open port is recorded regardless of HTTP outcome. Binary-
	// protocol services (Postgres, SSH, …) live on tcpOnlyPorts and
	// skip the HTTP fetch entirely; on every other port HTTP failure
	// still records the open port so detectors that match on port
	// alone can run (the HTTPResponses map just won't have an entry
	// for that port).
	type portHit struct {
		port int
		snap *HTTPSnapshot
	}
	const perHostPortConcurrency = 8
	portSem := make(chan struct{}, perHostPortConcurrency)
	hitsCh := make(chan portHit, len(ports))
	var pwg sync.WaitGroup
	for _, port := range ports {
		if ctx.Err() != nil {
			break
		}
		pwg.Add(1)
		portSem <- struct{}{}
		go func(p int) {
			defer pwg.Done()
			defer func() { <-portSem }()
			if !tcpConnectProbe(ctx, host, p, timeout) {
				return
			}
			// Standard TLS ports get https://; everything else is
			// http://. Apps that self-sign on non-standard ports
			// (Sonarr v4 etc.) are out of scope until Phase 4 lets
			// detectors declare a per-port protocol.
			tlsOn := isTLSExpectedPort(p)
			snap, err := httpGetProbe(ctx, host, p, "/", tlsOn, timeout)
			if err != nil {
				// TCP open but HTTP failed — still record as open
				// so TCP-only or port-based detectors can match.
				hitsCh <- portHit{port: p, snap: nil}
				return
			}
			hitsCh <- portHit{port: p, snap: snap}
		}(port)
	}
	pwg.Wait()
	close(hitsCh)

	for h := range hitsCh {
		probe.OpenPorts = append(probe.OpenPorts, h.port)
		if h.snap != nil {
			probe.HTTPResponses[h.port] = h.snap
		}
	}

	if len(probe.OpenPorts) == 0 {
		return false
	}

	// Run specific detectors first. Track which (host, port) tuples got
	// a hit so the fallback HTTP detector can be suppressed on those.
	claimedPorts := make(map[int]bool)

	persistHit := func(det Detector, hit EmittedHit) {
		// Pre-fetch the favicon for this host:port and stash both the
		// inline data URL (for the curate UI to render) and the
		// Shodan-style MMH3 hash (for future user-defined detectors).
		// One extra HTTP GET per result — cheap, and the visual lift
		// when the admin can SEE the favicon in the curate table is
		// significant.
		fp := hit.RawFingerprint
		if fp == nil {
			fp = map[string]interface{}{}
		}
		tlsOn := isTLSExpectedPort(hit.Port)
		if dataURL, hash, ok := faviconFetch(ctx, host, hit.Port, tlsOn, timeout); ok {
			fp["favicon_data_url"] = dataURL
			fp["favicon_mmh3"] = hash
		}

		cat := hit.Category
		if cat == "" {
			cat = CategoryOther
		}
		r := &Result{
			ID:             newID(),
			ScanID:         scanID,
			Host:           host,
			Hostname:       probe.Hostname,
			Port:           hit.Port,
			DetectorID:     det.ID(),
			Confidence:     hit.Confidence,
			Category:       cat,
			SuggestedName:  hit.SuggestedName,
			SuggestedIcon:  hit.SuggestedIcon,
			SuggestedURL:   hit.SuggestedURL,
			SuggestedDesc:  hit.SuggestedDesc,
			RawFingerprint: fp,
			CurateState:    CuratePending,
		}
		if err := o.store.InsertResult(r); err != nil {
			slog.Error("discovery: failed to persist result",
				"component", "discovery", "scan_id", scanID,
				"host", host, "port", hit.Port, "error", err)
		}
	}

	anyEmit := false
	for _, det := range o.registry.Specific() {
		if ctx.Err() != nil {
			return anyEmit
		}
		for _, hit := range det.Run(ctx, probe) {
			claimedPorts[hit.Port] = true
			persistHit(det, hit)
			anyEmit = true
		}
	}

	// Favicon-hash pass for unclaimed HTTP ports. The favicon fetch
	// is bounded by the same per-host timeout and uses the existing
	// SSRF-safe dialer. We always compute the hash on unclaimed
	// HTTP-responsive ports (it lands in slog so admins can grow
	// the favicon table from what their homelab actually serves);
	// the table lookup only emits a Result on match.
	for _, port := range probe.OpenPorts {
		if ctx.Err() != nil {
			return anyEmit
		}
		if claimedPorts[port] || probe.HTTPResponses[port] == nil {
			continue
		}
		tlsOn := isTLSExpectedPort(port)
		dataURL, hash, ok := faviconFetch(ctx, host, port, tlsOn, timeout)
		if !ok {
			continue
		}
		// Log the hash at DEBUG so admins can grow the favicon table
		// (or harvest hashes for user-detector signatures) by raising
		// the log level. INFO would flood the journal on big scans
		// where every HTTP responder gets hashed.
		slog.Debug("discovery: favicon hashed",
			"component", "discovery", "scan_id", scanID,
			"host", host, "port", port, "mmh3", hash)

		// User detectors with declared faviconHashes get first dibs at
		// the hash — admin-defined signatures are more specific than
		// the bundled corpus. If any matches, emit it as a regular
		// httpFingerprintDetector hit (carrying that detector's
		// icon / name / category / urlPath) and mark the port claimed.
		if det := matchUserDetectorByFavicon(hash, o.registry.Specific()); det != nil {
			ehit := EmittedHit{
				Port:          port,
				Confidence:    ConfidenceHigh,
				Category:      detectorCategory(det),
				SuggestedName: det.Name(),
				SuggestedIcon: detectorIcon(det),
				SuggestedURL:  constructURL(schemeForPort(tlsOn), host, port),
				SuggestedDesc: "favicon hash match",
				RawFingerprint: map[string]interface{}{
					"detector":         det.ID(),
					"favicon_mmh3":     hash,
					"favicon_data_url": dataURL,
					"method":           "favicon-hash",
				},
			}
			persistHit(det, ehit)
			claimedPorts[port] = true
			anyEmit = true
			continue
		}

		match, found := lookupFaviconHash(hash)
		if !found {
			continue
		}
		scheme := "http"
		if tlsOn {
			scheme = "https"
		}
		urlStr := constructURL(scheme, host, port)
		cat := match.Category
		if cat == "" {
			cat = CategoryOther
		}
		desc := match.Desc
		if desc == "" {
			desc = match.Name + " (favicon match)"
		}
		r := &Result{
			ID:            newID(),
			ScanID:        scanID,
			Host:          host,
			Hostname:      probe.Hostname,
			Port:          port,
			DetectorID:    "core/favicon",
			Confidence:    ConfidenceMedium,
			Category:      cat,
			SuggestedName: match.Name,
			SuggestedIcon: match.Icon,
			SuggestedURL:  urlStr,
			SuggestedDesc: desc,
			RawFingerprint: map[string]interface{}{
				"detector":         "core/favicon",
				"favicon_mmh3":     hash,
				"favicon_data_url": dataURL,
				"method":           "favicon-hash",
			},
			CurateState: CuratePending,
		}
		if err := o.store.InsertResult(r); err != nil {
			slog.Error("discovery: failed to persist favicon-hash result",
				"component", "discovery", "scan_id", scanID,
				"host", host, "port", port, "error", err)
		} else {
			claimedPorts[port] = true
			anyEmit = true
		}
	}

	for _, det := range o.registry.Fallback() {
		if ctx.Err() != nil {
			return anyEmit
		}
		for _, hit := range det.Run(ctx, probe) {
			if claimedPorts[hit.Port] {
				continue // a specific detector already covered this port
			}
			persistHit(det, hit)
			anyEmit = true
		}
	}
	return anyEmit
}

// runPassivePrelude collects passive-discovery hints scoped to the
// scan's target set. Each source is best-effort — failures are logged
// and the other sources continue. Returns a non-nil PassiveHints even
// on total failure (so callers can iterate without nil checks).
//
// internalDomain is the optional zone the admin typed when starting the
// scan; used as the preferred AXFR target. Empty when no zone given.
func (o *Orchestrator) runPassivePrelude(ctx context.Context, scanID string, allow hostAllowlist, internalDomain string) *PassiveHints {
	hints := newPassiveHints()

	// ARP — cheap, no network I/O, no goroutine needed.
	if entries, err := readARPTableForHosts(allow); err != nil {
		slog.Debug("discovery: ARP table read failed",
			"component", "discovery", "error", err)
		o.addWarning(scanID, "ARP table read failed: "+err.Error())
	} else {
		for _, e := range entries {
			if e.MAC != "" {
				hints.putHostname(e.IP, "")
			}
		}
		_ = entries
	}

	// mDNS — UDP multicast, ~3 sec listen window. Runs in its own
	// short-context to bound the prelude even if the parent context is
	// huge.
	mctx, mcancel := context.WithTimeout(ctx, mdnsListenWindow+500*time.Millisecond)
	defer mcancel()
	if entries, err := browseMDNSForHosts(mctx, allow); err != nil {
		slog.Debug("discovery: mDNS browse failed",
			"component", "discovery", "error", err)
		o.addWarning(scanID, "mDNS browse failed (broadcast services like HomeKit / AirPlay won't be detected): "+err.Error())
	} else {
		for _, e := range entries {
			if e.Host != "" && e.Instance != "" {
				hints.putHostname(e.Host, e.Instance)
			}
			if e.Host != "" {
				hints.putMDNS(e.Host, e)
			}
		}
	}

	// DNS — PTR sweep + opportunistic AXFR. Both enrichment-only;
	// never emit Results. Bounded by a 4s child ctx so a stalled DNS
	// server can't drag out the prelude.
	dctx, dcancel := context.WithTimeout(ctx, 4*time.Second)
	enrichDNSForHosts(dctx, allow, hints, internalDomain)
	dcancel()

	// SSDP / UPnP — multicast M-SEARCH plus a follow-up XML fetch
	// per responder. Catches smart TVs, Roku, Sonos, IGD routers,
	// UPnP media servers — devices that don't speak HTTP on a well-
	// known port and would otherwise be invisible to the active loop.
	// Bounded by a 6s child ctx (listen window + fetch round-trips).
	sctx, scancel := context.WithTimeout(ctx, ssdpListenWindow+3*time.Second)
	if devs, err := browseSSDPForHosts(sctx, allow); err != nil {
		slog.Debug("discovery: SSDP browse failed",
			"component", "discovery", "error", err)
		o.addWarning(scanID, "SSDP / UPnP browse failed (smart TVs / media renderers / IGD routers won't be detected): "+err.Error())
	} else {
		for _, d := range devs {
			hints.putSSDP(d.Host, d)
		}
	}
	scancel()

	// SNMP v2c with "public" — best-effort sweep of every target IP.
	// Catches printers, managed switches, UPS units, server BMCs that
	// don't speak HTTP. Hosts with SNMP off or a non-default community
	// return nothing — silent. Bounded by snmpPerHostTimeout per host,
	// capped by an outer 8s budget across the whole sweep.
	snctx, sncancel := context.WithTimeout(ctx, 8*time.Second)
	allowedIPs := make([]string, 0, len(allow))
	for ip := range allow {
		allowedIPs = append(allowedIPs, ip)
	}
	for _, r := range snmpProbeHosts(snctx, allowedIPs) {
		hints.putSNMP(r.Host, r)
	}
	sncancel()

	slog.Info("discovery passive prelude complete",
		"component", "discovery",
		"target_hosts", len(allow),
		"discovered_hosts", len(hints.AllIPs()))
	return hints
}

// hostAllowlist is the set of IPs (dotted-quad strings) that belong to
// a scan's target set. Built from expandTargets output and used by
// passive-discovery sources that need an "is this IP in scope?" check.
type hostAllowlist map[string]struct{}

func (a hostAllowlist) contains(ip string) bool {
	_, ok := a[ip]
	return ok
}

func newHostAllowlist(hosts []string) hostAllowlist {
	m := make(hostAllowlist, len(hosts))
	for _, h := range hosts {
		m[h] = struct{}{}
	}
	return m
}

// emitForwardEnumDeduped inserts forward-enum candidates into the store
// and, when both a forward-enum hit and a direct probe hit exist for
// the same service, deletes the direct hit so the proxy URL wins. The
// reverse-proxy URL is what most admins prefer to expose in a
// dashboard: cleaner with real TLS, works from anywhere on the LAN
// via DNS, and survives DHCP-rotation of the backend's LAN IP.
//
// Returns (emitted, dropped) counts for the slog summary. "Dropped"
// here refers to direct results we removed because a forward-enum
// version is taking their place.
//
// Hits with no matched-core (generic subdomains like git.<domain>)
// pass through with no dedup work — there's no direct counterpart.
func (o *Orchestrator) emitForwardEnumDeduped(scanID string, candidates []*Result) (emitted, dropped int) {
	existing, err := o.store.ListResults(scanID)
	if err != nil {
		slog.Error("discovery: forward-enum dedup list failed; inserting all candidates",
			"component", "discovery", "scan_id", scanID, "error", err)
		// Fall through and insert everything — better to have potential
		// duplicates than to silently drop hits because of a store
		// error.
	}
	// Build detector_id → []resultID for the existing direct hits so we
	// can target deletions precisely (a single detector can fire on
	// multiple ports / hosts in the same scan).
	directByDetector := make(map[string][]string)
	for _, r := range existing {
		if r.DetectorID == "dns/forward" {
			continue // shouldn't be present yet, but be defensive
		}
		directByDetector[r.DetectorID] = append(directByDetector[r.DetectorID], r.ID)
	}

	for _, fe := range candidates {
		if err := o.store.InsertResult(fe); err != nil {
			slog.Error("discovery: failed to persist forward-enum result",
				"component", "discovery", "scan_id", scanID,
				"host", fe.Host, "hostname", fe.Hostname, "error", err)
			continue
		}
		emitted++

		// If this forward-enum hit matched a known detector, delete the
		// direct version(s) for that detector — the proxy URL takes
		// over. Done after insert so an insert failure doesn't leave
		// us with neither.
		matchedCore, _ := fe.RawFingerprint["matchedCore"].(string)
		if matchedCore == "" {
			continue
		}
		for _, rid := range directByDetector[matchedCore] {
			if err := o.store.DeleteResult(scanID, rid); err != nil {
				slog.Error("discovery: failed to delete direct result superseded by forward-enum",
					"component", "discovery", "scan_id", scanID,
					"result_id", rid, "detector", matchedCore, "error", err)
				continue
			}
			dropped++
		}
		// Mark detector as handled so a second forward-enum hit for the
		// same detector (e.g. both pve.<domain> and proxmox.<domain>)
		// doesn't try to re-delete already-removed rows.
		delete(directByDetector, matchedCore)
	}
	return emitted, dropped
}

// emitPassiveResults turns the mDNS + SSDP instances for one host into
// ScanResult rows. Called only for hosts the active probe didn't pick
// up, so this is purely additive. Each service instance becomes one
// result; if multiple instances share a host, multiple results emit
// (admin curates).
func (o *Orchestrator) emitPassiveResults(scanID, host string, hints *PassiveHints) {
	hostname := hints.Hostname(host)

	for _, inst := range hints.MDNSFor(host) {
		name, icon, desc, url := mdnsSuggest(host, hostname, inst)
		r := &Result{
			ID:            NewID(),
			ScanID:        scanID,
			Host:          host,
			Hostname:      hostname,
			Port:          inst.Port,
			DetectorID:    "passive/mdns",
			Confidence:    ConfidenceMedium,
			Category:      categoryForMDNSService(inst.Service),
			SuggestedName: name,
			SuggestedIcon: icon,
			SuggestedURL:  url,
			SuggestedDesc: desc,
			RawFingerprint: map[string]interface{}{
				"source":   "mdns",
				"service":  inst.Service,
				"target":   inst.Target,
				"instance": inst.Instance,
			},
			CurateState: CuratePending,
		}
		if err := o.store.InsertResult(r); err != nil {
			slog.Error("discovery: failed to persist passive result",
				"component", "discovery", "scan_id", scanID,
				"host", host, "error", err)
		}
	}

	if snmp, ok := hints.SNMPFor(host); ok {
		name, icon, cat, desc := snmpSuggest(snmp)
		r := &Result{
			ID:            NewID(),
			ScanID:        scanID,
			Host:          host,
			Hostname:      hostname,
			Port:          0,
			DetectorID:    "passive/snmp",
			Confidence:    ConfidenceMedium,
			Category:      cat,
			SuggestedName: name,
			SuggestedIcon: icon,
			SuggestedURL:  "http://" + host,
			SuggestedDesc: desc,
			RawFingerprint: map[string]interface{}{
				"source":      "snmp",
				"sysDescr":    snmp.SysDescr,
				"sysName":     snmp.SysName,
				"sysLocation": snmp.SysLocation,
			},
			CurateState: CuratePending,
		}
		if err := o.store.InsertResult(r); err != nil {
			slog.Error("discovery: failed to persist passive result",
				"component", "discovery", "scan_id", scanID,
				"host", host, "error", err)
		}
	}

	for _, dev := range hints.SSDPFor(host) {
		name, icon, cat, desc := ssdpSuggest(dev)
		// SSDP devices rarely have a browser-clickable URL — the
		// LOCATION points at the description XML, not the user UI.
		// Fall back to http://<ip>/ so the admin can edit it.
		url := "http://" + host
		r := &Result{
			ID:            NewID(),
			ScanID:        scanID,
			Host:          host,
			Hostname:      hostname,
			Port:          0,
			DetectorID:    "passive/ssdp",
			Confidence:    ConfidenceMedium,
			Category:      cat,
			SuggestedName: name,
			SuggestedIcon: icon,
			SuggestedURL:  url,
			SuggestedDesc: desc,
			RawFingerprint: map[string]interface{}{
				"source":       "ssdp",
				"deviceType":   dev.DeviceType,
				"manufacturer": dev.Manufacturer,
				"modelName":    dev.ModelName,
				"location":     dev.Location,
				"server":       dev.Server,
			},
			CurateState: CuratePending,
		}
		if err := o.store.InsertResult(r); err != nil {
			slog.Error("discovery: failed to persist passive result",
				"component", "discovery", "scan_id", scanID,
				"host", host, "error", err)
		}
	}
}

// mdnsSuggest picks a sensible tile name / icon / URL from one mDNS
// service instance. Falls back to generic strings when we don't have a
// specific mapping; the curate UI lets the admin edit either.
func mdnsSuggest(host, hostname string, inst mdnsInstance) (name, icon, desc, url string) {
	name = inst.Instance
	if name == "" {
		if hostname != "" {
			name = hostname
		} else {
			name = host
		}
	}
	desc = "mDNS: " + inst.Service
	switch inst.Service {
	case "_http._tcp.local.", "_https._tcp.local.":
		scheme := "http"
		if strings.HasPrefix(inst.Service, "_https") {
			scheme = "https"
		}
		port := inst.Port
		if port == 0 {
			port = 80
		}
		url = constructURL(scheme, host, port)
		icon = "mdi:web"
	case "_googlecast._tcp.local.":
		icon = "mdi:cast"
		url = constructURL("http", host, inst.Port)
	case "_airplay._tcp.local.", "_raop._tcp.local.":
		icon = "mdi:airplay"
		url = constructURL("http", host, inst.Port)
	case "_homeassistant._tcp.local.":
		icon = "home-assistant"
		url = constructURL("http", host, inst.Port)
	case "_plex._tcp.local.":
		icon = "plex"
		url = constructURL("http", host, 32400)
	case "_smb._tcp.local.":
		icon = "mdi:nas"
		url = "smb://" + host + "/"
	case "_ssh._tcp.local.":
		icon = "mdi:ssh"
		url = "ssh://" + host
	case "_printer._tcp.local.", "_ipp._tcp.local.":
		icon = "mdi:printer"
		url = constructURL("http", host, inst.Port)
	case "_hap._tcp.local.":
		icon = "mdi:home-automation"
		// HomeKit accessories don't have a web UI; URL is nominal.
		url = "http://" + host
	default:
		icon = "mdi:lan-pending"
		url = constructURL("http", host, inst.Port)
	}
	return
}

func constructURL(scheme, host string, port int) string {
	if port <= 0 || (scheme == "http" && port == 80) || (scheme == "https" && port == 443) {
		return scheme + "://" + host
	}
	return fmt.Sprintf("%s://%s:%d", scheme, host, port)
}

// maxScanHosts caps the total number of distinct hosts a single scan
// can expand to. /16 = 65,536; bigger than that and the scan runs for
// hours, the UI feels stuck, and the admin probably typed something
// wrong.
const maxScanHosts = 65536

// expandTargets parses the targets field of a scan and returns the
// deduplicated, capped list of IPv4 host addresses to probe. The input
// is a comma-separated string where each target is one of:
//
//	CIDR      192.168.1.0/24
//	range     192.168.1.10-192.168.1.50    (full IP pairs)
//	range     192.168.1.10-50               (short form: end is an octet)
//	single    192.168.1.5
//
// Any piece may be prefixed with `!` or `NOT ` (case-insensitive) to
// EXCLUDE it from the include set. All pieces are AND-combined:
//
//	10.10.0.0/24, !10.10.0.8-12, 10.10.25.25
//	    ↓
//	(every host in /24) ∪ {10.10.25.25} ∖ (10.10.0.8 .. 10.10.0.12)
//
// At least one include is required — a list of only excludes is an
// error. Whitespace around commas and within targets is trimmed.
// Overlapping targets are deduplicated. Network/broadcast addresses
// of /30+ CIDRs are excluded in line with usual scan-tool behaviour.
func expandTargets(input string) ([]string, error) {
	includes := make(map[string]struct{})
	excludes := make(map[string]struct{})
	var ordered []string // preserves include insertion order for deterministic scans

	for _, raw := range strings.Split(input, ",") {
		piece := strings.TrimSpace(raw)
		if piece == "" {
			continue
		}
		exclude, rest := stripExcludePrefix(piece)
		if rest == "" {
			return nil, fmt.Errorf("target %q is empty after stripping exclusion prefix", piece)
		}
		hosts, err := expandOneTarget(rest)
		if err != nil {
			return nil, fmt.Errorf("target %q: %w", piece, err)
		}
		dest := includes
		if exclude {
			dest = excludes
		}
		for _, h := range hosts {
			if _, dup := dest[h]; dup {
				continue
			}
			dest[h] = struct{}{}
			if !exclude {
				ordered = append(ordered, h)
				if len(ordered) > maxScanHosts {
					return nil, fmt.Errorf("targets expand to more than %d hosts (raise the cap or narrow the input)", maxScanHosts)
				}
			}
		}
	}
	if len(includes) == 0 {
		return nil, fmt.Errorf("no include targets supplied (at least one target without a ! / NOT prefix is required)")
	}

	// Subtract excludes from includes, preserving order.
	out := make([]string, 0, len(ordered))
	for _, h := range ordered {
		if _, dropped := excludes[h]; dropped {
			continue
		}
		out = append(out, h)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("after applying exclusions, no hosts remain to scan")
	}
	return out, nil
}

// stripExcludePrefix peels a leading `!`, `NOT `, or `not ` off a
// target piece and returns (true, restOfString) for excludes, or
// (false, piece) for plain include pieces. The `NOT` form requires a
// space separator so it isn't confused with a hostname literally
// starting with "not" (unlikely for IPv4 targets but defensive).
func stripExcludePrefix(s string) (exclude bool, rest string) {
	trimmed := strings.TrimSpace(s)
	if strings.HasPrefix(trimmed, "!") {
		return true, strings.TrimSpace(strings.TrimPrefix(trimmed, "!"))
	}
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "not ") {
		return true, strings.TrimSpace(trimmed[len("not "):])
	}
	return false, trimmed
}

func expandOneTarget(s string) ([]string, error) {
	switch {
	case strings.Contains(s, "/"):
		return expandCIDR(s)
	case strings.Contains(s, "-"):
		return expandRange(s)
	default:
		return expandSingleIP(s)
	}
}

// expandCIDR returns the list of usable IPv4 host addresses in the given
// CIDR. Network and broadcast addresses are excluded for prefixes /30 and
// larger; for /31 and /32 every address is included.
func expandCIDR(cidr string) ([]string, error) {
	_, ipnet, err := net.ParseCIDR(cidr)
	if err != nil {
		return nil, err
	}
	if ipnet.IP.To4() == nil {
		return nil, fmt.Errorf("only IPv4 CIDRs are supported in this release")
	}

	ones, bits := ipnet.Mask.Size()
	hostBits := bits - ones
	if hostBits > 16 {
		return nil, fmt.Errorf("CIDR too large (max /16, got /%d)", ones)
	}

	start := ipToUint32(ipnet.IP)
	count := uint32(1) << hostBits

	includeAll := ones >= 31
	first := uint32(0)
	last := count
	if !includeAll {
		first = 1
		last = count - 1
	}

	out := make([]string, 0, last-first)
	for i := first; i < last; i++ {
		out = append(out, uint32ToIP(start+i).String())
	}
	return out, nil
}

// expandRange parses "start-end" where end is either a full IP or just
// the last octet (shorthand: "10.10.0.1-50" = "10.10.0.1-10.10.0.50").
// Caps the range at maxScanHosts addresses to refuse pathological input
// before the orchestrator wastes work on it.
func expandRange(s string) ([]string, error) {
	parts := strings.SplitN(s, "-", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("range needs start-end format")
	}
	start := net.ParseIP(strings.TrimSpace(parts[0]))
	if start == nil || start.To4() == nil {
		return nil, fmt.Errorf("invalid start IP")
	}
	startV4 := start.To4()

	endStr := strings.TrimSpace(parts[1])
	var endV4 net.IP
	if strings.Contains(endStr, ".") {
		end := net.ParseIP(endStr)
		if end == nil || end.To4() == nil {
			return nil, fmt.Errorf("invalid end IP")
		}
		endV4 = end.To4()
	} else {
		n, err := strconv.Atoi(endStr)
		if err != nil || n < 0 || n > 255 {
			return nil, fmt.Errorf("invalid end octet %q (must be 0-255)", endStr)
		}
		endV4 = net.IPv4(startV4[0], startV4[1], startV4[2], byte(n)).To4()
	}

	startU := ipToUint32(startV4)
	endU := ipToUint32(endV4)
	if endU < startU {
		return nil, fmt.Errorf("range end is before start")
	}
	if endU-startU+1 > maxScanHosts {
		return nil, fmt.Errorf("range covers more than %d addresses", maxScanHosts)
	}
	out := make([]string, 0, endU-startU+1)
	for u := startU; u <= endU; u++ {
		out = append(out, uint32ToIP(u).String())
	}
	return out, nil
}

// expandSingleIP returns a single-host list for a bare IPv4 input. Used
// for "scan exactly this address" entries in the target list.
func expandSingleIP(s string) ([]string, error) {
	ip := net.ParseIP(strings.TrimSpace(s))
	if ip == nil || ip.To4() == nil {
		return nil, fmt.Errorf("invalid IPv4 address")
	}
	return []string{ip.To4().String()}, nil
}

func ipToUint32(ip net.IP) uint32 {
	ip = ip.To4()
	return uint32(ip[0])<<24 | uint32(ip[1])<<16 | uint32(ip[2])<<8 | uint32(ip[3])
}

func uint32ToIP(n uint32) net.IP {
	return net.IPv4(byte(n>>24), byte(n>>16), byte(n>>8), byte(n))
}

// newID returns a 16-hex-character random identifier. Not a UUID — just
// enough entropy that collisions are astronomically unlikely for our
// per-server scale.
func newID() string {
	return NewID()
}

// NewID is the exported variant of newID — the API package calls it to
// generate scan IDs before persisting them so the response includes the
// new ID without a round-trip.
func NewID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
