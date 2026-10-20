<script lang="ts">
  import type { Entry } from '$lib/types';
  import Icon from '@iconify/svelte';
  import ColoredIcon from '../ColoredIcon.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import OpacitySlider from './OpacitySlider.svelte';
  import IconEditModal from './IconEditModal.svelte';
  import Modal from '../shared/Modal.svelte';
  import { confirm } from '$lib/stores/confirmModal';
  import { editMode } from '$lib/stores/editMode';

  interface Props {
    entry: Entry;
    onSave: (entry: Entry) => void;
    onCancel: () => void;
    onDelete?: () => void;
    /**
     * Opens the Move/Copy dialog (any tab or folder, any dashboard). A tile
     * goes in and comes out with its kind, id and placement untouched (the
     * editor never patches those).
     */
    onMoveCopy?: () => void;
  }

  let { entry, onSave, onCancel, onDelete, onMoveCopy }: Props = $props();

  // Form state initialized from props (intentionally captures initial values)
  // svelte-ignore state_referenced_locally
  let editedEntry = $state<Entry>({ ...entry });
  let showIconEditor = $state(false);

  // Update editedEntry when entry prop changes. Normalise `type` to
  // 'link' when the incoming entry has no value, so the Tile type
  // dropdown's bind:value matches a real <option> (configs from
  // pre-v1.7.0 don't carry a `type` field).
  $effect(() => {
    editedEntry = { ...entry, type: entry.type ?? 'link' };
  });

  // Close modal when edit mode is turned off
  $effect(() => {
    if (!$editMode) {
      onCancel();
    }
  });

  function handleBeforeClose(): boolean {
    if (showIconEditor) {
      showIconEditor = false;
      return false;
    }
    return true;
  }

  // Derived: are we editing a note tile? Notes have no URL / open-mode /
  // status check / icon, so the form hides those fields when this is true.
  let isNote = $derived(editedEntry.type === 'note');

  function handleSave() {
    // For note tiles, clear out the link-only fields so the saved record
    // is clean (no stale URL / open mode / status check / icon left
    // behind from a previous link form).
    if (isNote) {
      editedEntry.url = '';
      editedEntry.icon = '';
      editedEntry.iconUrl = '';
      editedEntry.openMode = 'newtab';
      editedEntry.statusCheck = undefined;
      editedEntry.showStatus = false;
    }
    onSave(editedEntry);
  }

  async function handleDelete() {
    if (!onDelete) return;

    const tileName = editedEntry.name?.trim() || 'this tile';
    const confirmed = await confirm({
      title: `Delete "${tileName}"?`,
      message: 'This tile will be removed from the dashboard. You can undo this only by re-creating it.',
      confirmText: 'Delete',
      confirmStyle: 'danger'
    });
    if (confirmed) {
      onDelete();
    }
  }

  // Icon picking, uploading, and clearing all live in IconEditModal now.
</script>

<Modal
  id="entry-edit"
  title={entry.id ? 'Edit Tile' : 'New Tile'}
  onClose={onCancel}
  onBeforeClose={handleBeforeClose}
