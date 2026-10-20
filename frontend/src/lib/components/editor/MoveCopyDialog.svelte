<script lang="ts">
  // Move/Copy to… with a tree picker: every dashboard > tab > folder (any depth).
  // The current dashboard is read from the session draft (so unsaved folders
  // appear); the others come from the stored layout. Same dashboard: edits the
  // draft (one undo step). Another dashboard: the transfer endpoint, allowed
  // only while the session has no unsaved changes. Branches render lazily —
  // only the children of expanded rows exist in the DOM (Tenet 4).
  import Icon from '@iconify/svelte';
  import Modal from '../shared/Modal.svelte';
  import { isDescendant } from '$lib/editor/treeOps';
  import { containerOfNode, moveOrCopyTo, transferAndRebase } from '$lib/editor/editorActions';
  import { session, dirty } from '$lib/stores/editSession';
  import { layoutDoc, findLayoutDashboard } from '$lib/stores/config';
  import { toast } from '$lib/stores/toast';
    import type { Container, LayoutDashboard, LayoutNode } from '$lib/types/layout';

  interface Props {
    ids: string[];
    onClose: () => void;
  }
  let { ids, onClose }: Props = $props();

  const DIRTY_REASON = 'Save or discard your changes first';

  interface Row {
    key: string;
    kind: 'dashboard' | 'tab' | 'folder';
    label: string;
    level: number;
    dashboardId: string;
    tabId?: string;
    folderId?: string;
    expandable: boolean;
    expanded: boolean;
    parent?: string;
    /** Selectable as a destination (for at least a copy). */
    selectable: boolean;
    noMove?: string;
    noCopy?: string;
    /** The reason shown beside the row when it can't be used. */
    reason?: string;
  }

  const current = $derived($session?.draft ?? null);
  const currentId = $derived($session?.dashboardId ?? '');
  const dashboards = $derived.by((): LayoutDashboard[] => {
    const list = $layoutDoc?.dashboards ?? [];
    return list.map((d) => (d.id === currentId && current ? current : d));
  });

  // Expansion state; the current dashboard starts open.
  let expandedKeys = $state<Record<string, boolean>>({});
  let initialised = false;
  $effect(() => {
    if (!initialised && currentId) {
      initialised = true;
      expandedKeys[`d:${currentId}`] = true;
    }
  });

  const homes = $derived.by(() => {
    const s = new Set<string>();
    if (current)
      for (const id of ids) {
        const r = containerOfNode(current, id);
        s.add(r ? (r.folderId ? `f:${currentId}:${r.folderId}` : `t:${currentId}:${r.tabId}`) : '');
      }
    return s;
  });

  function hasFolders(c: Container): boolean {
    return (Array.isArray(c.children) ? c.children : []).some((n) => n.kind === 'folder');
  }

  const rows = $derived.by((): Row[] => {
    const out: Row[] = [];
    const isOther = (did: string) => did !== currentId;
    const blockedOther = $dirty;
    const place = (r: Row, did: string, selfInvalid: boolean, homeKey: string) => {
      if (selfInvalid) {
        r.selectable = false;
        r.noMove = r.noCopy = "A folder can't go inside itself";
        r.reason = r.noCopy;
      } else if (isOther(did)) {
        if (blockedOther) {
          r.selectable = false;
          r.noMove = r.noCopy = DIRTY_REASON;
          r.reason = DIRTY_REASON;
        } else r.selectable = true;
      } else {
        r.selectable = true;
        if (homes.size === 1 && homes.has(homeKey)) {
          r.noMove = 'Already here';
          r.reason = 'Already here (copy only)';
        }
      }
    };
    const walk = (c: Container, d: LayoutDashboard, tabId: string, level: number, parent: string) => {
      for (const n of Array.isArray(c.children) ? c.children : ([] as LayoutNode[])) {
        if (n.kind !== 'folder') continue;
        const key = `f:${d.id}:${n.id}`;
        const sub = hasFolders(n.content);
        const row: Row = {
          key, kind: 'folder', label: n.name || 'Untitled folder', level, dashboardId: d.id, tabId, folderId: n.id,
          expandable: sub, expanded: sub && !!expandedKeys[key], parent, selectable: true
        };
        const self = !isOther(d.id) && !!current && ids.some((id) => id === n.id || isDescendant(current, id, n.id));
        place(row, d.id, self, key);
        out.push(row);
        if (row.expanded) walk(n.content, d, tabId, level + 1, key);
      }
    };
    for (const d of dashboards) {
      const dkey = `d:${d.id}`;
      const drow: Row = {
        key: dkey, kind: 'dashboard', label: d.name || d.path || 'Untitled dashboard', level: 1, dashboardId: d.id,
        expandable: d.tabs.length > 0, expanded: !!expandedKeys[dkey], selectable: false
      };
      if (isOther(d.id) && blockedOther) drow.reason = DIRTY_REASON;
      out.push(drow);
      if (!drow.expanded) continue;
      for (const t of d.tabs) {
        const tkey = `t:${d.id}:${t.id}`;
        const sub = hasFolders(t.root);
        const trow: Row = {
          key: tkey, kind: 'tab', label: t.name || 'Untitled tab', level: 2, dashboardId: d.id, tabId: t.id,
          expandable: sub, expanded: sub && !!expandedKeys[tkey], parent: dkey, selectable: true
        };
        place(trow, d.id, false, tkey);
        out.push(trow);
        if (trow.expanded) walk(t.root, d, t.id, 3, tkey);
      }
    }
    return out;
  });

  let chosen = $state('');
  let focusKey = $state('');
  let busy = $state(false);
  const dest = $derived(rows.find((r) => r.key === chosen && r.selectable));
  let gone = $state(false);
  // A chosen row can vanish when the layout refreshes under the dialog (e.g. after a
  // conflict reload). Only a row that is truly missing from the data counts, not one
  // hidden by a collapsed parent, so check the data, not the visible rows.
  function exists(key: string): boolean {
    const [kind, did, id] = key.split(':');
    const d = dashboards.find((x) => x.id === did);
    if (!d) return false;
    if (kind === 't') return d.tabs.some((t) => t.id === id);
    const find = (c: Container): boolean =>
      (Array.isArray(c.children) ? c.children : []).some((n) => n.kind === 'folder' && (n.id === id || find(n.content)));
    return d.tabs.some((t) => find(t.root));
  }
  $effect(() => {
    if (chosen && !exists(chosen)) {
      chosen = '';
      gone = true;
    }
  });
  const count = $derived(ids.length === 1 ? 'this item' : `these ${ids.length} items`);
  const tabbable = $derived(rows.some((r) => r.key === focusKey) ? focusKey : (rows[0]?.key ?? ''));

  function toggle(r: Row, open?: boolean) {
    if (!r.expandable) return;
    expandedKeys[r.key] = open ?? !r.expanded;
  }

  function focusRow(key: string) {
    focusKey = key;
    queueMicrotask(() => document.getElementById(`mc-${key}`)?.focus());
  }

  function onKey(e: KeyboardEvent, r: Row) {
    const i = rows.findIndex((x) => x.key === r.key);
    let handled = true;
    switch (e.key) {
      case 'ArrowDown': if (i < rows.length - 1) focusRow(rows[i + 1].key); break;
      case 'ArrowUp': if (i > 0) focusRow(rows[i - 1].key); break;
      case 'Home': focusRow(rows[0].key); break;
      case 'End': focusRow(rows[rows.length - 1].key); break;
      case 'ArrowRight':
        if (r.expandable && !r.expanded) toggle(r, true);
        else if (r.expanded && rows[i + 1]?.parent === r.key) focusRow(rows[i + 1].key);
        break;
      case 'ArrowLeft':
        if (r.expanded) toggle(r, false);
        else if (r.parent) focusRow(r.parent);
        break;
      case 'Enter':
      case ' ':
        if (r.selectable) { chosen = r.key; gone = false; }
        else if (r.expandable) toggle(r);
        break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  }

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
    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <ul class="tree" role="tree" aria-labelledby="move-copy-lbl">
      {#each rows as r (r.key)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id={`mc-${r.key}`}
          role="treeitem"
          aria-level={r.level}
          aria-expanded={r.expandable ? r.expanded : undefined}
          aria-selected={r.selectable ? chosen === r.key : undefined}
          aria-disabled={!r.selectable ? 'true' : undefined}
          tabindex={r.key === tabbable ? 0 : -1}
          class="row"
          class:sel={chosen === r.key}
          class:off={!r.selectable}
          style:padding-left={`${(r.level - 1) * 1.1 + 0.4}rem`}
          onkeydown={(e) => { if (e.target === e.currentTarget) onKey(e, r); }}
          onfocus={(e) => { if (e.target === e.currentTarget) focusKey = r.key; }}
          onclick={(e) => {
            if (e.target !== e.currentTarget && !(e.target as HTMLElement).closest('.name')) return;
            focusKey = r.key;
            if (r.selectable) { chosen = r.key; gone = false; }
            else toggle(r);
          }}
        >
          {#if r.expandable}
            <button type="button" class="chev" tabindex="-1" aria-label={r.expanded ? 'Collapse' : 'Expand'} onclick={(e) => { e.stopPropagation(); toggle(r); }}>
              <Icon icon={r.expanded ? 'mdi:chevron-down' : 'mdi:chevron-right'} width="16" />
            </button>
          {:else}<span class="chev"></span>{/if}
          <span class="name">
            <Icon icon={r.kind === 'dashboard' ? 'mdi:view-dashboard' : r.kind === 'tab' ? 'mdi:tab' : 'mdi:folder'} width="16" />
            {r.label}{r.kind === 'dashboard' && r.dashboardId === currentId ? ' (this dashboard)' : ''}
          </span>
          {#if r.reason}<span class="why-inline">{r.reason}</span>{/if}
        </li>
      {/each}
    </ul>
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
  .tree {
    list-style: none; margin: 0; padding: 0.25rem; max-height: 50vh; overflow: auto;
    border: 1px solid var(--border); border-radius: 0.375rem; background: var(--bg-secondary);
  }
  .row { display: flex; align-items: center; gap: 0.25rem; padding: 0.25rem 0.4rem; border-radius: 0.25rem; cursor: pointer; color: var(--text-primary); font-size: 0.9rem; }
  .row:hover { background: var(--bg-tertiary, rgba(127, 127, 127, 0.12)); }
  .row:focus-visible { outline: 2px solid var(--accent, #3b82f6); outline-offset: -2px; }
  .row.sel { background: var(--accent, #3b82f6); color: #fff; }
  .row.off { color: var(--text-secondary); }
  .row.off:not(:has(.chev button)) { cursor: default; }
  .name { display: inline-flex; align-items: center; gap: 0.35rem; }
  .chev { width: 1.1rem; display: inline-flex; background: none; border: 0; padding: 0; color: inherit; cursor: pointer; }
  .why-inline { margin-left: auto; font-size: 0.75rem; opacity: 0.85; }
  .why { margin: 0; color: var(--color-warning, #d97706); font-size: 0.85rem; }
  .actions { display: flex; justify-content: flex-end; gap: 0.5rem; width: 100%; }
  .actions button { display: inline-flex; align-items: center; gap: 0.35rem; }
</style>
