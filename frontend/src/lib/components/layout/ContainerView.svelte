<script lang="ts">
  import type { Container, FolderNode, LayoutDashboard, LayoutNode, LayoutTab } from '$lib/types/layout';
  import type { CanvasPlan, ContainerMetrics } from '$lib/layout/geometry';
  import {
    clampPlacement, freeContentHeightPx, hasPosition, isRenderable, nodeBox, readingOrder, requiredFolderHeightPx,
    tileFit
  } from '$lib/layout/geometry';
  import type { Placement } from '$lib/types/layout';
  import Entry from '../Entry.svelte';
  import FolderView from './FolderView.svelte';
  import NodePlaceholder from './NodePlaceholder.svelte';
  import { pointToCell } from '$lib/layout/geometry';
  import { selectedNodes, toggleNode } from '$lib/stores/nodeSelection';
  import { openDialog, openMenu, menuPointFor, ownsTarget } from '$lib/editor/editorUi';
  import type { ContainerRef } from '$lib/editor/treeOps';
  import { drag, dragSource, pressMenu } from '$lib/editor/drag/dragController';
  import { dropContainer } from '$lib/editor/drag/hitTest';
  import ResizeHandles from '../editor/ResizeHandles.svelte';
  import EditHandle from '../editor/EditHandle.svelte';

  interface Props {
    container: Container;
    /** Every size in this container comes from these (geometry.containerMetrics). */
    metrics: ContainerMetrics;
    plan: CanvasPlan;
    dashboard: LayoutDashboard;
    tab: LayoutTab;
    /** Outermost-first chain of the folders enclosing this container. */
    folderChain: FolderNode[];
    /** Edit mode: select (click / Ctrl-click), edit (double-click), item and container menus. */
    editing?: boolean;
  }
  let { container, metrics, plan, dashboard, tab, folderChain, editing = false }: Props = $props();

  const parent = $derived(folderChain[folderChain.length - 1]);
  const parentId = $derived(parent ? parent.id : tab.id);

  // ---- editing: selection uses the RENDERED boxes; every edit goes through the editor (draft).
  const ref = $derived<ContainerRef>(parent ? { tabId: tab.id, folderId: parent.id } : { tabId: tab.id });
  function onNodeClick(e: MouseEvent, id: string) {
    // The edit handle's own click edits; it must reach the handle (and not select).
    if (e.target instanceof Element && e.target.closest('[data-edit-handle]')) return;
    // Capture phase: the tile never sees the click, so it does not open its link while editing.
    e.preventDefault();
    e.stopPropagation();
    toggleNode(id, e.ctrlKey || e.metaKey);
  }
  function onNodeMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    const pt = menuPointFor(e, e.currentTarget as Element);
    openMenu({ ...pt, target: { kind: 'node', id } });
  }
  function containerMenuAt(el: HTMLElement, x: number, y: number, fromPointer: boolean) {
    let cell: { x: number; y: number } | undefined;
    if (fromPointer && effective !== 'stacked') {
      const r = el.getBoundingClientRect();
      cell = pointToCell(metrics, x - r.left, y - r.top);
    }
    openMenu({ x, y, target: { kind: 'container', ref, ...(cell ? { cell } : {}) } });
  }
  /** Touch long-press on this container's own empty space (not an item in it) opens its menu. */
  function emptyPress(el: HTMLElement | null) {
    return (x: number, y: number, t: EventTarget | null) => {
      if (editing && el && ownsTarget(el, t)) containerMenuAt(el, x, y, true);
    };
  }
  const nodeMenu = (id: string) => (x: number, y: number) => openMenu({ x, y, target: { kind: 'node', id } });
  const dragging = $derived(new Set(editing ? ($drag?.ids ?? []) : []));
  let gridEl = $state<HTMLElement | null>(null);
  let freeEl = $state<HTMLElement | null>(null);
  function onContainerMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    const pt = menuPointFor(e, el);
    containerMenuAt(el, pt.x, pt.y, !!(e.clientX || e.clientY));
  }

  const columns = $derived(metrics.columns);
  const kids = $derived(Array.isArray(container?.children) ? container.children : []);
  // Valid children in reading order, followed by unplaceable ones (readingOrder never throws).
  const ordered = $derived(readingOrder(kids) as unknown[]);

  // Phone/narrow plans stack every container, whatever its own mode.
  const effective = $derived<'grid' | 'free' | 'stacked'>(plan.kind === 'stacked' ? 'stacked' : metrics.mode);

  const px = (v: number) => `${Math.round(v * 100) / 100}px`;
  // Column tracks round DOWN so N tracks never overflow the container by a rounding hair.
  const trackPx = (v: number) => `${Math.floor(v * 100) / 100}px`;

  const freeHeight = $derived(freeContentHeightPx(kids, metrics));
  const freeStyle = $derived(
    `position:relative;min-height:${px(freeHeight)};width:${px(metrics.innerWidthPx)};`
  );
  function freeCellStyle(n: LayoutNode): string {
    const b = nodeBox(n.placement, metrics);
    const z = clampPlacement(n.placement, columns).z ?? 0;
    // Folders grow past their box (min-height) rather than clip their content.
    const h = n.kind === 'folder' ? `min-height:${px(requiredFolderHeightPx(n, metrics))}` : `height:${px(b.heightPx)}`;
    return `position:absolute;left:${px(b.leftPx)};top:${px(b.topPx)};width:${px(b.widthPx)};${h};z-index:${z};`;
  }
  const gridStyle = $derived(
    `display:grid;grid-template-columns:repeat(${columns}, ${trackPx(metrics.unitPx)});` +
      `grid-auto-rows:${px(metrics.rowPx)};`
  );

  function cellStyle(n: LayoutNode): string {
    const p = clampPlacement(n.placement, columns);
    return `grid-column: ${p.x + 1} / span ${p.w}; grid-row: ${p.y + 1} / span ${p.h};` +
      (p.z !== undefined ? ` z-index: ${p.z};` : '');
  }

  /** How a tile fits its box (Ruling 22): the box is the tile's cell span, in px. */
  function fitOf(n: LayoutNode): 'fill' | 'compact' | undefined {
    if (effective === 'stacked') return undefined; // phone stacking keeps the v2 tile sizes
    const b = nodeBox(n.placement, metrics);
    return tileFit(b.widthPx, b.heightPx);
  }

  // Placeholders (unrenderable nodes, m3): one that has a position keeps it, drawn
  // above its siblings so a tile can never hide it; the rest stack after every
  // positioned item, in array order.
  const unplaced = $derived(kids.filter((k) => !isRenderable(k) && !hasPosition(k)));
  const topZ = $derived(
    kids.reduce((m: number, k) => {
      if (!isRenderable(k)) return m;
      const z = clampPlacement(k.placement, columns).z;
      return z !== undefined && z > m ? z : m;
    }, 0) + 1
  );
  /** A placement with numeric x/y (w/h default to 1 via clampPlacement). */
  function rawPlacement(n: unknown): Placement {
    return (n as { placement: Placement }).placement;
  }
  function placeholderStyle(n: unknown): string {
    const p = clampPlacement(rawPlacement(n), columns);
    if (effective === 'free') {
      const b = nodeBox(p, metrics);
      return `position:absolute;left:${px(b.leftPx)};top:${px(b.topPx)};width:${px(b.widthPx)};` +
        `height:${px(b.heightPx)};z-index:${topZ};`;
    }
    return `grid-column: ${p.x + 1} / span ${p.w}; grid-row: ${p.y + 1} / span ${p.h}; z-index: ${topZ};`;
  }
  function nodeId(n: unknown): string {
    const id = (n as { id?: unknown } | null)?.id;
    return typeof id === 'string' && id ? id : '(no id)';
  }
