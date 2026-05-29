<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import { isAuthenticated } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
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
    if (!confirm(`Delete user detector "${d.name}"?\n\nExisting scan results that already used this detector stay intact; only new scans are affected.`)) return;
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
    if (!confirm(`Reset "${d.name}" to bundled defaults?\n\nYour customizations to this detector will be discarded.`)) return;
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
    if (!confirm(`Reset all ${overrideCount} customized bundled detector${overrideCount === 1 ? '' : 's'} to defaults?\n\nYour user-defined detectors are untouched.`)) return;
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
      <button class="back" onclick={() => goto('/admin/discovery')} title="Back to Discovery">
        <Icon icon="mdi:arrow-left" width="20" />
      </button>
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
    Bundled detectors ship with HOPS; you can customize any of them
    (your edits become an override that supersedes the shipped definition,
    and you can reset to bundled defaults at any time). Add your own user
    detectors to recognize services HOPS doesn't yet know about. Changes
    take effect on the <em>next</em> scan you start — an in-flight scan
    locks its detector set + port list at launch and won't pick up edits
    mid-run.
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
    <div class="empty">
      <Icon icon="mdi:radar-scan" width="48" />
      {#if filter === 'user'}
        <p>No user detectors yet. Press <b>Add detector</b> to define one.</p>
      {:else}
        <p>No detectors in this view.</p>
      {/if}
    </div>
  {:else}
    <table class="detectors">
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
              <span class="badge badge-{d.source}">{d.source}</span>
              {#if d.source === 'bundled' && d.overridden}
                <span class="badge badge-modified" title="You've customized this bundled detector">modified</span>
              {/if}
              {#if d.source === 'user' && !d.enabled}
                <span class="badge badge-disabled">disabled</span>
              {/if}
            </td>
            <td class="actions">
              {#if d.source === 'user'}
                <button class="action" onclick={() => handleToggle(d)} title={d.enabled ? 'Disable' : 'Enable'}>
                  <Icon icon={d.enabled ? 'mdi:eye' : 'mdi:eye-off'} width="18" />
                </button>
                <button class="action" onclick={() => openEdit(d)} title="Edit">
                  <Icon icon="mdi:pencil" width="18" />
                </button>
                <button class="action danger" onclick={() => handleDelete(d)} title="Delete">
                  <Icon icon="mdi:trash-can" width="18" />
                </button>
              {:else if d.overridden}
                <button class="action" onclick={() => openEdit(d)} title="Edit your override">
                  <Icon icon="mdi:pencil" width="18" />
                </button>
                <button class="action" onclick={() => handleResetOverride(d)} title="Reset to bundled defaults">
                  <Icon icon="mdi:restart" width="18" />
                </button>
              {:else}
                <button class="action" onclick={() => openEdit(d)} title="Customize this bundled detector">
                  <Icon icon="mdi:tune" width="18" />
                </button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
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
  .title-row h1 { margin: 0; font-size: 1.5rem; }
  .back {
    background: transparent; border: 1px solid var(--border);
    border-radius: 0.4rem; color: var(--text-primary);
    padding: 0.4rem 0.55rem; cursor: pointer;
  }
  .back:hover { background: var(--bg-tertiary); }
  .lede { color: var(--text-secondary); margin: 0 0 1.5rem; max-width: 80ch; }
  .muted { color: var(--text-secondary); }
  .muted.small { font-size: 0.82rem; }

  .filter-bar { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
  .filter-bar button {
    background: var(--bg-secondary); color: var(--text-primary);
    border: 1px solid var(--border); border-radius: 0.4rem;
    padding: 0.35rem 0.9rem; font-size: 0.9rem; cursor: pointer;
  }
  .filter-bar button:hover { background: var(--bg-tertiary); }
  .filter-bar button.active { background: var(--bg-tertiary); border-color: var(--text-primary); }

  .error { background: var(--bg-tertiary); border: 1px solid var(--color-error, #b00); border-radius: 0.4rem; padding: 0.8rem 1rem; }
  .empty {
    text-align: center; padding: 3rem 1rem;
    color: var(--text-secondary);
    border: 1px dashed var(--border);
    border-radius: 0.6rem;
  }
  .empty p { margin-top: 0.5rem; }

  table.detectors {
    width: 100%; border-collapse: separate; border-spacing: 0;
    background: var(--bg-secondary); border: 1px solid var(--border);
    border-radius: 0.5rem; overflow: hidden;
  }
  table.detectors th, table.detectors td {
    text-align: left; padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.92rem;
    vertical-align: middle;
  }
  table.detectors thead th { background: var(--bg-tertiary); font-weight: 600; }
  table.detectors thead th.sortable { padding: 0; }
  table.detectors thead th.sortable button {
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    padding: 0.6rem 0.9rem;
    font: inherit;
    font-weight: 600;
    color: var(--text-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  table.detectors thead th.sortable button:hover { background: var(--bg-secondary); }
  table.detectors thead th.sortable .arrow { font-size: 0.7rem; color: var(--text-secondary); }
  table.detectors tbody tr:last-child td { border-bottom: none; }
  table.detectors tbody tr.disabled { opacity: 0.55; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

  .icon-cell { width: 36px; text-align: center; }
  .name { font-weight: 500; }
  .desc { color: var(--text-secondary); font-size: 0.82rem; margin-top: 0.1rem; }

  .badge {
    display: inline-block; font-size: 0.72rem; padding: 0.1rem 0.5rem;
    border-radius: 999px; font-weight: 600; border: 1px solid transparent;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .badge-bundled { background: rgba(79,140,255,0.15); color: #4f8cff; border-color: rgba(79,140,255,0.35); }
  .badge-user    { background: rgba(34,197,94,0.15);  color: #22c55e; border-color: rgba(34,197,94,0.35); }
  .badge-modified{ background: rgba(245,158,11,0.15); color: #f59e0b; border-color: rgba(245,158,11,0.35); margin-left: 0.3rem; }
  .badge-disabled{ background: var(--bg-tertiary); color: var(--text-secondary); border-color: var(--border); margin-left: 0.3rem; }

  .actions-col { width: 1%; white-space: nowrap; }
  .actions { display: flex; gap: 0.3rem; align-items: center; }
  .action {
    background: transparent; border: 1px solid var(--border);
    border-radius: 0.35rem; padding: 0.3rem 0.45rem;
    color: var(--text-primary); cursor: pointer;
    display: inline-flex; align-items: center;
  }
  .action:hover { background: var(--bg-tertiary); }
  .action.danger:hover { background: rgba(239,68,68,0.15); color: #ef4444; }
</style>
