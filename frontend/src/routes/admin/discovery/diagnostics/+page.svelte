<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import { isAuthenticated, waitForAuthChecked } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import {
    getDiagnostics, createDetector,
    type DiscoveryResult, type DiscoveryDetector,
    type DiscoveryDetectorInput, type DiscoveryCategory,
    type DetectionSummaryEntry,
  } from '$lib/utils/api';
  import DetectorEditModal from '$lib/components/admin/DetectorEditModal.svelte';

  let unidentified = $state<DiscoveryResult[]>([]);
  let summary = $state<DetectionSummaryEntry[]>([]);
  let loading = $state(true);
  let loadError = $state('');
  let bootstrapSeed = $state<DiscoveryDetector | null>(null);

  const totalDetections = $derived(summary.reduce((sum, s) => sum + s.count, 0));
  const distinctDetectors = $derived(summary.length);

  onMount(async () => {
    await waitForAuthChecked();
    if (!$isAuthenticated) {
      goto('/');
      return;
    }
    await refresh();
  });

  async function refresh() {
    loading = true;
    loadError = '';
    try {
      const resp = await getDiagnostics();
      unidentified = resp?.unidentified ?? [];
      summary = resp?.summary ?? [];
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load diagnostics';
    } finally {
      loading = false;
    }
  }

  // Seed the detector form from a row. Same shape as the bootstrap
  // affordance on the curate UI — but here the rows come from EVERY
  // past scan, so it doubles as "things I've seen on my network but
  // HOPS doesn't recognize yet, anywhere I've scanned".
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
      toast.success(`Detector created — "${input.name}" will be recognized on the next scan`);
      // Don't refresh the diagnostics list — the new detector won't
      // affect already-saved rows. Admin re-scans to see it in action.
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    }
  }

  function faviconURL(r: DiscoveryResult): string {
    const fp = (r.rawFingerprint ?? {}) as Record<string, unknown>;
    return typeof fp.favicon_data_url === 'string' ? fp.favicon_data_url : '';
  }

  function serverHeader(r: DiscoveryResult): string {
    const fp = (r.rawFingerprint ?? {}) as Record<string, unknown>;
    return typeof fp.server === 'string' ? fp.server : '';
  }

  function httpStatus(r: DiscoveryResult): string {
    const fp = (r.rawFingerprint ?? {}) as Record<string, unknown>;
    const s = fp.httpStatus;
    return typeof s === 'number' ? String(s) : '';
  }

  function faviconHash(r: DiscoveryResult): string {
    const fp = (r.rawFingerprint ?? {}) as Record<string, unknown>;
    const h = fp.favicon_mmh3;
    return typeof h === 'number' ? String(h) : '';
  }

  function fmtTime(ts?: string): string {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString();
  }
</script>

<svelte:head>
  <title>Discovery diagnostics — HOPS</title>
</svelte:head>

