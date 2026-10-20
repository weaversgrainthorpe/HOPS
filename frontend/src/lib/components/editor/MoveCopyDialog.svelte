<script lang="ts">
  // Move/Copy to… with a tree picker: every dashboard > tab > folder (any depth).
  // The current dashboard is read from the session draft (so unsaved folders
  // appear); the others come from the stored layout. Same dashboard: edits the
  // draft (one undo step). Another dashboard: the transfer endpoint, allowed
  // only while the session has no unsaved changes.
  import Icon from '@iconify/svelte';
  import Modal from '../shared/Modal.svelte';
  import DestinationTree, { type TreeRow } from './DestinationTree.svelte';
  import { isDescendant } from '$lib/editor/treeOps';
  import { containerOfNode, moveOrCopyTo, transferAndRebase } from '$lib/editor/editorActions';
  import { session, dirty } from '$lib/stores/editSession';
  import { dashboards as allDashboards, findLayoutDashboard, layoutDoc } from '$lib/stores/config';
  import { toast } from '$lib/stores/toast';
  import type { LayoutDashboard } from '$lib/types/layout';

  interface Props {
    ids: string[];
    onClose: () => void;
  }
  let { ids, onClose }: Props = $props();

  const DIRTY_REASON = 'Save or discard your changes first';

  const current = $derived($session?.draft ?? null);
  const currentId = $derived($session?.dashboardId ?? '');
  const dashboards = $derived.by((): LayoutDashboard[] =>
    $allDashboards.map((d) => (d.id === currentId && current ? current : d))
  );

  const homes = $derived.by(() => {
    const s = new Set<string>();
    if (current)
      for (const id of ids) {
        const r = containerOfNode(current, id);
        s.add(r ? (r.folderId ? `f:${currentId}:${r.folderId}` : `t:${currentId}:${r.tabId}`) : '');
      }
    return s;
  });

  /** Which rows can take the items, and why not. */
  function annotate(r: TreeRow) {
    const other = r.dashboardId !== currentId;
    if (r.kind === 'dashboard') {
      if (other && $dirty) r.reason = DIRTY_REASON;
      return;
    }
    const self = r.kind === 'folder' && !other && !!current && ids.some((id) => id === r.folderId || isDescendant(current, id, r.folderId!));
    if (self) {
      r.selectable = false;
      r.noMove = r.noCopy = "A folder can't go inside itself";
      r.reason = r.noCopy;
    } else if (other) {
      if ($dirty) {
        r.selectable = false;
        r.noMove = r.noCopy = DIRTY_REASON;
        r.reason = DIRTY_REASON;
      }
    } else if (homes.size === 1 && homes.has(r.key)) {
      r.noMove = 'Already here';
      r.reason = 'Already here (copy only)';
    }
  }

  let chosen = $state('');
  let dest = $state<TreeRow | undefined>(undefined);
  let gone = $state(false);
  let busy = $state(false);
  const count = $derived(ids.length === 1 ? 'this item' : `these ${ids.length} items`);

  async function go(mode: 'move' | 'copy') {
    const r = dest;
    const s = $session;
    if (!r || !s || busy) return;
    if (r.dashboardId === s.dashboardId) {
      if (moveOrCopyTo(ids, r.folderId ? { tabId: r.tabId!, folderId: r.folderId } : { tabId: r.tabId! }, mode)) onClose();
      return;
    }
    if ($dirty) {
      toast.error(DIRTY_REASON);
      return;
    }
    const target = findLayoutDashboard(r.dashboardId, $layoutDoc);
    if (!target || typeof target.revision !== 'number') {
      toast.error('That dashboard is no longer available. Close this dialog and try again.');
      return;
    }
    busy = true;
    try {
      const ok = await transferAndRebase(
        {
          mode,
          sourceId: s.dashboardId,
          sourceRevision: s.baseRevision,
          nodeIds: ids,
          targetId: r.dashboardId,
          targetRevision: target.revision,
          target: r.folderId ? { tabId: r.tabId!, folderId: r.folderId } : { tabId: r.tabId! }
        },
        `${mode === 'copy' ? 'Copied' : 'Moved'} ${ids.length === 1 ? '1 item' : `${ids.length} items`} to "${target.name}" and saved`,
        'Move/copy failed'
      );
      if (ok) onClose();
    } finally {
      busy = false;
    }
  }
</script>

<Modal id="move-copy" title="Move or copy" onClose={onClose} maxWidth="520px">
  <div class="body">
    <span class="lbl" id="move-copy-lbl">Destination</span>
    <p class="hint">Move or copy {count} to a tab or folder, on this dashboard or another.</p>
    <DestinationTree
      {dashboards}
      {annotate}
      labelledby="move-copy-lbl"
      idPrefix="mc"
      initiallyExpanded={currentId ? [`d:${currentId}`] : []}
      {currentId}
      bind:chosen
      bind:selected={dest}
      bind:gone
    />
    {#if gone}
      <p class="why" role="status">That destination no longer exists. Choose another.</p>
    {/if}
    {#if dest?.noMove}
      <p class="why" role="status">{dest.noMove}: choose Copy, or another destination to move.</p>
    {/if}
  </div>
  {#snippet footer()}
    <div class="actions">
      <button type="button" class="btn-secondary" onclick={onClose}>Cancel</button>
      <button type="button" class="btn-secondary" disabled={!dest || busy || !!dest.noCopy} onclick={() => go('copy')}>
        <Icon icon="mdi:content-copy" width="18" />Copy
      </button>
      <button type="button" class="btn-primary" disabled={!dest || busy || !!dest.noMove} onclick={() => go('move')}>
        <Icon icon="mdi:folder-move" width="18" />Move
      </button>
    </div>
  {/snippet}
</Modal>

<style>
  .body { display: flex; flex-direction: column; gap: 0.5rem; }
  .lbl { font-weight: 500; font-size: 0.875rem; }
  .hint { margin: 0; color: var(--text-secondary); font-size: 0.85rem; }
  .why { margin: 0; color: var(--color-warning, #d97706); font-size: 0.85rem; }
  .actions { display: flex; justify-content: flex-end; gap: 0.5rem; width: 100%; }
  .actions button { display: inline-flex; align-items: center; gap: 0.35rem; }
</style>
