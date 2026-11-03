<script lang="ts">
  import Icon from '@iconify/svelte';
  import ColoredIcon from '../ColoredIcon.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import OpacitySlider from './OpacitySlider.svelte';
  import BackgroundConfigModal from './BackgroundConfigModal.svelte';
  import IconEditModal from './IconEditModal.svelte';
  import Modal from '../shared/Modal.svelte';
  import ActionButton from '../shared/ActionButton.svelte';
  import type { Background } from '$lib/types';
  import { editMode } from '$lib/stores/editMode';
  import { backgroundSummary } from '../background/backgroundSummary';
  import { reducedMotion } from '$lib/stores/backgroundAnimation';
  import StatusCheckSetting from '../editor/StatusCheckSetting.svelte';
  import { gateSetting, type GateSetting, type StatusContext } from '$lib/editor/statusChecks';
  import TextColourSetting from '../editor/TextColourSetting.svelte';
  import { textColourOn, type TextColorMode } from '$lib/utils/colorContrast';

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
    /** Auto (missing), Light or Dark: the one text rule, as tiles and folders. */
    tabTextColor?: string;
    tabBackground?: Background;
    onSave: (
      name: string, icon?: string, iconUrl?: string, iconBgColor?: string, color?: string, opacity?: number,
      /** A background picked in this dialog: undefined = unchanged, null = removed. */
      background?: Background | null,
      /** Status-check gate: undefined = unchanged, false = Disabled, null = Enabled (key removed). */
      statusChecksEnabled?: boolean | null,
      /** Undefined = Auto (the key removed). */
      textColor?: 'light' | 'dark'
    ) => void;
    onCancel: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
    /** The tab's stored status-check gate (missing = Enabled). */
    tabStatusChecks?: unknown;
    /** The dashboard, so the status-check row can say when a gate above stops this one. */
    statusContext?: StatusContext;
  }

  let { tabName, tabIcon, tabIconUrl, tabIconBgColor, tabColor, tabOpacity, tabTextColor, tabBackground, onSave, onCancel, onDelete, onDuplicate, tabStatusChecks, statusContext }: Props = $props();
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
  // svelte-ignore state_referenced_locally
  let textColor = $state<TextColorMode>(tabTextColor === 'light' || tabTextColor === 'dark' ? tabTextColor : 'auto');
  const textOn = $derived(textColourOn(color, textColor));
  // svelte-ignore state_referenced_locally
  const initialStatus = gateSetting(tabStatusChecks);
  let statusSetting = $state<GateSetting>(initialStatus);
  let showBackgroundConfig = $state(false);

  // A picked background is staged here and saved with the dialog (one undo step);
  // Cancel discards it.
  let stagedBackground = $state<{ value: Background | undefined } | null>(null);
  const shownBackground = $derived(stagedBackground ? stagedBackground.value : tabBackground);
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
    if (!name.trim()) return;
    const bg = stagedBackground ? (stagedBackground.value ?? null) : undefined;
    // Only a changed choice is written (an untouched invalid value stays as stored).
    const sc =
      statusSetting !== initialStatus && statusSetting !== 'invalid'
        ? statusSetting === 'disabled' ? false : null
        : undefined;
    onSave(name.trim(), icon || undefined, iconUrl || undefined, iconBgColor, color, opacity, bg, sc, textColor === 'auto' ? undefined : textColor);
  }

  function handleBackgroundSave(background: Background | undefined) {
    stagedBackground = { value: background };
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
      <label for="name">Name *</label>
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
      <label>Icon</label>
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

    <section class="dialog-section" aria-labelledby="tab-colour-heading">
      <h3 id="tab-colour-heading" class="part-title">Colour</h3>
      <div class="stack">
        <ColorPicker
          label="Colour"
          hideLabel
          selectedColor={color}
          onSelect={(c) => color = c}
        />
        {#if textOn.invalid}
          <p class="colour-problem" role="status" data-colour-unreadable>Its colour ({color}) can't be read, so the tab shows the theme colour. Choose a colour above.</p>
        {/if}

        <OpacitySlider
          label="Background opacity"
          opacity={opacity}
          onSelect={(o) => opacity = o}
        />

        <TextColourSetting name="tab-text-color" bind:value={textColor} contrast={textOn.contrastWarning ? textOn.contrast : null}
          noColourNote={textOn.themed ? 'Text colour applies when the tab has a colour.' : null} />
      </div>
    </section>


    <StatusCheckSetting level="tab" bind:value={statusSetting} context={statusContext} />

    <div class="form-group">
      <button type="button" class="btn-background" onclick={() => showBackgroundConfig = true}>
        <Icon icon="mdi:image-multiple" width="20" />
        Configure Tab Background
      </button>
      <small class="background-status">
        {backgroundSummary(shownBackground, 'Using the dashboard background')}{stagedBackground ? ' — applies when you save this tab' : ''}
      </small>
    </div>

  </form>

  {#snippet footer()}
    <div class="modal-actions">
      <div class="actions-left">
        {#if tabName && onDelete}
          <ActionButton action="delete" onclick={onDelete} />
        {/if}
        {#if tabName && onDuplicate}
          <ActionButton action="duplicate" onclick={onDuplicate} />
        {/if}
      </div>
      <div class="actions-right">
        <ActionButton action="cancel" onclick={onCancel} />
        <ActionButton action={tabName ? 'save' : 'create'} type="submit" form="tab-edit-form" />
      </div>
    </div>
  {/snippet}
</Modal>

{#if showBackgroundConfig}
  <BackgroundConfigModal
    background={shownBackground}
    level="tab"
    runtime={{ reducedMotion: $reducedMotion }}
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
  /* Modal body already pads; no extra padding here. */
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
    color: var(--accent-text);
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
    color: var(--accent-text);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .colour-problem {
    margin: 0.5rem 0 0;
    font-size: 0.875rem;
    color: var(--color-error-text);
  }

  .dialog-section {
    margin: 1.5rem 0;
    padding-top: 1.25rem;
    border-top: 1px solid var(--border);
  }

  .part-title {
    margin: 0 0 0.85rem;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 1rem;
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

  .btn-background {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    width: 100%;
    justify-content: center;
  }

  .btn-background:hover {
    background: var(--accent-solid);
    color: var(--on-accent);
    border-color: var(--accent-solid);
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


  /* Old inline-icon CSS removed — IconEditModal owns the picker UI now. */
</style>