</script>

{#snippet nodes(list: unknown[], styleOf: (n: LayoutNode) => string, folderStyle: (n: LayoutNode) => string, inPlace: boolean)}
  {#each list as node, i (nodeId(node) + ':' + i)}
    {#if isRenderable(node)}
      {#if node.kind === 'tile'}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="cell"
          class:selected={editing && $selectedNodes.has(node.id)}
          class:editable={editing}
          class:dragging={dragging.has(node.id)}
          data-node-id={node.id}
          style={styleOf(node)}
          onclickcapture={editing ? (e) => onNodeClick(e, node.id) : undefined}
          ondblclick={editing
            ? (e) => {
                e.stopPropagation();
                openDialog({ kind: 'tile', id: node.id });
              }
            : undefined}
          oncontextmenu={editing ? (e) => onNodeMenu(e, node.id) : undefined}
          use:dragSource={{ id: node.id, enabled: editing, onMenu: nodeMenu(node.id) }}
        >
          <Entry
            entry={node}
            fit={fitOf(node)}
            editorSelected={editing ? $selectedNodes.has(node.id) : undefined}
          />
          {#if editing}
            <EditHandle name={node.name} onEdit={() => openDialog({ kind: 'tile', id: node.id })} />
          {/if}
          {#if editing && effective === 'free'}
            <!-- Free tiles resize like folders; a grid tile is one cell (its Size is in the tile dialog). -->
            <ResizeHandles id={node.id} name={node.name} metrics={metrics} />
          {/if}
        </div>
      {:else}
        <FolderView
          folder={node}
          style={folderStyle(node)}
          {plan}
          {dashboard}
          {tab}
          {folderChain}
          parent={metrics}
          {editing}
        />
      {/if}
    {:else if !inPlace}
      <NodePlaceholder id={nodeId(node)} reason="missing or invalid placement/content" />
    {:else if hasPosition(node)}
      <NodePlaceholder id={nodeId(node)} reason="missing or invalid placement/content" style={placeholderStyle(node)} />
    {/if}
  {/each}
{/snippet}

{#snippet stackedPlaceholders()}
  {#if unplaced.length > 0}
    <div class="placeholder-stack">
      {#each unplaced as node, i (nodeId(node) + ':' + i)}
        <NodePlaceholder id={nodeId(node)} reason="missing or invalid placement/content" />
      {/each}
    </div>
  {/if}
{/snippet}

{#if effective === 'grid'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="container-grid"
    style={gridStyle}
    data-container-id={parentId}
    oncontextmenu={editing ? onContainerMenu : undefined}
    use:pressMenu={{ enabled: editing, onMenu: emptyPress(gridEl) }}
    use:dropContainer={{ ref, metrics, layout: 'grid' }}
    bind:this={gridEl}
  >
    {@render nodes(ordered, cellStyle, cellStyle, true)}
  </div>
  {@render stackedPlaceholders()}
{:else if effective === 'free'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="container-free"
    style={freeStyle}
    data-container-id={parentId}
    oncontextmenu={editing ? onContainerMenu : undefined}
    use:pressMenu={{ enabled: editing, onMenu: emptyPress(freeEl) }}
    use:dropContainer={{ ref, metrics, layout: 'free' }}
    bind:this={freeEl}
  >
    {@render nodes(kids, freeCellStyle, freeCellStyle, true)}
  </div>
  {@render stackedPlaceholders()}
{:else}
  <!-- Phone stacking: reading order, tiles wrap at today's phone sizes, expanded folders full width. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="container-stacked"
    data-container-id={parentId}
    oncontextmenu={editing ? onContainerMenu : undefined}
    use:dropContainer={{ ref, metrics, layout: 'stacked' }}
  >
    {@render nodes(
      ordered,
      () => '',
      (n) => (n.kind === 'folder' && n.display === 'collapsed' ? '' : 'grid-column: 1 / -1;'),
      false
    )}
  </div>
{/if}

<style>
  .container-grid {
    width: 100%;
  }
  .cell {
    min-width: 0;
    min-height: 0;
  }
  /* Edit-mode selection: an outline on the rendered box (a collapsed folder = its one cell). */
  .cell.selected {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
    border-radius: 0.75rem;
  }
  /* Edit mode: items are dragged, so no text selection or touch callout on them. */
  .cell.editable {
    /* The edit handle sits in the corner (free cells are already absolutely positioned). */
    position: relative;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  /* The originals stay in place, dimmed, while they are dragged. */
  .cell.dragging {
    opacity: 0.4;
  }
  .placeholder-stack {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .container-stacked {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(135px, 1fr));
    gap: 0.875rem;
    width: 100%;
  }
  .container-stacked :global(.folder-slot.collapsed) {
    min-height: 7rem;
  }
  @media (max-width: 768px) {
    .container-stacked {
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 0.75rem;
    }
  }
  @media (max-width: 480px) {
    .container-stacked {
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    }
  }
</style>
