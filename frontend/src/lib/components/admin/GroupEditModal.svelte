<script lang="ts">
  import Icon from '@iconify/svelte';
  import ColorPicker from './ColorPicker.svelte';
  import OpacitySlider from './OpacitySlider.svelte';
  import IconPickerModal from './IconPickerModal.svelte';
  import { focusTrap } from '$lib/utils/focusTrap';

  interface TabInfo {
    id: string;
    name: string;
  }

  interface Props {
    groupName: string;
    groupIcon?: string;
    groupIconUrl?: string;
    groupColor?: string;
    groupOpacity?: number;
    groupTextColor?: 'auto' | 'light' | 'dark';
    groupDisplayStyle?: 'header' | 'folder';
    currentTabId?: string;
    availableTabs?: TabInfo[];
    onSave: (name: string, icon?: string, iconUrl?: string, color?: string, opacity?: number, textColor?: 'auto' | 'light' | 'dark', displayStyle?: 'header' | 'folder') => void;
    onCancel: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
    onMoveToTab?: (targetTabId: string) => void;
  }

  let { groupName, groupIcon, groupIconUrl, groupColor, groupOpacity, groupTextColor, groupDisplayStyle, currentTabId = '', availableTabs = [], onSave, onCancel, onDelete, onDuplicate, onMoveToTab }: Props = $props();
  // Form state initialized from props (intentionally captures initial values)
  // svelte-ignore state_referenced_locally
  let name = $state(groupName);
  // svelte-ignore state_referenced_locally
  let icon = $state(groupIcon || '');
  // svelte-ignore state_referenced_locally
  let iconUrl = $state(groupIconUrl || '');
  // svelte-ignore state_referenced_locally
  let color = $state(groupColor);
  // svelte-ignore state_referenced_locally
  let opacity = $state(groupOpacity);
  // svelte-ignore state_referenced_locally
  let textColor = $state<'auto' | 'light' | 'dark'>(groupTextColor || 'auto');
  // svelte-ignore state_referenced_locally
  let displayStyle = $state<'header' | 'folder'>(groupDisplayStyle || 'header');
  let showIconPicker = $state(false);

  // Move to tab state
  let showMoveSection = $state(false);
  let selectedMoveTabId = $state('');

  // Can only move if there are other tabs to move to
  const canMove = $derived(
    groupName && // Only for existing groups
    availableTabs.length > 1 &&
    onMoveToTab !== undefined
  );

  // Filter out current tab from available targets
  const moveTargetTabs = $derived(
    availableTabs.filter(t => t.id !== currentTabId)
  );

  function handleMove() {
    if (selectedMoveTabId && onMoveToTab) {
      onMoveToTab(selectedMoveTabId);
    }
  }

  function handleSave() {
    if (name.trim()) {
      onSave(name.trim(), icon || undefined, iconUrl || undefined, color, opacity, textColor, displayStyle);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (showIconPicker) {
        showIconPicker = false;
      } else {
        onCancel();
      }
    }
  }

  function handleIconSelect(selection: { icon: string; imageUrl?: string }) {
    icon = selection.icon || '';
    iconUrl = selection.imageUrl || '';
    showIconPicker = false;
  }

  function clearIcon() {
    icon = '';
    iconUrl = '';
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onCancel} onkeydown={(e) => e.key === 'Escape' && onCancel()}>
  <div
    class="modal-content"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    aria-labelledby="group-edit-title"
    tabindex="-1"
    use:focusTrap
  >
    <div class="modal-header">
      <h2 id="group-edit-title">{groupName ? 'Edit Group' : 'New Group'}</h2>
      <button class="close-btn" onclick={onCancel}>
        <Icon icon="mdi:close" width="24" />
      </button>
    </div>

    <form onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
      <div class="form-group">
        <label for="name">Group Name *</label>
        <input
          id="name"
          type="text"
          bind:value={name}
          required
          placeholder="e.g., Services, Media, Tools"
          autofocus
        />
      </div>

      <div class="form-group">
        <label>Icon (optional)</label>
        <div class="icon-input-wrapper">
          <div class="icon-input">
            {#if iconUrl}
              <div class="selected-icon-display">
                <img src={iconUrl} alt="Selected icon" class="icon-image" />
                <span class="icon-name">Image icon selected</span>
              </div>
            {:else}
              <input
                type="text"
                bind:value={icon}
                placeholder="mdi:folder"
              />
              {#if icon}
                <div class="icon-preview">
                  <Icon icon={icon} width="24" />
                </div>
              {/if}
            {/if}
          </div>
          <button
            type="button"
            class="browse-btn"
            onclick={() => showIconPicker = true}
            title="Browse icons"
          >
            <Icon icon="mdi:apps" width="18" />
            Browse
          </button>
          {#if icon || iconUrl}
            <button
              type="button"
              class="clear-btn"
              onclick={clearIcon}
              title="Clear icon"
            >
              <Icon icon="mdi:close" width="18" />
            </button>
          {/if}
        </div>
        <small>Browse presets or find icons at <a href="https://icon-sets.iconify.design/" target="_blank" rel="noopener">iconify.design</a></small>
      </div>

      <ColorPicker
        selectedColor={color}
        onSelect={(c) => color = c}
      />

      <OpacitySlider
        opacity={opacity}
        onSelect={(o) => opacity = o}
      />

      <div class="form-group">
        <label>Text Color</label>
        <div class="text-color-options">
          <button
            type="button"
            class="text-color-btn"
            class:active={textColor === 'auto'}
            onclick={() => textColor = 'auto'}
          >
            <Icon icon="mdi:auto-fix" width="20" />
            Auto
          </button>
          <button
            type="button"
            class="text-color-btn"
            class:active={textColor === 'light'}
            onclick={() => textColor = 'light'}
          >
            <Icon icon="mdi:weather-sunny" width="20" />
            Light
          </button>
          <button
            type="button"
            class="text-color-btn"
            class:active={textColor === 'dark'}
            onclick={() => textColor = 'dark'}
          >
            <Icon icon="mdi:weather-night" width="20" />
            Dark
          </button>
        </div>
        <small>Auto determines text color based on background</small>
      </div>

      <div class="form-group">
        <label>Display Style</label>
        <div class="display-style-options">
          <button
            type="button"
            class="display-style-btn"
            class:active={displayStyle === 'header'}
            onclick={() => displayStyle = 'header'}
          >
            <Icon icon="mdi:page-layout-header" width="20" />
            Full Header
          </button>
          <button
            type="button"
            class="display-style-btn"
            class:active={displayStyle === 'folder'}
            onclick={() => displayStyle = 'folder'}
          >
            <Icon icon="mdi:folder" width="20" />
            Folder Tab
          </button>
        </div>
        <small>Full header spans width, folder tab is compact</small>
      </div>

      {#if canMove}
        <div class="form-group move-section">
          <button
            type="button"
            class="btn-move-toggle"
            onclick={() => showMoveSection = !showMoveSection}
          >
            <Icon icon="mdi:folder-move" width="20" />
            Move to Another Tab
            <Icon icon={showMoveSection ? 'mdi:chevron-up' : 'mdi:chevron-down'} width="20" />
          </button>

          {#if showMoveSection}
            <div class="move-controls">
              <div class="move-row">
                <label for="move-tab">Move to:</label>
                <select
                  id="move-tab"
                  bind:value={selectedMoveTabId}
                >
                  <option value="">Select a tab...</option>
                  {#each moveTargetTabs as tab}
                    <option value={tab.id}>{tab.name}</option>
                  {/each}
                </select>
              </div>

              <button
                type="button"
                class="btn-move"
                onclick={handleMove}
                disabled={!selectedMoveTabId}
              >
                <Icon icon="mdi:check" width="18" />
                Move Group
              </button>
            </div>
          {/if}
        </div>
      {/if}

      <div class="modal-actions">
        <div class="actions-left">
          {#if groupName && onDelete}
            <button type="button" class="btn-danger" onclick={onDelete}>
              <Icon icon="mdi:trash-can" width="20" />
              Delete
            </button>
          {/if}
          {#if groupName && onDuplicate}
            <button type="button" class="btn-duplicate" onclick={onDuplicate}>
              <Icon icon="mdi:content-copy" width="20" />
              Duplicate
            </button>
          {/if}
        </div>
        <div class="actions-right">
          <button type="button" class="btn-secondary" onclick={onCancel}>
            Cancel
          </button>
          <button type="submit" class="btn-primary">
            <Icon icon="mdi:content-save" width="20" />
            {groupName ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </form>
  </div>
</div>

{#if showIconPicker}
  <IconPickerModal
    currentIcon={icon}
    currentImageUrl={iconUrl}
    onSelect={handleIconSelect}
    onCancel={() => showIconPicker = false}
  />
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal);
    padding: 1rem;
  }

  .modal-content {
    background: var(--bg-primary);
    border-radius: 0.75rem;
    width: 100%;
    max-width: 400px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.5rem;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.5rem;
    border-radius: 0.375rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  form {
    padding: 1.5rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }

  label {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  input[type="text"] {
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 1rem;
  }

  input[type="text"]:focus {
    outline: none;
    border-color: var(--accent);
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
    align-items: center;
  }

  .actions-left {
    display: flex;
    gap: 0.75rem;
  }

  .actions-right {
    display: flex;
    gap: 0.75rem;
  }

  button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1.25rem;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-primary {
    background: var(--accent);
    color: white;
  }

  .btn-primary:hover {
    background: var(--accent-hover);
  }

  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .btn-secondary:hover {
    background: var(--bg-secondary);
  }

  .btn-danger {
    background: var(--color-error-dark);
    color: white;
  }

  .btn-danger:hover {
    background: color-mix(in srgb, var(--color-error-dark) 80%, black);
  }

  .btn-duplicate {
    background: #10b981;
    color: white;
  }

  .btn-duplicate:hover {
    background: #059669;
  }

  .text-color-options {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .text-color-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border: 2px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .text-color-btn:hover {
    background: var(--bg-primary);
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .text-color-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .display-style-options {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .display-style-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border: 2px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .display-style-btn:hover {
    background: var(--bg-primary);
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .display-style-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .icon-input-wrapper {
    display: flex;
    gap: 0.5rem;
  }

  .icon-input {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
  }

  .icon-input input {
    width: 100%;
    padding-right: 2.5rem;
  }

  .icon-preview {
    position: absolute;
    right: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-primary);
  }

  .browse-btn {
    padding: 0.5rem 0.75rem;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .browse-btn:hover {
    background: var(--accent);
    color: white;
  }

  .clear-btn {
    padding: 0.5rem;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }

  .clear-btn:hover {
    background: var(--color-error);
    color: white;
  }

  .selected-icon-display {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    flex: 1;
  }

  .selected-icon-display .icon-image {
    width: 32px;
    height: 32px;
    object-fit: contain;
  }

  .selected-icon-display .icon-name {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  /* Move to tab section */
  .move-section {
    border-top: 1px solid var(--border);
    padding-top: 1rem;
    margin-top: 0.5rem;
  }

  .btn-move-toggle {
    width: 100%;
    justify-content: center;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px dashed var(--border);
  }

  .btn-move-toggle:hover {
    background: var(--bg-secondary);
    border-color: var(--accent);
  }

  .move-controls {
    margin-top: 1rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .move-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .move-row label {
    flex-shrink: 0;
    min-width: 60px;
    font-size: 0.875rem;
  }

  .move-row select {
    flex: 1;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .move-row select:focus {
    outline: none;
    border-color: var(--accent);
  }

  .btn-move {
    align-self: flex-end;
    padding: 0.5rem 1rem;
    background: var(--accent);
    color: white;
    font-size: 0.875rem;
  }

  .btn-move:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn-move:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
