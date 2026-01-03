<script lang="ts">
  import type { Entry } from '$lib/types';
  import Icon from '@iconify/svelte';
  import ColoredIcon from '../ColoredIcon.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import OpacitySlider from './OpacitySlider.svelte';
  import IconPickerModal from './IconPickerModal.svelte';

  interface Props {
    entry: Entry;
    onSave: (entry: Entry) => void;
    onCancel: () => void;
    onDelete?: () => void;
  }

  let { entry, onSave, onCancel, onDelete }: Props = $props();

  let editedEntry = $state<Entry>({ ...entry });
  let iconSearch = $state(entry.icon || '');
  let showIconPicker = $state(false);

  // Update editedEntry when entry prop changes
  $effect(() => {
    editedEntry = { ...entry };
    iconSearch = entry.icon || '';
  });

  function handleSave() {
    onSave(editedEntry);
  }

  function handleDelete() {
    if (onDelete && confirm('Are you sure you want to delete this tile?')) {
      onDelete();
    }
  }

  function handleIconSelect(icon: string) {
    editedEntry.icon = icon;
    iconSearch = icon;
    showIconPicker = false;
  }

  // Close modal on escape key
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (showIconPicker) {
        showIconPicker = false;
      } else {
        onCancel();
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-backdrop" onclick={onCancel}>
  <div class="modal-content" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>Edit Tile</h2>
      <button class="close-btn" onclick={onCancel}>
        <Icon icon="mdi:close" width="24" />
      </button>
    </div>

    <form onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
      <div class="form-grid">
        <div class="form-group">
          <label for="name">Name *</label>
          <input
            id="name"
            type="text"
            bind:value={editedEntry.name}
            required
            placeholder="Service Name"
          />
        </div>

        <div class="form-group">
          <label for="description">Subtitle/Description</label>
          <input
            id="description"
            type="text"
            bind:value={editedEntry.description}
            placeholder="Optional subtitle"
          />
        </div>

        <div class="form-group">
          <label for="url">URL *</label>
          <input
            id="url"
            type="url"
            bind:value={editedEntry.url}
            required
            placeholder="https://example.com"
          />
        </div>

        <div class="form-group">
          <label for="icon">Icon</label>
          <div class="icon-input-wrapper">
            <div class="icon-input">
              <input
                id="icon"
                type="text"
                bind:value={iconSearch}
                oninput={() => editedEntry.icon = iconSearch}
                placeholder="mdi:server"
              />
              {#if editedEntry.icon}
                <div class="icon-preview">
                  <ColoredIcon icon={editedEntry.icon} width="32" />
                </div>
              {/if}
            </div>
            <button
              type="button"
              class="browse-btn"
              onclick={() => showIconPicker = true}
              title="Browse icon presets"
            >
              <Icon icon="mdi:apps" width="20" />
              Browse
            </button>
          </div>
          <small>Browse presets or find custom icons at <a href="https://icon-sets.iconify.design/" target="_blank" rel="noopener">iconify.design</a></small>
          <small class="help-text">💡 To use a custom icon: search on Iconify, click an icon, copy the full name (e.g., "mdi:home" or "simple-icons:docker"), and paste it above</small>
        </div>

        <div class="form-group">
          <label for="size">Size</label>
          <select id="size" bind:value={editedEntry.size}>
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </div>

        <div class="form-group">
          <label for="openMode">Open Mode</label>
          <select id="openMode" bind:value={editedEntry.openMode}>
            <option value="newtab">New Tab</option>
            <option value="sametab">Same Tab</option>
            <option value="iframe">iFrame Modal</option>
            <option value="popup">Popup Modal</option>
          </select>
        </div>

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

        <div class="form-group checkbox-group">
          <label>
            <input type="checkbox" bind:checked={editedEntry.showStatus} />
            Show Status Indicator
          </label>
        </div>

        <div class="form-group checkbox-group">
          <label>
            <input type="checkbox" bind:checked={editedEntry.fetchFavicon} />
            Auto-fetch Favicon
          </label>
        </div>
      </div>

      <div class="modal-actions">
        {#if onDelete}
          <button type="button" class="btn-danger" onclick={handleDelete}>
            <Icon icon="mdi:delete" width="20" />
            Delete
          </button>
        {/if}
        <div class="action-right">
          <button type="button" class="btn-secondary" onclick={onCancel}>
            Cancel
          </button>
          <button type="submit" class="btn-primary">
            <Icon icon="mdi:content-save" width="20" />
            Save
          </button>
        </div>
      </div>
    </form>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal-content {
    background: var(--bg-primary);
    border-radius: 0.75rem;
    width: 100%;
    max-width: 600px;
    max-height: 90vh;
    overflow: auto;
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

  .form-group:nth-child(1),
  .form-group:nth-child(3),
  .form-group:nth-child(4) {
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

  .icon-input {
    position: relative;
  }

  .icon-preview {
    position: absolute;
    right: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-secondary);
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
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
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

  .btn-primary {
    background: var(--accent);
    color: white;
  }

  .btn-primary:hover {
    background: #2563eb;
  }

  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .btn-secondary:hover {
    background: var(--bg-secondary);
  }

  .btn-danger {
    background: #dc2626;
    color: white;
  }

  .btn-danger:hover {
    background: #b91c1c;
  }

  @media (max-width: 640px) {
    .form-grid {
      grid-template-columns: 1fr;
    }

    .form-group:nth-child(1),
    .form-group:nth-child(3),
    .form-group:nth-child(4) {
      grid-column: 1;
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

  .icon-input-wrapper {
    display: flex;
    gap: 0.5rem;
  }

  .browse-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
  }

  .browse-btn:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  .help-text {
    display: block;
    margin-top: 0.5rem;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border-left: 3px solid var(--accent);
    border-radius: 0.375rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }
</style>

{#if showIconPicker}
  <IconPickerModal
    currentIcon={editedEntry.icon}
    onSelect={handleIconSelect}
    onCancel={() => showIconPicker = false}
  />
{/if}
