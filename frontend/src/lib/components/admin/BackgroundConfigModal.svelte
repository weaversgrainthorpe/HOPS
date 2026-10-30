<script lang="ts">
  /**
   * The tab and folder background picker, nested over their edit dialogs: the
   * BackgroundSection form in its own dialog with Save / Cancel. (The dashboard's background is
   * the dashboard dialog's Background section.)
   */
  import type { Background } from '$lib/types';
  import Icon from '@iconify/svelte';
  import { focusTrap } from '$lib/utils/focusTrap';
  import { portal } from '$lib/utils/portal';
  import { dialogContentKeydown, dialogWindowEscape } from '$lib/utils/dialogKeys';
  import BackgroundSection, { LEVEL_TEXT } from './BackgroundSection.svelte';
  import type { BackgroundContext } from '$lib/components/background/backgroundCapabilities';

  interface Props {
    background?: Background;
    onSave: (background: Background | undefined) => void;
    onCancel: () => void;
    /** Which level this picker edits; what it offers comes from backgroundCapabilities. */
    level: 'dashboard' | 'tab' | 'folder';
    /** The capability table's runtime conditions, from the host. */
    runtime: BackgroundContext;
    /** Opens the dashboard's settings (the folder-animations note's link). */
    onOpenDashboardSettings?: () => void;
    /** Folder level, a stored colour background: hand it to the folder dialog as the folder's colour. */
    onUseAsFolderColour?: () => void;
  }

  let { background, onSave, onCancel, level, runtime, onUseAsFolderColour, onOpenDashboardSettings }: Props = $props();

  let section = $state<BackgroundSection>();
  /** A refused Save, shown by the buttons (no silent failures). */
  let saveError = $state('');

  function handleSave() {
    if (!section) return;
    const r = section.build();
    if (!r.ok) {
      saveError = r.problem;
      return;
    }
    saveError = '';
    onSave(r.value);
  }

  let dialogEl = $state<HTMLElement>();
  // Keys inside the picker: Ctrl+Enter saves, Escape cancels it (only it, when nested), and no
  // key leaves it (dialogKeys). The window listener is the Escape fallback for focus outside.
  function handleContentKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.stopPropagation();
      e.preventDefault();
      handleSave();
      return;
    }
    dialogContentKeydown(e, onCancel);
  }
  function handleKeydown(e: KeyboardEvent) {
    dialogWindowEscape(e, dialogEl, onCancel);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<!-- Portalled above the dialog that opened it (tab/folder dialogs are portalled Modals too). -->
<div class="modal-backdrop" use:portal onclick={onCancel}>
  <div
    bind:this={dialogEl}
    class="modal-content"
    onclick={(e) => e.stopPropagation()}
    onkeydown={handleContentKeydown}
    role="dialog"
    aria-modal="true"
    aria-labelledby="background-config-title"
    tabindex="-1"
    use:focusTrap
  >
    <div class="modal-header">
      <h2 id="background-config-title">{LEVEL_TEXT[level].title}</h2>
      <button class="close-btn" onclick={onCancel} aria-label="Close">
        <Icon icon="mdi:close" width="24" />
      </button>
    </div>

    <div class="modal-body">
      <BackgroundSection bind:this={section} {background} {level} {runtime} {onUseAsFolderColour} {onOpenDashboardSettings} />
    </div>

    <div class="modal-footer">
      {#if saveError}
        <p class="field-error save-error" role="alert">{saveError}</p>
      {/if}
      <button class="btn-secondary" onclick={onCancel}>Cancel</button>
      <button class="btn-primary" onclick={handleSave}>Save Background</button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    /* Above the tab/folder dialog that opens it; below confirm dialogs (critical). */
    z-index: var(--z-modal-overlay);
    padding: 1rem;
  }

  .modal-content {
    background: var(--bg-secondary);
    border-radius: 0.75rem;
    width: 100%;
    max-width: 1000px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
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
    font-weight: 600;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.5rem;
    border-radius: 0.375rem;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .field-error {
    margin: 0.4rem 0 0;
    color: var(--color-error, #dc2626);
    font-size: 0.85rem;
  }

  .save-error {
    margin: 0 auto 0 0;
    align-self: center;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1.5rem;
    border-top: 1px solid var(--border);
  }

  @media (max-width: 768px) {
    .modal-content {
      max-width: 100%;
      max-height: 100vh;
      border-radius: 0;
    }
  }
</style>
