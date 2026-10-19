<script lang="ts">
  import type { FolderNode, LayoutDashboard, LayoutTab } from '$lib/types/layout';
  import type { CanvasPlan } from '$lib/layout/geometry';
  import { clampPlacement, folderContentRowPx, isRenderable, resolveMode } from '$lib/layout/geometry';
  import { getTextColorValue } from '$lib/utils/colorContrast';
  import Icon from '@iconify/svelte';
  import ContainerView from './ContainerView.svelte';

  interface Props {
    folder: FolderNode;
    /** Grid placement CSS from the parent container. */
    style?: string;
    plan: CanvasPlan;
    dashboard: LayoutDashboard;
    tab: LayoutTab;
    /** Folders enclosing this one (outermost first); does not include `folder`. */
    folderChain: FolderNode[];
    /** Row height (px) of the container this folder sits in; sizes this folder's own rows. */
    parentRowPx: number;
  }
  let { folder, style = '', plan, dashboard, tab, folderChain, parentRowPx }: Props = $props();

  const chain = $derived([...folderChain, folder]);
  const innerMode = $derived(resolveMode(dashboard, tab, chain));
  const showTitle = $derived(folder.showTitle !== false);
  const tabLook = $derived(folder.shape === 'folder-tab');
  const textColor = $derived(
    folder.color ? getTextColorValue(folder.textColor || 'auto', folder.color) : 'inherit'
  );
  const innerColumns = $derived(
    Number.isFinite(folder.placement.w) && folder.placement.w >= 1 ? Math.floor(folder.placement.w) : 1
  );
  // Content rows = max(h-1, deepest child bottom), so a child below the folder's
  // nominal height still has a row and is shrunk-to-fit, never clipped.
  const contentRows = $derived.by(() => {
    let rows = Math.max(1, Math.floor(folder.placement.h) - 1);
    for (const c of folder.content.children) {
      if (!isRenderable(c)) continue;
      const p = clampPlacement(c.placement, innerColumns);
      rows = Math.max(rows, p.y + p.h);
    }
    return rows;
  });
  const innerRowPx = $derived(
    plan.kind === 'grid'
      ? Math.round(
          ((folderContentRowPx(folder.placement.h, parentRowPx, showTitle) *
            Math.max(1, Math.floor(folder.placement.h) - 1)) /
            contentRows) *
            100
        ) / 100
      : undefined
  );
  const inner = $derived({ columns: innerColumns, children: folder.content.children });
</script>

{#if folder.display === 'collapsed'}
  <!-- Collapsed rendering is added in a later task: a plain one-cell tile with the name. -->
  <div class="folder collapsed" data-node-id={folder.id} role="group" aria-label={folder.name} {style}>
    <span class="collapsed-name">{folder.name}</span>
  </div>
{:else}
  <div
    class="folder"
    class:folder-style={tabLook}
    data-node-id={folder.id}
    role="group"
    aria-label="{folder.name} folder"
    {style}
    style:--group-bg={folder.color || 'var(--bg-secondary)'}
    style:--group-opacity={folder.opacity !== undefined ? folder.opacity : 0.95}
    style:color={textColor}
  >
    {#if showTitle}
      <div class="folder-header" class:custom-color={folder.color}>
        {#if folder.iconUrl || folder.icon}
          <span class="folder-icon-backing" class:has-bg={folder.iconBgColor} style:background-color={folder.iconBgColor}>
            {#if folder.iconUrl}
              <img src={folder.iconUrl} alt="" class="folder-icon-img" />
            {:else if folder.icon}
              <Icon icon={folder.icon} width="24" />
            {/if}
          </span>
        {/if}
        <h3>{folder.name}</h3>
      </div>
    {/if}
    <div class="folder-body">
      <ContainerView
        container={inner}
        mode={innerMode}
        {plan}
        {dashboard}
        {tab}
        folderChain={chain}
        rowPx={innerRowPx}
      />
    </div>
  </div>
{/if}

<style>
  .folder {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    isolation: isolate;
  }
  .folder::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--group-bg, var(--bg-secondary));
    opacity: var(--group-opacity, 0.95);
    border-radius: inherit;
    z-index: -1;
  }
  .folder-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    height: 40px;
    box-sizing: border-box;
    flex: none;
  }
  .folder-header.custom-color {
    border-color: rgba(255, 255, 255, 0.2);
  }
  h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder-icon-img {
    width: 24px;
    height: 24px;
    object-fit: contain;
  }
  .folder-icon-backing {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .folder-icon-backing.has-bg {
    padding: 0.3rem;
    border-radius: 0.35rem;
  }
  .folder-body {
    padding: 0.5rem;
    flex: 1;
    min-height: 0;
  }

  /* Folder-tab look: compact tab header over a bordered body (as Group's folder-style). */
  .folder.folder-style {
    border: none;
    overflow: visible;
  }
  .folder.folder-style::before {
    display: none;
  }
  .folder.folder-style .folder-header {
    align-self: flex-start;
    position: relative;
    z-index: 2;
    border: 1px solid var(--border);
    border-bottom: none;
    border-radius: 0.5rem 0.5rem 0 0;
    background: var(--group-bg, var(--bg-secondary));
  }
  .folder.folder-style .folder-body {
    border: 1px solid var(--border);
    border-radius: 0 0.5rem 0.5rem 0.5rem;
    background: rgba(var(--bg-secondary-rgb, 30, 41, 59), 0.5);
    margin-top: -1px;
    position: relative;
    z-index: 1;
  }

  .collapsed {
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
  }
  .collapsed-name {
    font-weight: 600;
    text-align: center;
  }
</style>
