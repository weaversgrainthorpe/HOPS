<script lang="ts">
  import type { Tab, Entry, Group as GroupType, Background } from '$lib/types';
  import Group from './Group.svelte';
  import BackgroundSlideshow from './BackgroundSlideshow.svelte';
  import Icon from '@iconify/svelte';
  import { editMode } from '$lib/stores/editMode';
  import GroupEditModal from './admin/GroupEditModal.svelte';
  import { untrack } from 'svelte';
  import { dndzone } from 'svelte-dnd-action';
  import type { DndEvent } from 'svelte-dnd-action';

  interface TabInfoForEntry {
    id: string;
    name: string;
    groups: { id: string; name: string }[];
  }

  interface TabInfoForGroup {
    id: string;
    name: string;
  }

  interface Props {
    tab: Tab;
    currentTabId?: string;
    availableTabsForEntry?: TabInfoForEntry[];
    availableTabsForGroup?: TabInfoForGroup[];
    onUpdateEntry?: (groupId: string, entryId: string, updatedEntry: Entry) => void;
    onDeleteEntry?: (groupId: string, entryId: string) => void;
    onAddEntry?: (groupId: string, newEntry: Entry) => void;
    onAddGroup?: (groupName: string, icon?: string, iconUrl?: string, color?: string, opacity?: number, textColor?: 'auto' | 'light' | 'dark', displayStyle?: 'header' | 'folder') => void;
    onReorderEntries?: (groupId: string, reorderedEntries: Entry[]) => void;
    onMoveEntry?: (fromGroupId: string, toGroupId: string, entryId: string, newIndex: number) => void;
    onMoveEntryToTab?: (sourceGroupId: string, entryId: string, targetTabId: string, targetGroupId: string) => void;
    onMoveGroupToTab?: (groupId: string, targetTabId: string) => void;
    onReorderGroups?: (reorderedGroups: GroupType[]) => void;
    onUpdateGroup?: (groupId: string, updatedGroup: GroupType) => void;
    onDeleteGroup?: (groupId: string) => void;
    onDuplicateGroup?: (groupId: string) => void;
    onUpdateTabBackground?: (background: Background | undefined) => void;
    onGroupFocus?: (groupId: string) => void;
  }

  let { tab, currentTabId = '', availableTabsForEntry = [], availableTabsForGroup = [], onUpdateEntry, onDeleteEntry, onAddEntry, onAddGroup, onReorderEntries, onMoveEntry, onMoveEntryToTab, onMoveGroupToTab, onReorderGroups, onUpdateGroup, onDeleteGroup, onDuplicateGroup, onUpdateTabBackground, onGroupFocus }: Props = $props();
  let showAddGroupModal = $state(false);

  // Local groups state for drag operations
  // svelte-ignore state_referenced_locally
  let localGroups = $state<GroupType[]>([...(tab.groups || [])]);

  // Track the expected group order after a local change
  let expectedGroupOrder = $state<string[] | null>(null);

  // Flag to block sync during drag operations
  let blockSync = $state(false);

  // Sync localGroups when tab.groups changes
  $effect(() => {
    const serverGroups = tab.groups || [];
    const serverOrder = serverGroups.map(g => g.id);

    const currentExpectedOrder = untrack(() => expectedGroupOrder);
    const isBlocked = untrack(() => blockSync);

    if (isBlocked) {
      return;
    }

    if (currentExpectedOrder !== null) {
      const orderMatches = currentExpectedOrder.length === serverOrder.length &&
        currentExpectedOrder.every((id, i) => id === serverOrder[i]);

      if (orderMatches) {
        expectedGroupOrder = null;
        localGroups = [...serverGroups];
        return;
      } else {
        return;
      }
    }

    localGroups = [...serverGroups];
  });

  // Event handlers
  function handleUpdateEntry(groupId: string) {
    return (entryId: string, updatedEntry: Entry) => {
      if (onUpdateEntry) {
        onUpdateEntry(groupId, entryId, updatedEntry);
      }
    };
  }

  function handleDeleteEntry(groupId: string) {
    return (entryId: string) => {
      if (onDeleteEntry) {
        onDeleteEntry(groupId, entryId);
      }
    };
  }

  function handleAddEntry(groupId: string) {
    return (newEntry: Entry) => {
      if (onAddEntry) {
        onAddEntry(groupId, newEntry);
      }
    };
  }

  function handleAddGroupClick() {
    showAddGroupModal = true;
  }

  function handleSaveGroup(groupName: string, icon?: string, iconUrl?: string, color?: string, opacity?: number, textColor?: 'auto' | 'light' | 'dark', displayStyle?: 'header' | 'folder') {
    if (onAddGroup) {
      onAddGroup(groupName, icon, iconUrl, color, opacity, textColor, displayStyle);
    }
    showAddGroupModal = false;
  }

  function handleReorderEntries(groupId: string) {
    return (reorderedEntries: Entry[]) => {
      if (onReorderEntries) {
        onReorderEntries(groupId, reorderedEntries);
      }
    };
  }

  function handleMoveEntry(toGroupId: string) {
    return (fromGroupId: string, _toGroupId: string, entryId: string, newIndex: number) => {
      if (onMoveEntry) {
        onMoveEntry(fromGroupId, toGroupId, entryId, newIndex);
      }
    };
  }

  function handleUpdateGroup(groupId: string) {
    return (updatedGroup: GroupType) => {
      if (onUpdateGroup) {
        onUpdateGroup(groupId, updatedGroup);
      }
    };
  }

  function handleDeleteGroup(groupId: string) {
    return () => {
      if (onDeleteGroup) {
        onDeleteGroup(groupId);
      }
    };
  }

  function handleDuplicateGroup(groupId: string) {
    return () => {
      if (onDuplicateGroup) {
        onDuplicateGroup(groupId);
      }
    };
  }

  function handleMoveEntryToTab(groupId: string) {
    return (entryId: string, targetTabId: string, targetGroupId: string) => {
      if (onMoveEntryToTab) {
        onMoveEntryToTab(groupId, entryId, targetTabId, targetGroupId);
      }
    };
  }

  function handleMoveGroupToTab(groupId: string) {
    return (targetTabId: string) => {
      if (onMoveGroupToTab) {
        onMoveGroupToTab(groupId, targetTabId);
      }
    };
  }

  // svelte-dnd-action handlers for groups
  function handleDndConsider(e: CustomEvent<DndEvent<GroupType>>) {
    blockSync = true;
    localGroups = e.detail.items;
  }

  function handleDndFinalize(e: CustomEvent<DndEvent<GroupType>>) {
    const newGroups = e.detail.items;
    const reorderedGroups = newGroups.map((g, idx) => ({ ...g, order: idx }));

    localGroups = reorderedGroups;
    expectedGroupOrder = reorderedGroups.map(g => g.id);

    if (onReorderGroups) {
      onReorderGroups(reorderedGroups);
    }

    setTimeout(() => {
      blockSync = false;
    }, 300);
  }
