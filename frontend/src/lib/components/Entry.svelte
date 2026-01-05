<script lang="ts">
  import type { Entry } from '$lib/types';
  import Icon from '@iconify/svelte';
  import ColoredIcon from './ColoredIcon.svelte';
  import { editMode } from '$lib/stores/editMode';
  import { confirm } from '$lib/stores/confirmModal';
  import EntryEditModal from './admin/EntryEditModal.svelte';
  import IframeModal from './IframeModal.svelte';
  import PopupModal from './PopupModal.svelte';
  import StatusIndicator from './StatusIndicator.svelte';
  import { copyEntry, cutEntry } from '$lib/stores/clipboard';
  import { selectEntry, toggleEntrySelection, isEntrySelected, selectedEntries } from '$lib/stores/selection';
  import { safeOpenUrl, isValidUrl } from '$lib/utils/url';

  interface TabInfo {
    id: string;
    name: string;
    groups: { id: string; name: string }[];
  }

  interface Props {
    entry: Entry;
    currentTabId?: string;
    currentGroupId?: string;
    availableTabs?: TabInfo[];
    onUpdate?: (entry: Entry) => void;
    onDelete?: () => void;
    onMoveToTab?: (targetTabId: string, targetGroupId: string) => void;
    tabId?: string;
    groupId?: string;
  }

  let { entry, currentTabId = '', currentGroupId = '', availableTabs = [], onUpdate, onDelete, onMoveToTab, tabId, groupId }: Props = $props();
  let showEditModal = $state(false);
  let showIframeModal = $state(false);
  let showPopupModal = $state(false);
  let showContextMenu = $state(false);
  let contextMenuX = $state(0);
  let contextMenuY = $state(0);

  // Check if this entry is selected
  let isSelected = $derived(
    tabId && groupId ? isEntrySelected(entry.id, tabId, groupId) : false
  );

  function handleClick(e: MouseEvent) {
    // In edit mode, handle multi-select with Ctrl/Cmd key
    if ($editMode) {
      if (e.ctrlKey || e.metaKey) {
        // Toggle multi-selection
        if (tabId && groupId) {
          toggleEntrySelection(entry, tabId, groupId);
        }
        return;
      }
      // Regular click - open edit modal
      showEditModal = true;
      return;
    }

    switch (entry.openMode) {
      case 'newtab':
        safeOpenUrl(entry.url, '_blank');
        break;
      case 'sametab':
        safeOpenUrl(entry.url, '_self');
        break;
      case 'iframe':
        showIframeModal = true;
        break;
      case 'modal':
        showPopupModal = true;
        break;
      default:
        // Default to new tab if no mode specified
        safeOpenUrl(entry.url, '_blank');
        break;
    }
  }

  function handleContextMenu(e: MouseEvent) {
    if (!$editMode) return;

    e.preventDefault();
    e.stopPropagation();

    // Store this entry as the currently selected one for keyboard shortcuts
    if (tabId && groupId) {
      selectEntry(entry, tabId, groupId);
    }

    contextMenuX = e.clientX;
    contextMenuY = e.clientY;
    showContextMenu = true;
  }

  function handleCopy() {
    if (tabId && groupId) {
      copyEntry(entry, tabId, groupId);
    }
    showContextMenu = false;
  }

  function handleCut() {
    if (tabId && groupId) {
      cutEntry(entry, tabId, groupId);
    }
    showContextMenu = false;
  }

  function handleSave(updatedEntry: Entry) {
    if (onUpdate) {
      onUpdate(updatedEntry);
    }
    showEditModal = false;
  }

  async function handleDeleteClick(e: MouseEvent) {
    e.stopPropagation();
    if (!onDelete) return;

    const confirmed = await confirm({
      title: 'Delete Tile',
      message: `Are you sure you want to delete "${entry.name}"?`,
      confirmText: 'Delete',
      confirmStyle: 'danger'
    });
    if (confirmed) {
      onDelete();
    }
  }

  // Close context menu when clicking outside
  function handleWindowClick() {
    if (showContextMenu) {
      showContextMenu = false;
    }
  }

  // Get size classes
  // svelte-ignore state_referenced_locally
  const sizeClass = entry.size || 'medium';
</script>

<svelte:window onclick={handleWindowClick} />

