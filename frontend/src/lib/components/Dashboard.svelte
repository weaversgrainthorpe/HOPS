<script lang="ts">
  import type { Dashboard, Entry, HeaderConfig, Tab, Background, Group } from '$lib/types';
  import TabPanel from './TabPanel.svelte';
  import BackgroundSlideshow from './BackgroundSlideshow.svelte';
  import PartyMode from './PartyMode.svelte';
  import HopAnimation from './HopAnimation.svelte';
  import { updateDashboard } from '$lib/stores/config';
  import { editMode } from '$lib/stores/editMode';
  import { isAuthenticated } from '$lib/stores/auth';
  import { clipboard } from '$lib/stores/clipboard';
  import { confirm } from '$lib/stores/confirmModal';
  import { initEasterEggs, destroyEasterEggs, partyModeActive } from '$lib/stores/easterEggs';
  import TabEditModal from './admin/TabEditModal.svelte';
  import HeaderConfigModal from './admin/HeaderConfigModal.svelte';
  import BackgroundConfigModal from './admin/BackgroundConfigModal.svelte';
  import Icon from '@iconify/svelte';
  import { dndzone } from 'svelte-dnd-action';
  import type { DndEvent } from 'svelte-dnd-action';
  import { onMount, onDestroy } from 'svelte';

  let { dashboard }: { dashboard: Dashboard } = $props();
  let activeTabIndex = $state(0);
  let editingTabIndex = $state<number | null>(null);
  let showHeaderConfig = $state(false);
  let showBackgroundConfig = $state(false);
  let draggedTabs = $state<Tab[]>([]);
  let focusedGroupId = $state<string | null>(null); // Track which group has focus for paste

  // Determine the effective background based on perTabBackgrounds setting
  const effectiveBackground = $derived(() => {
    if (dashboard.perTabBackgrounds) {
      const activeTab = dashboard.tabs[activeTabIndex];
      // Use tab background if available, otherwise fall back to dashboard background
      return activeTab?.background || dashboard.background;
    }
    return dashboard.background;
  });

  // Initialize Easter eggs
  onMount(() => {
    initEasterEggs();
  });

  onDestroy(() => {
    destroyEasterEggs();
  });

  $effect(() => {
    draggedTabs = dashboard.tabs.map(tab => ({ ...tab }));
  });

  // Helper to check authentication before edit operations
  function requireAuth(): boolean {
    if (!$isAuthenticated) {
      console.error('Edit operation requires authentication');
      return false;
    }
    return true;
  }

  // Global keyboard shortcuts
  function handleKeyboard(e: KeyboardEvent) {
    // Only handle shortcuts in edit mode
    if (!$editMode || !$isAuthenticated) return;

    // Ctrl+V or Cmd+V - Paste
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      // Don't interfere with text input paste
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const clipboardItem = $clipboard;
      if (!clipboardItem || clipboardItem.type !== 'entry') return;

      e.preventDefault();

      // Determine target group
      const activeTab = dashboard.tabs[activeTabIndex];
      if (!activeTab || activeTab.groups.length === 0) return;

      // Use focused group or first group
      let targetGroupId = focusedGroupId || activeTab.groups[0].id;

      // Paste the entry
      handleAddEntry(activeTab.id, targetGroupId, {
        ...clipboardItem.data,
        id: '', // Will be generated
        order: 0 // Will be set correctly
      });
    }
  }

  function setActiveTab(index: number) {
    activeTabIndex = index;
  }

  function handleTabClick(index: number, e: MouseEvent) {
    if ($editMode) {
      e.stopPropagation();
      editingTabIndex = index;
    } else {
      setActiveTab(index);
    }
  }

  async function handleUpdateEntry(tabId: string, groupId: string, entryId: string, updatedEntry: Entry) {
    if (!requireAuth()) return;
    // Find and update the entry in the dashboard structure
    const updatedDashboard = { ...dashboard };
    const tab = updatedDashboard.tabs.find(t => t.id === tabId);
    if (tab) {
      const group = tab.groups.find(g => g.id === groupId);
      if (group) {
        const entryIndex = group.entries.findIndex(e => e.id === entryId);
        if (entryIndex !== -1) {
          group.entries[entryIndex] = { ...updatedEntry, id: entryId };
          // Save to backend
          await updateDashboard(updatedDashboard);
        }
      }
    }
  }

  async function handleDeleteEntry(tabId: string, groupId: string, entryId: string) {
    if (!requireAuth()) return;
    // Find and delete the entry in the dashboard structure
    const updatedDashboard = { ...dashboard };
    const tab = updatedDashboard.tabs.find(t => t.id === tabId);
    if (tab) {
      const group = tab.groups.find(g => g.id === groupId);
      if (group) {
        group.entries = group.entries.filter(e => e.id !== entryId);
        // Save to backend
        await updateDashboard(updatedDashboard);
      }
    }
  }

  async function handleAddEntry(tabId: string, groupId: string, newEntry: Entry) {
    if (!requireAuth()) return;
    // Find and add the entry to the dashboard structure
    const updatedDashboard = { ...dashboard };
    const tab = updatedDashboard.tabs.find(t => t.id === tabId);
    if (tab) {
      const group = tab.groups.find(g => g.id === groupId);
      if (group) {
        // Generate a unique ID for the new entry
        const newId = `entry-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const entryWithId = { ...newEntry, id: newId, order: group.entries.length };
        group.entries.push(entryWithId);
        // Save to backend
        await updateDashboard(updatedDashboard);
      }
    }
  }

  async function handleAddGroup(tabId: string, groupName: string) {
    if (!requireAuth()) return;
    // Find and add the group to the dashboard structure
    const updatedDashboard = { ...dashboard };
    const tab = updatedDashboard.tabs.find(t => t.id === tabId);
    if (tab) {
      // Generate a unique ID for the new group
      const newId = `group-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const newGroup = {
        id: newId,
        name: groupName,
        collapsed: false,
        entries: [],
        order: tab.groups.length
      };
      tab.groups.push(newGroup);
      // Save to backend
      await updateDashboard(updatedDashboard);
    }
  }

  function makeUpdateHandler(tabId: string) {
    return (groupId: string, entryId: string, updatedEntry: Entry) => {
      handleUpdateEntry(tabId, groupId, entryId, updatedEntry);
    };
  }

  function makeDeleteHandler(tabId: string) {
    return (groupId: string, entryId: string) => {
      handleDeleteEntry(tabId, groupId, entryId);
    };
  }

  function makeAddHandler(tabId: string) {
    return (groupId: string, newEntry: Entry) => {
      handleAddEntry(tabId, groupId, newEntry);
    };
  }

  function makeAddGroupHandler(tabId: string) {
    return (groupName: string) => {
      handleAddGroup(tabId, groupName);
    };
  }

  async function handleReorderEntries(tabId: string, groupId: string, reorderedEntries: Entry[]) {
    if (!requireAuth()) return;
    // Find and update the entries in the dashboard structure
    const updatedDashboard = { ...dashboard };
    const tab = updatedDashboard.tabs.find(t => t.id === tabId);
    if (tab) {
      const group = tab.groups.find(g => g.id === groupId);
      if (group) {
        group.entries = reorderedEntries;
        // Save to backend
        await updateDashboard(updatedDashboard);
      }
    }
  }

  function makeReorderHandler(tabId: string) {
    return (groupId: string, reorderedEntries: Entry[]) => {
      handleReorderEntries(tabId, groupId, reorderedEntries);
    };
  }

  async function handleMoveEntry(
    tabId: string,
    fromGroupId: string,
    toGroupId: string,
    entryId: string,
    newIndex: number
  ) {
    if (!requireAuth()) return;

    const updatedDashboard = { ...dashboard };
    const tab = updatedDashboard.tabs.find(t => t.id === tabId);
    if (!tab) return;

    const fromGroup = tab.groups.find(g => g.id === fromGroupId);
    const toGroup = tab.groups.find(g => g.id === toGroupId);
    if (!fromGroup || !toGroup) return;

    // Find and remove entry from source group
    const entryIndex = fromGroup.entries.findIndex(e => e.id === entryId);
    if (entryIndex === -1) return;

    const [movedEntry] = fromGroup.entries.splice(entryIndex, 1);

    // Insert into target group at specified index
    toGroup.entries.splice(newIndex, 0, { ...movedEntry, order: newIndex });

    // Reorder entries in target group
    toGroup.entries = toGroup.entries.map((entry, idx) => ({
      ...entry,
      order: idx
    }));

    // Reorder remaining entries in source group
    fromGroup.entries = fromGroup.entries.map((entry, idx) => ({
      ...entry,
      order: idx
    }));

    await updateDashboard(updatedDashboard);
  }

  function makeMoveEntryHandler(tabId: string) {
    return (fromGroupId: string, toGroupId: string, entryId: string, newIndex: number) => {
      handleMoveEntry(tabId, fromGroupId, toGroupId, entryId, newIndex);
    };
  }

  async function handleReorderGroups(tabId: string, reorderedGroups: Group[]) {
    if (!requireAuth()) return;
    const updatedDashboard = { ...dashboard };
    const tab = updatedDashboard.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.groups = reorderedGroups;
      await updateDashboard(updatedDashboard);
    }
  }

  function makeReorderGroupsHandler(tabId: string) {
    return (reorderedGroups: Group[]) => {
      handleReorderGroups(tabId, reorderedGroups);
    };
  }

  async function handleUpdateGroup(tabId: string, groupId: string, updatedGroup: Partial<Group>) {
    if (!requireAuth()) return;
    const updatedDashboard = { ...dashboard };
    const tab = updatedDashboard.tabs.find(t => t.id === tabId);
    if (tab) {
      const groupIndex = tab.groups.findIndex(g => g.id === groupId);
      if (groupIndex !== -1) {
        tab.groups[groupIndex] = { ...tab.groups[groupIndex], ...updatedGroup };
        await updateDashboard(updatedDashboard);
      }
    }
  }

  function makeUpdateGroupHandler(tabId: string) {
    return (groupId: string, updatedGroup: Partial<Group>) => {
      handleUpdateGroup(tabId, groupId, updatedGroup);
    };
  }

  async function handleDeleteGroup(tabId: string, groupId: string) {
    if (!requireAuth()) return;
    const updatedDashboard = { ...dashboard };
    const tab = updatedDashboard.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.groups = tab.groups.filter(g => g.id !== groupId);
      await updateDashboard(updatedDashboard);
    }
  }

  function makeDeleteGroupHandler(tabId: string) {
    return (groupId: string) => {
      handleDeleteGroup(tabId, groupId);
    };
  }

  async function handleUpdateTab(tabId: string, newName: string, newIcon?: string, newColor?: string, newOpacity?: number) {
    if (!requireAuth()) return;
    const updatedDashboard = { ...dashboard };
    const tabIndex = updatedDashboard.tabs.findIndex(t => t.id === tabId);
    if (tabIndex !== -1) {
      updatedDashboard.tabs[tabIndex] = { ...updatedDashboard.tabs[tabIndex], name: newName, icon: newIcon, color: newColor, opacity: newOpacity };
      await updateDashboard(updatedDashboard);
    }
    editingTabIndex = null;
  }

  async function handleDeleteTab(tabId: string) {
    if (!requireAuth()) return;
    const updatedDashboard = { ...dashboard };
    updatedDashboard.tabs = updatedDashboard.tabs.filter(t => t.id !== tabId);

    // Adjust active tab if needed
    if (activeTabIndex >= updatedDashboard.tabs.length) {
      activeTabIndex = Math.max(0, updatedDashboard.tabs.length - 1);
    }

    await updateDashboard(updatedDashboard);
    editingTabIndex = null;
  }

  async function handleUpdateHeader(headerConfig: HeaderConfig) {
    if (!requireAuth()) return;
    const updatedDashboard = { ...dashboard, header: headerConfig };
    await updateDashboard(updatedDashboard);
    showHeaderConfig = false;
  }

  async function handleUpdateBackground(background: Background | undefined) {
    if (!requireAuth()) return;
    try {
      const updatedDashboard = { ...dashboard, background };
      await updateDashboard(updatedDashboard);
      showBackgroundConfig = false;
    } catch (error) {
      console.error('Failed to save background:', error);
      if (error instanceof Error && error.message.includes('401')) {
        alert('Session expired. Please login again at /admin');
      } else {
        alert('Failed to save background. Please try again.');
      }
    }
  }

  async function handlePerTabBackgroundsChange(enabled: boolean) {
    if (!requireAuth()) return;
    try {
      const updatedDashboard = { ...dashboard, perTabBackgrounds: enabled };
      await updateDashboard(updatedDashboard);
    } catch (error) {
      console.error('Failed to update perTabBackgrounds setting:', error);
    }
  }

  async function handleUpdateTabBackground(tabId: string, background: Background | undefined) {
    if (!requireAuth()) return;
    try {
      const updatedDashboard = { ...dashboard };
      const tab = updatedDashboard.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.background = background;
        await updateDashboard(updatedDashboard);
      }
    } catch (error) {
      console.error('Failed to save tab background:', error);
      if (error instanceof Error && error.message.includes('401')) {
        alert('Session expired. Please login again at /admin');
      } else {
        alert('Failed to save background. Please try again.');
      }
    }
  }

  function makeUpdateTabBackgroundHandler(tabId: string) {
    return (background: Background | undefined) => {
      handleUpdateTabBackground(tabId, background);
    };
  }

  async function handleAddTab() {
    if (!requireAuth()) return;
    const updatedDashboard = { ...dashboard };
    const newId = `tab-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const newTab: Tab = {
      id: newId,
      name: 'New Tab',
      groups: [],
      order: updatedDashboard.tabs.length
    };
    updatedDashboard.tabs.push(newTab);
    await updateDashboard(updatedDashboard);

    // Switch to the new tab
    activeTabIndex = updatedDashboard.tabs.length - 1;

    // Open edit modal for the new tab
    editingTabIndex = updatedDashboard.tabs.length - 1;
  }

  function handleTabsConsider(e: CustomEvent<DndEvent<Tab>>) {
    draggedTabs = e.detail.items;
  }

  async function handleTabsFinalize(e: CustomEvent<DndEvent<Tab>>) {
    if (!requireAuth()) return;
    draggedTabs = e.detail.items;
    const updatedDashboard = { ...dashboard };
    updatedDashboard.tabs = draggedTabs.map((tab, index) => ({ ...tab, order: index }));

    // Adjust active tab index if needed
    const activeTab = dashboard.tabs[activeTabIndex];
    const newActiveIndex = draggedTabs.findIndex(tab => tab.id === activeTab?.id);
    if (newActiveIndex !== -1) {
      activeTabIndex = newActiveIndex;
    }

    await updateDashboard(updatedDashboard);
  }
</script>

<svelte:window onkeydown={handleKeyboard} />

<div class="dashboard" class:party-mode={$partyModeActive}>
  <BackgroundSlideshow background={effectiveBackground()} />
  <PartyMode />
  <HopAnimation />

  <div class="dashboard-header">
    {#if $editMode}
      <div class="header-actions">
        <button class="header-config-btn" onclick={() => showBackgroundConfig = true} title="Configure Background">
          <Icon icon="mdi:image-multiple" width="20" />
          Background
        </button>
        <button class="header-config-btn" onclick={() => showHeaderConfig = true} title="Configure Header">
          <Icon icon="mdi:tune" width="20" />
          Header
        </button>
      </div>
    {/if}

    {#if dashboard.tabs.length >= 1}
      <div
        class="tabs"
        role="tablist"
        aria-label="Dashboard tabs"
        use:dndzone={{
          items: draggedTabs,
          flipDurationMs: 200,
          dragDisabled: !$editMode,
          dropTargetStyle: {}
        }}
        onconsider={handleTabsConsider}
        onfinalize={handleTabsFinalize}
      >
        {#each draggedTabs as tab, index (tab.id)}
          <div class="tab-container">
            <div
              class="tab"
              class:active={activeTabIndex === index}
              class:custom-color={tab.color}
              class:draggable={$editMode}
              style:--tab-bg={tab.color || 'var(--bg-secondary)'}
              style:--tab-opacity={tab.opacity !== undefined ? tab.opacity : 0.95}
              role="tab"
              tabindex="0"
              aria-selected={activeTabIndex === index}
              aria-label={$editMode ? `Edit ${tab.name} tab` : `Switch to ${tab.name} tab`}
              onclick={(e) => handleTabClick(index, e)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleTabClick(index, e as unknown as MouseEvent); }}
            >
              {#if tab.icon}
                <Icon icon={tab.icon} width="16" />
              {/if}
              <span class="tab-name">{tab.name}</span>
            </div>
            {#if $editMode}
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
                  class="tab-control-btn delete-btn"
                  onclick={async (e) => {
                    e.stopPropagation();
                    const confirmed = await confirm({
                      title: 'Delete Tab',
                      message: `Are you sure you want to delete "${tab.name}" and all its contents?`,
                      confirmText: 'Delete',
                      confirmStyle: 'danger'
                    });
                    if (confirmed) {
                      handleDeleteTab(tab.id);
                    }
                  }}
                  title="Delete tab"
                  aria-label="Delete {tab.name} tab"
                >
                  <Icon icon="mdi:trash-can" width="16" />
                </button>
              </div>
            {/if}
          </div>
        {/each}
        {#if $editMode}
          <button class="add-tab-btn" onclick={handleAddTab} title="Add New Tab" aria-label="Add new tab to dashboard">
            <Icon icon="mdi:plus" width="24" />
            <span>Add Tab</span>
          </button>
        {/if}
      </div>
    {/if}
  </div>

  {#if dashboard.tabs.length > 0}
    <TabPanel
      tab={dashboard.tabs[activeTabIndex]}
      onUpdateEntry={makeUpdateHandler(dashboard.tabs[activeTabIndex].id)}
      onDeleteEntry={makeDeleteHandler(dashboard.tabs[activeTabIndex].id)}
      onAddEntry={makeAddHandler(dashboard.tabs[activeTabIndex].id)}
      onAddGroup={makeAddGroupHandler(dashboard.tabs[activeTabIndex].id)}
      onReorderEntries={makeReorderHandler(dashboard.tabs[activeTabIndex].id)}
      onMoveEntry={makeMoveEntryHandler(dashboard.tabs[activeTabIndex].id)}
      onReorderGroups={makeReorderGroupsHandler(dashboard.tabs[activeTabIndex].id)}
      onUpdateGroup={makeUpdateGroupHandler(dashboard.tabs[activeTabIndex].id)}
      onDeleteGroup={makeDeleteGroupHandler(dashboard.tabs[activeTabIndex].id)}
      onUpdateTabBackground={makeUpdateTabBackgroundHandler(dashboard.tabs[activeTabIndex].id)}
      onGroupFocus={(groupId) => focusedGroupId = groupId}
    />
  {:else}
    <div class="empty-dashboard">
      <p>No tabs configured for this dashboard</p>
      <a href="/admin">Go to Admin Panel</a>
    </div>
  {/if}
</div>

{#if editingTabIndex !== null && dashboard.tabs[editingTabIndex]}
  <TabEditModal
    tabName={dashboard.tabs[editingTabIndex].name}
    tabIcon={dashboard.tabs[editingTabIndex].icon}
    tabColor={dashboard.tabs[editingTabIndex].color}
    tabOpacity={dashboard.tabs[editingTabIndex].opacity}
    tabBackground={dashboard.tabs[editingTabIndex].background}
    perTabBackgrounds={dashboard.perTabBackgrounds}
    onSave={(newName, newIcon, newColor, newOpacity) => handleUpdateTab(dashboard.tabs[editingTabIndex!].id, newName, newIcon, newColor, newOpacity)}
    onSaveBackground={(background) => handleUpdateTabBackground(dashboard.tabs[editingTabIndex!].id, background)}
    onCancel={() => editingTabIndex = null}
    onDelete={async () => {
      const confirmed = await confirm({
        title: 'Delete Tab',
        message: `Are you sure you want to delete "${dashboard.tabs[editingTabIndex!].name}" and all its contents?`,
        confirmText: 'Delete',
        confirmStyle: 'danger'
      });
      if (confirmed) {
        handleDeleteTab(dashboard.tabs[editingTabIndex!].id);
      }
    }}
  />
{/if}

{#if showHeaderConfig}
  <HeaderConfigModal
    header={dashboard.header}
    onSave={handleUpdateHeader}
    onCancel={() => showHeaderConfig = false}
  />
{/if}

{#if showBackgroundConfig}
  <BackgroundConfigModal
    background={dashboard.background}
    level="dashboard"
    perTabBackgrounds={dashboard.perTabBackgrounds}
    onPerTabBackgroundsChange={handlePerTabBackgroundsChange}
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

  .dashboard-header {
    padding: 1rem 2rem;
    background: rgba(15, 23, 42, 0.8);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--border);
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
    margin-bottom: -1px;
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
    border-color: var(--border);
    border-bottom-color: transparent;
    z-index: 1;
  }

  .tab.active::before {
    background: var(--tab-bg, var(--bg-primary));
    opacity: 1;
  }

  .tab.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--bg-primary);
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
    border-bottom-color: transparent;
  }

  .tab.custom-color.active::after {
    background: currentColor;
  }

  .tab-name {
    display: block;
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

  .tab-container:hover .tab-controls {
    opacity: 1;
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
    background: #f59e0b;
    color: white;
    transform: scale(1.1);
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
  }

  .empty-dashboard p {
    color: var(--text-secondary);
  }

  .empty-dashboard a {
    padding: 0.75rem 1.5rem;
    background: var(--accent);
    color: white;
    border-radius: 0.5rem;
    text-decoration: none;
  }

  .empty-dashboard a:hover {
    background: var(--accent-hover);
  }

  /* Party mode wiggle effect */
  .dashboard.party-mode :global(.entry),
  .dashboard.party-mode :global(.tab),
  .dashboard.party-mode :global(.group-header) {
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