<div class="page">
  <header class="header">
    <div class="title-row">
      <Button variant="ghost" icon="mdi:arrow-left" onclick={() => goto('/admin/discovery')} ariaLabel="Back to Discovery" />
      <h1>Discovery diagnostics</h1>
    </div>
  </header>

  <p class="lede">
    Two things to see here. <b>Detection summary</b> shows which detectors
    have fired across all your scans — useful for sanity-checking that
    HOPS is recognizing what you expect. <b>Unidentified services</b>
    shows HTTP responders no specific detector matched — each row is a
    promotion candidate; click <b>+ Create detector</b> to bootstrap a
    new detector from what HOPS saw.
  </p>
  <p class="lede-aside">
    <b>A note about titles:</b> some services (Uptime Kuma is the classic)
    send you on to a different page when you visit the bare address.
    HOPS follows those redirects so the title you see below is from the
    page the service actually lands on — not whatever sat at the original
    URL. So a row labelled "Dashboard" might be a service whose home page
    is one redirect away.
  </p>

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if loadError}
    <div class="error">{loadError}</div>
  {:else}
    <!-- Section 1: Detection summary -->
    <section class="section">
      <h2>Detection summary</h2>
      {#if summary.length === 0}
        <div class="empty-state">
          <Icon icon="mdi:radar" width="48" />
          <p>No scan results yet. Run a scan to populate this view.</p>
        </div>
      {:else}
        <p class="count">
          {totalDetections.toLocaleString()} total detection{totalDetections === 1 ? '' : 's'}
          across {distinctDetectors} distinct detector{distinctDetectors === 1 ? '' : 's'}.
        </p>
        <div class="table-scroll"><table class="data-table summary">
          <thead>
            <tr>
              <th>Detector</th>
              <th>Detections</th>
              <th>Distinct hosts</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {#each summary as s (s.detectorId)}
              <tr>
                <td class="mono">{s.detectorId}</td>
                <td class="num">{s.count.toLocaleString()}</td>
                <td class="num">{s.distinctHosts.toLocaleString()}</td>
                <td class="muted small">{fmtTime(s.lastSeen)}</td>
              </tr>
            {/each}
          </tbody>
        </table></div>
      {/if}
    </section>

    <!-- Section 2: Unidentified services -->
    <section class="section">
      <h2>Unidentified services</h2>
      {#if unidentified.length === 0}
        <div class="empty-state">
          <Icon icon="mdi:check-circle-outline" width="48" />
          <p>
            Every HTTP service in your past scans matched a specific detector.
            This view will fill up if a future scan finds an app HOPS doesn't
            yet recognize — that's where you'd promote it into a new detector.
          </p>
        </div>
      {:else}
        <p class="count">{unidentified.length} unidentified service{unidentified.length === 1 ? '' : 's'} across all scans.</p>
        <div class="table-scroll"><table class="data-table diag">
      <thead>
        <tr>
          <th>Icon</th>
          <th>Host</th>
          <th>Port</th>
          <th>Title / suggested name</th>
          <th>Server</th>
          <th>HTTP</th>
          <th>Last seen</th>
          <th class="actions-col"></th>
        </tr>
      </thead>
      <tbody>
        {#each unidentified as r (r.id)}
          <tr>
            <td class="icon-cell">
              {#if faviconURL(r)}
                <img src={faviconURL(r)} alt="" width="22" height="22" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
              {:else}
                <Icon icon="mdi:help-circle-outline" width="22" />
              {/if}
            </td>
            <td>
              <div class="mono">{r.host}</div>
              {#if r.hostname}
                <div class="hostname mono">{r.hostname}</div>
              {/if}
            </td>
            <td class="mono">{r.port}</td>
            <td>{r.suggestedName || '—'}</td>
            <td class="mono small">{serverHeader(r) || '—'}</td>
            <td class="mono small">{httpStatus(r) || '—'}</td>
            <td class="muted small">{fmtTime(r.createdAt)}</td>
            <td class="actions">
              <button class="action primary" onclick={() => (bootstrapSeed = seedFromResult(r))} title="Create a detector from this row">
                <Icon icon="mdi:plus-circle-outline" width="16" />
                <span>Create detector</span>
              </button>
              {#if faviconHash(r)}
                <span class="hash mono" title="Favicon MMH3 hash — use as a signature in a custom detector">
                  hash: {faviconHash(r)}
                </span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table></div>
      {/if}
    </section>
  {/if}
</div>

{#if bootstrapSeed}
  <DetectorEditModal
    detector={bootstrapSeed}
    onSave={handleBootstrapSave}
    onCancel={() => (bootstrapSeed = null)}
  />
{/if}

<style>
  .page {
    max-width: 1300px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    color: var(--text-primary);
  }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; gap: 1rem; }
  .title-row { display: flex; align-items: center; gap: 0.75rem; }
  .title-row h1 { margin: 0; font-size: var(--font-h1); }
  /* .lede ships from app.css */
  .muted { color: var(--text-secondary); }
  .small { font-size: 0.82rem; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .hostname { color: var(--text-secondary); font-size: 0.8rem; }
  .count { color: var(--text-secondary); margin: 0 0 0.5rem; font-size: 0.9rem; }

  .error { background: var(--bg-tertiary); border: 1px solid var(--color-error, #b00); border-radius: var(--radius-md); padding: 0.8rem 1rem; }

  .section { margin-bottom: 2rem; }
  .section h2 { font-size: var(--font-h2); margin: 0 0 0.5rem; }

  /* table.summary and table.diag chrome ship from .data-table in app.css.
     Only the size-specific tweaks remain. */
  table.summary th, table.summary td { padding: var(--space-2) var(--space-3); font-size: 0.9rem; }
  table.diag th, table.diag td { padding: 0.6rem var(--space-3); font-size: 0.9rem; vertical-align: middle; }
  .num { font-variant-numeric: tabular-nums; }

  .icon-cell { width: 36px; text-align: center; }
  .actions-col { width: 1%; white-space: nowrap; }
  .actions { display: flex; gap: 0.5rem; align-items: center; }
  .action {
    background: transparent; border: 1px solid var(--border);
    border-radius: var(--radius-md); padding: 0.3rem 0.6rem;
    color: var(--text-primary); cursor: pointer;
    display: inline-flex; align-items: center; gap: 0.3rem;
    font-size: 0.85rem;
  }
  .action:hover { background: var(--bg-tertiary); }
  .action.primary {
    background: rgba(79,140,255,0.15);
    border-color: rgba(79,140,255,0.35);
    color: var(--accent);
  }
  .action.primary:hover { background: rgba(79,140,255,0.25); }
  .hash { font-size: 0.72rem; color: var(--text-secondary); }
</style>
