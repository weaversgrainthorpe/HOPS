<script lang="ts">
  import Icon from '@iconify/svelte';
  import { focusTrap } from '$lib/utils/focusTrap';
  import type { Snippet } from 'svelte';

  interface Props {
    /** Unique ID for the modal (used for aria-labelledby) */
    id: string;
    /** Title displayed in the modal header */
    title?: string;
    /** Icon to display next to the title (Iconify format) */
    titleIcon?: string;
    /** Close callback function */
    onClose: () => void;
    /** Maximum width of the modal (default: 600px) */
    maxWidth?: string;
    /** Z-index CSS variable name (default: --z-modal) */
    zIndex?: string;
    /** Whether to show the close button (default: true) */
    showCloseButton?: boolean;
    /** Additional CSS class for the modal content */
    contentClass?: string;
    /** Header slot content (overrides title) */
    header?: Snippet;
    /** Default slot content (modal body) */
    children: Snippet;
    /** Footer slot content */
    footer?: Snippet;
  }

  let {
    id,
    title = '',
    titleIcon,
    onClose,
    maxWidth = '600px',
    zIndex = 'var(--z-modal)',
    showCloseButton = true,
    contentClass = '',
    header,
    children,
    footer
  }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="modal-backdrop"
  onclick={handleBackdropClick}
  onkeydown={(e) => e.key === 'Escape' && onClose()}
  style:--modal-z-index={zIndex}
>
  <div
    class="modal-content {contentClass}"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    aria-labelledby="{id}-title"
    tabindex="-1"
    use:focusTrap
    style:--modal-max-width={maxWidth}
  >
    {#if header}
      <div class="modal-header">
        {@render header()}
      </div>
    {:else if title}
      <div class="modal-header">
        <h2 id="{id}-title">
          {#if titleIcon}
            <Icon icon={titleIcon} width="28" />
          {/if}
          {title}
        </h2>
        {#if showCloseButton}
          <button class="close-btn" onclick={onClose} title="Close (Esc)">
            <Icon icon="mdi:close" width="24" />
          </button>
        {/if}
      </div>
    {/if}

    <div class="modal-body">
      {@render children()}
    </div>

    {#if footer}
      <div class="modal-footer">
        {@render footer()}
      </div>
    {/if}
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
    z-index: var(--modal-z-index, var(--z-modal));
    padding: 1rem;
  }

  .modal-content {
    background: var(--bg-secondary);
    border-radius: 0.75rem;
    width: 100%;
    max-width: var(--modal-max-width, 600px);
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
    animation: modalSlideIn 0.2s ease-out;
  }

  @keyframes modalSlideIn {
    from {
      opacity: 0;
      transform: translateY(-10px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--text-primary);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.5rem;
    border-radius: 0.375rem;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
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

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  @media (max-width: 640px) {
    .modal-content {
      max-height: 100vh;
      border-radius: 0;
    }
  }
</style>
