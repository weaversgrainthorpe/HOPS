<script lang="ts">
  import Icon from '@iconify/svelte';
  import ColoredIcon from '../ColoredIcon.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import OpacitySlider from './OpacitySlider.svelte';
  import IconEditModal from './IconEditModal.svelte';
  import Modal from '../shared/Modal.svelte';
  import { editMode } from '$lib/stores/editMode';

  // Close modal when edit mode is turned off
  $effect(() => {
    if (!$editMode) {
      onCancel();
    }
  });

  interface TabInfo {
    id: string;
    name: string;
  }

  interface Props {
    groupName: string;
    groupIcon?: string;
    groupIconUrl?: string;
    groupIconBgColor?: string;
    groupColor?: string;
    groupOpacity?: number;
    groupTextColor?: 'auto' | 'light' | 'dark';
    groupDisplayStyle?: 'header' | 'folder';
    groupWidth?: 'full' | 'half' | 'third';
    currentTabId?: string;
    availableTabs?: TabInfo[];
    onSave: (name: string, icon?: string, iconUrl?: string, iconBgColor?: string, color?: string, opacity?: number, textColor?: 'auto' | 'light' | 'dark', displayStyle?: 'header' | 'folder', width?: 'full' | 'half' | 'third') => void;
    onCancel: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
    onMoveToTab?: (targetTabId: string) => void;
    onCopyToTab?: (targetTabId: string) => void;
  }

  let { groupName, groupIcon, groupIconUrl, groupIconBgColor, groupColor, groupOpacity, groupTextColor, groupDisplayStyle, groupWidth, currentTabId = '', availableTabs = [], onSave, onCancel, onDelete, onDuplicate, onMoveToTab, onCopyToTab }: Props = $props();
  // Form state initialized from props (intentionally captures initial values)
  // svelte-ignore state_referenced_locally
  let name = $state(groupName);
  // svelte-ignore state_referenced_locally
  let icon = $state(groupIcon || '');
  // svelte-ignore state_referenced_locally
  let iconUrl = $state(groupIconUrl || '');
  // svelte-ignore state_referenced_locally
  let iconBgColor = $state<string | undefined>(groupIconBgColor);
  // svelte-ignore state_referenced_locally
  let color = $state(groupColor);
  // svelte-ignore state_referenced_locally
  let opacity = $state(groupOpacity);
  // svelte-ignore state_referenced_locally
  let textColor = $state<'auto' | 'light' | 'dark'>(groupTextColor || 'auto');
  // svelte-ignore state_referenced_locally
  let displayStyle = $state<'header' | 'folder'>(groupDisplayStyle || 'header');
  // svelte-ignore state_referenced_locally
  let width = $state<'full' | 'half' | 'third'>(groupWidth || 'full');
  let showIconEditor = $state(false);

  // Move/copy to tab state
  let showMoveSection = $state(false);
  let selectedMoveTabId = $state('');
  let isMovingOrCopying = $state(false);

  // Can only move/copy if there are other tabs available
  const canMoveOrCopy = $derived(
    groupName && // Only for existing groups
    availableTabs.length > 1 &&
    (onMoveToTab !== undefined || onCopyToTab !== undefined)
  );

  // Filter out current tab from available targets
  const moveTargetTabs = $derived(
    availableTabs.filter(t => t.id !== currentTabId)
  );

  function handleBeforeClose(): boolean {
    if (showIconEditor) {
      showIconEditor = false;
      return false;
    }
    return true;
  }

  function handleMove() {
    if (isMovingOrCopying || !selectedMoveTabId || !onMoveToTab) return;
    isMovingOrCopying = true;
    onMoveToTab(selectedMoveTabId);
  }

  function handleCopy() {
    if (isMovingOrCopying || !selectedMoveTabId || !onCopyToTab) return;
    isMovingOrCopying = true;
    onCopyToTab(selectedMoveTabId);
  }

  function handleSave() {
    if (name.trim()) {
      onSave(name.trim(), icon || undefined, iconUrl || undefined, iconBgColor, color, opacity, textColor, displayStyle, width);
    }
  }

  // Icon picking and clearing live in IconEditModal now.
</script>

<Modal
  id="group-edit"
  title={groupName ? 'Edit Group' : 'New Group'}
  onClose={onCancel}
  onBeforeClose={handleBeforeClose}
  maxWidth="480px"
