<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Icon from '@iconify/svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import { isAuthenticated, waitForAuthChecked } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import { config as configStore, loadConfig } from '$lib/stores/config';
  import {
    getScan, cancelScan, deleteScan, updateScanResult, promoteScan, createScan,
    createDetector,
    CATEGORY_LIST, categoryLabel, categoryIcon,
    type DiscoveryScan, type DiscoveryResult, type DiscoveryCategory,
    type DiscoveryDetector, type DiscoveryDetectorInput,
  } from '$lib/utils/api';
  import DetectorEditModal from '$lib/components/admin/DetectorEditModal.svelte';

  const scanId = $derived(page.params.id ?? '');

  let scan = $state<DiscoveryScan | null>(null);
  let results = $state<DiscoveryResult[]>([]);
  let recentHosts = $state<string[]>([]);
  let phase = $state('');
  let warnings = $state<string[]>([]);
  // Cursor for delta polling. After each successful poll, set to the
  // max createdAt seen so far; the next poll only fetches rows
  // strictly newer than this. Cleared when navigating to a different
  // scan (in the scanId effect below).
  let lastResultTs = $state('');
  let loading = $state(true);
  let loadError = $state('');
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  // Curate state — selected IDs + per-row override drafts (name, url).
  // We sync to the server via PATCH on blur so a half-curated draft
  // survives a reload.
  let selected = $state<Record<string, boolean>>({});
  let nameDrafts = $state<Record<string, string>>({});
  let urlDrafts = $state<Record<string, string>>({});

  // Local per-row category override before any PATCH lands. Lets the
  // dropdown reflect the user's choice immediately without waiting on
  // the server round-trip.
  let categoryDrafts = $state<Record<string, DiscoveryCategory>>({});

  // Promote modal state. The admin picks dashboard + tab; the server
  // distributes selected results into groups by their category, so the
  // modal no longer asks for a group. New-dashboard still implies
  // new-tab (server enforces; UI mirrors).
  const NEW = '__new__';
  let showPromote = $state(false);
  let promoteDashId = $state('');
  let promoteTabId = $state('');
  let newDashName = $state('');
  let newTabName = $state('');
  let promoting = $state(false);
  let rescanning = $state(false);

  onMount(async () => {
    await waitForAuthChecked();
    if (!$isAuthenticated) {
      goto('/');
      return;
    }
    await loadConfig();
    await refresh();
  });

  onDestroy(() => {
    stopped = true;
    if (pollTimer) clearTimeout(pollTimer);
  });

  // SvelteKit reuses this component when navigating between
  // /admin/discovery/[id] URLs (e.g. after rescan creates a new scan
  // and we goto its page). `onMount` doesn't re-fire in that case, so
  // we need an effect that watches scanId and triggers a fresh load
  // when it changes. Without this, the URL updates but the page still
  // shows the previous scan's data.
  let lastLoadedScanId = '';
  $effect(() => {
    const id = scanId;
    if (!id || id === lastLoadedScanId) return;
    if (!$isAuthenticated) return;
    lastLoadedScanId = id;
    // Reset state from the previous scan before reloading.
    scan = null;
    results = [];
    recentHosts = [];
    phase = '';
    warnings = [];
    lastResultTs = '';
    selected = {};
    nameDrafts = {};
    urlDrafts = {};
    categoryDrafts = {};
    loading = true;
    loadError = '';
    stopped = false;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    refresh();
  });

  async function refresh() {
    // Capture scanId at the start of the call. By the time getScan
    // resolves, scanId may have changed (rapid navigation, rescan).
    // We compare on return and discard if it has — otherwise an
    // in-flight fetch for scan A would clobber the freshly-loaded
    // scan B's data + reschedule a poll against A.
    const inflightScanId = scanId;
    try {
      // Use the cursor on subsequent polls to fetch only new results.
      // First call (lastResultTs is "") returns the full set so the
      // page hydrates correctly on initial load and after navigation.
      const data = await getScan(inflightScanId, lastResultTs);
      if (inflightScanId !== scanId || stopped) {
        // Navigation happened (or onDestroy fired) while we were
        // awaiting — drop the response on the floor.
        return;
      }
      scan = data.scan;
      // Merge delta into the existing array (by id, so duplicates from
      // a borderline timestamp collision are deduped). Initial call
      // returns everything and the existing array is empty.
      if (lastResultTs === '') {
        results = data.results;
      } else if (data.results.length > 0) {
        const seen = new Set(results.map((r) => r.id));
        for (const r of data.results) {
          if (!seen.has(r.id)) results.push(r);
        }
      }
      // Advance the cursor to the latest createdAt across the merged set.
      for (const r of results) {
        if (r.createdAt && r.createdAt > lastResultTs) lastResultTs = r.createdAt;
      }
      recentHosts = data.recentHosts ?? [];
      phase = data.phase ?? '';
      warnings = data.warnings ?? [];

      // Hydrate curate drafts from the server (don't overwrite local
      // edits the user already made — only fill blanks). New
      // high-confidence rows default to ticked; medium/low default to
      // unticked unless the server already says "selected". Already-
      // promoted rows stay unticked locally — their checkbox is locked
      // and they're excluded from any subsequent promote payload.
      for (const r of results) {
        if (selected[r.id] === undefined) {
          if (r.curateState === 'promoted') {
            selected[r.id] = false;
          } else if (r.curateState === 'selected') {
            selected[r.id] = true;
          } else if (r.curateState === 'pending' && r.confidence === 'high') {
            selected[r.id] = true;
          } else {
            selected[r.id] = false;
          }
        }
        if (nameDrafts[r.id] === undefined) {
          const ov = r.curateOverrides as Record<string, unknown> | undefined;
          nameDrafts[r.id] = (ov?.name as string) ?? r.suggestedName;
        }
        if (urlDrafts[r.id] === undefined) {
          const ov = r.curateOverrides as Record<string, unknown> | undefined;
          urlDrafts[r.id] = (ov?.url as string) ?? r.suggestedUrl;
        }
        if (categoryDrafts[r.id] === undefined) {
          categoryDrafts[r.id] = (r.category ?? 'other') as DiscoveryCategory;
        }
      }

      loadError = '';
      // If still running, schedule another poll. Short-poll every 1s
      // while running, matches what the plan committed to. The
      // scanId-equality recheck below is belt-and-braces against a
      // navigation that happens between the await and now.
      if (!stopped && scan && inflightScanId === scanId &&
          (scan.state === 'running' || scan.state === 'pending')) {
        pollTimer = setTimeout(refresh, 1000);
      }
    } catch (e) {
      if (inflightScanId !== scanId) return; // navigation already moved on
      loadError = e instanceof Error ? e.message : 'Failed to load scan';
    } finally {
      if (inflightScanId === scanId) loading = false;
    }
  }

  function isTerminal(s: DiscoveryScan | null): boolean {
    if (!s) return false;
    return ['complete', 'cancelled', 'failed', 'promoted'].includes(s.state);
  }

  // Protocol-scheme URLs (postgres://, mongodb://, redis://, mysql://,
  // smb://, ssh://, etc.) aren't browser-clickable. They surface from
  // the TCP-port detector and the user is meant to copy-paste them into
  // a native client (pgAdmin, DBeaver, Finder, terminal). Render them
  // as a copy button instead of an open-in-new-tab link.
  function isCopyOnlyURL(url: string): boolean {
    if (!url) return false;
    const lower = url.toLowerCase();
    return !lower.startsWith('http://') && !lower.startsWith('https://');
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('URL copied');
    } catch {
      toast.error('Copy failed — select the URL field and Ctrl-C');
    }
  }

  // Rows where the bundled detectors didn't identify the service — the
  // bootstrap-detector affordance is most useful here, since the admin
  // can promote an unrecognized HTTP service to a recognized one with
  // a couple of clicks. Generic HTTP fallback rows are the canonical
  // case; we also surface it on forward-enum rows that didn't match
  // any specific detector (their matchedCore is "").
  function canBootstrapDetector(r: DiscoveryResult): boolean {
    if (r.detectorId === 'core/http-fallback' || r.detectorId === 'core/http-80' || r.detectorId === 'core/http-443') return true;
    if (r.detectorId === 'dns/forward') {
      const fp = r.rawFingerprint as Record<string, unknown> | undefined;
      const matched = (fp?.matchedCore as string) ?? '';
      return matched === '';
    }
    return false;
  }

  let bootstrapSeed = $state<DiscoveryDetector | null>(null);

  // Build a partial DiscoveryDetector to seed the modal from a curated
  // row. The modal accepts a DiscoveryDetector | null; passing one of
  // these makes the form open pre-populated with the result's data.
  // (id is empty so the modal treats it as creating new.)
  function seedFromResult(r: DiscoveryResult): DiscoveryDetector {
    const fp = (r.rawFingerprint ?? {}) as Record<string, unknown>;
    const server = typeof fp.server === 'string' ? fp.server : '';
    const headerKeys = server ? ['server'] : [];
    const faviconUrl = typeof fp.favicon_data_url === 'string' ? fp.favicon_data_url : '';
    const faviconHash = typeof fp.favicon_mmh3 === 'number' ? [fp.favicon_mmh3 as number] : [];
    return {
      id: '',
      name: r.suggestedName || `Service on ${r.host}`,
      icon: faviconUrl || '',
      category: (r.category ?? 'other') as DiscoveryCategory,
      description: '',
      ports: r.port ? [r.port] : [],
      paths: [],
      urlPath: '',
      bodyContains: [],
      titleContains: r.suggestedName ? [r.suggestedName] : [],
      headerKeys,
      faviconHashes: faviconHash,
      confidence: 'high',
      enabled: true,
      source: 'user',
    };
  }

  async function handleBootstrapSave(input: DiscoveryDetectorInput) {
    try {
      await createDetector(input);
      bootstrapSeed = null;
      toast.success(`Detector created — re-scan to see "${input.name}" identified`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    }
  }

  async function handleCancel() {
    if (!scan) return;
    try {
      await cancelScan(scan.id);
      toast.success('Scan cancelled');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Cancel failed');
    }
  }

  // "Edit & re-scan" — navigates to the New Scan form pre-filled with
  // this draft's targets, intensity, internal domain, and label so the
  // admin can tweak (e.g. add a !10.10.0.50 exclusion for that printer
  // that jams on probes) before kicking off a fresh scan. The current
  // draft is left in place; the admin can delete it after the new
  // scan is running if they want.
  function handleEditAndRescan() {
    if (!scan) return;
    const params = new URLSearchParams();
    params.set('targets', scan.cidr);
    if (scan.intensity) params.set('intensity', scan.intensity);
    if (scan.internalDomain) params.set('internalDomain', scan.internalDomain);
    if (scan.label) params.set('label', scan.label);
    // Stop polling on the old scan before navigating away (same race
    // we fixed for handleRescan — the timer can interfere with goto).
    stopped = true;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    goto(`/admin/discovery/new?${params.toString()}`);
  }

  async function handleRescan() {
    if (!scan || rescanning) return;
    rescanning = true;
    // Safety net for the case where the underlying fetch hangs without
    // resolving (server restart mid-request, dropped connection that
    // never errors out): unstick the button after 15s with an explicit
    // error message rather than sitting on "Starting…" indefinitely.
    let resolved = false;
    const safety = setTimeout(() => {
      if (resolved) return;
      rescanning = false;
      toast.error('Re-scan timed out — check the server logs and try again');
    }, 15_000);
    try {
      const fresh = await createScan({
        cidr: scan.cidr,
        intensity: scan.intensity,
        label: scan.label,
        internalDomain: scan.internalDomain,
      });
      resolved = true;
      clearTimeout(safety);
      // Stop the old-scan polling loop BEFORE navigating — otherwise
      // the 1s refresh timer can race with goto, kick off a fetch
      // mid-navigation, and leave the page stuck on "Starting…".
      stopped = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      toast.success('Started a new scan with the same settings');
      await goto(`/admin/discovery/${fresh.id}`);
      // Reset rescanning as a defensive fallback in case the page is
      // still mounted (goto resolved but the component didn't unmount).
      rescanning = false;
    } catch (e) {
      resolved = true;
      clearTimeout(safety);
      toast.error(e instanceof Error ? e.message : 'Re-scan failed');
      rescanning = false;
    }
  }

  async function handleDelete() {
    if (!scan) return;
    if (!confirm('Delete this draft and all its results?')) return;
    try {
      await deleteScan(scan.id);
      toast.success('Draft deleted');
      goto('/admin/discovery');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  function toggleAll(state: boolean) {
    // Already-promoted rows are locked — bulk actions skip them so the
    // user can't accidentally untick the visual "this is on the dashboard"
    // marker or attempt to re-promote a row that already shipped.
    for (const r of results) {
      if (r.curateState === 'promoted') continue;
      selected[r.id] = state;
    }
  }
  function selectAllHigh() {
    for (const r of results) {
      if (r.curateState === 'promoted') continue;
      selected[r.id] = r.confidence === 'high';
    }
  }

  let promotedCount = $derived(
    results.reduce((n, r) => n + (r.curateState === 'promoted' ? 1 : 0), 0)
  );

  async function persistCurateState(r: DiscoveryResult) {
    if (!scan) return;
    // Locked rows are read-only — the server rejects writes to them
    // anyway but skipping here avoids spurious error toasts on blur.
    if (r.curateState === 'promoted') return;
    const overrides: Record<string, unknown> = {
      name: nameDrafts[r.id],
      url: urlDrafts[r.id],
    };
    const curateState = selected[r.id] ? 'selected' : 'pending';
    try {
      await updateScanResult(scan.id, r.id, { curateState, overrides });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  }

  async function persistCategory(r: DiscoveryResult) {
    if (!scan) return;
    if (r.curateState === 'promoted') return;
    const cat = categoryDrafts[r.id];
    if (!cat) return;
    try {
      await updateScanResult(scan.id, r.id, { category: cat });
      // Reflect the change in the local result so promote-preview
      // counts update without a refetch.
      results = results.map((x) => (x.id === r.id ? { ...x, category: cat } : x));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  }

  // Promote pick lists — driven from the loaded config blob.
  let dashboards = $derived($configStore?.dashboards ?? []);
  let tabsForDash = $derived(
    promoteDashId === NEW ? [] : (dashboards.find((d) => d.id === promoteDashId)?.tabs ?? [])
  );
  // selectedCount excludes already-promoted rows so the "Promote N"
  // button reflects only what would actually be added on the next click.
  let selectedCount = $derived(
    results.reduce(
      (n, r) => n + (selected[r.id] && r.curateState !== 'promoted' ? 1 : 0),
      0
    )
  );

  // Categories that will become groups when the user presses Promote.
  // Preview shown in the modal so the admin sees the distribution
  // before committing.
  let categoriesInSelection = $derived.by(() => {
    const counts = new Map<DiscoveryCategory, number>();
    for (const r of results) {
      if (!selected[r.id] || r.curateState === 'promoted') continue;
      const cat = (categoryDrafts[r.id] ?? r.category ?? 'other') as DiscoveryCategory;
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return CATEGORY_LIST
      .filter((c) => counts.has(c.slug))
      .map((c) => ({ slug: c.slug, label: c.label, icon: c.icon, count: counts.get(c.slug)! }));
  });

  // Cascading rule (server-enforced, UI-mirrored): new dashboard ⇒ new
  // tab. Groups aren't picked anymore — categories drive that.
  let dashIsNew = $derived(promoteDashId === NEW);
  let tabIsNew = $derived(dashIsNew || promoteTabId === NEW);

  function openPromote() {
    if (selectedCount === 0) {
      toast.error('Tick at least one result to promote');
      return;
    }
    showPromote = true;
    if (!promoteDashId) {
      promoteDashId = dashboards[0]?.id ?? NEW;
    }
  }

  // When the dashboard changes and the current tab doesn't belong to
  // it, reset the tab. Skipped while the parent is in "new" mode.
  $effect(() => {
    if (dashIsNew) {
      promoteTabId = NEW;
      return;
    }
    if (!tabsForDash.find((t) => t.id === promoteTabId)) {
      promoteTabId = tabsForDash[0]?.id ?? NEW;
    }
  });

  function promoteCanSubmit(): boolean {
    if (dashIsNew && !newDashName.trim()) return false;
    if (!dashIsNew && !promoteDashId) return false;
    if (tabIsNew && !newTabName.trim()) return false;
    if (!tabIsNew && !promoteTabId) return false;
    return true;
  }

  async function doPromote() {
    if (!scan || promoting) return;
    if (!promoteCanSubmit()) {
      toast.error('Pick or name a dashboard and tab');
      return;
    }
    promoting = true;
    const ids = results
      .filter((r) => selected[r.id] && r.curateState !== 'promoted')
      .map((r) => r.id);
    // Push the latest overrides for selected rows so the server has them
    // before promoting.
    for (const r of results) {
      if (selected[r.id]) await persistCurateState(r);
    }
    const target: Record<string, unknown> = {};
    if (dashIsNew) target.newDashboard = { name: newDashName.trim() };
    else target.dashboardId = promoteDashId;
    if (tabIsNew) target.newTab = { name: newTabName.trim() };
    else target.tabId = promoteTabId;

    try {
      const { promoted, dashboardPath } = await promoteScan(scan.id, target, ids);
      toast.success(`${promoted} tile(s) added to the dashboard`);
      // Take the user to where their new tiles now live — prefer the
      // path the server tells us, fall back to the picked dashboard.
      if (dashboardPath) {
        // Reload the config first so the new dashboard appears in the
        // navbar and elsewhere.
        await loadConfig();
        goto(dashboardPath);
      } else if (!dashIsNew) {
        const dash = dashboards.find((d) => d.id === promoteDashId);
        if (dash) goto(dash.path);
        else goto('/admin/discovery');
      } else {
        goto('/admin/discovery');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Promote failed');
      promoting = false;
    }
  }

  // Picks the best icon source for a result: prefer the actual favicon
  // fetched during the scan (admin recognises real icons instantly),
  // fall back to the detector's suggested icon (dashboard-icons slug or
  // Iconify name), fall back to a placeholder. Mirrors the backend's
  // icon-routing rule for the second case.
  function iconHrefFor(r: DiscoveryResult): { iconUrl?: string; iconify?: string } {
    const favicon = (r.rawFingerprint as Record<string, unknown> | undefined)?.favicon_data_url;
    if (typeof favicon === 'string' && favicon.startsWith('data:image/')) {
      return { iconUrl: favicon };
    }
    const icon = r.suggestedIcon;
    if (!icon) return {};
    if (icon.includes(':')) return { iconify: icon };
    return { iconUrl: `/api/icons/dashboard/${icon}.svg` };
  }

  function fmtTime(ts?: string): string {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString();
  }
</script>

<svelte:head>
  <title>Discovery Draft — HOPS</title>
</svelte:head>

<div class="page">
  <header class="header">
    <div class="title-row">
      <button class="back" onclick={() => goto('/admin/discovery')} title="Back">
        <Icon icon="mdi:arrow-left" width="20" />
      </button>
      <div>
        <h1>Discovery draft</h1>
        {#if scan}
          <div class="sub mono">
            {scan.cidr} · {scan.intensity} · {fmtTime(scan.createdAt)}
            {#if scan.label}· {scan.label}{/if}
            {#if scan.internalDomain}· domain: {scan.internalDomain}{/if}
          </div>
        {/if}
      </div>
    </div>
    {#if scan}
      <div class="header-actions">
        {#if scan.state === 'running' || scan.state === 'pending'}
          <Button variant="secondary" icon="mdi:stop" onclick={handleCancel}>Cancel scan</Button>
        {:else}
          <Button variant="secondary" icon="mdi:refresh" onclick={handleRescan} disabled={rescanning}>
            {rescanning ? 'Starting…' : 'Re-scan'}
          </Button>
          <Button variant="secondary" icon="mdi:pencil-box-outline" onclick={handleEditAndRescan}>
            Edit & re-scan
          </Button>
        {/if}
        <Button variant="danger" icon="mdi:trash-can" onclick={handleDelete}>Delete</Button>
      </div>
    {/if}
  </header>

  {#if loading && !scan}
    <p class="muted">Loading…</p>
  {:else if loadError}
    <div class="error">{loadError}</div>
  {:else if scan}
    {@const total = scan.progressTotal || 1}
    {@const pct = Math.min(100, Math.round((scan.progressDone / total) * 100))}

    {#if scan.state === 'running' || scan.state === 'pending'}
      <div class="progress">
        <div class="progress-label">
          <span class="dot dot-running"></span>
          Scanning {scan.cidr} — {scan.progressDone} / {scan.progressTotal} hosts
        </div>
        {#if phase}
          <div class="phase">{phase}</div>
        {/if}
        {#if recentHosts.length > 0}
          <div class="recent mono">probing {recentHosts.slice(0, 5).join(', ')}…</div>
        {/if}
        <div class="bar"><div class="bar-fill" style:width="{pct}%"></div></div>
      </div>
    {:else if scan.state === 'failed'}
      <div class="error">Scan failed{scan.errorMessage ? `: ${scan.errorMessage}` : ''}.</div>
    {/if}

    {#if warnings.length > 0}
      <div class="warnings" role="alert">
        <div class="warnings-head">
          <Icon icon="mdi:alert-outline" width="20" />
          <span>Scan completed with {warnings.length} warning{warnings.length === 1 ? '' : 's'}:</span>
        </div>
        <ul>
          {#each warnings as w}<li>{w}</li>{/each}
        </ul>
      </div>
    {/if}

    {#if results.length === 0}
      {#if scan.state === 'complete' || scan.state === 'cancelled'}
        <div class="empty">
          <Icon icon="mdi:magnify-close" width="48" />
          <p>Scan finished — nothing detected on the requested range.</p>
        </div>
      {:else}
        <p class="muted">No results yet…</p>
      {/if}
    {:else}
      <div class="curate-toolbar">
        <div class="bulk">
          <button onclick={() => toggleAll(true)}>Select all</button>
          <button onclick={() => toggleAll(false)}>Select none</button>
          <button onclick={selectAllHigh}>Select all high-confidence</button>
        </div>
        <div class="bulk">
          {#if promotedCount > 0}
            <span class="muted">{promotedCount} already promoted ·</span>
          {/if}
          <span class="muted">{selectedCount} selected</span>
          <Button
            variant="primary"
            icon="mdi:check-bold"
            disabled={selectedCount === 0}
            onclick={openPromote}
          >
            Promote {selectedCount} to dashboard
          </Button>
        </div>
      </div>

      <table class="results">
        <thead>
          <tr>
            <th class="check-col"></th>
            <th class="icon-col"></th>
            <th>Host</th>
            <th>Port</th>
            <th>Confidence</th>
            <th>Category</th>
            <th>Name</th>
            <th>URL</th>
            <th class="open-col"></th>
            <th class="open-col"></th>
          </tr>
        </thead>
        <tbody>
          {#each results as r (r.id)}
            {@const isPromoted = r.curateState === 'promoted'}
            {@const iconRef = iconHrefFor(r)}
            <tr class:selected={selected[r.id]} class:promoted={isPromoted}>
              <td>
                {#if isPromoted}
                  <Icon icon="mdi:check-circle" width="20" class="promoted-icon" />
                {:else}
                  <input
                    type="checkbox"
                    bind:checked={selected[r.id]}
                    onchange={() => persistCurateState(r)}
                  />
                {/if}
              </td>
              <td class="icon-cell">
                {#if iconRef.iconUrl}
                  <img src={iconRef.iconUrl} alt="" class="row-icon" loading="lazy" decoding="async" />
                {:else if iconRef.iconify}
                  <Icon icon={iconRef.iconify} width="24" />
                {:else}
                  <Icon icon="mdi:application-outline" width="24" class="muted-icon" />
                {/if}
              </td>
              <td class="mono">
                {#if r.detectorId === 'dns/forward'}
                  <!-- Forward-enum hits live behind a reverse proxy:
                       the FQDN is the canonical "where", the resolved
                       IP is just the proxy door. Showing the IP as the
                       primary line implied the service ran there — it
                       doesn't. Swap the hierarchy so the row reads
                       correctly. -->
                  {r.hostname || r.host}
                  {#if r.hostname}<div class="muted small">via {r.host}</div>{/if}
                {:else}
                  {r.host}
                  {#if r.hostname}<div class="muted small">{r.hostname}</div>{/if}
                {/if}
              </td>
              <td class="mono">{r.port}</td>
              <td>
                {#if isPromoted}
                  <span class="conf conf-promoted">promoted</span>
                {:else}
                  <span class="conf conf-{r.confidence}">{r.confidence}</span>
                {/if}
              </td>
              <td class="cat-cell">
                {#if isPromoted}
                  <span class="cat-static">
                    <Icon icon={categoryIcon(r.category ?? 'other')} width="14" />
                    {categoryLabel(r.category ?? 'other')}
                  </span>
                {:else}
                  <select
                    class="cat-select"
                    bind:value={categoryDrafts[r.id]}
                    onchange={() => persistCategory(r)}
                  >
                    {#each CATEGORY_LIST as c (c.slug)}
                      <option value={c.slug}>{c.label}</option>
                    {/each}
                  </select>
                {/if}
              </td>
              <td>
                <input
                  class="inline-input"
                  type="text"
                  bind:value={nameDrafts[r.id]}
                  onblur={() => persistCurateState(r)}
                  disabled={isPromoted}
                />
              </td>
              <td>
                <input
                  class="inline-input mono"
                  type="text"
                  bind:value={urlDrafts[r.id]}
                  onblur={() => persistCurateState(r)}
                  disabled={isPromoted}
                />
              </td>
              <td class="open-cell">
                {#if canBootstrapDetector(r) && !isPromoted}
                  <button
                    type="button"
                    class="open-link"
                    onclick={() => (bootstrapSeed = seedFromResult(r))}
                    title="Create a detector from this — HOPS will identify this service in future scans"
                  >
                    <Icon icon="mdi:plus-circle-outline" width="18" />
                  </button>
                {/if}
              </td>
              <td class="open-cell">
                {#if isCopyOnlyURL(urlDrafts[r.id] || r.suggestedUrl)}
                  <button
                    type="button"
                    class="open-link copy-btn"
                    onclick={() => copyToClipboard(urlDrafts[r.id] || r.suggestedUrl)}
                    title="Copy URL — paste into your client (pgAdmin / DBeaver / terminal)"
                  >
                    <Icon icon="mdi:content-copy" width="18" />
                  </button>
                {:else}
                  <a
                    href={urlDrafts[r.id] || r.suggestedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="open-link"
                    title="Open this URL in a new tab"
                  >
                    <Icon icon="mdi:open-in-new" width="18" />
                  </a>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
</div>

{#if showPromote && scan}
  <div class="modal-backdrop" onclick={() => (showPromote = false)} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Promote results">
      <h2>Promote {selectedCount} tile{selectedCount === 1 ? '' : 's'}</h2>
      <p class="muted">Pick where the new tiles should land — or create a new dashboard, tab, or group on the fly.</p>

      <div class="field">
        <label for="p-dash">Dashboard</label>
        <select id="p-dash" bind:value={promoteDashId}>
          {#each dashboards as d (d.id)}
            <option value={d.id}>{d.name}</option>
          {/each}
          <option value={NEW}>+ New dashboard…</option>
        </select>
        {#if dashIsNew}
          <input
            type="text"
            placeholder="New dashboard name (e.g. Media)"
            bind:value={newDashName}
            autocomplete="off"
          />
          <div class="hint">A URL path will be auto-generated from the name.</div>
        {/if}
      </div>

      <div class="field">
        <label for="p-tab">Tab</label>
        {#if tabIsNew}
          <input
            type="text"
            placeholder="New tab name"
            bind:value={newTabName}
            autocomplete="off"
          />
          {#if dashIsNew}
            <div class="hint">A new dashboard needs at least one tab.</div>
          {/if}
        {:else}
          <select id="p-tab" bind:value={promoteTabId}>
            {#each tabsForDash as t (t.id)}
              <option value={t.id}>{t.name}</option>
            {/each}
            <option value={NEW}>+ New tab…</option>
          </select>
        {/if}
      </div>

      <div class="field">
        <span class="label">Groups will be created from categories</span>
        <div class="category-preview">
          {#each categoriesInSelection as c (c.slug)}
            <span class="cat-chip">
              <Icon icon={c.icon} width="16" />
              <span>{c.label}</span>
              <span class="cat-count">{c.count}</span>
            </span>
          {/each}
          {#if categoriesInSelection.length === 0}
            <span class="muted">No results selected.</span>
          {/if}
        </div>
        <div class="hint">
          Each unique category becomes one group in the target tab. If a
          group with that name already exists there, the tiles are added
          to it. Change a result's category in the table to move it
          between groups.
        </div>
      </div>

      <div class="modal-actions">
        <Button variant="secondary" onclick={() => (showPromote = false)}>Cancel</Button>
        <Button
          variant="primary"
          icon="mdi:check-bold"
          disabled={promoting || !promoteCanSubmit()}
          onclick={doPromote}
        >
          {promoting ? 'Promoting…' : 'Promote'}
        </Button>
      </div>
    </div>
  </div>
{/if}

{#if bootstrapSeed}
  <DetectorEditModal
    detector={bootstrapSeed}
    onSave={handleBootstrapSave}
    onCancel={() => (bootstrapSeed = null)}
  />
{/if}

<style>
  .page {
    max-width: 1180px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    color: var(--text-primary);
  }
  .header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .title-row { display: flex; gap: 0.75rem; align-items: flex-start; }
  .title-row h1 { margin: 0; font-size: 1.5rem; }
  .sub { color: var(--text-secondary); font-size: 0.9rem; margin-top: 0.2rem; }
  .back {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    color: var(--text-primary);
    padding: 0.4rem 0.55rem;
    cursor: pointer;
    margin-top: 0.15rem;
  }
  .back:hover { background: var(--bg-tertiary); }
  .header-actions { display: flex; gap: 0.5rem; }

  .muted { color: var(--text-secondary); }
  .small { font-size: 0.8rem; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .error {
    background: rgba(239,68,68,0.1);
    border: 1px solid rgba(239,68,68,0.3);
    color: #ef4444;
    border-radius: 0.4rem;
    padding: 0.6rem 0.8rem;
    margin-bottom: 1rem;
  }
  .note {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    padding: 0.6rem 0.8rem;
    margin-bottom: 1rem;
    color: var(--text-secondary);
  }
  .empty {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--text-secondary);
    border: 1px dashed var(--border);
    border-radius: 0.6rem;
    margin-top: 1rem;
  }
  .empty p { margin-top: 0.5rem; }

  .progress {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.8rem 1rem;
    margin-bottom: 1.2rem;
  }
  .progress-label { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; }
  .recent {
    color: var(--text-secondary);
    font-size: 0.82rem;
    margin: 0 0 0.5rem 1rem;
    opacity: 0.85;
  }
  .phase {
    color: var(--text-secondary);
    font-size: 0.88rem;
    margin: 0.25rem 0 0.4rem 1rem;
    font-style: italic;
  }
  .warnings {
    background: rgba(245, 158, 11, 0.08);
    border: 1px solid rgba(245, 158, 11, 0.4);
    color: var(--text-primary);
    border-radius: 0.4rem;
    padding: 0.6rem 0.9rem;
    margin: 0 0 1rem;
  }
  .warnings-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: #f59e0b;
    font-weight: 600;
    font-size: 0.9rem;
    margin-bottom: 0.3rem;
  }
  .warnings ul { margin: 0; padding-left: 1.4rem; font-size: 0.88rem; }
  .warnings li { margin: 0.15rem 0; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .dot-running { background: #4f8cff; animation: pulse 1.2s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  .bar {
    width: 100%;
    height: 6px;
    background: var(--bg-tertiary);
    border-radius: 999px;
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    background: #4f8cff;
    transition: width 0.3s ease;
  }

  .curate-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin: 1rem 0;
  }
  .bulk { display: flex; align-items: center; gap: 0.4rem; }
  .bulk button {
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    padding: 0.35rem 0.7rem;
    cursor: pointer;
    font-size: 0.88rem;
  }
  .bulk button:hover { background: var(--bg-tertiary); }

  table.results {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    overflow: hidden;
  }
  table.results th, table.results td {
    text-align: left;
    padding: 0.55rem 0.8rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.95rem;
    vertical-align: top;
  }
  table.results thead th { background: var(--bg-tertiary); font-weight: 600; }
  table.results tbody tr:last-child td { border-bottom: none; }
  table.results tr.selected { background: rgba(79,140,255,0.05); }
  .check-col { width: 1%; }
  .icon-col { width: 1%; }
  .open-col { width: 1%; }
  .icon-cell { padding: 0.4rem 0.5rem; vertical-align: middle; }
  .icon-cell .row-icon {
    width: 28px;
    height: 28px;
    object-fit: contain;
    display: block;
  }
  .icon-cell :global(.muted-icon) { color: var(--text-secondary); opacity: 0.6; }
  .open-cell { vertical-align: middle; }
  .open-link {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.4rem;
    color: var(--text-secondary);
    border-radius: 0.3rem;
  }
  .open-link:hover { background: var(--bg-tertiary); color: var(--text-primary); }
  .copy-btn {
    background: transparent;
    border: 0;
    cursor: pointer;
    font: inherit;
  }

  .inline-input {
    width: 100%;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0.3rem;
    padding: 0.2rem 0.4rem;
    color: var(--text-primary);
    font-size: 0.95rem;
  }
  .inline-input:hover:not(:disabled) { border-color: var(--border); }
  .inline-input:focus { border-color: var(--accent, #4f8cff); outline: none; background: var(--bg-tertiary); }

  .conf {
    display: inline-block;
    font-size: 0.78rem;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-weight: 600;
  }
  .conf-high   { background: rgba(34,197,94,0.15);  color: #22c55e; }
  .conf-medium { background: rgba(245,158,11,0.15); color: #f59e0b; }
  .conf-low    { background: var(--bg-tertiary); color: var(--text-secondary); }
  .conf-promoted { background: rgba(168,85,247,0.15); color: #a855f7; }

  .cat-cell { vertical-align: middle; }
  .cat-select {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 0.3rem;
    padding: 0.2rem 0.4rem;
    font-size: 0.88rem;
    max-width: 9rem;
  }
  .cat-select:focus { outline: none; border-color: var(--accent, #4f8cff); }
  .cat-static {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--text-secondary);
    font-size: 0.88rem;
  }

  .category-preview {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--bg-secondary);
    min-height: 2.2rem;
    align-items: center;
  }
  .cat-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.2rem 0.6rem 0.2rem 0.55rem;
    font-size: 0.85rem;
  }
  .cat-count {
    background: var(--accent, #4f8cff);
    color: white;
    border-radius: 999px;
    padding: 0 0.45rem;
    font-size: 0.78rem;
    font-weight: 600;
    min-width: 1.2rem;
    text-align: center;
  }

  /* Promoted rows fade slightly to signal "this one's done"; the icon in
     the checkbox cell takes the row's accent so it doesn't look ticked. */
  table.results tr.promoted { background: rgba(168,85,247,0.04); }
  table.results tr.promoted td { color: var(--text-secondary); }
  table.results tr.promoted :global(.promoted-icon) { color: #a855f7; }
  table.results tr.promoted .inline-input:disabled {
    color: var(--text-secondary);
    cursor: not-allowed;
  }

  /* Modal */
  .modal-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.55);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
  }
  .modal {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    padding: 1.2rem 1.4rem;
    width: 100%;
    max-width: 460px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.4);
  }
  .modal h2 { margin: 0 0 0.4rem; font-size: 1.2rem; }
  .modal .field { display: flex; flex-direction: column; gap: 0.3rem; margin-top: 0.9rem; }
  .modal .field label { font-weight: 600; font-size: 0.88rem; }
  .modal .field select,
  .modal .field input[type="text"] {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    padding: 0.45rem 0.6rem;
    font-size: 0.95rem;
  }
  .modal .hint {
    color: var(--text-secondary);
    font-size: 0.8rem;
    margin-top: 0.1rem;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1.2rem;
  }
</style>
