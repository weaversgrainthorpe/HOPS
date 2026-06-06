<script lang="ts">
  import Icon from '@iconify/svelte';
  import Modal from '../shared/Modal.svelte';
  import ColoredIcon from '../ColoredIcon.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import IconPickerModal from './IconPickerModal.svelte';
  import { createIcon, uploadIconImage } from '$lib/utils/api';
  import { toast } from '$lib/stores/toast';
  import { logWarn } from '$lib/utils/errors';

  // All icon-related editing lives here, opened from a small "Edit icon"
  // button in the parent (tile / group / tab) modal. Mirrors the original
  // inline icon section but in a focused sub-modal — keeps the parent
  // form concerned only with its own properties.
  //
  // Changes propagate live to the parent via the per-field callbacks.
  // The parent's outer Save/Cancel still controls when the whole tile
  // / group / tab is persisted, so closing this modal with "Done" is a
  // pure UI concern.

  interface Props {
    title?: string;
    icon?: string;
    iconUrl?: string;
    iconBgColor?: string;
    onIconChange: (icon: string | undefined) => void;
    onIconUrlChange: (iconUrl: string | undefined) => void;
    onIconBgColorChange: (c: string | undefined) => void;
    onClose: () => void;
  }

  let {
    title = 'Edit icon',
    icon,
    iconUrl,
    iconBgColor,
    onIconChange,
    onIconUrlChange,
    onIconBgColorChange,
    onClose,
  }: Props = $props();

  // Local copy of the iconify name so typing feels snappy. We push every
  // keystroke up to the parent so the preview elsewhere stays in sync.
  // svelte-ignore state_referenced_locally
  let iconSearch = $state(icon || '');
  let showIconPicker = $state(false);
  let isUploadingIcon = $state(false);
  let uploadError = $state('');
  let iconFileInput: HTMLInputElement;

  // Sync iconSearch when the parent swaps the icon out from under us
  // (e.g. picking from the library closes that modal and updates icon).
  $effect(() => {
    iconSearch = icon || '';
  });

  function handleIconSelect(selection: { icon: string; imageUrl?: string }) {
    onIconChange(selection.icon);
    onIconUrlChange(selection.imageUrl);
    iconSearch = selection.icon || '';
    showIconPicker = false;
  }

  function clearCustomIcon() {
    onIconUrlChange(undefined);
  }

  async function handleIconUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      uploadError = 'Invalid file type. Use PNG, JPG, GIF, WebP, or SVG.';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      uploadError = 'File too large. Maximum size is 5MB.';
      return;
    }

    isUploadingIcon = true;
    uploadError = '';

    try {
      const result = await uploadIconImage(file);
      onIconUrlChange(result.url);
      onIconChange('');
      iconSearch = '';

      const fileName = file.name.replace(/\.[^/.]+$/, '');
      const iconName = fileName.charAt(0).toUpperCase() + fileName.slice(1).replace(/[-_]/g, ' ');

      try {
        await createIcon({
          id: result.id,
          name: iconName,
          icon: '',
          categoryId: 'containers',
          imageUrl: result.url,
        });
        toast.success('Icon saved to "My Uploads"');
      } catch {
        logWarn('Could not save icon to database');
      }
    } catch (err) {
      uploadError = err instanceof Error ? err.message : 'Upload failed';
    } finally {
      isUploadingIcon = false;
      input.value = '';
    }
  }
</script>

