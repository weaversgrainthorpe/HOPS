<script lang="ts">
  import Icon from '@iconify/svelte';
  import ColorPicker from './ColorPicker.svelte';
  import OpacitySlider from './OpacitySlider.svelte';
  import BackgroundConfigModal from './BackgroundConfigModal.svelte';
  import IconPickerModal from './IconPickerModal.svelte';
  import type { Background } from '$lib/types';
  import { focusTrap } from '$lib/utils/focusTrap';

  interface Props {
    tabName: string;
    tabIcon?: string;
    tabIconUrl?: string;
    tabColor?: string;
    tabOpacity?: number;
    tabBackground?: Background;
    perTabBackgrounds?: boolean; // Whether per-tab backgrounds are enabled at dashboard level
    onSave: (name: string, icon?: string, iconUrl?: string, color?: string, opacity?: number) => void;
    onSaveBackground?: (background: Background | undefined) => void;
    onCancel: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
  }

  let { tabName, tabIcon, tabIconUrl, tabColor, tabOpacity, tabBackground, perTabBackgrounds = false, onSave, onSaveBackground, onCancel, onDelete, onDuplicate }: Props = $props();
  // Form state initialized from props (intentionally captures initial values)
  // svelte-ignore state_referenced_locally
  let name = $state(tabName);
  // svelte-ignore state_referenced_locally
  let icon = $state(tabIcon || '');
  // svelte-ignore state_referenced_locally
  let iconUrl = $state(tabIconUrl || '');
  // svelte-ignore state_referenced_locally
  let color = $state(tabColor);
  // svelte-ignore state_referenced_locally
  let opacity = $state(tabOpacity);
  let showBackgroundConfig = $state(false);
  let showIconPicker = $state(false);

  function handleSave() {
    if (name.trim()) {
      onSave(name.trim(), icon || undefined, iconUrl || undefined, color, opacity);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (showBackgroundConfig || showIconPicker) {
        showBackgroundConfig = false;
        showIconPicker = false;
      } else {
        onCancel();
      }
    }
  }

  function handleBackgroundSave(background: Background | undefined) {
    if (onSaveBackground) {
      onSaveBackground(background);
    }
    showBackgroundConfig = false;
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
<div class="modal-backdrop" onclick={onCancel} onkeydown={(e) => e.key === 'Escape' && !showBackgroundConfig && !showIconPicker && onCancel()}>
  <div
    class="modal-content"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    aria-labelledby="tab-edit-title"
    tabindex="-1"
    use:focusTrap
  >
    <div class="modal-header">
      <h2 id="tab-edit-title">{tabName ? 'Edit Tab' : 'New Tab'}</h2>
      <button class="close-btn" onclick={onCancel}>
        <Icon icon="mdi:close" width="24" />
      </button>
    </div>

    <form onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
      <div class="form-group">
        <label for="name">Tab Name *</label>
        <input
          id="name"
          type="text"
          bind:value={name}
          required
          placeholder="e.g., Home, Work, Media"
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
                placeholder="mdi:home"
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

      {#if onSaveBackground && perTabBackgrounds}
        <div class="form-group">
          <button type="button" class="btn-background" onclick={() => showBackgroundConfig = true}>
            <Icon icon="mdi:image-multiple" width="20" />
            Configure Tab Background
          </button>
          {#if tabBackground}
            <small class="background-status">
              {tabBackground.type === 'color' ? `Color: ${tabBackground.value}` : ''}
              {tabBackground.type === 'image' ? 'Image background set' : ''}
              {tabBackground.type === 'slideshow' ? `Slideshow (${tabBackground.images?.length || 0} images)` : ''}
            </small>
          {:else}
            <small class="background-status">Using dashboard background</small>
          {/if}
        </div>
      {:else if onSaveBackground}
        <div class="form-group">
          <small class="background-hint">
            <Icon icon="mdi:information-outline" width="16" />
            Enable "Individual backgrounds per tab" in dashboard background settings to set a custom background for this tab.
          </small>
        </div>
      {/if}

      <div class="modal-actions">
        <div class="actions-left">
          {#if tabName && onDelete}
            <button type="button" class="btn-danger" onclick={onDelete}>
              <Icon icon="mdi:trash-can" width="20" />
              Delete
            </button>
          {/if}
          {#if tabName && onDuplicate}
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
            {tabName ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </form>
  </div>
</div>

{#if showBackgroundConfig}
  <BackgroundConfigModal
    background={tabBackground}
    level="tab"
    onSave={handleBackgroundSave}
    onCancel={() => showBackgroundConfig = false}
  />
{/if}

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

  .btn-background {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    width: 100%;
    justify-content: center;
  }

  .btn-background:hover {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .background-status {
    display: block;
    color: var(--text-secondary);
    font-size: 0.75rem;
    margin-top: 0.5rem;
    padding: 0.5rem;
    background: var(--bg-tertiary);
    border-radius: 0.25rem;
  }

  .background-hint {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.8rem;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border-radius: 0.375rem;
    border: 1px dashed var(--border);
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
</style>
