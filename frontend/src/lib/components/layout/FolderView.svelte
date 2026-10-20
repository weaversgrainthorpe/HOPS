<script lang="ts">
  import type { FolderNode, LayoutDashboard, LayoutTab } from '$lib/types/layout';
  import type { CanvasPlan, ContainerMetrics } from '$lib/layout/geometry';
  import { folderInnerMetrics, previewChildren } from '$lib/layout/geometry';
  import { getTextColorValue } from '$lib/utils/colorContrast';
  import Icon from '@iconify/svelte';
  import ColoredIcon from '../ColoredIcon.svelte';
  import ContainerView from './ContainerView.svelte';
  import { openFolder } from '$lib/stores/folderOverlay';
  import { getContext } from 'svelte';
  import { editMode } from '$lib/stores/editMode';
  import { FOLDER_VIEW_CONTEXT, type FolderViewContext } from '$lib/stores/folderView';
  import FolderControls from './FolderControls.svelte';

  interface Props {
    folder: FolderNode;
    /** Grid placement CSS from the parent container. */
    style?: string;
    plan: CanvasPlan;
    dashboard: LayoutDashboard;
    tab: LayoutTab;
    /** Folders enclosing this one (outermost first); does not include `folder`. */
    folderChain: FolderNode[];
    /** Metrics of the container this folder sits in; every inner size derives from them. */
    parent: ContainerMetrics;
  }
  let { folder, style = '', plan, dashboard, tab, folderChain, parent }: Props = $props();

  // This viewer's remembered view and the saved default (TabCanvas has already applied the view).
  const views = getContext<FolderViewContext | undefined>(FOLDER_VIEW_CONTEXT);
  const remembered = $derived(views?.remembered(folder.id));
  const saved = $derived(views?.saved(folder.id) ?? folder.display);
  const chain = $derived([...folderChain, folder]);
  const showTitle = $derived(folder.showTitle !== false);
  const tabLook = $derived(folder.shape === 'folder-tab');
  const textColor = $derived(
    folder.color ? getTextColorValue(folder.textColor || 'auto', folder.color) : 'inherit'
  );
  // Content box, columns, row height and mode: one source (geometry.folderInnerMetrics).
  const innerMetrics = $derived(folderInnerMetrics(folder, parent));
  const previews = $derived(previewChildren(folder));
  const itemCount = $derived(Array.isArray(folder.content?.children) ? folder.content.children.length : 0);
  // Children exist but none can be drawn: say so, never "Empty folder" (no silent failures).
  const unreadable = $derived(previews.length === 0 && itemCount > 0);
  const collapsedLabel = $derived(
    `${folder.name}, folder with ${itemCount} ${itemCount === 1 ? 'item' : 'items'}` +
      (unreadable ? " (can't display its contents)" : '')
  );

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openFolder(folder.id);
    }
  }
  const inner = $derived({ columns: innerMetrics.columns, children: folder.content.children });
</script>

{#if folder.display === 'collapsed'}
  <div
    class="folder collapsed folder-collapsed-tile"
    data-node-id={folder.id}
    role="button"
    tabindex="0"
    aria-haspopup="dialog"
    aria-label={collapsedLabel}
    {style}
    style:--group-bg={folder.color || 'var(--bg-secondary)'}
    style:--group-opacity={folder.opacity !== undefined ? folder.opacity : 0.95}
    style:color={textColor}
    onclick={() => openFolder(folder.id)}
    onkeydown={onKey}
  >
    {#if unreadable}
      <span class="empty-note unreadable">Can't display this folder's contents</span>
    {:else if previews.length === 0}
      <span class="empty-note">Empty folder</span>
    {:else}
      <div class="preview-grid">
        {#each previews as p (p.id)}
          <span class="preview-cell">
            {#if p.iconUrl}
              <img src={p.iconUrl} alt="" />
            {:else if p.icon}
              <ColoredIcon icon={p.icon} width="100%" />
            {:else}
              <ColoredIcon icon={p.kind === 'folder' ? 'mdi:folder' : 'mdi:application'} width="100%" />
            {/if}
          </span>
        {/each}
      </div>
    {/if}
    <span class="collapsed-name">{folder.name}</span>
    {#if views && !$editMode}
      <span class="tile-restore">
        <FolderControls dashboardId={views.dashboardId} folderId={folder.id} {remembered} {saved} variant="tile" />
      </span>
    {/if}
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
        {#if views && !$editMode}
          <FolderControls dashboardId={views.dashboardId} folderId={folder.id} {remembered} {saved} variant="bar" />
        {/if}
      </div>
    {/if}
    <div class="folder-body">
      <ContainerView
        container={inner}
        metrics={innerMetrics}
        {plan}
        {dashboard}
        {tab}
        folderChain={chain}
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
    position: relative;
    z-index: 1;
  }
  /* The body overlaps the tab's 1px edge (geometry.folderChrome: titlePx 39). */
  .folder.folder-style .folder-header + .folder-body {
    margin-top: -1px;
  }

  .collapsed {
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    padding: 0.5rem;
    cursor: pointer;
  }
  .preview-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.25rem;
    width: 60%;
    max-width: 64px;
  }
  .preview-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    min-width: 0;
  }
  .preview-cell img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .tile-restore {
    position: absolute;
    top: 0.15rem;
    right: 0.15rem;
  }
  .empty-note {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
  .empty-note.unreadable {
    color: var(--color-error, #dc2626);
    text-align: center;
  }
  .collapsed-name {
    font-weight: 600;
    text-align: center;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
