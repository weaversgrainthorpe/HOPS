<script lang="ts">
  import type { Container, FolderNode, LayoutDashboard, LayoutMode, LayoutNode, LayoutTab } from '$lib/types/layout';
  import type { CanvasPlan } from '$lib/layout/geometry';
  import { clampPlacement, isRenderable, readingOrder } from '$lib/layout/geometry';
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
  const cellPx = $derived(plan.kind === 'grid' ? plan.cellPx : 0);
  const gridStyle = $derived(
    `display:grid;grid-template-columns:${
      isRoot ? `repeat(${columns}, ${cellPx}px)` : `repeat(${columns}, minmax(0, 1fr))`
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

{#if mode === 'grid' && plan.kind === 'grid'}
  <div class="container-grid" style={gridStyle}>
    {#each ordered as node, i (nodeId(node) + ':' + i)}
      {#if isRenderable(node)}
        {#if node.kind === 'tile'}
          <div class="cell" data-node-id={node.id} style={cellStyle(node)}>
            <Entry
              entry={node}
              currentTabId={tab.id}
              currentGroupId={parentId}
              tabId={tab.id}
              groupId={parentId}
            />
          </div>
        {:else}
          <FolderView
            folder={node}
            style={cellStyle(node)}
            {plan}
            {dashboard}
            {tab}
            {folderChain}
          />
        {/if}
      {:else}
        <NodePlaceholder id={nodeId(node)} reason="missing or invalid placement/content" />
      {/if}
    {/each}
  </div>
{:else}
  <!-- Free and stacked layouts arrive in a later task; never render nothing. -->
  <div class="unsupported" role="status">
    Can't display this layout yet ({mode}/{plan.kind} is not supported).
  </div>
{/if}

<style>
  .container-grid {
    width: 100%;
  }
  .cell {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .unsupported {
    padding: 1rem;
    border: 2px dashed var(--border);
    border-radius: 0.5rem;
    color: var(--text-secondary);
  }
</style>
