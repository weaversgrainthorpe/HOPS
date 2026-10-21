<script lang="ts">
  import type { HeaderConfig, Background } from '$lib/types';
  import type { LayoutDashboard, LayoutTab } from '$lib/types/layout';
  import TabCanvas from './layout/TabCanvas.svelte';
  import BackgroundLayer from './background/BackgroundLayer.svelte';
  import PartyMode from './PartyMode.svelte';
  import HopAnimation from './HopAnimation.svelte';
  import { layoutStale, loadConfig } from '$lib/stores/config';
  import { closeAll, openFolder, revealRequest, takeReveal, type RevealRequest } from '$lib/stores/folderOverlay';
  import { editMode } from '$lib/stores/editMode';
  import { session, apply } from '$lib/stores/editSession';
  import { initEasterEggs, destroyEasterEggs, partyModeActive } from '$lib/stores/easterEggs';
  import TabEditModal from './admin/TabEditModal.svelte';
  import DashboardEditModal from './editor/DashboardEditModal.svelte';
  import EditToolbar from './editor/EditToolbar.svelte';
  import EditorDialogs from './editor/EditorDialogs.svelte';
  import EditHandle from './editor/EditHandle.svelte';
  import { editorDialog, openDialog, openMenu, menuPointFor, showTabRequest } from '$lib/editor/editorUi';
  import DragLayer from '$lib/editor/drag/DragLayer.svelte';
  import { tabSource } from '$lib/editor/drag/dragController';
  import {
    addTabWith, editTab, duplicateTabAction, deleteTabWithConfirm,
    type TabFields
  } from '$lib/editor/editorActions';
  import { reorderTabs } from '$lib/editor/treeOps';
  import { contextForTab } from '$lib/editor/statusChecks';
  import Icon from '@iconify/svelte';
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { toast } from '$lib/stores/toast';
  import { reportBackgroundError, markBackgroundLoaded } from '$lib/stores/backgroundErrors';
  import { reducedMotion } from '$lib/stores/backgroundAnimation';

  // The route's dashboard: the stored v3 dashboard (every dashboard is editable).
  let { dashboard }: { dashboard: LayoutDashboard } = $props();
  let activeTabIndex = $state(0);

  const editing = $derived($editMode);

  // Edit mode works on the edit session's DRAFT of this dashboard (Tenet 5):
  // every change below goes through editSession.apply, and nothing is saved
  // before Save.
  const draft = $derived<LayoutDashboard | null>(
    editing && $session && $session.dashboardId === dashboard.id ? $session.draft : null
  );

  /** What the tab bar needs from a tab (saved or draft). */
  interface BarTab {
    id: string;
    name: string;
    icon?: string;
    iconUrl?: string;
    iconBgColor?: string;
    color?: string;
    opacity?: number;
    background?: Background;
    layout?: 'inherit' | 'grid' | 'free';
    designWidth?: number;
    statusChecksEnabled?: unknown;
  }
  // The tabs shown: the draft's while editing (added/renamed/reordered tabs live there), else the saved ones.
  const barTabs = $derived<BarTab[]>(
    editing ? ((draft?.tabs ?? []) as unknown as BarTab[]) : (dashboard.tabs as unknown as BarTab[])
  );
  // The dashboard-level look (background, per-tab backgrounds) the page shows: the draft's while editing.
  type Look = { background?: Background; header?: HeaderConfig };
  const look = $derived<Look>((draft ?? dashboard) as unknown as Look);

  // View mode renders the saved dashboard through the layout engine; the tab
  // is followed by id.
  const activeTabId = $derived(barTabs[activeTabIndex]?.id);
  const layoutTab = $derived(dashboard.tabs.find((t) => t.id === activeTabId));
  /** A tab the renderer can draw: it has a root container with a children list. */
  const drawable = (t: LayoutTab | undefined): t is LayoutTab =>
    !!t && !!t.root && typeof t.root === 'object' && Array.isArray(t.root.children);
  const draftTab = $derived<LayoutTab | undefined>(draft?.tabs.find((t) => t.id === activeTabId));

  // A reload, entering edit mode, or any new tabs array keeps the ACTIVE TAB
  // ID, not its index: when the tab moved, follow it. An explicit index change
  // (tab click, add, reveal) always wins, even in the same flush as new tabs.
  let heldTabs: unknown = undefined;
  let heldIndex = -1;
  let heldTabId: string | undefined = undefined;
  $effect.pre(() => {
    const tabs = barTabs;
    const idx = activeTabIndex;
    untrack(() => {
      if (tabs !== heldTabs && idx === heldIndex && heldTabId !== undefined && tabs[idx]?.id !== heldTabId) {
        const j = tabs.findIndex((t) => t.id === heldTabId);
        if (j !== -1) {
          heldTabs = tabs;
          heldIndex = j;
          activeTabIndex = j;
          return;
        }
      }
      heldTabs = tabs;
      heldIndex = idx;
      heldTabId = tabs[idx]?.id;
    });
  });

  // Keep the active index in range when tabs disappear (e.g. a reload or a deleted tab).
  $effect(() => {
    const n = barTabs.length;
    if (n > 0 && activeTabIndex >= n) untrack(() => (activeTabIndex = n - 1));
  });

  // Search asked to show a tile on this dashboard: switch tab, open the
  // collapsed folders on its path (outermost first), then focus the tile.
  $effect(() => {
    const req = $revealRequest;
    if (!req || req.dashboardId !== dashboard.id) return;
    untrack(() => {
      const taken = takeReveal(dashboard.id);
      if (taken) void reveal(taken);
    });
  });

  const nextFrame = () =>
    new Promise<void>((r) =>
      typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 16)
    );

  function findTileEl(tileId: string): HTMLElement | null {
    // The last match wins: open overlays are portalled after the canvas.
    const all = Array.from(document.querySelectorAll<HTMLElement>('[data-node-id]')).filter(
      (el) => el.getAttribute('data-node-id') === tileId && !el.closest('[inert]')
    );
    return all[all.length - 1] ?? null;
  }

  async function reveal(req: RevealRequest) {
    const idx = barTabs.findIndex((t) => t.id === req.tabId);
    if (idx === -1) {
      toast.error("Couldn't show that tile: its tab is no longer on this dashboard");
      return;
    }
    activeTabIndex = idx;
    await tick(); // let the canvas switch tab (which closes any open folders) first
    closeAll();
    for (const id of req.folderIds) openFolder(id);
    let el: HTMLElement | null = null;
    for (let i = 0; i < 60 && !el; i++) {
      await tick();
      el = findTileEl(req.tileId);
      if (!el) await nextFrame();
    }
    if (!el) {
      toast.error("Couldn't show that tile: it may have been moved or removed — reload and try again");
      return;
    }
    // After the overlay's own focus-on-open (next frame), focus the tile.
    await nextFrame();
    const target =
      el.querySelector<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? el;
    if (target === el && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    target.focus();
    target.scrollIntoView?.({ block: 'nearest' });
  }
  // The tab being edited: one editor dialog request ({kind:'tab'}), opened by the tab's handle,
  // a double-click or its menu's Edit — the same flow as every item (§4B).
  const editingTabId = $derived($editorDialog?.kind === 'tab' ? $editorDialog.id : null);
  const closeTabDialog = () => editorDialog.set(null);

  // ---- §7.2 room for the floating toolbar. The panel's bottom padding (the same in both modes) is
  // the baseline; when the toolbar reaches higher than that (it wrapped, a warning or the hint shows),
  // an edit-only spacer BELOW all content makes up the rest, so the last row can always be scrolled
  // clear of it. Space below the last row moves nothing, so view and edit positions still match.
  let editPanelEl = $state<HTMLElement | null>(null);
  let toolbarSpacerPx = $state(0);
  const TOOLBAR_GAP_PX = 8;
  function onToolbarReach(reach: number) {
    const pad = editPanelEl ? parseFloat(getComputedStyle(editPanelEl).paddingBottom) || 0 : 0;
    toolbarSpacerPx = Math.max(0, Math.ceil(reach + TOOLBAR_GAP_PX - pad));
  }
  let showAddTabModal = $state(false);
  /** The one dashboard dialog (Header, Background, Settings — walkthrough §4C). */
  let showDashboardEdit = $state(false);
  // Edit mode ending (Exit, idle timeout) closes it for good: it never reopens on the next entry.
  $effect(() => {
    if (!editing) untrack(() => (showDashboardEdit = false));
  });

  // ---- background layers (M4 Task 4, design §4a calls 1–4) ----
  // The dashboard's layer, then the active tab's own layer above it (at its
  // opacity). The inherit form (or none) draws no layer at that level.
  /** A level's own background, or undefined for none / the inherit form (a bare {inherit:true} included). */
  const ownBackground = (bg: Background | undefined): Background | undefined =>
    bg && typeof bg === 'object' && !bg.inherit && bg.type ? bg : undefined;
  const dashboardBackground = $derived(ownBackground(look.background));
  const tabBackground = $derived(ownBackground(barTabs[activeTabIndex]?.background));
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  /** The active tab's background is fully opaque: it hides the dashboard's entirely. */
  const tabOpaque = $derived(!!tabBackground && (finite(tabBackground.opacity) ? tabBackground.opacity >= 1 : true));
  // One canvas-level overlay: from the topmost FULLY OPAQUE layer — the tab
  // when it is, else the dashboard. Values are clamped (security checklist).
  const overlaySource = $derived(tabOpaque ? tabBackground : dashboardBackground);
  const overlayOpacity = $derived(
    finite(overlaySource?.overlayOpacity) ? Math.min(1, Math.max(0, overlaySource.overlayOpacity)) : 0.7
  );
  const overlayBlur = $derived(
    finite(overlaySource?.overlayBlur) ? Math.min(20, Math.max(0, overlaySource.overlayBlur)) : 10
  );
  // Reduced motion freezes both slideshows. A fully opaque tab pauses the
  // dashboard's layer: nothing more loads (nothing at all if it starts there),
  // and it resumes at its current image when a see-through tab is shown.
  const dashboardAnimates = $derived(!$reducedMotion && !tabOpaque);
  const tabAnimates = $derived(!$reducedMotion);

  onMount(() => {
    initEasterEggs();
  });

  onDestroy(() => {
    destroyEasterEggs();
  });

  // Clicking a tab always switches to it — even in edit mode. Editing the tab
  // itself is its handle, a double-click or its menu (§4B).
  function handleTabClick(index: number) {
    activeTabIndex = index;
  }

  function editTabAt(tabId: string) {
    openDialog({ kind: 'tab', id: tabId });
  }

  function tabMenu(e: MouseEvent, tabId: string) {
    e.preventDefault();
    e.stopPropagation();
    openMenu({ ...menuPointFor(e, e.currentTarget as Element), target: { kind: 'tab', id: tabId } });
  }

  // The editor (a menu Duplicate) asks to show a tab: switch to it, or say why not.
  $effect(() => {
    const want = $showTabRequest;
    if (!want) return;
    untrack(() => {
      showTabRequest.set(null);
      void showDraftTab(want).then((shown) => {
        if (!shown) toast.error("Couldn't show that tab: it is no longer on this dashboard.");
      });
    });
  });

  /** Switch to a tab of the draft by id (after an add or duplicate). */
  async function showDraftTab(tabId: string | null): Promise<boolean> {
    if (!tabId) return false;
    await tick();
    const i = (get(session)?.draft.tabs ?? []).findIndex((t) => t.id === tabId);
    if (i !== -1) activeTabIndex = i;
    return i !== -1;
  }

  // ---- edit mode: every change edits the draft (editorActions → apply).

  function tabFields(
    name: string, icon?: string, iconUrl?: string, iconBgColor?: string, color?: string, opacity?: number,
    layout?: { layout: 'inherit' | 'grid' | 'free'; designWidth?: number },
    background?: Background | null,
    statusChecksEnabled?: boolean | null
  ): TabFields {
    return {
      name, icon, iconUrl, iconBgColor, color, opacity, ...(layout ?? {}),
      ...(background !== undefined ? { background } : {}),
      ...(statusChecksEnabled !== undefined ? { statusChecksEnabled } : {})
    };
  }

  function handleAddTab() {
    showAddTabModal = true;
  }

  function handleSaveNewTab(...args: Parameters<typeof tabFields>) {
    const id = addTabWith(tabFields(...args));
    if (!id) return;
    showAddTabModal = false;
    void showDraftTab(id);
  }

  function handleUpdateTab(tabId: string, ...args: Parameters<typeof tabFields>) {
    if (editTab(tabId, tabFields(...args))) closeTabDialog();
  }

  function handleDuplicateTab(tabId: string) {
    const id = duplicateTabAction(tabId);
    if (!id) return; // apply() has already said why
    closeTabDialog();
    void showDraftTab(id);
  }

  async function handleDeleteTab(tabId: string) {
    if (await deleteTabWithConfirm(tabId)) closeTabDialog();
  }

  /** A drag (the editor's drag engine) asks to show a tab: the drag continues there. */
  function showTabForDrag(tabId: string): boolean {
    const i = barTabs.findIndex((t) => t.id === tabId);
    if (i === -1) {
      toast.error("That tab is no longer on this dashboard, so the drag stayed where it was.");
      return false;
    }
    activeTabIndex = i;
    return true;
  }

  /** Keyboard tab reorder (edit mode): Alt+Left / Alt+Right moves the focused tab one place. */
  function handleTabKey(e: KeyboardEvent, index: number) {
    if (e.key === 'Enter' || e.key === ' ') {
      handleTabClick(index);
      return;
    }
    if (!editing || !e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const to = index + (e.key === 'ArrowLeft' ? -1 : 1);
    const name = barTabs[index]?.name || 'Tab';
    if (to < 0 || to >= barTabs.length) {
      toast.info(`"${name}" is already ${to < 0 ? 'first' : 'last'} (position ${index + 1} of ${barTabs.length}).`);
      return;
    }
    const ids = barTabs.map((t) => t.id);
    [ids[index], ids[to]] = [ids[to], ids[index]];
    const focusId = ids[to];
    // The active tab is followed by id when the draft's tab order changes.
    if (apply('Reorder tabs', (d) => reorderTabs(d, ids))) {
      toast.info(`Moved "${name}" to position ${to + 1} of ${ids.length}.`);
      void tick().then(() => document.querySelector<HTMLElement>(`[data-drag-tab="${CSS.escape(focusId)}"]`)?.focus());
    }
  }

  // The tab dialog's status-check row inherits from the dashboard (M4 §4b).
  const tabStatusContext = $derived(contextForTab(draft ?? dashboard));
  const inheritedLayout = $derived<'grid' | 'free'>(draft?.defaultLayout === 'free' ? 'free' : 'grid');
</script>

<div class="dashboard" class:party-mode={$partyModeActive}>
  <BackgroundLayer
    background={dashboardBackground}
    scope="viewport"
    level="dashboard"
    animate={dashboardAnimates}
    paused={tabOpaque}
    onError={reportBackgroundError}
    onLoad={markBackgroundLoaded}
    fallbackColor="#1e293b"
  />
  <BackgroundLayer
    background={tabBackground}
    scope="viewport"
    level="tab"
    animate={tabAnimates}
    onError={reportBackgroundError}
    onLoad={markBackgroundLoaded}
    fallbackColor={barTabs[activeTabIndex]?.color || '#1e293b'}
  />
  <PartyMode />
  <HopAnimation />

  <!-- §7.2: the header and tab row are identical in both modes. Every editing control (the Dashboard
       pencil and Add tab included) is in the floating EditToolbar, which takes no layout space. -->
  <div class="dashboard-header">
    {#if barTabs.length >= 1}
      <div
        class="tabs"
        data-dashboard-tabs
        role="tablist"
        aria-label="Dashboard tabs"
        data-drag-tabbar={editing ? '' : undefined}
      >
        {#each barTabs as tab, index (tab.id)}
          <div class="tab-container" data-drag-tabbox={editing ? tab.id : undefined}>
            <div
              class="tab"
              class:active={activeTabIndex === index}
              class:custom-color={tab.color}
              class:draggable={editing}
              style:--tab-bg={tab.color || 'var(--bg-secondary)'}
              style:--tab-opacity={tab.opacity !== undefined ? tab.opacity : 0.95}
              role="tab"
              tabindex="0"
              aria-selected={activeTabIndex === index}
              aria-label={`Switch to ${tab.name} tab`}
              title={editing ? 'Drag to reorder (or Alt+Left / Alt+Right); drop items here to move them to this tab' : undefined}
              data-drag-tab={editing ? tab.id : undefined}
              use:tabSource={{ tabId: tab.id, enabled: editing }}
              onclick={() => handleTabClick(index)}
              ondblclick={editing ? () => editTabAt(tab.id) : undefined}
              oncontextmenu={editing ? (e) => tabMenu(e, tab.id) : undefined}
              onkeydown={(e) => handleTabKey(e, index)}
            >
              {#if tab.iconUrl || tab.icon}
                <span class="tab-icon-backing"
                      class:has-bg={tab.iconBgColor}
                      style:background-color={tab.iconBgColor}>
                  {#if tab.iconUrl}
                    <img src={tab.iconUrl} alt="" class="tab-icon-img" />
                  {:else if tab.icon}
                    <Icon icon={tab.icon} width="24" />
                  {/if}
                </span>
              {/if}
              <span class="tab-name">{tab.name}</span>
            </div>
            {#if editing}
              <!-- The shared edit handle, inside the tab's box: a drop on it counts as the tab. -->
              <EditHandle name="{tab.name} tab" placement="inline" onEdit={() => editTabAt(tab.id)} />
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if editing}
    {#if draft}
      <EditToolbar
        tabId={activeTabId ?? ''}
        onAddTab={handleAddTab}
        onEditDashboard={() => (showDashboardEdit = true)}
        {dashboardBackground}
        {tabBackground}
        onReach={onToolbarReach}
      />
      {#if draftTab}
        <div
          class="canvas-panel editing"
          bind:this={editPanelEl}
          style:--overlay-opacity={overlayOpacity}
          style:--overlay-blur="{overlayBlur}px"
        >
          <TabCanvas dashboard={draft} tab={draftTab} editing />
          <div class="toolbar-spacer" aria-hidden="true" style:height="{toolbarSpacerPx}px"></div>
        </div>
      {:else}
        <div class="empty-dashboard">
          <p>No tabs yet on this dashboard</p>
          <p class="hint">Tabs let you organize tiles and folders by purpose (e.g. Media, Tools, Networking).</p>
          <button class="add-first-tab-btn" onclick={handleAddTab}>
            <Icon icon="mdi:plus" width="20" />
            Add Your First Tab
          </button>
        </div>
      {/if}
      <EditorDialogs tabId={activeTabId ?? ''} />
      <DragLayer tabId={activeTabId ?? null} onSwitchTab={showTabForDrag} />
    {:else}
      <!-- Edit mode is on but no session is open for this dashboard yet (it follows the route). -->
      <div role="status" class="layout-refreshing">Starting the edit session…</div>
    {/if}
  {:else if dashboard.tabs.length > 0}
    {#if drawable(layoutTab)}
      <div class="canvas-panel" style:--overlay-opacity={overlayOpacity} style:--overlay-blur="{overlayBlur}px">
        <TabCanvas {dashboard} tab={layoutTab} />
      </div>
    {:else if $layoutStale}
      <div role="status" class="layout-refreshing">Refreshing layout…</div>
    {:else}
      <div role="alert" class="layout-missing">
        <span>Layout data missing for this tab — reload</span>
        <button type="button" onclick={() => loadConfig()}>Reload</button>
      </div>
    {/if}
  {:else}
    <div class="empty-dashboard">
      <p>No tabs yet on this dashboard</p>
      <p class="hint">Tabs let you organize tiles and folders by purpose (e.g. Media, Tools, Networking).</p>
      <a href="/settings">Open Settings</a>
    </div>
  {/if}
</div>

{#if editing && showAddTabModal}
  <TabEditModal
    tabName=""
    {inheritedLayout}
    statusContext={tabStatusContext}
    onSave={handleSaveNewTab}
    onCancel={() => (showAddTabModal = false)}
  />
{/if}

{#if editing && editingTabId !== null && barTabs.find((x) => x.id === editingTabId)}
  {@const t = barTabs.find((x) => x.id === editingTabId)!}
  {#key t.id}
    <TabEditModal
      tabName={t.name}
      tabIcon={t.icon}
      tabIconUrl={t.iconUrl}
      tabIconBgColor={t.iconBgColor}
      tabColor={t.color}
      tabOpacity={t.opacity}
      tabBackground={t.background}
      tabLayout={t.layout}
      tabDesignWidth={t.designWidth}
      tabStatusChecks={t.statusChecksEnabled}
      statusContext={tabStatusContext}
      {inheritedLayout}
      onSave={(...args) => handleUpdateTab(t.id, ...args)}
      onCancel={closeTabDialog}
      onDelete={() => handleDeleteTab(t.id)}
      onDuplicate={() => handleDuplicateTab(t.id)}
    />
  {/key}
{/if}

{#if editing && draft && showDashboardEdit}
  <DashboardEditModal
    dashboardId={dashboard.id}
    header={look.header}
    background={look.background}
    onClose={() => (showDashboardEdit = false)}
  />
{/if}

<style>
  /* A column filling the page area below the navbar (the layout's .app-page), so the
     tab panel can take the rest of the screen (walkthrough §3). */
  .dashboard {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
    background-size: cover;
    background-position: center;
    background-attachment: fixed;
  }

  /* Room below the last row for the floating edit toolbar (§7.2). The same in BOTH modes, so every
     item sits at exactly the same place in view and edit mode; the user can scroll the last row
     clear of the toolbar. Phones: the toolbar's button row scrolls sideways and stays one row. */
  .dashboard {
    --edit-toolbar-room: 4.5rem;
  }
  @media (max-width: 768px) {
    .dashboard {
      --edit-toolbar-room: 6.5rem;
    }
  }

  .canvas-panel {
    position: relative;
    padding: 2rem;
    padding-bottom: calc(2rem + var(--edit-toolbar-room));
    background: rgba(15, 23, 42, var(--overlay-opacity, 0.7));
    backdrop-filter: blur(var(--overlay-blur, 10px));
    min-height: 400px;
    /* Fills the screen below the tab bar on short content; grows with long content. */
    flex: 1 0 auto;
    border-top: 1px solid var(--border);
  }

  .layout-missing,
  .layout-refreshing {
    margin: 2rem;
    padding: 1rem 1.25rem;
    border-radius: 0.5rem;
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .layout-missing {
    background: color-mix(in srgb, var(--color-error) 15%, transparent);
    color: var(--color-error-text);
    border: 1px solid var(--color-error);
  }

  .layout-missing button {
    padding: 0.4rem 0.9rem;
    border-radius: 0.375rem;
    border: 1px solid currentColor;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .layout-refreshing {
    color: var(--text-secondary);
  }

  .dashboard-header {
    padding: 1rem 2rem 0;
    background: rgba(15, 23, 42, 0.8);
    backdrop-filter: blur(10px);
  }

  .tabs {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
    position: relative;
    z-index: 1;
  }

  /* On phones, stop wrapping tabs to multiple rows (which can push
     the whole dashboard below the fold). Scroll them horizontally
     instead — the tab strip becomes a single row the user can swipe
     through. */
  @media (max-width: 768px) {
    .tabs {
      flex-wrap: nowrap;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: thin;
    }
    .tab-container {
      flex-shrink: 0;
    }
  }

  .tab-container {
    position: relative;
    display: flex;
    align-items: center;
  }

  .tab {
    padding: 0 1.5rem;
    height: 48px;
    background: transparent;
    border: 1px solid var(--border);
    border-bottom: none;
    border-radius: 0.5rem 0.5rem 0 0;
    color: var(--text-secondary);
    font-weight: 500;
    transition: all 0.2s;
    position: relative;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .tab::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--tab-bg, var(--bg-secondary));
    opacity: var(--tab-opacity, 0.95);
    border-radius: inherit;
    z-index: -1;
  }

  .tab.draggable {
    cursor: grab;
  }

  .tab.draggable:active {
    cursor: grabbing;
  }

  .tab:hover {
    color: var(--text-primary);
  }

  .tab:hover::before {
    background: var(--tab-bg, var(--bg-tertiary));
    opacity: 1;
  }

  .tab.active {
    color: var(--text-primary);
    border-color: var(--accent);
    border-width: 2px;
    border-bottom: 2px solid var(--bg-primary);
    margin-bottom: -1px;
    z-index: 2;
  }

  .tab.active::before {
    background: var(--tab-bg, var(--bg-primary));
    opacity: 1;
  }

  .tab.active::after {
    content: '';
    position: absolute;
    top: -2px;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--accent);
    border-radius: 0.25rem 0.25rem 0 0;
  }

  .tab.custom-color {
    color: white;
    border-color: rgba(255, 255, 255, 0.3);
  }

  .tab.custom-color:hover {
    filter: brightness(1.1);
  }

  .tab.custom-color.active {
    filter: brightness(1.2);
    border-color: white;
    border-width: 2px;
    border-bottom: 2px solid var(--bg-primary);
    margin-bottom: -1px;
  }

  .tab.custom-color.active::after {
    background: white;
  }

  .tab-name {
    display: block;
  }

  .tab-icon-img {
    width: 24px;
    height: 24px;
    object-fit: contain;
  }

  /* Optional coloured backing behind the tab icon. Same pattern as
     tile / folder — invisible until iconBgColor is set. */
  .tab-icon-backing {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .tab-icon-backing.has-bg {
    padding: 0.25rem;
    border-radius: 0.3rem;
  }

  /* The tab's edit handle takes no layout space (§7.2: the tab row is identical in both modes). It sits
     inside the tab's own right padding (1.5rem), so it never covers the tab's icon or name, and it
     is inside the tab box, so a drop on it counts as the tab. It takes pointer events only while
     shown, and never during a drag (EditHandle) — hidden, it never swallows a tab click (Ruling 29). */
  .tab-container > :global(.edit-handle) {
    position: absolute;
    top: 50%;
    right: 2px;
    transform: translateY(-50%);
    z-index: 3;
    box-sizing: border-box;
    min-width: 0;
    width: 1.375rem;
    height: 1.375rem;
    padding: 0;
  }

  .empty-dashboard {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 400px;
    gap: 1rem;
    padding: 2rem;
    text-align: center;
  }

  .empty-dashboard p {
    color: var(--text-secondary);
    margin: 0;
  }

  .empty-dashboard .hint {
    font-size: 0.875rem;
    opacity: 0.8;
    max-width: 32rem;
  }

  .empty-dashboard a,
  .add-first-tab-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 0.5rem;
    text-decoration: none;
    font-size: 0.9375rem;
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-normal);
  }

  .empty-dashboard a:hover,
  .add-first-tab-btn:hover {
    background: var(--accent-hover);
  }

  /* Party mode wiggle effect */
  .dashboard.party-mode :global(.entry),
  .dashboard.party-mode :global(.tab) {
    animation: party-wiggle 0.3s ease-in-out infinite alternate;
  }

  .dashboard.party-mode :global(.entry:nth-child(2n)),
  .dashboard.party-mode :global(.tab:nth-child(2n)) {
    animation-delay: 0.1s;
  }

  .dashboard.party-mode :global(.entry:nth-child(3n)),
  .dashboard.party-mode :global(.tab:nth-child(3n)) {
    animation-delay: 0.2s;
  }

  @keyframes party-wiggle {
    0% {
      transform: rotate(-2deg) scale(1);
    }
    100% {
      transform: rotate(2deg) scale(1.02);
    }
  }
</style>
