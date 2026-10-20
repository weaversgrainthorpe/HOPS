<script lang="ts">
  // Move/Copy to… for items on THIS dashboard: every tab and every folder at
  // any depth of the draft (v2's "Move to tab / Copy to tab", extended to
  // folders). Edits the draft only. Other dashboards are added by the M3
  // Task 10 tree picker (via the transfer endpoint).
  import Icon from '@iconify/svelte';
  import Modal from '../shared/Modal.svelte';
  import type { ContainerRef } from '$lib/editor/treeOps';
  import { isDescendant } from '$lib/editor/treeOps';
  import { containerOfNode, moveOrCopyTo } from '$lib/editor/editorActions';
  import { session } from '$lib/stores/editSession';
  import type { Container, LayoutNode } from '$lib/types/layout';

  interface Props {
    ids: string[];
    onClose: () => void;
  }
  let { ids, onClose }: Props = $props();

  interface Dest {
    value: string;
    label: string;
    depth: number;
    ref: ContainerRef;
    /** Why it can't take a MOVE of these items (copy is still allowed unless `noCopy`). */
    noMove?: string;
    noCopy?: string;
  }

  const draft = $derived($session?.draft ?? null);

  const dests = $derived.by((): Dest[] => {
    if (!draft) return [];
    const out: Dest[] = [];
    const homes = new Set(
      ids.map((id) => {
        const r = containerOfNode(draft, id);
        return r ? r.folderId ?? `tab:${r.tabId}` : '';
      })
    );
    const walk = (c: Container, tabId: string, depth: number) => {
      for (const n of Array.isArray(c.children) ? c.children : ([] as LayoutNode[])) {
        if (n.kind !== 'folder') continue;
        const intoSelf = ids.some((id) => id === n.id || isDescendant(draft, id, n.id));
        const d: Dest = { value: `folder:${n.id}`, label: n.name || 'Untitled folder', depth, ref: { tabId, folderId: n.id } };
        if (intoSelf) d.noMove = d.noCopy = "A folder can't go inside itself";
        else if (homes.size === 1 && homes.has(n.id)) d.noMove = 'Already here';
        out.push(d);
        walk(n.content, tabId, depth + 1);
      }
    };
    for (const t of draft.tabs) {
      const d: Dest = { value: `tab:${t.id}`, label: `${t.name} (tab)`, depth: 0, ref: { tabId: t.id } };
      if (homes.size === 1 && homes.has(`tab:${t.id}`)) d.noMove = 'Already here';
      out.push(d);
      walk(t.root, t.id, 1);
    }
    return out;
  });

  let chosen = $state('');
  const dest = $derived(dests.find((d) => d.value === chosen));
  const count = $derived(ids.length === 1 ? 'this item' : `these ${ids.length} items`);

  function go(mode: 'move' | 'copy') {
    if (!dest) return;
    if (moveOrCopyTo(ids, dest.ref, mode)) onClose();
  }
  const indent = (depth: number) => '  '.repeat(depth) + (depth > 0 ? '└ ' : '');
</script>

<Modal id="move-copy" title="Move or copy" onClose={onClose} maxWidth="480px">
  <div class="body">
    <label for="move-copy-dest">Destination</label>
    <p class="hint">Move or copy {count} to a tab or folder on this dashboard.</p>
    <select id="move-copy-dest" aria-label="Destination" size="10" bind:value={chosen}>
      {#each dests as d (d.value)}
        <option value={d.value} disabled={!!d.noCopy} title={d.noCopy ?? d.noMove ?? ''}>
          {indent(d.depth)}{d.label}{d.noCopy ? ` — ${d.noCopy}` : d.noMove ? ` — ${d.noMove}` : ''}
        </option>
      {/each}
    </select>
    {#if dest?.noMove}
      <p class="why" role="status">{dest.noMove}: choose Copy, or another destination to move.</p>
    {/if}
  </div>
  {#snippet footer()}
    <div class="actions">
      <button type="button" class="btn-secondary" onclick={onClose}>Cancel</button>
      <button type="button" class="btn-secondary" disabled={!dest || !!dest.noCopy} onclick={() => go('copy')}>
        <Icon icon="mdi:content-copy" width="18" />Copy
      </button>
      <button type="button" class="btn-primary" disabled={!dest || !!dest.noMove} onclick={() => go('move')}>
        <Icon icon="mdi:folder-move" width="18" />Move
      </button>
    </div>
  {/snippet}
</Modal>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  label {
    font-weight: 500;
    font-size: 0.875rem;
  }
  .hint {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.85rem;
  }
  select {
    width: 100%;
    padding: 0.25rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 0.9rem;
  }
  .why {
    margin: 0;
    color: var(--color-warning, #d97706);
    font-size: 0.85rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    width: 100%;
  }
  .actions button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
</style>
