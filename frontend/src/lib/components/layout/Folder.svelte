<script lang="ts">
  /**
   * THE folder (M5 §2, plan Task 3): one component draws every folder, everywhere, in view and edit
   * mode, on the tab and on a phone.
   * - minimised: a tile of the folder's own size (on a tab, at the top-left of the space it keeps;
   *   inside a folder, at that folder's contents size) with its name and up to four child icons;
   * - open: a box with a title bar (name or breadcrumb, edit handle in edit mode, minimise), ONE page
   *   of its items at its contents size (only the current page is drawn, Tenet 4) and a page bar
   *   only when there is more than one page;
   * - drilled: a sub-folder fills the box; the title bar becomes a breadcrumb back up.
   * Click, Enter, the menu's "Open" and Restore all open a folder in place: nothing pops over.
   * Page and drill-down are this browser's memory (folderView), never saved to the layout.
   * Task 4 reads data-folder-id / data-folder-page / data-folder-per-page (the page shown),
   * data-page-bar ("prev" / "next") and data-crumb (the folder id a crumb goes back to).
   */
  import { getContext, tick, untrack } from 'svelte';
  import type { FolderNode, LayoutDashboard, LayoutTab } from '$lib/types/layout';
  import type { CanvasPlan, ContainerMetrics } from '$lib/layout/geometry';
  import {
    FOLDER_CHROME, folderFlowMetrics, folderPaging, nodeBox, openFolderContentBox, phoneFlowMetrics, phonePaging,
    previewChildren
  } from '$lib/layout/geometry';
  import { getTextColorValue } from '$lib/utils/colorContrast';
  import Icon from '@iconify/svelte';
  import ColoredIcon from '../ColoredIcon.svelte';
  import ContainerView from './ContainerView.svelte';
  import {
    FOLDER_VIEW_CONTEXT, clearFolderView, differsFromSaved, drillTo, folderNavFor, pageReveal, resolveDrill,
    setFolderDrill, setFolderPage, setFolderView, takePageReveal, type FolderViewContext
  } from '$lib/stores/folderView';
  import { selectedNodes, toggleNode } from '$lib/stores/nodeSelection';
  import { openDialog, openMenu, menuPointFor } from '$lib/editor/editorUi';
  import { setDisplay } from '$lib/editor/editorActions';
  import { drag, dragSource } from '$lib/editor/drag/dragController';
  import { COLLAPSED_HINT } from '$lib/editor/resize';
  import { focusFolderControl } from '$lib/utils/overlayActions';
  import ResizeHandles from '../editor/ResizeHandles.svelte';
  import EditHandle from '../editor/EditHandle.svelte';
  import FolderSurface from '../background/FolderSurface.svelte';
  import BackgroundFailedBadge from '../background/BackgroundFailedBadge.svelte';

  interface Props {
    folder: FolderNode;
    /** Grid placement CSS from the container it sits in. */
    style?: string;
    plan: CanvasPlan;
    dashboard: LayoutDashboard;
    tab: LayoutTab;
    /** Folders enclosing this one (outermost first); does not include `folder`. */
    folderChain: FolderNode[];
    /** Metrics of the container this folder sits in; every inner size derives from them. */
    parent: ContainerMetrics;
    /** An item on another folder's page: always its minimised tile; opening it drills in. */
    item?: boolean;
    /** Edit mode: click selects, double-click / the handle edits, right-click = item menu. */
    editing?: boolean;
  }
  let { folder, style = '', plan, dashboard, tab, folderChain, parent, item = false, editing = false }: Props = $props();

  const minimised = $derived(item || folder.display === 'collapsed');

  // ---- editing: select, edit, menu, drag (as every item)
  const selected = $derived(editing && $selectedNodes.has(folder.id));
  function select(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation(); // an enclosing folder must not select itself too
    toggleNode(folder.id, e.ctrlKey || e.metaKey);
  }
  function menu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    openMenu({ ...menuPointFor(e, e.currentTarget as Element), target: { kind: 'node', id: folder.id } });
  }
  /** Touch long-press released without moving (Ruling 18(1)): the folder's menu. */
  const pressed = (x: number, y: number) => openMenu({ x, y, target: { kind: 'node', id: folder.id } });
  /** Every item edits the same way (§4B): the handle and a double-click open the folder dialog. */
  const edit = () => openDialog({ kind: 'folder', id: folder.id });
  const dragging = $derived(editing && ($drag?.ids.includes(folder.id) ?? false));
  /** In edit mode a control's click (and double-click) is its own: it never also selects or edits the folder. */
  function own(e: Event) {
    if (editing) e.stopPropagation();
  }

  // ---- this viewer's remembered view and the saved default (TabCanvas has already applied the view)
  const views = getContext<FolderViewContext | undefined>(FOLDER_VIEW_CONTEXT);
  const remembered = $derived(views?.remembered(folder.id));
  const saved = $derived(views?.saved(folder.id) ?? folder.display);
  const showRestore = $derived(!editing && !item && !!views && differsFromSaved(saved, remembered));

  /** The clicked control is about to unmount: hand focus to whatever replaces it. */
  async function thenFocus() {
    await tick();
    focusFolderControl(folder.id);
  }

  /**
   * Open in place (click, Enter, the menu's Open): a sub-folder on a page drills in (this browser's
   * memory, in view and edit mode alike); a folder on the tab opens into the space it kept — in edit
   * mode that is its saved default (undoable, as Minimise there), else this viewer's view.
   */
  function open() {
    if (item) {
      drillTo(dashboard.id, [...folderChain.map((f) => f.id), folder.id]);
      return;
    }
    if (editing) setDisplay(folder.id, 'expanded');
    else setFolderView(dashboard.id, folder.id, 'expanded');
    void thenFocus();
  }
  function minimise(e: Event) {
    own(e);
    if (editing) setDisplay(folder.id, 'collapsed');
    else setFolderView(dashboard.id, folder.id, 'collapsed');
    void thenFocus();
  }
  function restore(e: Event) {
    own(e);
    clearFolderView(dashboard.id, folder.id);
    void thenFocus();
  }
  function onTileKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  }

  // ---- look
  const showTitle = $derived(folder.showTitle !== false);
  const textColor = $derived(folder.color ? getTextColorValue(folder.textColor || 'auto', folder.color) : 'inherit');
  // The folder's colour look applies to its SURFACE only (FolderSurface), never to the tiles inside.
  const surfaceColor = $derived(folder.color || 'var(--bg-secondary)');
  const surfaceOpacity = $derived(folder.opacity !== undefined ? folder.opacity : 0.95);

  // ---- minimised tile
  const previews = $derived(previewChildren(folder));
  const itemCount = $derived(Array.isArray(folder.content?.children) ? folder.content.children.length : 0);
  // Children exist but none can be drawn: say so, never "Empty folder" (no silent failures).
  const unreadable = $derived(previews.length === 0 && itemCount > 0);
  const collapsedLabel = $derived(
    `${folder.name}, folder with ${itemCount} ${itemCount === 1 ? 'item' : 'items'}` +
      (unreadable ? " (can't display its contents)" : '')
  );

  // ---- open: drill-down, the page model and the page shown (one geometry source: geometry.ts)
  const nav = $derived(folderNavFor(dashboard.id));
  const drilled = $derived(minimised ? [] : resolveDrill(folder, $nav.drill[folder.id]));
  const current = $derived(drilled.length > 0 ? drilled[drilled.length - 1] : folder);
  const chainShown = $derived([...folderChain, folder, ...drilled]);
  const kids = $derived(Array.isArray(current.content?.children) ? current.content.children : []);
  // On a phone an open folder spans the stacked canvas (its width and the viewport come with the plan:
  // no extra observer, Tenet 4) and its items are the phone tab's tiles; on a tab it fills the box it
  // keeps and its items are tab cells at its contents size. One page model each (geometry.ts).
  const stacked = $derived(plan.kind === 'stacked' || !folder.placement);
  const phoneCanvasPx = $derived(plan.kind === 'stacked' ? (plan.widthPx ?? 0) : 0);
  const contentWidthPx = $derived(
    stacked ? Math.max(0, phoneCanvasPx - FOLDER_CHROME.padXPx) : openFolderContentBox(nodeBox(folder.placement!, parent)).widthPx
  );
  const asked = $derived($nav.page[current.id] ?? 0);
  const phone = $derived(
    stacked
      ? phonePaging(
          contentWidthPx,
          phoneCanvasPx,
          {
            widthPx: plan.kind === 'stacked' ? (plan.viewportWidthPx ?? phoneCanvasPx) : 0,
            heightPx: plan.kind === 'stacked' ? (plan.viewportHeightPx ?? 0) : 0
          },
          current.contentSize,
          kids.length,
          asked
        )
      : null
  );
  const paging = $derived(
    phone ??
      folderPaging(openFolderContentBox(nodeBox(folder.placement!, parent)), current.contentSize, parent.unitPx, kids.length, asked)
  );
  const metrics = $derived(phone ? phoneFlowMetrics(phone, contentWidthPx) : folderFlowMetrics(paging, parent.unitPx, contentWidthPx));
  const pageKids = $derived(kids.slice(paging.start, paging.end));
  const pageNumbers = $derived(paging.pages <= 7 ? Array.from({ length: paging.pages }, (_, i) => i) : []);

  function goPage(e: Event, n: number) {
    own(e);
    const p = Math.min(Math.max(0, n), paging.pages - 1);
    setFolderPage(dashboard.id, current.id, p);
  }
  /** A crumb: back up to that level (0 = this folder itself). */
  function goUp(e: Event, level: number) {
    own(e);
    setFolderDrill(dashboard.id, folder.id, drilled.slice(0, level).map((f) => f.id));
  }

  // Search reveal (M5 §3a.5): the folder holding the item flips to the item's page once it is shown.
  $effect(() => {
    const r = $pageReveal;
    const id = current.id;
    const perPage = paging.perPage;
    if (!r || minimised) return;
    untrack(() => {
      const taken = takePageReveal(dashboard.id, id);
      if (!taken) return;
      const idx = kids.findIndex((k) => (k as { id?: unknown } | null)?.id === taken.itemId);
      // Not here: the Dashboard's reveal reports it ("may have been moved or removed").
      if (idx >= 0) setFolderPage(dashboard.id, id, Math.floor(idx / perPage));
    });
  });
