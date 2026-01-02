<script lang="ts">
  import type { Entry } from '$lib/types';
  import Icon from '@iconify/svelte';
  import { editMode } from '$lib/stores/editMode';
  import EntryEditModal from './admin/EntryEditModal.svelte';
  import { copyEntry, cutEntry } from '$lib/stores/clipboard';

  interface Props {
    entry: Entry;
    onUpdate?: (entry: Entry) => void;
    onDelete?: () => void;
    tabId?: string;
    groupId?: string;
  }

  let { entry, onUpdate, onDelete, tabId, groupId }: Props = $props();
  let showEditModal = $state(false);
  let showContextMenu = $state(false);
  let contextMenuX = $state(0);
  let contextMenuY = $state(0);

  function handleClick() {
    // In edit mode, open edit modal instead of navigating
    if ($editMode) {
      showEditModal = true;
      return;
    }

    switch (entry.openMode) {
      case 'newtab':
        window.open(entry.url, '_blank');
        break;
      case 'sametab':
        window.location.href = entry.url;
        break;
      case 'iframe':
        // TODO: Open in modal iframe
        window.open(entry.url, '_blank');
        break;
      case 'modal':
        // TODO: Open in popup modal
        window.open(entry.url, '_blank');
        break;
    }
  }

  function handleContextMenu(e: MouseEvent) {
    if (!$editMode) return;

    e.preventDefault();
    e.stopPropagation();
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

  function handleDeleteClick(e: MouseEvent) {
    e.stopPropagation();
    if (onDelete) {
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
  const sizeClass = entry.size || 'medium';
</script>

<svelte:window onclick={handleWindowClick} />

<button
  class="entry {sizeClass}"
  class:edit-mode={$editMode}
  class:custom-color={entry.color}
  style:background-color={entry.color}
  style:opacity={entry.opacity !== undefined ? entry.opacity : 0.95}
  onclick={handleClick}
  oncontextmenu={handleContextMenu}
  title={entry.description || entry.name}
>
  {#if $editMode}
    <div class="edit-overlay">
      <Icon icon="mdi:pencil" width="24" />
    </div>
  {/if}

  <div class="title">{entry.name}</div>

  <div class="icon">
    {#if entry.iconUrl}
      <img src={entry.iconUrl} alt={entry.name} />
    {:else if entry.icon}
      <Icon icon={entry.icon} width="48" />
    {:else}
      <Icon icon="mdi:application" width="48" />
    {/if}
  </div>

  {#if entry.description}
    <div class="subtitle">{entry.description}</div>
  {/if}

  {#if entry.statusCheck?.enabled}
    <div class="status-indicator">
      <span class="status-dot unknown" title="Status check pending"></span>
    </div>
  {/if}

  {#if $editMode && onDelete}
    <button class="delete-btn" onclick={handleDeleteClick} title="Delete tile">
      <Icon icon="mdi:close" width="16" />
    </button>
  {/if}
</button>

{#if showEditModal}
  <EntryEditModal entry={entry} onSave={handleSave} onCancel={() => showEditModal = false} onDelete={onDelete} />
{/if}

{#if showContextMenu}
  <div class="context-menu" style="left: {contextMenuX}px; top: {contextMenuY}px;">
    <button class="context-menu-item" onclick={handleCopy}>
      <Icon icon="mdi:content-copy" width="18" />
      Copy
    </button>
    <button class="context-menu-item" onclick={handleCut}>
      <Icon icon="mdi:content-cut" width="18" />
      Cut
    </button>
    {#if onDelete}
      <div class="context-menu-divider"></div>
      <button class="context-menu-item danger" onclick={handleDeleteClick}>
        <Icon icon="mdi:delete" width="18" />
        Delete
      </button>
    {/if}
  </div>
{/if}

<style>
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

  .status-indicator {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
  }

  .status-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .status-dot.online {
    background: #10b981;
  }

  .status-dot.offline {
    background: #ef4444;
  }

  .status-dot.unknown {
    background: #6b7280;
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

  .edit-overlay {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    background: #f59e0b;
    color: white;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
  }

  .entry.edit-mode:hover .edit-overlay {
    opacity: 1;
  }

  .delete-btn {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    background: #dc2626;
    color: white;
    border: none;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0;
    transition: all 0.2s;
    padding: 0;
  }

  .entry.edit-mode:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    background: #b91c1c;
    transform: scale(1.1);
  }

  /* Context menu */
  .context-menu {
    position: fixed;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    box-shadow: 0 4px 12px var(--shadow);
    z-index: 1000;
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
    color: #dc2626;
  }

  .context-menu-item.danger:hover {
    background: rgba(220, 38, 38, 0.1);
  }

  .context-menu-divider {
    height: 1px;
    background: var(--border);
    margin: 0.5rem 0;
  }
</style>
