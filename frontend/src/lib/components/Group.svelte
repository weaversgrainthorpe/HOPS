<script lang="ts">
  import type { Group, Entry as EntryType } from '$lib/types';
  import Entry from './Entry.svelte';
  import Icon from '@iconify/svelte';
  import { editMode } from '$lib/stores/editMode';
  import EntryEditModal from './admin/EntryEditModal.svelte';
  import GroupEditModal from './admin/GroupEditModal.svelte';
  import { dndzone } from 'svelte-dnd-action';
  import type { DndEvent } from 'svelte-dnd-action';
  import { clipboard, clearClipboard } from '$lib/stores/clipboard';
  import { getTextColorValue } from '$lib/utils/colorContrast';

  interface Props {
    group: Group;
    onUpdateEntry?: (entryId: string, updatedEntry: EntryType) => void;
    onDeleteEntry?: (entryId: string) => void;
    onAddEntry?: (newEntry: EntryType) => void;
    onReorderEntries?: (reorderedEntries: EntryType[]) => void;
    onMoveEntry?: (fromGroupId: string, toGroupId: string, entryId: string, newIndex: number) => void;
    onUpdateGroup?: (updatedGroup: Group) => void;
    onDeleteGroup?: () => void;
    onFocus?: () => void;
    tabId?: string;
  }

  let { group, onUpdateEntry, onDeleteEntry, onAddEntry, onReorderEntries, onMoveEntry, onUpdateGroup, onDeleteGroup, onFocus, tabId }: Props = $props();
  let collapsed = $state(group.collapsed || false);
  let showAddModal = $state(false);
  let showEditModal = $state(false);

  // Compute text color based on background color
  const headerTextColor = $derived(
    group.color
      ? getTextColorValue(group.textColor || 'auto', group.color)
      : 'inherit'
  );

  function toggleCollapse(e: MouseEvent) {
    // In edit mode, don't toggle - allow editing instead
    if ($editMode) {
      e.stopPropagation();
      showEditModal = true;
      return;
    }
    collapsed = !collapsed;
  }

  function handleSaveGroup(groupName: string, groupColor?: string, groupOpacity?: number, groupTextColor?: 'auto' | 'light' | 'dark') {
    if (onUpdateGroup) {
      onUpdateGroup({ ...group, name: groupName, color: groupColor, opacity: groupOpacity, textColor: groupTextColor });
    }
    showEditModal = false;
  }

  function handleDeleteGroup() {
    if (onDeleteGroup && confirm(`Are you sure you want to delete the group "${group.name}" and all its entries?`)) {
      onDeleteGroup();
    }
    showEditModal = false;
  }

  function handleUpdateEntry(entryId: string) {
    return (updatedEntry: EntryType) => {
      if (onUpdateEntry) {
        onUpdateEntry(entryId, updatedEntry);
      }
    };
  }

  function handleDeleteEntry(entryId: string) {
    return () => {
      if (onDeleteEntry) {
        onDeleteEntry(entryId);
      }
    };
  }

  function handleAddClick() {
    showAddModal = true;
  }

  function handleSaveNewEntry(newEntry: EntryType) {
    if (onAddEntry) {
      onAddEntry(newEntry);
    }
    showAddModal = false;
  }

  // Create empty entry template for new tiles
  const emptyEntry: EntryType = {
    id: '', // Will be generated on save
    name: '',
    url: '',
    icon: 'mdi:application',
    openMode: 'newtab',
    size: 'medium',
    order: group.entries.length
  };

  // Drag and drop handling
  let items = $state([...group.entries]);

  $effect(() => {
    items = [...group.entries];
  });

  function handleDndConsider(e: CustomEvent<DndEvent<EntryType>>) {
    // Tag entries with source group ID for cross-group detection
    items = e.detail.items.map(entry => ({
      ...entry,
      _sourceGroupId: group.id
    } as any));
  }

  function handleDndFinalize(e: CustomEvent<DndEvent<EntryType>>) {
    const newItems = e.detail.items;

    // Check if this is a cross-group drop (item with different groupId appeared)
    const foreignEntries = newItems.filter(item =>
      !group.entries.find(existing => existing.id === item.id)
    );

    if (foreignEntries.length > 0 && onMoveEntry) {
      // Cross-group move detected
      const movedEntry = foreignEntries[0];
      const newIndex = newItems.indexOf(movedEntry);

      // Extract source group from entry metadata (if available)
      const sourceGroupId = (movedEntry as any)._sourceGroupId || '';

      onMoveEntry(sourceGroupId, group.id, movedEntry.id, newIndex);
    } else {
      // Regular reorder within same group
      items = newItems.map((entry, index) => ({ ...entry, order: index }));
      if (onReorderEntries) {
        onReorderEntries(items);
      }
    }
  }

  function handlePaste() {
    const clipboardItem = $clipboard;
    if (!clipboardItem || clipboardItem.type !== 'entry') return;

    // Create a copy of the entry with a new ID
    const newEntry: EntryType = {
      ...clipboardItem.data,
      id: '', // Will be generated on save
      order: group.entries.length
    };

    if (onAddEntry) {
      onAddEntry(newEntry);
    }

    // Clear clipboard after paste for cut operations
    if (clipboardItem.operation === 'cut') {
      clearClipboard();
    }
  }