</script>

{#snippet controls()}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span class="folder-controls" ondblclick={own}>
    <button
      type="button"
      aria-label="Minimise folder"
      title={editing ? 'Minimise folder (sets how it starts)' : 'Minimise folder'}
      onclick={minimise}
    >
      <Icon icon="mdi:window-minimize" width="18" />
    </button>
    {#if showRestore}
      <button type="button" aria-label="Restore folder" title="Restore folder" onclick={restore}>
        <Icon icon="mdi:restore" width="18" />
      </button>
    {/if}
  </span>
{/snippet}

{#if minimised}
  <!-- The positioned wrapper carries the node id and placement; the tile (role=button) and
       the restore control are siblings, never nested. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="folder-slot collapsed"
    class:selected
    class:editable={editing}
    class:dragging
    data-node-id={folder.id}
    {style}
    title={editing && !item ? COLLAPSED_HINT : undefined}
    oncontextmenu={editing ? menu : undefined}
    use:dragSource={{ id: folder.id, enabled: editing, onMenu: pressed }}
  >
    <div
      class="folder tile-face folder-collapsed-tile"
      role="button"
      tabindex="0"
      aria-label={collapsedLabel}
      aria-pressed={editing ? selected : undefined}
      aria-describedby={editing && !item ? `resize-hint-${folder.id}` : undefined}
      style:color={textColor}
      onclick={(e) => (editing ? select(e) : open())}
      ondblclick={editing
        ? (e) => {
            // Edit mode: double-click edits, like every item; "Open" is in its menu (§4B).
            e.stopPropagation();
            edit();
          }
        : undefined}
      onkeydown={onTileKey}
    >
      <!-- The first image, still, behind the mini preview. -->
      <FolderSurface background={folder.background} color={surfaceColor} colorOpacity={surfaceOpacity} mode="still" dashboardId={dashboard.id} />
      <span class="collapsed-name">{folder.name}</span>
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
    </div>
    <!-- Edit mode: a failed background image, flagged on a tab outside the tile (never on its content). -->
    <BackgroundFailedBadge background={folder.background} {editing} level="folder" placement="corner" />
    {#if editing}
      {#if !item}
        <!-- The tooltip's hint, also for touch and screen readers (a minimised folder has no handles). -->
        <span id="resize-hint-{folder.id}" class="sr-only">{COLLAPSED_HINT}</span>
      {/if}
      <EditHandle name={folder.name} onEdit={edit} />
    {/if}
    {#if showRestore}
      <span class="tile-restore">
        <button type="button" class="restore-btn" aria-label="Restore folder" title="Restore folder" onclick={restore}>
          <Icon icon="mdi:restore" width="18" />
        </button>
      </span>
    {/if}
  </div>
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <div
    class="folder open"
    class:selected
    class:editable={editing}
    class:dragging
    data-node-id={folder.id}
    role="group"
    aria-label="{folder.name} folder"
    {style}
    onclick={editing ? select : undefined}
    ondblclick={editing
      ? (e) => {
          e.stopPropagation();
          edit();
        }
      : undefined}
    oncontextmenu={editing ? menu : undefined}
    use:dragSource={{ id: folder.id, enabled: editing, onMenu: pressed }}
    style:--group-bg={folder.color || 'var(--bg-secondary)'}
    style:color={textColor}
  >
    <FolderSurface background={folder.background} color={surfaceColor} colorOpacity={surfaceOpacity} mode="animated" dashboardId={dashboard.id} />
    <!-- Every open folder has its bar (M5 §3a.7): an untitled one shows only its controls, or the
         breadcrumb when drilled in. -->
    <div class="folder-header" class:custom-color={folder.color}>
      {#if drilled.length > 0}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <nav class="crumbs" aria-label="Folder path" ondblclick={own}>
          {#each [folder, ...drilled] as c, i (c.id)}
            {#if i > 0}<span class="sep" aria-hidden="true">›</span>{/if}
            {#if i === drilled.length}
              <span class="crumb current" aria-current="page">{c.name}</span>
            {:else}
              <button type="button" class="crumb" data-crumb={c.id} onclick={(e) => goUp(e, i)}>{c.name}</button>
            {/if}
          {/each}
        </nav>
      {:else if showTitle}
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
      {:else}
        <span class="title-space"></span>
      {/if}
      {#if editing}
        <!-- A zero-width slot at the end of the title: the handle hangs from it over the title's end
             (never over the failed-background warning, the controls or an inner item, and taking no
             layout space — §7.2). -->
        <span class="handle-slot">
          <EditHandle name={folder.name} onEdit={edit} placement="inline" />
        </span>
      {/if}
      <BackgroundFailedBadge background={folder.background} {editing} level="folder" placement="inline" />
      {@render controls()}
    </div>
    <!-- data-drop-area: the whole body is this folder's drop target, not just its items' rows. -->
    <div
      class="folder-body"
      data-drop-area={editing ? '' : undefined}
      data-folder-id={current.id}
      data-folder-page={paging.page}
      data-folder-per-page={paging.perPage}
    >
      {#if kids.length === 0}
        <span class="empty-note open-empty">Empty folder</span>
      {:else}
        <div class="page">
          <ContainerView
            container={{ children: pageKids }}
            {metrics}
            {plan}
            {dashboard}
            {tab}
            folderChain={chainShown}
            {editing}
          />
        </div>
      {/if}
      {#if paging.pageBar}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <nav class="page-bar" aria-label="{current.name} pages" ondblclick={own}>
          <button type="button" aria-label="First page" disabled={paging.page === 0} onclick={(e) => goPage(e, 0)}>«</button>
          <button type="button" aria-label="Previous page" data-page-bar="prev" disabled={paging.page === 0} onclick={(e) => goPage(e, paging.page - 1)}>‹</button>
          {#if pageNumbers.length > 0}
            {#each pageNumbers as n (n)}
              <button
                type="button"
                class="page-num"
                aria-label="Page {n + 1}"
                aria-current={n === paging.page ? 'page' : undefined}
                onclick={(e) => goPage(e, n)}>{n + 1}</button
              >
            {/each}
          {:else}
            <span class="page-of" aria-live="polite">Page {paging.page + 1} of {paging.pages}</span>
          {/if}
          <button type="button" aria-label="Next page" data-page-bar="next" disabled={paging.page >= paging.pages - 1} onclick={(e) => goPage(e, paging.page + 1)}>›</button>
          <button type="button" aria-label="Last page" disabled={paging.page >= paging.pages - 1} onclick={(e) => goPage(e, paging.pages - 1)}>»</button>
        </nav>
      {/if}
    </div>
    {#if editing && plan.kind !== 'stacked' && folder.placement}
      <!-- Handles on the rendered (open) box on a tab; a minimised folder has none (Ruling 13). -->
      <ResizeHandles id={folder.id} name={folder.name} metrics={parent} />
    {/if}
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
  /* geometry.FOLDER_CHROME: a 40px bar, 8px body padding, 1px border; PAGE_BAR_PX: a 32px bar. */
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
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title-space {
    flex: 1;
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
  .crumbs {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    overflow: hidden;
    white-space: nowrap;
    font-size: 1rem;
  }
  .crumb {
    background: none;
    border: none;
    color: inherit;
    opacity: 0.75;
    font: inherit;
    cursor: pointer;
    padding: 0.1rem 0.25rem;
    border-radius: 0.25rem;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .crumb:hover,
  .crumb:focus-visible {
    opacity: 1;
    text-decoration: underline;
  }
  .crumb.current {
    opacity: 1;
    font-weight: 600;
    cursor: default;
  }
  .sep {
    opacity: 0.6;
  }
  .folder-body {
    padding: 0.5rem;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .page {
    flex: none;
  }
  .page-bar {
    margin-top: auto;
    height: 32px;
    box-sizing: border-box;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
  }
  .page-bar button {
    background: none;
    border: 1px solid transparent;
    color: inherit;
    font: inherit;
    min-width: 1.75rem;
    height: 1.75rem;
    padding: 0 0.35rem;
    border-radius: 0.375rem;
    cursor: pointer;
    opacity: 0.85;
  }
  .page-bar button:hover:not(:disabled),
  .page-bar button:focus-visible {
    opacity: 1;
    background: rgba(128, 128, 128, 0.25);
  }
  .page-bar button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .page-bar button[aria-current='page'] {
    border-color: currentColor;
    font-weight: 600;
    opacity: 1;
  }
  .page-of {
    font-size: 0.875rem;
    padding: 0 0.5rem;
  }
  .folder-controls {
    display: inline-flex;
    gap: 0.25rem;
    flex: none;
  }
  .folder-controls button,
  .restore-btn {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    border-radius: 0.25rem;
    opacity: 0.8;
  }
  .folder-controls button:hover,
  .folder-controls button:focus-visible,
  .restore-btn:hover,
  .restore-btn:focus-visible {
    opacity: 1;
    background: rgba(128, 128, 128, 0.25);
  }

  .tile-face {
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
    min-height: 0;
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
  /* Edit-mode selection outline on the rendered box. */
  .folder.selected,
  .folder-slot.selected {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .folder.editable,
  .folder-slot.editable {
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .folder.dragging,
  .folder-slot.dragging {
    opacity: 0.4;
  }
  .folder-slot {
    position: relative;
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  .folder-slot > .tile-face {
    flex: 1;
    min-width: 0;
  }
  /* The edit handle: hung from a zero-width slot just left of the controls, centred in the bar.
     Shown like every handle — on the folder's hover or focus, only when no inner item is hovered /
     focused (EditHandle's own rule keys on its parent, here the slot). */
  .handle-slot {
    position: relative;
    flex: none;
    width: 0;
    align-self: stretch;
  }
  .handle-slot > :global(.edit-handle) {
    position: absolute;
    top: 50%;
    right: 0.25rem;
    transform: translateY(-50%);
    z-index: 4;
  }
  .folder:hover:not(:has([data-node-id]:hover)) > .folder-header > .handle-slot > :global(.edit-handle),
  .folder:focus-within:not(:has([data-node-id]:focus-within)) > .folder-header > .handle-slot > :global(.edit-handle) {
    opacity: 1;
    pointer-events: auto;
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
  .empty-note.open-empty {
    margin: auto;
    font-size: 0.875rem;
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
    flex-shrink: 0;
  }
</style>
