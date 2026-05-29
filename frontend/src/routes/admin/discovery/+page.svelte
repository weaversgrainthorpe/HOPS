<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import { isAuthenticated, waitForAuthChecked } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import {
    listScans, deleteScan, cancelScan,
    type DiscoveryScan, type ScanState,
  } from '$lib/utils/api';

  let scans = $state<DiscoveryScan[]>([]);
  let loading = $state(true);
  let loadError = $state('');

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
      const { scans: list } = await listScans();
      scans = list;
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load scans';
    } finally {
      loading = false;
    }
  }

  async function handleCancel(id: string) {
    try {
      await cancelScan(id);
      toast.success('Scan cancelled');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Cancel failed');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this draft and all its results?')) return;
    try {
      await deleteScan(id);
      toast.success('Draft deleted');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  function stateBadge(state: ScanState): { label: string; class: string } {
    switch (state) {
      case 'running':  return { label: 'Running',   class: 'badge-running' };
      case 'pending':  return { label: 'Pending',   class: 'badge-pending' };
      case 'complete': return { label: 'Complete',  class: 'badge-complete' };
      case 'promoted': return { label: 'Promoted',  class: 'badge-promoted' };
      case 'cancelled':return { label: 'Cancelled', class: 'badge-cancelled' };
      case 'failed':   return { label: 'Failed',    class: 'badge-failed' };
    }
  }

  function fmtTime(ts?: string): string {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString();
  }
</script>

<svelte:head>
  <title>Network Discovery — HOPS</title>
</svelte:head>

<div class="page">
  <header class="header">
    <div class="title-row">
      <button class="back" onclick={() => goto('/')} title="Back to Admin">
        <Icon icon="mdi:arrow-left" width="20" />
      </button>
      <h1>Network Discovery</h1>
    </div>
    <div class="header-actions">
      <Button variant="secondary" icon="mdi:magnify-scan" onclick={() => goto('/admin/discovery/diagnostics')}>
        Diagnostics
      </Button>
      <Button variant="secondary" icon="mdi:radar-scan" onclick={() => goto('/admin/discovery/detectors')}>
        Manage detectors
      </Button>
      <Button variant="primary" icon="mdi:radar" onclick={() => goto('/admin/discovery/new')}>
        New Scan
      </Button>
    </div>
  </header>

  <p class="lede">
    Scan your LAN for devices and services — web apps, NAS gear, smart-home
    devices, printers, UPSes — then bulk-add the ones you want as dashboard
    tiles. Drafts persist between sessions; start a scan now, curate it later.
  </p>
  <p class="lede-aside">
    Discovery is a head-start, not a magic wand — results depend on your
    network, firewalls, host-based AV, and whether services respond to
    unauthenticated probes. Expect some false positives and some missing
    apps. Every scan is a reviewable draft you curate before any tile
    lands on a dashboard; use the <b>Diagnostics</b> view to teach HOPS
    about anything it didn't recognise.
  </p>

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if loadError}
    <div class="error">{loadError}</div>
  {:else if scans.length === 0}
    <div class="empty">
      <Icon icon="mdi:radar" width="48" />
      <p>No scans yet. Press <b>New Scan</b> to discover services on your LAN.</p>
    </div>
  {:else}
    <table class="scans">
      <thead>
        <tr>
          <th>Created</th>
          <th>Targets</th>
          <th>State</th>
          <th>Progress</th>
          <th>Label</th>
          <th class="actions-col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each scans as scan (scan.id)}
          {@const b = stateBadge(scan.state)}
          <tr>
            <td>{fmtTime(scan.createdAt)}</td>
            <td class="mono">{scan.cidr}</td>
            <td><span class="badge {b.class}">{b.label}</span></td>
            <td>
              {#if scan.progressTotal > 0}
                {scan.progressDone} / {scan.progressTotal}
              {:else}
                —
              {/if}
            </td>
            <td>{scan.label ?? ''}</td>
            <td class="actions">
              <button class="action" onclick={() => goto(`/admin/discovery/${scan.id}`)} title="Open draft">
                <Icon icon="mdi:open-in-app" width="18" />
              </button>
              {#if scan.state === 'running' || scan.state === 'pending'}
                <button class="action" onclick={() => handleCancel(scan.id)} title="Cancel scan">
                  <Icon icon="mdi:stop" width="18" />
                </button>
              {/if}
              <button class="action danger" onclick={() => handleDelete(scan.id)} title="Delete draft">
                <Icon icon="mdi:trash-can" width="18" />
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .page {
    max-width: 1080px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    color: var(--text-primary);
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
    gap: 1rem;
  }
  .header-actions { display: flex; gap: 0.5rem; }
  .title-row { display: flex; align-items: center; gap: 0.75rem; }
  .title-row h1 { margin: 0; font-size: 1.5rem; }
  .back {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    color: var(--text-primary);
    padding: 0.4rem 0.55rem;
    cursor: pointer;
  }
  .back:hover { background: var(--bg-tertiary); }
  .lede { color: var(--text-secondary); margin: 0 0 0.8rem; max-width: 70ch; }
  .lede-aside {
    color: var(--text-secondary);
    margin: 0 0 1.5rem;
    max-width: 70ch;
    font-size: 0.88rem;
    border-left: 3px solid rgba(245, 158, 11, 0.4);
    padding: 0.1rem 0 0.1rem 0.8rem;
    opacity: 0.85;
  }
  .muted { color: var(--text-secondary); }
  .error {
    background: var(--bg-tertiary);
    border: 1px solid var(--color-error, #b00);
    border-radius: 0.4rem;
    padding: 0.8rem 1rem;
  }
  .empty {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--text-secondary);
    border: 1px dashed var(--border);
    border-radius: 0.6rem;
  }
  .empty p { margin-top: 0.5rem; }

  table.scans {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    overflow: hidden;
  }
  table.scans th, table.scans td {
    text-align: left;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.95rem;
  }
  table.scans thead th { background: var(--bg-tertiary); font-weight: 600; }
  table.scans tbody tr:last-child td { border-bottom: none; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

  .badge {
    display: inline-block;
    font-size: 0.78rem;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-weight: 600;
    border: 1px solid transparent;
  }
  .badge-running   { background: rgba(79,140,255,0.15); color: #4f8cff; border-color: rgba(79,140,255,0.35); }
  .badge-pending   { background: rgba(245,158,11,0.15); color: #f59e0b; border-color: rgba(245,158,11,0.35); }
  .badge-complete  { background: rgba(34,197,94,0.15);  color: #22c55e; border-color: rgba(34,197,94,0.35); }
  .badge-promoted  { background: rgba(168,85,247,0.15); color: #a855f7; border-color: rgba(168,85,247,0.35); }
  .badge-cancelled { background: var(--bg-tertiary); color: var(--text-secondary); border-color: var(--border); }
  .badge-failed    { background: rgba(239,68,68,0.15);  color: #ef4444; border-color: rgba(239,68,68,0.35); }

  .actions-col { width: 1%; white-space: nowrap; }
  .actions { display: flex; gap: 0.35rem; }
  .action {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    padding: 0.3rem 0.45rem;
    color: var(--text-primary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
  }
  .action:hover { background: var(--bg-tertiary); }
  .action.danger:hover { background: rgba(239,68,68,0.15); color: #ef4444; }
</style>
