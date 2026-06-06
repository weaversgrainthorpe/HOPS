<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import { isAuthenticated, waitForAuthChecked } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import { confirm } from '$lib/stores/confirmModal';
  import {
    listDetectors, createDetector, updateDetector, deleteDetector,
    resetAllOverrides,
    CATEGORY_LIST,
    type DiscoveryDetector, type DiscoveryDetectorInput, type DiscoveryCategory,
  } from '$lib/utils/api';
  import DetectorEditModal from '$lib/components/admin/DetectorEditModal.svelte';

  let detectors = $state<DiscoveryDetector[]>([]);
  let loading = $state(true);
  let loadError = $state('');
  let filter = $state<'all' | 'bundled' | 'user'>('all');
  let editing = $state<DiscoveryDetector | null>(null);
  let creating = $state(false);

  type SortKey = 'name' | 'category' | 'ports' | 'source';
  let sortKey = $state<SortKey>('name');
  let sortAsc = $state(true);

  function sortBy(key: SortKey) {
    if (sortKey === key) {
      sortAsc = !sortAsc;
    } else {
      sortKey = key;
      sortAsc = true;
    }
  }

  function sortValue(d: DiscoveryDetector, key: SortKey): string | number {
    switch (key) {
      case 'name': return d.name.toLowerCase();
      case 'category': return d.category;
      case 'ports': return d.ports[0] ?? 0;
      case 'source':
        // bundled-unmodified < bundled-modified < user — gives a natural grouping.
        if (d.source === 'user') return 2;
        return d.overridden ? 1 : 0;
    }
  }

  const filtered = $derived(
    (filter === 'all' ? detectors : detectors.filter((d) => d.source === filter))
      .slice()
      .sort((a, b) => {
        const av = sortValue(a, sortKey);
        const bv = sortValue(b, sortKey);
        if (av < bv) return sortAsc ? -1 : 1;
        if (av > bv) return sortAsc ? 1 : -1;
        // Tiebreak by name ascending for stable, predictable order.
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      })
  );

  const counts = $derived({
    all: detectors.length,
    bundled: detectors.filter((d) => d.source === 'bundled').length,
    user: detectors.filter((d) => d.source === 'user').length,
  });

  const overrideCount = $derived(detectors.filter((d) => d.overridden).length);

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
      const resp = await listDetectors();
      // Defensive normalisation: each detector's array fields must be
      // arrays (not null/undefined) so downstream `.length` access
      // doesn't crash. Belt-and-braces alongside the backend's
      // nil-to-empty fix.
      detectors = (resp?.detectors ?? []).map((d) => ({
        ...d,
        ports: d.ports ?? [],
        paths: d.paths ?? [],
        bodyContains: d.bodyContains ?? [],
        titleContains: d.titleContains ?? [],
        headerKeys: d.headerKeys ?? [],
      }));
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load detectors';
      console.error('listDetectors failed:', e);
    } finally {
      loading = false;
    }
  }

  async function handleToggle(d: DiscoveryDetector) {
    if (d.source !== 'user') return;
    // Toggle is implemented as a PATCH with enabled flipped.
    const input: DiscoveryDetectorInput = wireInputFromDetector(d);
    input.enabled = !d.enabled;
    try {
      await updateDetector(d.id, input);
      d.enabled = !d.enabled;
      toast.success(d.enabled ? 'Detector enabled' : 'Detector disabled');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Toggle failed');
    }
  }

  async function handleDelete(d: DiscoveryDetector) {
    if (d.source !== 'user') return;
    const ok = await confirm({
      title: `Delete detector "${d.name}"?`,
      message: 'Existing scan results that already used this detector stay intact — only new scans are affected.',
      confirmText: 'Delete',
      confirmStyle: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDetector(d.id);
      detectors = detectors.filter((x) => x.id !== d.id);
      toast.success('Detector deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  // Reset one bundled detector to its shipped defaults by deleting
  // the override row. The bundled definition then takes over on the
  // next scan. We refresh after so the UI shows the original fields.
  async function handleResetOverride(d: DiscoveryDetector) {
    if (d.source !== 'bundled' || !d.overridden) return;
    const ok = await confirm({
      title: `Reset "${d.name}" to defaults?`,
      message: 'Your changes to this detector will be discarded.',
      confirmText: 'Reset',
      confirmStyle: 'warning',
    });
    if (!ok) return;
    try {
      await deleteDetector(d.id);
      await refresh();
      toast.success(`"${d.name}" reset to bundled defaults`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reset failed');
    }
  }

  // Bulk reset every bundled override. Leaves user/ customs alone.
  async function handleResetAll() {
    if (overrideCount === 0) return;
    const ok = await confirm({
      title: `Reset all ${overrideCount} customisation${overrideCount === 1 ? '' : 's'}?`,
      message: 'Every bundled detector you have customised will go back to its shipped defaults. Your own detectors are untouched.',
      confirmText: 'Reset all',
      confirmStyle: 'warning',
    });
    if (!ok) return;
    try {
      const { resetCount } = await resetAllOverrides();
      await refresh();
      toast.success(`${resetCount} customization${resetCount === 1 ? '' : 's'} reset`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reset failed');
    }
  }

  function openCreate() {
    creating = true;
    editing = null;
  }

  // openEdit handles all three "open the form" cases:
  //   - user detector — edit existing user row
  //   - bundled with override — edit the existing override row
  //   - bundled without override — customize: form pre-populated with
  //     the bundled fields, save creates a new override row
  function openEdit(d: DiscoveryDetector) {
    editing = d;
    creating = false;
  }

  // Save dispatches based on the editing target:
  //   - editing user detector (id starts with user/) → PATCH /detectors/<id>
  //   - editing bundled override → PATCH /detectors/<id> (id is bundled ID)
  //   - first-time customize of bundled → PATCH /detectors/<id> (server upserts)
  //   - creating a brand-new user detector (no editing) → POST /detectors
  async function handleSave(input: DiscoveryDetectorInput) {
    try {
      if (editing) {
        // PATCH against the existing or to-be-overridden ID.
        const updated = await updateDetector(editing.id, input);
        await refresh(); // re-pull so source/overridden flags refresh
        toast.success(editing.source === 'bundled' ? 'Customization saved' : 'Detector saved');
        void updated;
      } else {
        const created = await createDetector(input);
        detectors = [...detectors, created];
        toast.success('Detector created');
      }
      editing = null;
      creating = false;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  }

  function categoryLabel(slug: DiscoveryCategory): string {
    return CATEGORY_LIST.find((c) => c.slug === slug)?.label ?? slug;
  }

  function wireInputFromDetector(d: DiscoveryDetector): DiscoveryDetectorInput {
    return {
      name: d.name,
      icon: d.icon,
      category: d.category,
      description: d.description,
      ports: d.ports,
      paths: d.paths,
      urlPath: d.urlPath,
      bodyContains: d.bodyContains,
      titleContains: d.titleContains,
      headerKeys: d.headerKeys,
      confidence: d.confidence,
      enabled: d.enabled,
    };
  }

  // Compact summary of the match grammar for the list row — e.g.
  // "title × 1, body × 3, header × 1".
  function signatureSummary(d: DiscoveryDetector): string {
    const parts: string[] = [];
    if (d.titleContains.length > 0) parts.push(`title × ${d.titleContains.length}`);
    if (d.bodyContains.length > 0) parts.push(`body × ${d.bodyContains.length}`);
    if (d.headerKeys.length > 0) parts.push(`header × ${d.headerKeys.length}`);
    if ((d.faviconHashes?.length ?? 0) > 0) parts.push(`favicon × ${d.faviconHashes.length}`);
    return parts.join(', ') || '—';
  }

  function portsSummary(ports: number[]): string {
    if (ports.length === 0) return '—';
    if (ports.length <= 4) return ports.join(', ');
    return `${ports.slice(0, 4).join(', ')}, +${ports.length - 4}`;
  }
</script>

<svelte:head>
  <title>Discovery detectors — HOPS</title>
</svelte:head>

<div class="page">
  <header class="header">
    <div class="title-row">
      <Button variant="ghost" icon="mdi:arrow-left" onclick={() => goto('/admin/discovery')} ariaLabel="Back to Discovery" />
      <h1>Discovery detectors</h1>
    </div>
    <div class="header-actions">
      {#if overrideCount > 0}
        <Button variant="secondary" icon="mdi:restart" onclick={handleResetAll}>
          Reset all customizations ({overrideCount})
        </Button>
      {/if}
      <Button variant="primary" icon="mdi:plus" onclick={openCreate}>
        Add detector
      </Button>
    </div>
  </header>

  <p class="lede">
    HOPS comes with detectors for ~70 common homelab services. You can
    tweak any of them, and any tweak you make can be undone in one click
    ("reset to bundled"). Add your own to recognise things HOPS doesn't
    ship support for yet. Changes apply to the <em>next</em> scan you
    start — if a scan is already running, let it finish (or cancel it)
    first.
  </p>

  <div class="filter-bar">
    <button class:active={filter === 'all'} onclick={() => (filter = 'all')}>
      All ({counts.all})
    </button>
    <button class:active={filter === 'bundled'} onclick={() => (filter = 'bundled')}>
      Bundled ({counts.bundled})
    </button>
    <button class:active={filter === 'user'} onclick={() => (filter = 'user')}>
      User ({counts.user})
    </button>
  </div>

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if loadError}
    <div class="error">{loadError}</div>
  {:else if filtered.length === 0}
    <div class="empty-state">
      <Icon icon="mdi:radar-scan" width="48" />
      {#if filter === 'user'}
        <p>No user detectors yet. Press <b>Add detector</b> to define one.</p>
      {:else}
        <p>No detectors in this view.</p>
      {/if}
    </div>
  {:else}
    <div class="table-scroll"><table class="data-table detectors">
      <thead>
        <tr>
          <th>Icon</th>
          <th class="sortable">
            <button type="button" onclick={() => sortBy('name')}>
              Name {#if sortKey === 'name'}<span class="arrow">{sortAsc ? '▲' : '▼'}</span>{/if}
            </button>
          </th>
          <th class="sortable">
            <button type="button" onclick={() => sortBy('category')}>
              Category {#if sortKey === 'category'}<span class="arrow">{sortAsc ? '▲' : '▼'}</span>{/if}
            </button>
          </th>
          <th class="sortable">
            <button type="button" onclick={() => sortBy('ports')}>
              Ports {#if sortKey === 'ports'}<span class="arrow">{sortAsc ? '▲' : '▼'}</span>{/if}
            </button>
          </th>
          <th>Match signatures</th>
          <th class="sortable">
            <button type="button" onclick={() => sortBy('source')}>
              Source {#if sortKey === 'source'}<span class="arrow">{sortAsc ? '▲' : '▼'}</span>{/if}
            </button>
          </th>
          <th class="actions-col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as d (d.id)}
          <tr class:disabled={!d.enabled && d.source === 'user'}>
            <td class="icon-cell">
              {#if !d.icon}
                <Icon icon="mdi:radar" width="22" />
              {:else if d.icon.startsWith('/') || d.icon.startsWith('http')}
                <img src={d.icon} alt="" width="22" height="22" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
              {:else if d.icon.includes(':')}
                <Icon icon={d.icon} width="22" />
              {:else}
                <img src="/api/icons/dashboard/{d.icon}.svg" alt="" width="22" height="22" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
              {/if}
            </td>
            <td>
              <div class="name">{d.name}</div>
              {#if d.description}
                <div class="desc">{d.description}</div>
              {/if}
            </td>
            <td>{categoryLabel(d.category)}</td>
            <td class="mono">{portsSummary(d.ports)}</td>
            <td class="muted">{signatureSummary(d)}</td>
            <td>
              <span class="badge badge--{d.source === 'user' ? 'success' : 'info'}">{d.source}</span>
              {#if d.source === 'bundled' && d.overridden}
                <span class="badge badge--warning badge--pill" title="You've customized this bundled detector">modified</span>
              {/if}
              {#if d.source === 'user' && !d.enabled}
                <span class="badge badge--neutral badge--pill">disabled</span>
              {/if}
            </td>
            <td class="actions">
              {#if d.source === 'user'}
                <button class="action" onclick={() => handleToggle(d)} title={d.enabled ? 'Disable' : 'Enable'} aria-label={(d.enabled ? 'Disable detector ' : 'Enable detector ') + d.name}>
                  <Icon icon={d.enabled ? 'mdi:eye' : 'mdi:eye-off'} width="18" />
                </button>
                <button class="action" onclick={() => openEdit(d)} title="Edit" aria-label="Edit detector {d.name}">
                  <Icon icon="mdi:pencil" width="18" />
                </button>
                <button class="action danger" onclick={() => handleDelete(d)} title="Delete" aria-label="Delete detector {d.name}">
                  <Icon icon="mdi:trash-can" width="18" />
                </button>
              {:else if d.overridden}
                <button class="action" onclick={() => openEdit(d)} aria-label="Edit {d.name}" title="Edit">
                  <Icon icon="mdi:pencil" width="18" />
                </button>
                <button class="action" onclick={() => handleResetOverride(d)} aria-label="Reset {d.name} to bundled defaults" title="Reset to bundled defaults">
                  <Icon icon="mdi:restart" width="18" />
                </button>
              {:else}
                <button class="action" onclick={() => openEdit(d)} aria-label="Edit {d.name}" title="Edit">
                  <Icon icon="mdi:tune" width="18" />
                </button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table></div>
  {/if}
</div>

{#if creating || editing}
  <DetectorEditModal
    detector={editing}
    onSave={handleSave}
    onCancel={() => { creating = false; editing = null; }}
  />
{/if}

<style>
  .page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    color: var(--text-primary);
  }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 1rem; gap: 1rem;
  }
  .header-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .title-row { display: flex; align-items: center; gap: 0.75rem; }
  .title-row h1 { margin: 0; font-size: var(--font-h1); }
  /* .lede ships from app.css */
  .muted { color: var(--text-secondary); }
  .muted.small { font-size: 0.82rem; }

  .filter-bar { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
  .filter-bar button {
    background: var(--bg-secondary); color: var(--text-primary);
    border: 1px solid var(--border); border-radius: var(--radius-md);
    padding: 0.35rem 0.9rem; font-size: 0.9rem; cursor: pointer;
  }
  .filter-bar button:hover { background: var(--bg-tertiary); }
  .filter-bar button.active { background: var(--bg-tertiary); border-color: var(--text-primary); }

  .error { background: var(--bg-tertiary); border: 1px solid var(--color-error, #b00); border-radius: var(--radius-md); padding: 0.8rem 1rem; }

  /* table.detectors chrome ships from .data-table. Only sort-header
     + disabled-row tweaks specific to this page remain. */
  table.detectors th, table.detectors td { padding: 0.6rem var(--space-3); font-size: 0.92rem; vertical-align: middle; }
  table.detectors thead th.sortable { padding: 0; }
  table.detectors thead th.sortable button {
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    padding: 0.6rem var(--space-3);
    font: inherit;
    font-weight: 600;
    color: var(--text-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  table.detectors thead th.sortable button:hover { background: var(--bg-secondary); }
  table.detectors thead th.sortable .arrow { font-size: 0.7rem; color: var(--text-secondary); }
  table.detectors tbody tr.disabled { opacity: 0.55; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

  .icon-cell { width: 36px; text-align: center; }
  .name { font-weight: 500; }
  .desc { color: var(--text-secondary); font-size: 0.82rem; margin-top: 0.1rem; }

  /* .badge / .badge--{tone} live in app.css. The page-local "source"
     badge stays uppercase via .badge--pill applied as needed. */
  .badge { text-transform: uppercase; letter-spacing: 0.04em; }
  .badge--warning.badge--pill,
  .badge--neutral.badge--pill { margin-left: 0.3rem; }

  .actions-col { width: 1%; white-space: nowrap; }
  .actions { display: flex; gap: 0.3rem; align-items: center; }
  .action {
    background: transparent; border: 1px solid var(--border);
    border-radius: var(--radius-md); padding: 0.3rem 0.45rem;
    color: var(--text-primary); cursor: pointer;
    display: inline-flex; align-items: center;
  }
  .action:hover { background: var(--bg-tertiary); }
  .action.danger:hover { background: rgba(239,68,68,0.15); color: #ef4444; }
</style>