>
  <form id="group-edit-form" onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
    <div class="form-group">
      <label for="name">Group Name *</label>
      <input
        id="name"
        type="text"
        bind:value={name}
        required
        placeholder="e.g., Services, Media, Tools"
      />
    </div>

    <!-- Icon: small preview + button that opens the icon sub-modal. -->
    <div class="form-group">
      <label>Icon (optional)</label>
      <button type="button" class="icon-summary" onclick={() => showIconEditor = true}>
        <span class="icon-preview-tile"
              class:has-bg={iconBgColor}
              style:background-color={iconBgColor}>
          {#if iconUrl}
            <img src={iconUrl} alt="" />
          {:else if icon}
            <ColoredIcon {icon} width="28" />
          {:else}
            <ColoredIcon icon="mdi:folder-outline" width="28" />
          {/if}
        </span>
        <span class="icon-summary-text">
          {#if iconUrl}
            Custom icon
          {:else if icon}
            <code>{icon}</code>
          {:else}
            No icon
          {/if}
        </span>
        <span class="edit-cta">
          <Icon icon="mdi:pencil" width="16" />
          Edit icon
        </span>
      </button>
    </div>

    <ColorPicker
      selectedColor={color}
      onSelect={(c) => color = c}
    />

    <OpacitySlider
      opacity={opacity}
      onSelect={(o) => opacity = o}
    />

    <details class="advanced">
      <summary>Advanced</summary>

      <div class="form-group">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label id="text-color-label">Text Color</label>
        <div class="choice-row" role="group" aria-labelledby="text-color-label">
          <button
            type="button"
            class="choice-btn"
            class:active={textColor === 'auto'}
            onclick={() => textColor = 'auto'}
          >
            <Icon icon="mdi:auto-fix" width="20" />
            Auto
          </button>
          <button
            type="button"
            class="choice-btn"
            class:active={textColor === 'light'}
            onclick={() => textColor = 'light'}
          >
            <Icon icon="mdi:weather-sunny" width="20" />
            Light
          </button>
          <button
            type="button"
            class="choice-btn"
            class:active={textColor === 'dark'}
            onclick={() => textColor = 'dark'}
          >
            <Icon icon="mdi:weather-night" width="20" />
            Dark
          </button>
        </div>
        <small>Auto picks light or dark text based on the background</small>
      </div>

      <div class="form-group">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label id="display-style-label">Display Style</label>
        <div class="choice-row" role="group" aria-labelledby="display-style-label">
          <button
            type="button"
            class="choice-btn"
            class:active={displayStyle === 'header'}
            onclick={() => displayStyle = 'header'}
          >
            <Icon icon="mdi:page-layout-header" width="20" />
            Full Header
          </button>
          <button
            type="button"
            class="choice-btn"
            class:active={displayStyle === 'folder'}
            onclick={() => displayStyle = 'folder'}
          >
            <Icon icon="mdi:folder" width="20" />
            Folder Tab
          </button>
        </div>
        <small>Full header spans the group's width; Folder Tab is a compact label</small>
      </div>

      <div class="form-group">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label id="width-label">Row Width</label>
        <div class="width-options" role="group" aria-labelledby="width-label">
          <button
            type="button"
            class="width-btn"
            class:active={width === 'full'}
            onclick={() => width = 'full'}
            title="Full row width"
          >
            <span class="width-glyph width-glyph-full"></span>
            Full
          </button>
          <button
            type="button"
            class="width-btn"
            class:active={width === 'half'}
            onclick={() => width = 'half'}
            title="Half row width — sits beside another half group"
          >
            <span class="width-glyph width-glyph-half"></span>
            Half
          </button>
          <button
            type="button"
            class="width-btn"
            class:active={width === 'third'}
            onclick={() => width = 'third'}
            title="Third row width — three side-by-side"
          >
            <span class="width-glyph width-glyph-third"></span>
            Third
          </button>
        </div>
        <small>Groups flow left-to-right; narrow screens collapse to full width.</small>
      </div>
    </details>

    {#if canMoveOrCopy}
      <div class="form-group move-section">
        <button
          type="button"
          class="btn-move-toggle"
          onclick={() => showMoveSection = !showMoveSection}
        >
          <Icon icon="mdi:folder-move" width="20" />
          Move or Copy to Another Tab
          <Icon icon={showMoveSection ? 'mdi:chevron-up' : 'mdi:chevron-down'} width="20" />
        </button>

        {#if showMoveSection}
          <div class="move-controls">
            <div class="move-row">
              <label for="move-tab">Target tab:</label>
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

            <div class="move-actions">
              {#if onMoveToTab}
                <button
                  type="button"
                  class="btn-move"
                  onclick={handleMove}
                  disabled={!selectedMoveTabId || isMovingOrCopying}
                  title="Move this group to the selected tab (removed from current tab)"
                >
                  <Icon icon="mdi:folder-move" width="18" />
                  Move Group
                </button>
              {/if}
              {#if onCopyToTab}
                <button
                  type="button"
                  class="btn-copy"
                  onclick={handleCopy}
                  disabled={!selectedMoveTabId || isMovingOrCopying}
                  title="Copy this group to the selected tab (original stays in place)"
                >
                  <Icon icon="mdi:content-copy" width="18" />
                  Copy Group
                </button>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/if}

  </form>

  {#snippet footer()}
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
        <button type="submit" form="group-edit-form" class="btn-primary">
          <Icon icon="mdi:content-save" width="20" />
          {groupName ? 'Save' : 'Create'}
        </button>
      </div>
    </div>
  {/snippet}
</Modal>

{#if showIconEditor}
  <IconEditModal
    {icon}
    {iconUrl}
    {iconBgColor}
    onIconChange={(v) => icon = v ?? ''}
    onIconUrlChange={(v) => iconUrl = v ?? ''}
    onIconBgColorChange={(v) => iconBgColor = v}
    onClose={() => showIconEditor = false}
  />
{/if}

<style>
  /* Modal.svelte's .modal-body already applies 1.5rem padding around
     the slotted content. The form used to double that with its own
     padding — visually it pushed the form 3rem in from the modal edge,
     wasting horizontal space and making the modal look heavier than the
     others. Padding removed so spacing matches every other edit modal. */
  form {
    padding: 0;
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
    width: 100%;
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

  /* .btn-primary, .btn-secondary, .btn-danger styles are defined globally in app.css */

  .btn-duplicate {
    background: var(--color-success);
    color: white;
  }

  .btn-duplicate:hover {
    background: var(--color-success-dark);
  }

  /* Icon summary row — clickable button that opens the icon sub-modal. */
  .icon-summary {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.6rem 0.85rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s, background 0.15s;
  }

  .icon-summary:hover {
    border-color: var(--accent);
    background: var(--bg-tertiary);
  }

  .icon-preview-tile {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 0.4rem;
    color: var(--accent);
    flex-shrink: 0;
  }

  .icon-preview-tile.has-bg {
    padding: 0.25rem;
  }

  .icon-preview-tile img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .icon-summary-text {
    flex: 1;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .icon-summary-text code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85em;
    color: var(--text-primary);
  }

  .edit-cta {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--accent);
    font-size: 0.875rem;
    font-weight: 500;
  }

  /* Text Color + Display Style choice buttons (shared style for both rows). */
  .choice-row {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .choice-btn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.6rem 0.75rem;
    border-radius: 0.4rem;
    border: 1px solid var(--border);
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 0.15s;
  }

  .choice-btn:hover {
    border-color: var(--text-secondary);
    color: var(--text-primary);
  }

  .choice-btn.active {
    border-color: var(--accent);
    color: var(--accent);
    background: rgba(79, 140, 255, 0.12);
  }

  .width-options {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .width-btn {
    flex: 1;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.6rem 0.5rem;
    background: var(--bg-tertiary);
    border: 2px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.8rem;
    font-weight: 500;
  }

  .width-btn:hover {
    background: var(--bg-primary);
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .width-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .width-glyph {
    display: block;
    height: 0.5rem;
    width: 100%;
    border-radius: 0.15rem;
    background: linear-gradient(
      to right,
      currentColor 0%,
      currentColor var(--seg, 100%),
      transparent var(--seg, 100%),
      transparent 100%
    );
    opacity: 0.85;
  }
  .width-glyph-full { --seg: 100%; }
  .width-glyph-half { --seg: 50%; }
  .width-glyph-third { --seg: 33.333%; }

  /* Old inline-icon CSS removed — IconEditModal now owns the picker UI. */

  /* Advanced disclosure — text color, display style, and row width
     are infrequently changed; collapsing them keeps the most-used
     fields (name, icon, color, opacity) prominent. */
  .advanced {
    margin: var(--space-2) 0 var(--space-6);
    border-top: 1px solid var(--border);
    padding-top: var(--space-3);
  }
  .advanced > summary {
    cursor: pointer;
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--text-secondary);
    padding: var(--space-1) 0;
    list-style: revert;
    user-select: none;
  }
  .advanced > summary:hover { color: var(--text-primary); }
  .advanced[open] > summary { color: var(--text-primary); margin-bottom: var(--space-3); }

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

  .move-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .btn-move,
  .btn-copy {
    padding: 0.5rem 1rem;
    color: white;
    font-size: 0.875rem;
  }

  .btn-move {
    background: var(--accent);
  }

  .btn-move:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn-copy {
    background: var(--color-success, #16a34a);
  }

  .btn-copy:hover:not(:disabled) {
    background: var(--color-success-dark, #15803d);
  }

  .btn-move:disabled,
  .btn-copy:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
