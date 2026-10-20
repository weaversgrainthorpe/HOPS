<script lang="ts">
  import type { HeaderConfig, Background } from '$lib/types';
  import type { LayoutDashboard, LayoutTab } from '$lib/types/layout';
  import TabCanvas from './layout/TabCanvas.svelte';
  import BackgroundSlideshow from './BackgroundSlideshow.svelte';
  import PartyMode from './PartyMode.svelte';
  import HopAnimation from './HopAnimation.svelte';
  import { layoutStale, loadConfig } from '$lib/stores/config';
  import { closeAll, openFolder, revealRequest, takeReveal, type RevealRequest } from '$lib/stores/folderOverlay';
  import { editMode } from '$lib/stores/editMode';
  import { session, apply } from '$lib/stores/editSession';
  import { initEasterEggs, destroyEasterEggs, partyModeActive } from '$lib/stores/easterEggs';
  import TabEditModal from './admin/TabEditModal.svelte';
  import HeaderConfigModal from './admin/HeaderConfigModal.svelte';
  import DashboardSettingsModal from './admin/DashboardSettingsModal.svelte';
  import BackgroundConfigModal from './admin/BackgroundConfigModal.svelte';
  import EditToolbar from './editor/EditToolbar.svelte';
  import EditorDialogs from './editor/EditorDialogs.svelte';
  import DragLayer from '$lib/editor/drag/DragLayer.svelte';
  import { tabSource } from '$lib/editor/drag/dragController';
  import {
    addTabWith, editTab, duplicateTabAction, deleteTabWithConfirm, setHeader, setBackground, setPerTabBackgrounds,
    setTabBackground, type TabFields
  } from '$lib/editor/editorActions';
  import { reorderTabs } from '$lib/editor/treeOps';
  import Icon from '@iconify/svelte';
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { toast } from '$lib/stores/toast';

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
  }
  // The tabs shown: the draft's while editing (added/renamed/reordered tabs live there), else the saved ones.
  const barTabs = $derived<BarTab[]>(
    editing ? ((draft?.tabs ?? []) as unknown as BarTab[]) : (dashboard.tabs as unknown as BarTab[])
  );
  // The dashboard-level look (background, per-tab backgrounds) the page shows: the draft's while editing.
  type Look = { background?: Background; perTabBackgrounds?: boolean; header?: HeaderConfig };
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
  let editingTabIndex = $state<number | null>(null);
  let showAddTabModal = $state(false);
  let showHeaderConfig = $state(false);
  let showDashboardSettings = $state(false);
  let showBackgroundConfig = $state(false);

  // The effective background: per-tab when enabled, else the dashboard's.
  const effectiveBackground = $derived.by(() => {
    if (look.perTabBackgrounds) return barTabs[activeTabIndex]?.background || look.background;
    return look.background;
  });

  onMount(() => {
    initEasterEggs();
  });

  onDestroy(() => {
    destroyEasterEggs();
  });

  // Clicking a tab always switches to it — even in edit mode. The per-tab
  // pencil button (rendered in edit mode) is the entry point for editing
  // the tab itself.
  function handleTabClick(index: number) {
    activeTabIndex = index;
  }

  /** Switch to a tab of the draft by id (after an add or duplicate). */
  async function showDraftTab(tabId: string | null) {
    if (!tabId) return;
    await tick();
    const i = (get(session)?.draft.tabs ?? []).findIndex((t) => t.id === tabId);
    if (i !== -1) activeTabIndex = i;
  }

  // ---- edit mode: every change edits the draft (editorActions → apply).

  function tabFields(
    name: string, icon?: string, iconUrl?: string, iconBgColor?: string, color?: string, opacity?: number,
    layout?: { layout: 'inherit' | 'grid' | 'free'; designWidth?: number }
  ): TabFields {
    return { name, icon, iconUrl, iconBgColor, color, opacity, ...(layout ?? {}) };
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
    if (editTab(tabId, tabFields(...args))) editingTabIndex = null;
  }

  function handleDuplicateTab(tabId: string) {
    const id = duplicateTabAction(tabId);
    editingTabIndex = null;
    void showDraftTab(id);
  }

  async function handleDeleteTab(tabId: string) {
    if (await deleteTabWithConfirm(tabId)) editingTabIndex = null;
  }

  function handleUpdateHeader(headerConfig: HeaderConfig) {
    if (setHeader(headerConfig)) showHeaderConfig = false;
  }

  function handleUpdateBackground(background: Background | undefined) {
    if (setBackground(background)) showBackgroundConfig = false;
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

  const inheritedLayout = $derived<'grid' | 'free'>(draft?.defaultLayout === 'free' ? 'free' : 'grid');
</script>

<div class="dashboard" class:party-mode={$partyModeActive}>
  <BackgroundSlideshow background={effectiveBackground} />
  <PartyMode />
  <HopAnimation />

  <div class="dashboard-header">
    {#if editing}
      <div class="header-actions">
        <button class="header-config-btn" onclick={() => showBackgroundConfig = true} title="Configure Background">
          <Icon icon="mdi:image-multiple" width="20" />
          Background
        </button>
        <button class="header-config-btn" onclick={() => showHeaderConfig = true} title="Configure Header">
          <Icon icon="mdi:tune" width="20" />
          Header
        </button>
        <button class="header-config-btn" onclick={() => showDashboardSettings = true} title="Dashboard settings">
          <Icon icon="mdi:cog-outline" width="20" />
          Settings
        </button>
      </div>
    {/if}

    {#if barTabs.length >= 1 || editing}
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
              <div class="tab-controls" role="group" aria-label="Tab actions">
                <button
                  class="tab-control-btn"
                  onclick={(e) => { e.stopPropagation(); editingTabIndex = index; }}
                  title="Edit tab"
                  aria-label="Edit {tab.name} tab"
                >
                  <Icon icon="mdi:pencil" width="16" />
                </button>
                <button
                  class="tab-control-btn duplicate-btn"
                  onclick={(e) => { e.stopPropagation(); handleDuplicateTab(tab.id); }}
                  title="Duplicate tab"
                  aria-label="Duplicate {tab.name} tab"
                >
                  <Icon icon="mdi:content-copy" width="16" />
                </button>
                <button
                  class="tab-control-btn delete-btn"
                  onclick={(e) => { e.stopPropagation(); void handleDeleteTab(tab.id); }}
                  title="Delete tab"
                  aria-label="Delete {tab.name} tab"
                >
                  <Icon icon="mdi:trash-can" width="16" />
                </button>
              </div>
            {/if}
          </div>
        {/each}
        {#if editing}
          <button class="add-tab-btn" onclick={handleAddTab} title="Add New Tab" aria-label="Add new tab to dashboard">
            <Icon icon="mdi:plus" width="24" />
            <span>Add Tab</span>
          </button>
        {/if}
      </div>
    {/if}
  </div>

  {#if editing}
    {#if draft}
      <div class="editor-shell">
        <EditToolbar tabId={activeTabId ?? ''} onAddTab={handleAddTab} />
      </div>
      {#if draftTab}
        <div class="canvas-panel editing">
          <TabCanvas dashboard={draft} tab={draftTab} editing />
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
      <div class="canvas-panel">
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
      <a href="/">Go to Admin Panel</a>
    </div>
  {/if}
</div>

{#if editing && showAddTabModal}
  <TabEditModal
    tabName=""
    {inheritedLayout}
    onSave={handleSaveNewTab}
    onCancel={() => (showAddTabModal = false)}
  />
{/if}

{#if editing && editingTabIndex !== null && barTabs[editingTabIndex]}
  {@const t = barTabs[editingTabIndex]}
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
      {inheritedLayout}
      perTabBackgrounds={look.perTabBackgrounds}
      onSave={(...args) => handleUpdateTab(t.id, ...args)}
      onSaveBackground={(background) => setTabBackground(t.id, background)}
      onCancel={() => (editingTabIndex = null)}
      onDelete={() => handleDeleteTab(t.id)}
      onDuplicate={() => handleDuplicateTab(t.id)}
    />
  {/key}
{/if}

{#if editing && showHeaderConfig}
  <HeaderConfigModal
    header={look.header}
    onSave={handleUpdateHeader}
    onCancel={() => showHeaderConfig = false}
  />
{/if}

{#if showDashboardSettings}
  <DashboardSettingsModal dashboardId={dashboard.id} onClose={() => showDashboardSettings = false} />
{/if}

{#if editing && showBackgroundConfig}
  <BackgroundConfigModal
    background={look.background}
    level="dashboard"
    perTabBackgrounds={look.perTabBackgrounds}
    onPerTabBackgroundsChange={(on) => setPerTabBackgrounds(on)}
    onSave={handleUpdateBackground}
    onCancel={() => showBackgroundConfig = false}
  />
{/if}

<style>
  .dashboard {
    min-height: calc(100vh - 60px);
    background-size: cover;
    background-position: center;
    background-attachment: fixed;
  }

  .canvas-panel {
    position: relative;
    padding: 2rem;
    background: rgba(15, 23, 42, var(--overlay-opacity, 0.7));
    backdrop-filter: blur(var(--overlay-blur, 10px));
    min-height: 400px;
    border-top: 1px solid var(--border);
  }

  .editor-shell {
    padding: 0.75rem 2rem 0;
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

  .header-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    margin-bottom: 1rem;
  }

  .header-config-btn {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .header-config-btn:hover {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .add-tab-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0 1.5rem;
    height: 48px;
    background: var(--bg-secondary);
    border: 2px dashed var(--border);
    border-radius: 0.5rem 0.5rem 0 0;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .add-tab-btn:hover {
    background: var(--bg-tertiary);
    border-color: var(--accent);
    color: var(--accent);
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

  .tab-controls {
    position: absolute;
    right: -0.5rem;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    gap: 0.25rem;
    opacity: 0;
    transition: opacity 0.2s;
    z-index: 10;
  }

  .tab-container:hover .tab-controls,
  .tab-container:focus-within .tab-controls {
    opacity: 1;
  }

  /* Touch devices have no hover, so the edit/duplicate/delete tab buttons
     would be unreachable without this — only entry to those actions on
     a tablet. */
  @media (hover: none) {
    .tab-controls {
      opacity: 1;
    }
  }

  .tab-control-btn {
    padding: 0;
    background: var(--bg-tertiary);
    border: none;
    border-radius: 50%;
    width: 24px;
    height: 24px;
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .tab-control-btn:hover {
    background: var(--color-warning);
    color: white;
    transform: scale(1.1);
  }

  .tab-control-btn.duplicate-btn:hover {
    background: var(--color-success);
    color: white;
  }

  .tab-control-btn.delete-btn:hover {
    background: var(--color-error-dark);
    color: white;
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
