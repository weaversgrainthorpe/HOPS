<script lang="ts">
  // Discovery "Promote to tiles": where the new tiles land (spec §11). Pick a
  // tab (one folder per category is created there, an existing top-level
  // folder with that category's name is reused) or any existing folder at
  // any depth (every tile goes into it), from the same tree as Move/Copy; or
  // a new tab, or a new dashboard. The server bumps the target's revision, so
  // an open edit session on it is told on Save.
  import Icon from '@iconify/svelte';
  import Modal from '../shared/Modal.svelte';
  import DestinationTree, { type TreeRow } from '../editor/DestinationTree.svelte';
  import { dashboards } from '$lib/stores/config';
  import type { PromoteTarget } from '$lib/utils/api';

  interface Category { slug: string; label: string; icon: string; count: number }
  interface Props {
    /** How many tiles will be added. */
    count: number;
    /** The categories in the selection (with counts), for the preview. */
    categories: Category[];
    busy: boolean;
    onSubmit: (target: PromoteTarget) => void;
    onCancel: () => void;
  }
  let { count, categories, busy, onSubmit, onCancel }: Props = $props();

  type Mode = 'existing' | 'new-tab' | 'new-dashboard';
  let mode = $state<Mode>('existing');
  let chosen = $state('');
  let dest = $state<TreeRow | undefined>(undefined);
  let gone = $state(false);
  let tabDashId = $state('');
  let newTabName = $state('');
  let newDashName = $state('');

  // Dashboards are only containers of tabs here; tabs and folders are targets.
  function annotate(r: TreeRow) {
    if (r.kind === 'dashboard') r.selectable = false;
  }

  const tiles = $derived(count === 1 ? '1 tile' : `${count} tiles`);
  const tabDash = $derived(tabDashId || $dashboards[0]?.id || '');

  const target = $derived.by((): PromoteTarget | null => {
    if (mode === 'existing') {
      if (!dest || !dest.tabId) return null;
      return dest.folderId
        ? { dashboardId: dest.dashboardId, tabId: dest.tabId, folderId: dest.folderId }
        : { dashboardId: dest.dashboardId, tabId: dest.tabId };
    }
    if (!newTabName.trim()) return null;
    if (mode === 'new-tab') return tabDash ? { dashboardId: tabDash, newTab: { name: newTabName.trim() } } : null;
    return newDashName.trim() ? { newDashboard: { name: newDashName.trim() }, newTab: { name: newTabName.trim() } } : null;
  });

  function submit() {
    if (target && !busy) onSubmit(target);
  }
</script>

<Modal id="promote" title={`Promote ${tiles}`} titleIcon="mdi:arrow-up-bold-box" onClose={onCancel} maxWidth="560px">
  <div class="body">
    <fieldset class="where">
      <legend>Where should the tiles go?</legend>
      <label><input type="radio" name="promote-mode" value="existing" bind:group={mode} /> A tab or folder</label>
      <label><input type="radio" name="promote-mode" value="new-tab" bind:group={mode} /> A new tab on an existing dashboard</label>
      <label><input type="radio" name="promote-mode" value="new-dashboard" bind:group={mode} /> A new dashboard</label>
    </fieldset>

    {#if mode === 'existing'}
      <span class="lbl" id="promote-tree-lbl">Destination</span>
      {#if $dashboards.length === 0}
        <p class="why" role="status">There are no dashboards yet — choose "A new dashboard".</p>
      {:else}
        <DestinationTree
          dashboards={$dashboards}
          {annotate}
          labelledby="promote-tree-lbl"
          idPrefix="promote"
          bind:chosen
          bind:selected={dest}
          bind:gone
        />
      {/if}
      {#if gone}
        <p class="why" role="status">That destination no longer exists. Choose another.</p>
      {/if}
    {:else}
      {#if mode === 'new-tab'}
        <div class="field">
          <label for="promote-dash">Dashboard</label>
          <select id="promote-dash" value={tabDash} onchange={(e) => (tabDashId = (e.currentTarget as HTMLSelectElement).value)}>
            {#each $dashboards as d (d.id)}
              <option value={d.id}>{d.name || d.path}</option>
            {/each}
          </select>
        </div>
      {:else}
        <div class="field">
          <label for="promote-new-dash">New dashboard name</label>
          <input id="promote-new-dash" type="text" placeholder="e.g. Media" bind:value={newDashName} autocomplete="off" />
          <span class="hint">A URL path is made from the name.</span>
        </div>
      {/if}
      <div class="field">
        <label for="promote-new-tab">New tab name</label>
        <input id="promote-new-tab" type="text" bind:value={newTabName} autocomplete="off" />
      </div>
    {/if}

    <div class="preview">
      {#if mode === 'existing' && dest?.folderId}
        <p>All {tiles} go into the folder “{dest.label}”.</p>
      {:else}
        <p>Each category becomes a folder in the tab (a top-level folder with that name is reused):</p>
        <div class="chips">
          {#each categories as c (c.slug)}
            <span class="chip"><Icon icon={c.icon} width="16" /><span>{c.label}</span><span class="n">{c.count}</span></span>
          {/each}
        </div>
      {/if}
    </div>
  </div>
  {#snippet footer()}
    <div class="actions">
      <button type="button" class="btn-secondary" onclick={onCancel}>Cancel</button>
      <button type="button" class="btn-primary" disabled={!target || busy} onclick={submit}>
        <Icon icon="mdi:check-bold" width="18" />{busy ? 'Promoting…' : 'Promote'}
      </button>
    </div>
  {/snippet}
</Modal>

<style>
  .body { display: flex; flex-direction: column; gap: 0.75rem; }
  .where { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .where legend { font-weight: 500; font-size: 0.875rem; margin-bottom: 0.25rem; }
  .where label { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.9rem; cursor: pointer; }
  .lbl { font-weight: 500; font-size: 0.875rem; }
  .field { display: flex; flex-direction: column; gap: 0.3rem; }
  .field label { font-weight: 500; font-size: 0.875rem; }
  .field input, .field select {
    padding: 0.5rem 0.75rem; border: 1px solid var(--border); border-radius: 0.375rem;
    background: var(--bg-secondary); color: var(--text-primary); font-size: 0.9rem;
  }
  .hint { font-size: 0.8rem; color: var(--text-secondary); }
  .why { margin: 0; color: var(--color-warning, #d97706); font-size: 0.85rem; }
  .preview p { margin: 0 0 0.4rem; color: var(--text-secondary); font-size: 0.85rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .chip {
    display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.2rem 0.55rem;
    border: 1px solid var(--border); border-radius: 999px; font-size: 0.8rem;
  }
  .chip .n { color: var(--text-secondary); }
  .actions { display: flex; justify-content: flex-end; gap: 0.5rem; width: 100%; }
  .actions button { display: inline-flex; align-items: center; gap: 0.35rem; }
</style>