>
  <form id="entry-edit-form" onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
    <div class="form-grid">
      <div class="form-group full-width">
        <label for="entry-type">Tile type</label>
        <select
          id="entry-type"
          bind:value={editedEntry.type}
          onchange={() => { if (editedEntry.type !== 'note' && editedEntry.type !== 'link') editedEntry.type = 'link'; }}
        >
          <option value="link">Link — opens a URL when clicked</option>
          <option value="note">Note — text only, no link</option>
        </select>
      </div>

      <div class="form-group full-width">
        <label for="name">Name *</label>
        <input
          id="name"
          type="text"
          bind:value={editedEntry.name}
          required
          placeholder={isNote ? 'Note heading' : 'Tile name'}
        />
      </div>

      <div class="form-group full-width">
        <label for="description">{isNote ? 'Body text' : 'Subtitle/Description'}</label>
        {#if isNote}
          <textarea
            id="description"
            bind:value={editedEntry.description}
            placeholder="Note text — appears under the heading"
            rows="3"
          ></textarea>
        {:else}
          <input
            id="description"
            type="text"
            bind:value={editedEntry.description}
            placeholder="Optional subtitle"
          />
        {/if}
      </div>

      {#if !isNote}
        <div class="form-group full-width">
          <label for="url">URL *</label>
          <input
            id="url"
            type="url"
            bind:value={editedEntry.url}
            required
            placeholder="https://example.com"
          />
        </div>
      {/if}

      {#if !isNote}
      <!-- Icon: small preview + one button to open the icon sub-modal,
           which handles picking / uploading / Iconify name / icon background. -->
      <div class="form-group full-width">
        <label>Icon</label>
        <button type="button" class="icon-summary" onclick={() => showIconEditor = true}>
          <span class="icon-preview-tile"
                class:has-bg={editedEntry.iconBgColor}
                style:background-color={editedEntry.iconBgColor}>
            {#if editedEntry.iconUrl}
              <img src={editedEntry.iconUrl} alt="" />
            {:else if editedEntry.icon}
              <ColoredIcon icon={editedEntry.icon} width="32" />
            {:else}
              <ColoredIcon icon="mdi:application-outline" width="32" />
            {/if}
          </span>
          <span class="icon-summary-text">
            {#if editedEntry.iconUrl}
              Custom uploaded icon
            {:else if editedEntry.icon}
              <code>{editedEntry.icon}</code>
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
      {/if}

      <!-- Tile background colour + opacity — inline, no sub-modal. They
           belong to the tile itself, not to the icon. -->
      <div class="form-group full-width">
        <ColorPicker
          selectedColor={editedEntry.color}
          onSelect={(color) => editedEntry.color = color}
        />
      </div>

      <div class="form-group full-width">
        <OpacitySlider
          opacity={editedEntry.opacity}
          onSelect={(opacity) => editedEntry.opacity = opacity}
        />
      </div>

      <div class="form-group">
        <label for="size">Size</label>
        <select id="size" bind:value={editedEntry.size}>
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </div>

      {#if !isNote}
        <div class="form-group">
          <label for="openMode">Open Mode</label>
          <select id="openMode" bind:value={editedEntry.openMode}>
            <option value="newtab">New Tab</option>
            <option value="sametab">Same Tab</option>
            <option value="iframe">iFrame Modal</option>
            <option value="popup">Popup Modal</option>
          </select>
        </div>

        <div class="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={editedEntry.statusCheck?.enabled ?? false}
              onchange={(e) => {
                if (!editedEntry.statusCheck) {
                  editedEntry.statusCheck = { type: 'http', enabled: false, interval: 60 };
                }
                editedEntry.statusCheck.enabled = (e.target as HTMLInputElement).checked;
              }}
            />
            Enable Status Check
          </label>
        </div>
      {/if}

      {#if onMoveCopy && entry.id}
        <div class="form-group full-width move-section">
          <button type="button" class="btn-move-toggle" onclick={onMoveCopy}>
            <Icon icon="mdi:folder-move" width="18" />
            Move or copy to…
          </button>
        </div>
      {/if}
    </div>

  </form>

  {#snippet footer()}
    <div class="modal-actions">
      {#if onDelete}
        <button type="button" class="btn-danger" onclick={handleDelete}>
          <Icon icon="mdi:trash-can" width="20" />
          Delete
        </button>
      {/if}
      <div class="action-right">
        <button type="button" class="btn-secondary" onclick={onCancel}>
          Cancel
        </button>
        <button type="submit" form="entry-edit-form" class="btn-primary">
          <Icon icon="mdi:content-save" width="20" />
          {entry.id ? 'Save' : 'Create'}
        </button>
      </div>
    </div>
  {/snippet}
</Modal>

<style>
  form {
    padding: 1.5rem;
  }

  .form-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: 1fr 1fr;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  /* Authoritative full-width marker: any form-group with this class spans
     the whole row. Replaces the old positional nth-child trick which
     silently broke whenever a field was added or removed. */
  .form-group.full-width {
    grid-column: 1 / -1;
  }

  label {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  input[type="text"],
  input[type="url"],
  select {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  input[type="text"]:focus,
  input[type="url"]:focus,
  select:focus {
    outline: none;
    border-color: var(--accent);
  }

  /* Compact "Edit icon" summary row — clickable button that opens the
     icon sub-modal. Shows a preview + the current icon name / "Custom
     uploaded" / "No icon". */
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
    width: 2.5rem;
    height: 2.5rem;
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

  small {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  small a {
    color: var(--accent);
    text-decoration: none;
  }

  small a:hover {
    text-decoration: underline;
  }

  .checkbox-group {
    flex-direction: row;
    align-items: center;
  }

  .checkbox-group label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  input[type="checkbox"] {
    cursor: pointer;
  }

  .modal-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    width: 100%;
  }

  .action-right {
    display: flex;
    gap: 0.75rem;
    margin-left: auto;
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

  @media (max-width: 640px) {
    .form-grid {
      grid-template-columns: 1fr;
    }

    .modal-actions {
      flex-direction: column;
    }

    .action-right {
      width: 100%;
      margin-left: 0;
    }

    .btn-danger {
      width: 100%;
    }
  }

  /* Icon-controls CSS (input wrapper, browse/upload buttons, custom-icon
     display, clear button, error text) lives in IconEditModal now —
     they were used only by the icon section we just lifted out. */

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* Move section styles */
  .move-section {
    margin-top: 0.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  .btn-move-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border: 1px dashed var(--border);
    border-radius: 0.375rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-move-toggle:hover {
    background: var(--bg-secondary);
    border-color: var(--accent);
    color: var(--accent);
  }

</style>

{#if showIconEditor}
  <IconEditModal
    icon={editedEntry.icon}
    iconUrl={editedEntry.iconUrl}
    iconBgColor={editedEntry.iconBgColor}
    onIconChange={(v) => editedEntry.icon = v ?? ''}
    onIconUrlChange={(v) => editedEntry.iconUrl = v}
    onIconBgColorChange={(v) => editedEntry.iconBgColor = v}
    onClose={() => showIconEditor = false}
  />
{/if}