</script>

<div class="tab-panel">
  <BackgroundSlideshow background={tab.background} />
  <div class="tab-content-wrapper">
    <div
      class="tab-content groups-list"
      use:dndzone={{
        items: localGroups,
        dragDisabled: !$editMode,
        dropFromOthersDisabled: true,
        type: 'group',
        flipDurationMs: 200
      }}
      onconsider={handleDndConsider}
      onfinalize={handleDndFinalize}
    >
      {#each localGroups as group (group.id)}
        <div class="group-wrapper">
          <Group
            {group}
            currentTabId={currentTabId}
            currentGroupId={group.id}
            availableTabsForEntry={availableTabsForEntry}
            availableTabsForGroup={availableTabsForGroup}
            onUpdateEntry={handleUpdateEntry(group.id)}
            onDeleteEntry={handleDeleteEntry(group.id)}
            onAddEntry={handleAddEntry(group.id)}
            onReorderEntries={handleReorderEntries(group.id)}
            onMoveEntry={handleMoveEntry(group.id)}
            onMoveEntryToTab={handleMoveEntryToTab(group.id)}
            onMoveGroupToTab={handleMoveGroupToTab(group.id)}
            onUpdateGroup={handleUpdateGroup(group.id)}
            onDeleteGroup={handleDeleteGroup(group.id)}
            onDuplicateGroup={handleDuplicateGroup(group.id)}
            onFocus={() => onGroupFocus?.(group.id)}
            tabId={tab.id}
          />
        </div>
      {/each}

      {#if localGroups.length === 0}
        <div class="empty-state">
          <p>No groups in this tab yet</p>
        </div>
      {/if}
    </div>

    <!-- Add Group button -->
    {#if $editMode && onAddGroup}
      <button class="add-group-btn" onclick={handleAddGroupClick}>
        <Icon icon="mdi:plus-circle" width="24" />
        <span>Add Group</span>
      </button>
    {/if}

  </div>
</div>

{#if showAddGroupModal}
  <GroupEditModal
    groupName=""
    onSave={handleSaveGroup}
    onCancel={() => showAddGroupModal = false}
  />
{/if}

<style>
  .tab-panel {
    min-height: 400px;
    background-size: cover;
    background-position: center;
  }

  .tab-content-wrapper {
    position: relative;
    padding: 2rem;
    background: rgba(15, 23, 42, 0.7);
    backdrop-filter: blur(10px);
    min-height: 400px;
    border-top: 1px solid var(--border);
  }

  /* Simple vertical list layout */
  .groups-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-height: 150px;
    padding-bottom: 120px;
  }

  .group-wrapper {
    width: 100%;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 300px;
    color: var(--text-secondary);
  }

  .add-group-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    margin-top: 1rem;
    padding: 1rem 1.5rem;
    background: var(--bg-secondary);
    border: 2px dashed var(--border);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    font-size: 1rem;
    font-weight: 500;
  }

  .add-group-btn:hover {
    background: var(--bg-tertiary);
    border-color: var(--accent);
    color: var(--accent);
    transform: translateY(-2px);
  }
</style>
