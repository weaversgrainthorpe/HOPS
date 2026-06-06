<script lang="ts">
  import Icon from '@iconify/svelte';
  import ColoredIcon from '../ColoredIcon.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import OpacitySlider from './OpacitySlider.svelte';
  import BackgroundConfigModal from './BackgroundConfigModal.svelte';
  import IconEditModal from './IconEditModal.svelte';
  import Modal from '../shared/Modal.svelte';
  import type { Background } from '$lib/types';
  import { editMode } from '$lib/stores/editMode';

  // Close modal when edit mode is turned off
  $effect(() => {
    if (!$editMode) {
      onCancel();
    }
  });

  interface Props {
    tabName: string;
    tabIcon?: string;
    tabIconUrl?: string;
    tabIconBgColor?: string;
    tabColor?: string;
    tabOpacity?: number;
    tabBackground?: Background;
    perTabBackgrounds?: boolean; // Whether per-tab backgrounds are enabled at dashboard level
    onSave: (name: string, icon?: string, iconUrl?: string, iconBgColor?: string, color?: string, opacity?: number) => void;
    onSaveBackground?: (background: Background | undefined) => void;
    onCancel: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
  }

  let { tabName, tabIcon, tabIconUrl, tabIconBgColor, tabColor, tabOpacity, tabBackground, perTabBackgrounds = false, onSave, onSaveBackground, onCancel, onDelete, onDuplicate }: Props = $props();
  // Form state initialized from props (intentionally captures initial values)
  // svelte-ignore state_referenced_locally
  let name = $state(tabName);
  // svelte-ignore state_referenced_locally
  let icon = $state(tabIcon || '');
  // svelte-ignore state_referenced_locally
  let iconUrl = $state(tabIconUrl || '');
  // svelte-ignore state_referenced_locally
  let iconBgColor = $state<string | undefined>(tabIconBgColor);
  // svelte-ignore state_referenced_locally
  let color = $state(tabColor);
  // svelte-ignore state_referenced_locally
  let opacity = $state(tabOpacity);
  let showBackgroundConfig = $state(false);
  let showIconEditor = $state(false);

  function handleBeforeClose(): boolean {
    if (showBackgroundConfig) {
      showBackgroundConfig = false;
      return false;
    }
    if (showIconEditor) {
      showIconEditor = false;
      return false;
    }
    return true;
  }

  function handleSave() {
    if (name.trim()) {
      onSave(name.trim(), icon || undefined, iconUrl || undefined, iconBgColor, color, opacity);
    }
  }

  function handleBackgroundSave(background: Background | undefined) {
    if (onSaveBackground) {
      onSaveBackground(background);
    }
    showBackgroundConfig = false;
  }

  // Icon picking and clearing live in IconEditModal now.
</script>

<Modal
  id="tab-edit"
  title={tabName ? 'Edit Tab' : 'New Tab'}
  onClose={onCancel}
  onBeforeClose={handleBeforeClose}
  maxWidth="520px"
>
  <form id="tab-edit-form" onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
    <div class="form-group">
      <label for="name">Tab Name *</label>
      <input
        id="name"
        type="text"
        bind:value={name}
        required
        placeholder="e.g., Home, Work, Media"
      />
    </div>

    <!-- Icon: small preview + button to open the icon sub-modal. -->
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
            <ColoredIcon icon="mdi:home-outline" width="28" />
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

  </form>

  {#snippet footer()}
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
        <button type="submit" form="tab-edit-form" class="btn-primary">
          <Icon icon="mdi:content-save" width="20" />
          {tabName ? 'Save' : 'Create'}
        </button>
      </div>
    </div>
  {/snippet}
</Modal>

{#if showBackgroundConfig}
  <BackgroundConfigModal
    background={tabBackground}
    level="tab"
    onSave={handleBackgroundSave}
    onCancel={() => showBackgroundConfig = false}
  />
{/if}

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
  /* Modal body already pads — see GroupEditModal note. */
  form {
    padding: 0;
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

  /* Old inline-icon CSS removed — IconEditModal owns the picker UI now. */
</style>