<div class="entry-container">
  <button
    class="entry {sizeClass}"
    class:edit-mode={$editMode}
    class:custom-color={entry.color}
    class:selected={isSelected}
    style:background-color={entry.color}
    style:opacity={entry.opacity !== undefined ? entry.opacity : 0.95}
    onclick={handleClick}
    oncontextmenu={handleContextMenu}
    title={entry.description || entry.name}
    aria-label={$editMode ? `Edit ${entry.name}` : `Open ${entry.name}`}
    aria-pressed={isSelected}
  >
    <div class="title">{entry.name}</div>

    <div class="icon">
      {#if entry.iconUrl}
        <img src={entry.iconUrl} alt={entry.name} />
      {:else if entry.icon}
        <ColoredIcon icon={entry.icon} width="48" />
      {:else}
        <ColoredIcon icon="mdi:application" width="48" />
      {/if}
    </div>

    {#if entry.description}
      <div class="subtitle">{entry.description}</div>
    {/if}

    {#if entry.statusCheck?.enabled}
      <div class="status-badge">
        <StatusIndicator entryId={entry.id} />
      </div>
    {/if}
  </button>

  {#if $editMode}
    <div class="hover-controls">
      <button class="control-btn edit-btn" onclick={(e) => { e.stopPropagation(); showEditModal = true; }} title="Edit tile">
        <Icon icon="mdi:pencil" width="16" />
      </button>
      {#if onDelete}
        <button class="control-btn delete-btn" onclick={handleDeleteClick} title="Delete tile">
          <Icon icon="mdi:trash-can" width="16" />
        </button>
      {/if}
    </div>
  {/if}
</div>

{#if showEditModal}
  <EntryEditModal
    entry={entry}
    currentTabId={currentTabId}
    currentGroupId={currentGroupId}
    availableTabs={availableTabs}
    onSave={handleSave}
    onCancel={() => showEditModal = false}
    onDelete={onDelete}
    onMoveToTab={onMoveToTab ? (targetTabId, targetGroupId) => { onMoveToTab(targetTabId, targetGroupId); showEditModal = false; } : undefined}
  />
{/if}

{#if showIframeModal}
  <IframeModal url={entry.url} title={entry.name} onClose={() => showIframeModal = false} />
{/if}

{#if showPopupModal}
  <PopupModal url={entry.url} title={entry.name} onClose={() => showPopupModal = false} />
{/if}

{#if showContextMenu}
  <div
    class="context-menu"
    style="left: {contextMenuX}px; top: {contextMenuY}px;"
    role="menu"
    aria-label="Tile actions"
  >
    <button class="context-menu-item" onclick={handleCopy} role="menuitem" aria-label="Copy tile">
      <Icon icon="mdi:content-copy" width="18" />
      Copy
    </button>
    <button class="context-menu-item" onclick={handleCut} role="menuitem" aria-label="Cut tile">
      <Icon icon="mdi:content-cut" width="18" />
      Cut
    </button>
    {#if onDelete}
      <div class="context-menu-divider" role="separator"></div>
      <button class="context-menu-item danger" onclick={handleDeleteClick} role="menuitem" aria-label="Delete tile">
        <Icon icon="mdi:trash-can" width="18" />
        Delete
      </button>
    {/if}
  </div>
{/if}

<style>
  .entry-container {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .entry {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 1rem 1.5rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
    text-decoration: none;
    color: var(--text-primary);
    position: relative;
    min-height: 120px;
    width: 100%;
  }

  .entry:hover {
    background: var(--bg-tertiary);
    border-color: var(--accent);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px var(--shadow);
  }

  .title {
    font-weight: 600;
    text-align: center;
    font-size: 0.875rem;
    width: 100%;
    flex-shrink: 0;
  }

  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
    flex: 1;
  }

  .icon img {
    width: 48px;
    height: 48px;
    object-fit: contain;
  }

  .status-badge {
    position: absolute;
    top: 0.375rem;
    right: 0.375rem;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 50%;
    padding: 2px;
  }

  .subtitle {
    font-size: 0.75rem;
    color: var(--text-secondary);
    text-align: center;
    width: 100%;
    flex-shrink: 0;
  }

  /* Size variants */
  .small {
    min-height: 100px;
    padding: 0.75rem 1rem;
  }

  .small .title {
    font-size: 0.75rem;
  }

  .small .icon :global(svg) {
    width: 32px;
    height: 32px;
  }

  .small .icon img {
    width: 32px;
    height: 32px;
  }

  .small .subtitle {
    font-size: 0.65rem;
  }

  .medium {
    min-height: 120px;
  }

  .medium .icon :global(svg) {
    width: 48px;
    height: 48px;
  }

  .large {
    min-height: 160px;
    padding: 1.25rem 1.5rem;
  }

  .large .title {
    font-size: 1rem;
  }

  .large .icon :global(svg) {
    width: 64px;
    height: 64px;
  }

  .large .icon img {
    width: 64px;
    height: 64px;
  }

  .large .subtitle {
    font-size: 0.875rem;
  }

  /* Edit mode styles */
  .entry.edit-mode {
    cursor: pointer;
    border-color: #f59e0b;
  }

  .entry.edit-mode:hover {
    border-color: #f59e0b;
    box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2);
  }

  /* Custom color styles */
  .entry.custom-color {
    color: white;
    border-color: rgba(255, 255, 255, 0.2);
  }

  .entry.custom-color .title,
  .entry.custom-color .subtitle {
    color: white;
  }

  .entry.custom-color .icon {
    color: white;
  }

  .entry.custom-color:hover {
    filter: brightness(1.1);
    border-color: rgba(255, 255, 255, 0.4);
  }

  .hover-controls {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    display: flex;
    gap: 0.25rem;
    opacity: 0;
    transition: opacity 0.2s;
    z-index: 10;
  }

  .entry-container:hover .hover-controls {
    opacity: 1;
  }

  .control-btn {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: none;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
    padding: 0;
  }

  .control-btn.edit-btn:hover {
    background: #f59e0b;
    color: white;
    transform: scale(1.1);
  }

  .control-btn.delete-btn:hover {
    background: var(--color-error-dark);
    color: white;
    transform: scale(1.1);
  }

  /* Context menu */
  .context-menu {
    position: fixed;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    box-shadow: 0 4px 12px var(--shadow);
    z-index: var(--z-context-menu);
    min-width: 150px;
    padding: 0.5rem 0;
  }

  .context-menu-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 1rem;
    background: none;
    border: none;
    border-radius: 0;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s;
    font-size: 0.875rem;
    text-align: left;
  }

  .context-menu-item:hover {
    background: var(--bg-tertiary);
  }

  .context-menu-item.danger {
    color: var(--color-error-dark);
  }

  .context-menu-item.danger:hover {
    background: color-mix(in srgb, var(--color-error-dark) 10%, transparent);
  }

  .context-menu-divider {
    height: 1px;
    background: var(--border);
    margin: 0.5rem 0;
  }
</style>