<Modal id="icon-edit" {title} titleIcon="mdi:image-edit-outline" {onClose} maxWidth="560px">
  <div class="body">
    {#if iconUrl}
      <!-- Custom uploaded icon — preview reflects the chosen icon
           background so the user sees what the rendered tile/group/tab
           will look like. -->
      <div class="custom-icon-display">
        <span class="custom-icon-backing"
              class:has-bg={iconBgColor}
              style:background-color={iconBgColor}>
          <img src={iconUrl} alt="Custom icon" class="custom-icon-preview" />
        </span>
        <span class="custom-icon-label">Custom icon uploaded</span>
        <button type="button" class="clear-icon-btn" onclick={clearCustomIcon} title="Remove custom icon">
          <Icon icon="mdi:close" width="18" />
        </button>
      </div>
      <small>Or use an Iconify icon instead:</small>
    {/if}

    <div class="icon-input-wrapper">
      <div class="icon-input">
        <label for="icon-edit-input" class="sr-only">Iconify icon name</label>
        <input
          id="icon-edit-input"
          type="text"
          bind:value={iconSearch}
          oninput={() => { onIconChange(iconSearch); onIconUrlChange(undefined); }}
          placeholder="mdi:server"
          aria-label="Iconify icon name (e.g. mdi:server)"
          disabled={isUploadingIcon}
        />
        {#if icon && !iconUrl}
          <div class="icon-preview"
               class:has-bg={iconBgColor}
               style:background-color={iconBgColor}>
            <ColoredIcon {icon} width="32" />
          </div>
        {/if}
      </div>
      <button
        type="button"
        class="browse-btn"
        onclick={() => showIconPicker = true}
        title="Browse icon library"
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
        aria-label="Upload custom icon image"
      />
    </div>

    {#if uploadError}
      <small class="error-text">{uploadError}</small>
    {/if}

    <small>Browse the icon library, enter an icon name from <a href="https://icon-sets.iconify.design/" target="_blank" rel="noopener">iconify.design</a>, or upload your own</small>

    <div class="icon-bg-section">
      <ColorPicker
        label="Icon background"
        selectedColor={iconBgColor}
        onSelect={onIconBgColorChange}
      />
    </div>

    <div class="footer">
      <button type="button" class="btn-primary" onclick={onClose}>Done</button>
    </div>
  </div>
</Modal>

{#if showIconPicker}
  <IconPickerModal
    currentIcon={icon}
    currentImageUrl={iconUrl}
    onSelect={handleIconSelect}
    onCancel={() => showIconPicker = false}
  />
{/if}

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .custom-icon-display {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.85rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--bg-secondary);
  }

  /* Wrapper that takes on the iconBgColor when one is set, so the
     preview in this modal looks like the rendered tile/group/tab. */
  .custom-icon-backing {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 0.4rem;
  }

  .custom-icon-backing.has-bg {
    padding: 0.35rem;
  }

  .custom-icon-preview {
    width: 32px;
    height: 32px;
    object-fit: contain;
    flex-shrink: 0;
  }

  .custom-icon-label {
    flex: 1;
    color: var(--text-primary);
    font-size: 0.9rem;
  }

  .clear-icon-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
    align-items: center;
  }

  .clear-icon-btn:hover {
    color: var(--color-error, #ef4444);
  }

  .icon-input-wrapper {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .icon-input {
    flex: 1;
    position: relative;
    min-width: 12rem;
  }

  .icon-input input {
    width: 100%;
    padding: 0.5rem 2.5rem 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9rem;
  }

  .icon-input input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .icon-preview {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--accent);
    border-radius: 0.4rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .icon-preview.has-bg {
    padding: 0.2rem;
    /* Override the negative-position trick — we still want a coloured box,
       not a tiny pill behind the icon. */
    right: 0.3rem;
  }

  .browse-btn,
  .upload-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.5rem 0.85rem;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    font-size: 0.9rem;
  }

  .browse-btn:hover,
  .upload-btn:hover {
    border-color: var(--accent);
  }

  .error-text {
    color: var(--color-error, #ef4444);
  }

  .icon-bg-section {
    margin-top: 0.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.75rem;
  }

  .btn-primary {
    padding: 0.5rem 1.25rem;
    border: none;
    border-radius: 0.4rem;
    background: var(--accent);
    color: white;
    font-weight: 500;
    cursor: pointer;
  }

  .btn-primary:hover {
    filter: brightness(1.1);
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
