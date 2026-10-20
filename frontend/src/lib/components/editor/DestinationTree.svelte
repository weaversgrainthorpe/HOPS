<script module lang="ts">
  /** One row of the destination tree: a dashboard, a tab or a folder (any depth). */
  export interface TreeRow {
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
    /** Selectable as a destination. */
    selectable: boolean;
    noMove?: string;
    noCopy?: string;
    /** The reason shown beside the row (why it can't be used, or a hint). */
    reason?: string;
  }
</script>

<script lang="ts">
  // The one destination tree picker (dashboard > tab > folder, any depth),
  // shared by Move/Copy and discovery's Promote. Branches render lazily —
  // only the children of expanded rows exist in the DOM (Tenet 4). The caller
  // decides which rows can be chosen (`annotate`); a chosen row that vanishes
  // from the data (a refresh underneath) is dropped and `gone` says so.
  import Icon from '@iconify/svelte';
  import type { Container, LayoutDashboard, LayoutNode } from '$lib/types/layout';

  interface Props {
    dashboards: LayoutDashboard[];
    /** Sets selectable / noMove / noCopy / reason on each row. Dashboards start unselectable. */
    annotate: (row: TreeRow) => void;
    /** id of the element labelling the tree. */
    labelledby: string;
    /** Prefix for row element ids (unique per page). */
    idPrefix: string;
    /** Row keys expanded on first render (e.g. `d:<id>`). */
    initiallyExpanded?: string[];
    /** Marks this dashboard's row "(this dashboard)". */
    currentId?: string;
    chosen?: string;
    selected?: TreeRow | undefined;
    gone?: boolean;
  }
  let {
    dashboards, annotate, labelledby, idPrefix, initiallyExpanded = [], currentId = '',
    chosen = $bindable(''), selected = $bindable(undefined), gone = $bindable(false)
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  let expandedKeys = $state<Record<string, boolean>>(Object.fromEntries(initiallyExpanded.map((k) => [k, true])));

  function hasFolders(c: Container): boolean {
    return (Array.isArray(c?.children) ? c.children : []).some((n) => n.kind === 'folder');
  }

  const rows = $derived.by((): TreeRow[] => {
    const out: TreeRow[] = [];
    const walk = (c: Container, d: LayoutDashboard, tabId: string, level: number, parent: string) => {
      for (const n of Array.isArray(c?.children) ? c.children : ([] as LayoutNode[])) {
        if (n.kind !== 'folder') continue;
        const key = `f:${d.id}:${n.id}`;
        const sub = hasFolders(n.content);
        const row: TreeRow = {
          key, kind: 'folder', label: n.name || 'Untitled folder', level, dashboardId: d.id, tabId, folderId: n.id,
          expandable: sub, expanded: sub && !!expandedKeys[key], parent, selectable: true
        };
        annotate(row);
        out.push(row);
        if (row.expanded) walk(n.content, d, tabId, level + 1, key);
      }
    };
    for (const d of dashboards) {
      const dkey = `d:${d.id}`;
      const drow: TreeRow = {
        key: dkey, kind: 'dashboard', label: d.name || d.path || 'Untitled dashboard', level: 1, dashboardId: d.id,
        expandable: d.tabs.length > 0, expanded: !!expandedKeys[dkey], selectable: false
      };
      annotate(drow);
      out.push(drow);
      if (!drow.expanded) continue;
      for (const t of d.tabs) {
        const tkey = `t:${d.id}:${t.id}`;
        const sub = hasFolders(t.root);
        const trow: TreeRow = {
          key: tkey, kind: 'tab', label: t.name || 'Untitled tab', level: 2, dashboardId: d.id, tabId: t.id,
          expandable: sub, expanded: sub && !!expandedKeys[tkey], parent: dkey, selectable: true
        };
        annotate(trow);
        out.push(trow);
        if (trow.expanded) walk(t.root, d, t.id, 3, tkey);
      }
    }
    return out;
  });

  let focusKey = $state('');

  // A chosen row can vanish when the layout refreshes under the picker (e.g.
  // after a conflict reload). Only a row that is truly missing from the data
  // counts, not one hidden by a collapsed parent, so check the data, not the
  // visible rows.
  function exists(key: string): boolean {
    const [kind, did, id] = key.split(':');
    const d = dashboards.find((x) => x.id === did);
    if (!d) return false;
    if (kind === 't') return d.tabs.some((t) => t.id === id);
    const find = (c: Container): boolean =>
      (Array.isArray(c?.children) ? c.children : []).some((n) => n.kind === 'folder' && (n.id === id || find(n.content)));
    return d.tabs.some((t) => find(t.root));
  }
  $effect(() => {
    if (chosen && !exists(chosen)) {
      chosen = '';
      gone = true;
    }
  });
  $effect(() => {
    selected = rows.find((r) => r.key === chosen && r.selectable);
  });

  const tabbable = $derived(rows.some((r) => r.key === focusKey) ? focusKey : (rows[0]?.key ?? ''));

  function choose(r: TreeRow) {
    chosen = r.key;
    gone = false;
  }

  function toggle(r: TreeRow, open?: boolean) {
    if (!r.expandable) return;
    expandedKeys[r.key] = open ?? !r.expanded;
  }

  function focusRow(key: string) {
    focusKey = key;
    queueMicrotask(() => document.getElementById(`${idPrefix}-${key}`)?.focus());
  }

  function onKey(e: KeyboardEvent, r: TreeRow) {
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
        if (r.selectable) choose(r);
        else if (r.expandable) toggle(r);
        break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<ul class="tree" role="tree" aria-labelledby={labelledby}>
  {#each rows as r (r.key)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <li
      id={`${idPrefix}-${r.key}`}
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
        if (r.selectable) choose(r);
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
        {r.label}{r.kind === 'dashboard' && currentId && r.dashboardId === currentId ? ' (this dashboard)' : ''}
      </span>
      {#if r.reason}<span class="why-inline">{r.reason}</span>{/if}
    </li>
  {/each}
</ul>

<style>
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
</style>
