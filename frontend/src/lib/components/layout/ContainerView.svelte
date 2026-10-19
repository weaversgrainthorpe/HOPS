<script lang="ts">
  import type { Container, FolderNode, LayoutDashboard, LayoutMode, LayoutNode, LayoutTab } from '$lib/types/layout';
  import type { CanvasPlan } from '$lib/layout/geometry';
  import { clampPlacement, FREE_UNIT_PX, isRenderable, readingOrder } from '$lib/layout/geometry';
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
  }
  let { container, mode, plan, dashboard, tab, folderChain, rowPx }: Props = $props();

  const parent = $derived(folderChain[folderChain.length - 1]);
  const parentId = $derived(parent ? parent.id : tab.id);
  const columns = $derived(
    Number.isFinite(container?.columns) && container.columns >= 1 ? Math.floor(container.columns) : 12
  );
  const kids = $derived(Array.isArray(container?.children) ? container.children : []);
  // Valid children in reading order, followed by unplaceable ones (readingOrder never throws).
  const ordered = $derived(readingOrder(kids) as unknown[]);

  const isRoot = $derived(folderChain.length === 0);

  // Measured content width: only nested free/grid containers outside a grid plan need it.
  let host = $state<HTMLElement | null>(null);
  let measured = $state(0);
  $effect(() => {
    if (!host) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number' && Number.isFinite(w)) measured = w;
    });
    ro.observe(host);
    return () => ro.disconnect();
  });

  // Phone/narrow plans stack every container, whatever its own mode.
  const effective = $derived<'grid' | 'free' | 'stacked'>(
    plan.kind === 'stacked' ? 'stacked' : mode === 'free' ? 'free' : 'grid'
  );
  const cellPx = $derived(
    plan.kind === 'grid' ? plan.cellPx : measured > 0 ? measured / columns : 48
  );

  // Free: columns is the design extent in 8 px units. The root uses the tab scale;
  // nested containers scale to their own measured box.
  const freeScale = $derived.by(() => {
    if (isRoot && plan.kind === 'free') return plan.scale;
    if (measured > 0) return measured / (columns * FREE_UNIT_PX);
    return plan.kind === 'free' ? plan.scale : 1;
  });
  const px = (v: number) => `${Math.round(v * 100) / 100}px`;
  const freeHeight = $derived.by(() => {
    let bottom = 0;
    for (const n of ordered) {
      if (!isRenderable(n)) continue;
      const p = clampPlacement(n.placement, columns);
      bottom = Math.max(bottom, p.y + p.h);
    }
    return bottom * FREE_UNIT_PX * freeScale;
  });
  const freeStyle = $derived(
    `position:relative;height:${px(freeHeight)};` +
      (isRoot && plan.kind === 'free' ? `width:${px(columns * FREE_UNIT_PX * freeScale)};` : 'width:100%;')
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

{#snippet nodes(styleOf: (n: LayoutNode) => string, folderStyle: (n: LayoutNode) => string)}
  {#each ordered as node, i (nodeId(node) + ':' + i)}
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
          parentRowPx={rowPx ?? cellPx}
        />
      {/if}
    {:else}
      <NodePlaceholder id={nodeId(node)} reason="missing or invalid placement/content" />
    {/if}
  {/each}
{/snippet}

{#if effective === 'grid'}
  <div class="container-grid" style={gridStyle} bind:this={host}>
    {@render nodes(cellStyle, cellStyle)}
  </div>
{:else if effective === 'free'}
  <div class="container-free" style={freeStyle} bind:this={host}>
    {@render nodes(freeCellStyle, freeCellStyle)}
  </div>
{:else}
  <!-- Phone stacking: reading order, tiles wrap at today's phone sizes, expanded folders full width. -->
  <div class="container-stacked">
    {@render nodes(
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
  .container-free {
    max-width: 100%;
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
