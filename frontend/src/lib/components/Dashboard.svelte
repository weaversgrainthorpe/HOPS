<script lang="ts">
  import type { Dashboard, Entry, HeaderConfig, Tab, Background } from '$lib/types';
  import TabPanel from './TabPanel.svelte';
  import BackgroundSlideshow from './BackgroundSlideshow.svelte';
  import { updateDashboard } from '$lib/stores/config';
  import { editMode } from '$lib/stores/editMode';
  import { isAuthenticated } from '$lib/stores/auth';
  import { clipboard } from '$lib/stores/clipboard';
  import TabEditModal from './admin/TabEditModal.svelte';
  import HeaderConfigModal from './admin/HeaderConfigModal.svelte';
  import BackgroundConfigModal from './admin/BackgroundConfigModal.svelte';
  import Icon from '@iconify/svelte';
  import { dndzone } from 'svelte-dnd-action';
  import type { DndEvent } from 'svelte-dnd-action';

  let { dashboard }: { dashboard: Dashboard } = $props();
  let activeTabIndex = $state(0);
  let editingTabIndex = $state<number | null>(null);
  let showHeaderConfig = $state(false);
  let showBackgroundConfig = $state(false);
  let draggedTabs = $state<Tab[]>([]);
  let focusedGroupId = $state<string | null>(null); // Track which group has focus for paste

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

  async function handleReorderGroups(tabId: string, reorderedGroups: any[]) {
    if (!requireAuth()) return;
    const updatedDashboard = { ...dashboard };
    const tab = updatedDashboard.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.groups = reorderedGroups;
      await updateDashboard(updatedDashboard);
    }
  }

  function makeReorderGroupsHandler(tabId: string) {
    return (reorderedGroups: any[]) => {
      handleReorderGroups(tabId, reorderedGroups);
    };
  }

  async function handleUpdateGroup(tabId: string, groupId: string, updatedGroup: any) {
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
    return (groupId: string, updatedGroup: any) => {
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

  async function handleUpdateTab(tabId: string, newName: string, newColor?: string, newOpacity?: number) {
    if (!requireAuth()) return;
    const updatedDashboard = { ...dashboard };
    const tabIndex = updatedDashboard.tabs.findIndex(t => t.id === tabId);
    if (tabIndex !== -1) {
      updatedDashboard.tabs[tabIndex] = { ...updatedDashboard.tabs[tabIndex], name: newName, color: newColor, opacity: newOpacity };
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

<div class="dashboard">
  <BackgroundSlideshow background={dashboard.background} />

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
        <button class="new-tab-btn" onclick={handleAddTab} title="Add New Tab">
          <Icon icon="mdi:plus" width="20" />
          New Tab
        </button>
      </div>
    {/if}

    {#if dashboard.tabs.length > 1}
      <div
        class="tabs"
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
          <button
            class="tab"
            class:active={activeTabIndex === index}
            class:custom-color={tab.color}
            class:draggable={$editMode}
            style:background-color={tab.color}
            style:opacity={tab.opacity !== undefined ? tab.opacity : 0.95}
            onclick={(e) => handleTabClick(index, e)}
          >
            {tab.name}
            {#if $editMode}
              <Icon icon="mdi:drag" width="16" class="drag-icon" />
            {/if}
          </button>
        {/each}
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
    tabColor={dashboard.tabs[editingTabIndex].color}
    tabOpacity={dashboard.tabs[editingTabIndex].opacity}
    onSave={(newName, newColor, newOpacity) => handleUpdateTab(dashboard.tabs[editingTabIndex].id, newName, newColor, newOpacity)}
    onCancel={() => editingTabIndex = null}
    onDelete={() => {
      if (confirm(`Are you sure you want to delete the tab "${dashboard.tabs[editingTabIndex].name}" and all its contents?`)) {
        handleDeleteTab(dashboard.tabs[editingTabIndex].id);
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

  .header-config-btn,
  .new-tab-btn {
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

  .header-config-btn:hover,
  .new-tab-btn:hover {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .new-tab-btn {
    background: #10b981;
    border-color: #10b981;
    color: white;
  }

  .new-tab-btn:hover {
    background: #059669;
    border-color: #059669;
  }

  .tabs {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
    margin-bottom: -1px;
  }

  .tab {
    padding: 0.75rem 1.5rem;
    background: var(--bg-secondary);
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

  .tab.draggable {
    cursor: grab;
  }

  .tab.draggable:active {
    cursor: grabbing;
  }

  .tab:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .drag-icon {
    opacity: 0.5;
  }

  .tab.active {
    background: var(--bg-primary);
    color: var(--text-primary);
    border-color: var(--border);
    border-bottom-color: transparent;
    z-index: 1;
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
</style>
