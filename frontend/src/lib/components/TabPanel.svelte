<script lang="ts">
  import type { Tab, Entry, Group as GroupType, Background } from '$lib/types';
  import Group from './Group.svelte';
  import BackgroundSlideshow from './BackgroundSlideshow.svelte';
  import Icon from '@iconify/svelte';
  import { editMode } from '$lib/stores/editMode';
  import GroupEditModal from './admin/GroupEditModal.svelte';
  import { dndzone } from 'svelte-dnd-action';
  import type { DndEvent } from 'svelte-dnd-action';
  import { getTextColorValue } from '$lib/utils/colorContrast';

  interface Props {
    tab: Tab;
    onUpdateEntry?: (groupId: string, entryId: string, updatedEntry: Entry) => void;
    onDeleteEntry?: (groupId: string, entryId: string) => void;
    onAddEntry?: (groupId: string, newEntry: Entry) => void;
    onAddGroup?: (groupName: string) => void;
    onReorderEntries?: (groupId: string, reorderedEntries: Entry[]) => void;
    onMoveEntry?: (fromGroupId: string, toGroupId: string, entryId: string, newIndex: number) => void;
    onReorderGroups?: (reorderedGroups: GroupType[]) => void;
    onUpdateGroup?: (groupId: string, updatedGroup: GroupType) => void;
    onDeleteGroup?: (groupId: string) => void;
    onUpdateTabBackground?: (background: Background | undefined) => void;
    onGroupFocus?: (groupId: string) => void;
  }

  let { tab, onUpdateEntry, onDeleteEntry, onAddEntry, onAddGroup, onReorderEntries, onMoveEntry, onReorderGroups, onUpdateGroup, onDeleteGroup, onUpdateTabBackground, onGroupFocus }: Props = $props();
  let showAddGroupModal = $state(false);

  // Drag and drop handling for groups
  let groupItems = $state([...tab.groups]);

  $effect(() => {
    groupItems = [...tab.groups];
  });

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

  function handleSaveGroup(groupName: string) {
    if (onAddGroup) {
      onAddGroup(groupName);
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

  function handleGroupDndConsider(e: CustomEvent<DndEvent<GroupType>>) {
    groupItems = e.detail.items;
  }

  function handleGroupDndFinalize(e: CustomEvent<DndEvent<GroupType>>) {
    groupItems = e.detail.items;
    // Update order property for each group
    const reorderedGroups = groupItems.map((group, index) => ({
      ...group,
      order: index
    }));
    if (onReorderGroups) {
      onReorderGroups(reorderedGroups);
    }
  }
</script>

<div class="tab-panel">
  <BackgroundSlideshow background={tab.background} />
  <div
    class="tab-content"
    use:dndzone={{items: groupItems, dragDisabled: !$editMode, dropTargetStyle: {}}}
    onconsider={handleGroupDndConsider}
    onfinalize={handleGroupDndFinalize}
  >
    {#each groupItems as group (group.id)}
      <Group
        {group}
        onUpdateEntry={handleUpdateEntry(group.id)}
        onDeleteEntry={handleDeleteEntry(group.id)}
        onAddEntry={handleAddEntry(group.id)}
        onReorderEntries={handleReorderEntries(group.id)}
        onMoveEntry={handleMoveEntry(group.id)}
        onUpdateGroup={handleUpdateGroup(group.id)}
        onDeleteGroup={handleDeleteGroup(group.id)}
        onFocus={() => onGroupFocus?.(group.id)}
        tabId={tab.id}
      />
    {/each}

    {#if tab.groups.length === 0}
      <div class="empty-state">
        <p>No groups in this tab yet</p>
      </div>
    {/if}

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

  .tab-content {
    padding: 2rem;
    background: rgba(15, 23, 42, 0.7);
    backdrop-filter: blur(10px);
    min-height: 400px;
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
    gap: 0.5rem;
    padding: 1rem 1.5rem;
    background: var(--bg-secondary);
    border: 2px dashed var(--border);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    margin-top: 2rem;
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
