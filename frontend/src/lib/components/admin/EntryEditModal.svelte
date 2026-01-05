<script lang="ts">
  import type { Entry } from '$lib/types';
  import Icon from '@iconify/svelte';
  import ColoredIcon from '../ColoredIcon.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import OpacitySlider from './OpacitySlider.svelte';
  import IconPickerModal from './IconPickerModal.svelte';
  import { confirm } from '$lib/stores/confirmModal';
  import { focusTrap } from '$lib/utils/focusTrap';
  import { getSessionToken } from '$lib/stores/auth';

  interface Props {
    entry: Entry;
    onSave: (entry: Entry) => void;
    onCancel: () => void;
    onDelete?: () => void;
  }

  let { entry, onSave, onCancel, onDelete }: Props = $props();

  // Form state initialized from props (intentionally captures initial values)
  // svelte-ignore state_referenced_locally
  let editedEntry = $state<Entry>({ ...entry });
  // svelte-ignore state_referenced_locally
  let iconSearch = $state(entry.icon || '');
  let showIconPicker = $state(false);
  let iconFileInput: HTMLInputElement;
  let isUploadingIcon = $state(false);
  let uploadError = $state('');

  // Update editedEntry when entry prop changes
  $effect(() => {
    editedEntry = { ...entry };
    iconSearch = entry.icon || '';
  });

  function handleSave() {
    onSave(editedEntry);
  }

  async function handleDelete() {
    if (!onDelete) return;

    const confirmed = await confirm({
      title: 'Delete Tile',
      message: 'Are you sure you want to delete this tile?',
      confirmText: 'Delete',
      confirmStyle: 'danger'
    });
    if (confirmed) {
      onDelete();
    }
  }

  function handleIconSelect(selection: { icon: string; imageUrl?: string }) {
    editedEntry.icon = selection.icon;
    editedEntry.iconUrl = selection.imageUrl;
    iconSearch = selection.icon || '';
    showIconPicker = false;
  }

  async function handleIconUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      uploadError = 'Invalid file type. Allowed: PNG, JPEG, GIF, WebP, SVG';
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      uploadError = 'File too large. Maximum size is 5MB';
      return;
    }

    isUploadingIcon = true;
    uploadError = '';

    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = getSessionToken();
      const response = await fetch('/api/icons/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Upload failed');
      }

      const result = await response.json();
      // Set the uploaded icon URL
      editedEntry.iconUrl = result.url;
      // Clear the iconify icon since we're using a custom image
      editedEntry.icon = '';
      iconSearch = '';
    } catch (err) {
      uploadError = err instanceof Error ? err.message : 'Upload failed';
    } finally {
      isUploadingIcon = false;
      // Reset file input
      input.value = '';
    }
  }

  function clearCustomIcon() {
    editedEntry.iconUrl = undefined;
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onCancel} onkeydown={(e) => e.key === 'Escape' && onCancel()}>
  <div
    class="modal-content"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    aria-labelledby="entry-edit-title"
    tabindex="-1"
    use:focusTrap
  >
    <div class="modal-header">
      <h2 id="entry-edit-title">Edit Tile</h2>
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

          {#if editedEntry.iconUrl}
            <!-- Custom uploaded icon -->
            <div class="custom-icon-display">
              <img src={editedEntry.iconUrl} alt="Custom icon" class="custom-icon-preview" />
              <span class="custom-icon-label">Custom icon uploaded</span>
              <button type="button" class="clear-icon-btn" onclick={clearCustomIcon} title="Remove custom icon">
                <Icon icon="mdi:close" width="18" />
              </button>
            </div>
            <small>Or use an Iconify icon instead:</small>
          {/if}

          <div class="icon-input-wrapper">
            <div class="icon-input">
              <input
                id="icon"
                type="text"
                bind:value={iconSearch}
                oninput={() => { editedEntry.icon = iconSearch; editedEntry.iconUrl = undefined; }}
                placeholder="mdi:server"
                disabled={isUploadingIcon}
              />
              {#if editedEntry.icon && !editedEntry.iconUrl}
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
              disabled={isUploadingIcon}
            >
              <Icon icon="mdi:apps" width="20" />
              Browse
            </button>
            <button
              type="button"
              class="upload-btn"
              onclick={() => iconFileInput?.click()}
              title="Upload custom icon"
              disabled={isUploadingIcon}
            >
              {#if isUploadingIcon}
                <Icon icon="mdi:loading" width="20" class="spin" />
              {:else}
                <Icon icon="mdi:upload" width="20" />
              {/if}
              Upload
            </button>
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
              onchange={handleIconUpload}
              bind:this={iconFileInput}
              style="display: none;"
            />
          </div>

          {#if uploadError}
            <small class="error-text">{uploadError}</small>
          {/if}

          <small>Browse presets, find icons at <a href="https://icon-sets.iconify.design/" target="_blank" rel="noopener">iconify.design</a>, or upload your own (PNG, SVG, etc.)</small>
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
            <Icon icon="mdi:trash-can" width="20" />
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
    z-index: var(--z-modal);
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

  .browse-btn:disabled,
  .upload-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }

  .upload-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
  }

  .upload-btn:hover:not(:disabled) {
    background: var(--bg-secondary);
    border-color: var(--accent);
  }

  .custom-icon-display {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    margin-bottom: 0.5rem;
  }

  .custom-icon-preview {
    width: 48px;
    height: 48px;
    object-fit: contain;
    border-radius: 0.25rem;
    background: var(--bg-secondary);
  }

  .custom-icon-label {
    flex: 1;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .clear-icon-btn {
    padding: 0.375rem;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 0.25rem;
  }

  .clear-icon-btn:hover {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .error-text {
    color: var(--color-error);
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>

{#if showIconPicker}
  <IconPickerModal
    currentIcon={editedEntry.icon}
    currentImageUrl={editedEntry.iconUrl}
    onSelect={handleIconSelect}
    onCancel={() => showIconPicker = false}
  />
{/if}