</script>

<div class="group" onclick={() => onFocus?.()}>
  <button
    class="group-header"
    class:custom-color={group.color}
    style:background-color={group.color}
    style:opacity={group.opacity !== undefined ? group.opacity : 0.95}
    style:color={headerTextColor}
    onclick={toggleCollapse}
  >
    <h3>{group.name}</h3>
    <Icon icon={collapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'} width="24" />
  </button>

  {#if !collapsed}
    <div
      class="entries-grid"
      use:dndzone={{
        items,
        dragDisabled: !$editMode,
        dropFromOthersDisabled: false,
        type: 'entry',
        dropTargetStyle: { outline: '2px dashed var(--accent)' }
      }}
      onconsider={handleDndConsider}
      onfinalize={handleDndFinalize}
    >
      {#each items as entry (entry.id)}
        <Entry
          {entry}
          onUpdate={handleUpdateEntry(entry.id)}
          onDelete={handleDeleteEntry(entry.id)}
          {tabId}
          groupId={group.id}
        />
      {/each}

      {#if $editMode && onAddEntry}
        <button class="add-tile-btn" onclick={handleAddClick} title="Add new tile">
          <Icon icon="mdi:plus" width="48" />
          <span>Add Tile</span>
        </button>

        {#if $clipboard?.type === 'entry'}
          <button class="paste-btn" onclick={handlePaste} title="Paste tile">
            <Icon icon="mdi:content-paste" width="48" />
            <span>Paste</span>
          </button>
        {/if}
      {/if}
    </div>
  {/if}
</div>

{#if showAddModal}
  <EntryEditModal
    entry={emptyEntry}
    onSave={handleSaveNewEntry}
    onCancel={() => showAddModal = false}
  />
{/if}

{#if showEditModal}
  <GroupEditModal
    groupName={group.name}
    groupColor={group.color}
    groupOpacity={group.opacity}
    groupTextColor={group.textColor}
    onSave={handleSaveGroup}
    onCancel={() => showEditModal = false}
    onDelete={handleDeleteGroup}
  />
{/if}

<style>
  .group {
    margin-bottom: 2rem;
  }

  .group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    cursor: pointer;
    margin-bottom: 1rem;
    transition: background 0.2s;
  }

  .group-header:hover {
    background: var(--bg-tertiary);
  }

  .group-header.custom-color {
    color: white;
    border-color: rgba(255, 255, 255, 0.2);
  }

  .group-header.custom-color h3 {
    color: white;
  }

  .group-header.custom-color:hover {
    filter: brightness(1.1);
    border-color: rgba(255, 255, 255, 0.4);
  }

  h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .entries-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 1rem;
  }

  .add-tile-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1.5rem;
    background: var(--bg-secondary);
    border: 2px dashed var(--border);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    min-height: 150px;
  }

  .add-tile-btn:hover {
    background: var(--bg-tertiary);
    border-color: var(--accent);
    color: var(--accent);
    transform: scale(1.02);
  }

  .add-tile-btn span {
    font-weight: 500;
    font-size: 0.875rem;
  }

  .paste-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1.5rem;
    background: var(--bg-secondary);
    border: 2px dashed #10b981;
    border-radius: 0.5rem;
    color: #10b981;
    cursor: pointer;
    transition: all 0.2s;
    min-height: 150px;
  }

  .paste-btn:hover {
    background: rgba(16, 185, 129, 0.1);
    border-color: #059669;
    color: #059669;
    transform: scale(1.02);
  }

  .paste-btn span {
    font-weight: 500;
    font-size: 0.875rem;
  }

  @media (max-width: 768px) {
    .entries-grid {
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    }
  }
</style>
