<script lang="ts">
  import type { Group, Entry as EntryType } from '$lib/types';
  import Entry from './Entry.svelte';
  import Icon from '@iconify/svelte';
  import { editMode } from '$lib/stores/editMode';
  import { confirm } from '$lib/stores/confirmModal';
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
  // svelte-ignore state_referenced_locally
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

  async function handleDeleteGroup() {
    if (!onDeleteGroup) return;

    const confirmed = await confirm({
      title: 'Delete Group',
      message: `Are you sure you want to delete "${group.name}" and all its entries?`,
      confirmText: 'Delete',
      confirmStyle: 'danger'
    });
    if (confirmed) {
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
  // svelte-ignore state_referenced_locally
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
  // svelte-ignore state_referenced_locally
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
  <div class="group-header-container">
    <div
      class="group-header"
      class:custom-color={group.color}
      style:--group-bg={group.color || 'var(--bg-secondary)'}
      style:--group-opacity={group.opacity !== undefined ? group.opacity : 0.95}
      style:color={headerTextColor}
      role="button"
      tabindex="0"
      onclick={toggleCollapse}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleCollapse(e as unknown as MouseEvent); }}
    >
      <h3>{group.name}</h3>
      <div class="group-header-right">
        <Icon icon={collapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'} width="24" />
      </div>
    </div>
    {#if $editMode}
      <div class="group-controls">
        <button
          class="group-control-btn"
          onclick={(e) => { e.stopPropagation(); showEditModal = true; }}
          title="Edit group"
        >
          <Icon icon="mdi:pencil" width="16" />
        </button>
        <button
          class="group-control-btn delete-btn"
          onclick={(e) => {
            e.stopPropagation();
            handleDeleteGroup();
          }}
          title="Delete group"
        >
          <Icon icon="mdi:trash-can" width="16" />
        </button>
      </div>
    {/if}
  </div>

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

  .group-header-container {
    position: relative;
    margin-bottom: 1rem;
  }

  .group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 1rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
  }

  .group-header::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--group-bg, var(--bg-secondary));
    opacity: var(--group-opacity, 0.95);
    border-radius: inherit;
    z-index: -1;
  }

  .group-header:hover::before {
    background: var(--group-bg, var(--bg-tertiary));
    opacity: 1;
  }

  .group-header.custom-color {
    color: white;
    border-color: rgba(255, 255, 255, 0.2);
  }

  .group-header.custom-color h3 {
    color: inherit;
  }

  .group-header.custom-color:hover {
    filter: brightness(1.1);
    border-color: rgba(255, 255, 255, 0.4);
  }

  h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    flex: 1;
  }

  .group-header-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .group-controls {
    position: absolute;
    right: 3rem;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    gap: 0.25rem;
    opacity: 0;
    transition: opacity 0.2s;
    z-index: 10;
  }

  .group-header-container:hover .group-controls {
    opacity: 1;
  }

  .group-control-btn {
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

  .group-control-btn:hover {
    background: #f59e0b;
    color: white;
    transform: scale(1.1);
  }

  .group-control-btn.delete-btn:hover {
    background: #dc2626;
    color: white;
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
