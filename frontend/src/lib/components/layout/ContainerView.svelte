<script lang="ts">
  import type { Container, FolderNode, LayoutDashboard, LayoutMode, LayoutNode, LayoutTab } from '$lib/types/layout';
  import type { CanvasPlan } from '$lib/layout/geometry';
  import {
    clampPlacement, FOLDER_CHROME_PX, FOLDER_TITLE_PX, folderInnerColumns, FREE_UNIT_PX, isRenderable, readingOrder, resolveMode
  } from '$lib/layout/geometry';
  import Entry from '../Entry.svelte';
  import FolderView from './FolderView.svelte';
  import NodePlaceholder from './NodePlaceholder.svelte';

  interface Props {
    container: Container;
    mode: LayoutMode;
    plan: CanvasPlan;
    dashboard: LayoutDashboard;
    tab: LayoutTab;
    /** Outermost-first chain of the folders enclosing this container. */
    folderChain: FolderNode[];
    /** Row height in px for nested containers; root uses the plan's cell size. */
    rowPx?: number;
    /** Content-box width in px handed down by the parent folder (root derives it from the plan). */
    boxPx?: number;
  }
  let { container, mode, plan, dashboard, tab, folderChain, rowPx, boxPx }: Props = $props();

  const parent = $derived(folderChain[folderChain.length - 1]);
  const parentId = $derived(parent ? parent.id : tab.id);
  const columns = $derived(
    Number.isFinite(container?.columns) && container.columns >= 1 ? Math.floor(container.columns) : 12
  );
  const kids = $derived(Array.isArray(container?.children) ? container.children : []);
  // Valid children in reading order, followed by unplaceable ones (readingOrder never throws).
  const ordered = $derived(readingOrder(kids) as unknown[]);

  const isRoot = $derived(folderChain.length === 0);

  // Phone/narrow plans stack every container, whatever its own mode.
  const effective = $derived<'grid' | 'free' | 'stacked'>(
    plan.kind === 'stacked' ? 'stacked' : mode === 'free' ? 'free' : 'grid'
  );

  // Sizes flow down from the canvas (the only ResizeObserver): the root derives its box
  // from the plan; nested containers receive their box width from the parent folder.
  const boxWidth = $derived.by(() => {
    if (boxPx !== undefined && boxPx > 0) return boxPx;
    if (plan.kind === 'grid') return plan.cellPx * columns;
    if (plan.kind === 'free') return plan.scale * FREE_UNIT_PX * columns;
    return 0;
  });
  /** Width in px of one column of this container; children's boxes are w * unitPx. */
  const unitPx = $derived(
    effective === 'free'
      ? boxWidth / columns
      : isRoot && plan.kind === 'grid'
        ? plan.cellPx
        : boxWidth / columns
  );
  const cellPx = $derived(rowPx ?? (plan.kind === 'grid' && isRoot ? plan.cellPx : unitPx || 48));
  const freeScale = $derived(boxWidth / (columns * FREE_UNIT_PX));

  const px = (v: number) => `${Math.round(v * 100) / 100}px`;

  /** Height a node needs inside a free container with unit u px: folders grow past their box, never clip. */
  function requiredPx(n: LayoutNode, u: number, chain: FolderNode[], cols: number): number {
    const p = clampPlacement(n.placement, cols);
    const box = p.h * u;
    if (n.kind !== 'folder' || n.display === 'collapsed') return box;
    const inner = [...chain, n];
    if (resolveMode(dashboard, tab, inner) !== 'free') return box;
    const innerCols = folderInnerColumns(n);
    const innerU = (p.w * u) / innerCols;
    const chrome = (n.showTitle !== false ? FOLDER_TITLE_PX : 0) + FOLDER_CHROME_PX;
    return Math.max(box, chrome + freeContentPx(n.content.children, innerCols, innerU, inner));
  }
  function freeContentPx(children: unknown[], cols: number, u: number, chain: FolderNode[]): number {
    let bottom = 0;
    for (const c of children) {
      if (!isRenderable(c)) continue;
      const p = clampPlacement(c.placement, cols);
      bottom = Math.max(bottom, p.y * u + requiredPx(c, u, chain, cols));
    }
    return bottom;
  }
  const freeHeight = $derived(freeContentPx(kids, columns, FREE_UNIT_PX * freeScale, folderChain));
  const freeStyle = $derived(
    `position:relative;min-height:${px(freeHeight)};width:${px(boxWidth)};`
  );
  function freeCellStyle(n: LayoutNode): string {
    const p = clampPlacement(n.placement, columns);
    const u = FREE_UNIT_PX * freeScale;
    // Folders grow past their box (min-height) rather than clip their content.
    return `position:absolute;left:${px(p.x * u)};top:${px(p.y * u)};width:${px(p.w * u)};` +
      `${n.kind === 'folder' ? 'min-height' : 'height'}:${px(p.h * u)};z-index:${p.z ?? 0};`;
  }
  const gridStyle = $derived(
    `display:grid;grid-template-columns:${
      isRoot && plan.kind === 'grid' ? `repeat(${columns}, ${cellPx}px)` : `repeat(${columns}, minmax(0, 1fr))`
    };grid-auto-rows:${rowPx ?? cellPx}px;`
  );

  function cellStyle(n: LayoutNode): string {
    const p = clampPlacement(n.placement, columns);
    return `grid-column: ${p.x + 1} / span ${p.w}; grid-row: ${p.y + 1} / span ${p.h};` +
      (p.z !== undefined ? ` z-index: ${p.z};` : '');
  }
  function nodeId(n: unknown): string {
    const id = (n as { id?: unknown } | null)?.id;
    return typeof id === 'string' && id ? id : '(no id)';
  }
</script>

{#snippet nodes(list: unknown[], styleOf: (n: LayoutNode) => string, folderStyle: (n: LayoutNode) => string)}
  {#each list as node, i (nodeId(node) + ':' + i)}
    {#if isRenderable(node)}
      {#if node.kind === 'tile'}
        <div class="cell" data-node-id={node.id} style={styleOf(node)}>
          <Entry
            entry={node}
            currentTabId={tab.id}
            currentGroupId={parentId}
            tabId={tab.id}
            groupId={parentId}
            viewOnly
          />
        </div>
      {:else}
        <FolderView
          folder={node}
          style={folderStyle(node)}
          {plan}
          {dashboard}
          {tab}
          {folderChain}
          parentRowPx={cellPx}
          {unitPx}
        />
      {/if}
    {:else}
      <NodePlaceholder id={nodeId(node)} reason="missing or invalid placement/content" />
    {/if}
  {/each}
{/snippet}

{#if effective === 'grid'}
  <div class="container-grid" style={gridStyle}>
    {@render nodes(ordered, cellStyle, cellStyle)}
  </div>
{:else if effective === 'free'}
  <div class="container-free" style={freeStyle}>
    {@render nodes(kids, freeCellStyle, freeCellStyle)}
  </div>
{:else}
  <!-- Phone stacking: reading order, tiles wrap at today's phone sizes, expanded folders full width. -->
  <div class="container-stacked">
    {@render nodes(
      ordered,
      () => '',
      (n) => (n.kind === 'folder' && n.display === 'collapsed' ? '' : 'grid-column: 1 / -1;')
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
  .container-stacked {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(135px, 1fr));
    gap: 0.875rem;
    width: 100%;
  }
  .container-stacked :global(.folder.collapsed) {
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
