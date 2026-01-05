<script lang="ts">
  import { confirmModalState, closeConfirmModal, type ConfirmOptions } from '$lib/stores/confirmModal';
  import { focusTrap } from '$lib/utils/focusTrap';
  import { COLORS } from '$lib/constants/colors';
  import Icon from '@iconify/svelte';

  interface ConfirmState {
    isOpen: boolean;
    options: ConfirmOptions | null;
    resolve: ((value: boolean) => void) | null;
  }

  let state = $state<ConfirmState>({ isOpen: false, options: null, resolve: null });

  $effect(() => {
    const unsubscribe = confirmModalState.subscribe(value => {
      state = value;
    });
    return unsubscribe;
  });

  function handleKeydown(e: KeyboardEvent) {
    if (!state.isOpen) return;

    if (e.key === 'Escape') {
      closeConfirmModal(false);
    } else if (e.key === 'Enter') {
      closeConfirmModal(true);
    }
  }

  function getIcon(style: string | undefined) {
    switch (style) {
      case 'danger': return 'mdi:alert-circle';
      case 'warning': return 'mdi:alert';
      default: return 'mdi:help-circle';
    }
  }

  function getIconColor(style: string | undefined) {
    switch (style) {
      case 'danger': return COLORS.error.DEFAULT;
      case 'warning': return COLORS.warning.DEFAULT;
      default: return 'var(--accent)';
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if state.isOpen && state.options}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-backdrop"
    onclick={() => closeConfirmModal(false)}
    onkeydown={(e) => e.key === 'Escape' && closeConfirmModal(false)}
  >
    <div
      class="modal-content"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      tabindex="-1"
      use:focusTrap
    >
      <div class="modal-icon" style:color={getIconColor(state.options.confirmStyle)}>
        <Icon icon={getIcon(state.options.confirmStyle)} width="48" />
      </div>

      <h2 id="confirm-title">{state.options.title}</h2>
      <p>{state.options.message}</p>

      <div class="modal-actions">
        <button class="btn-secondary" onclick={() => closeConfirmModal(false)}>
          {state.options.cancelText || 'Cancel'}
        </button>
        <button
          class="btn-confirm"
          class:btn-danger={state.options.confirmStyle === 'danger'}
          class:btn-warning={state.options.confirmStyle === 'warning'}
          class:btn-primary={!state.options.confirmStyle || state.options.confirmStyle === 'primary'}
          onclick={() => closeConfirmModal(true)}
        >
          {state.options.confirmText || 'Confirm'}
        </button>
      </div>
    </div>
  </div>
{/if}

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
    z-index: var(--z-modal-critical);
    padding: 1rem;
  }

  .modal-content {
    background: var(--bg-secondary);
    border-radius: 0.75rem;
    padding: 2rem;
    width: 100%;
    max-width: 400px;
    text-align: center;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
    animation: scaleIn 0.2s ease-out;
  }

  @keyframes scaleIn {
    from {
      transform: scale(0.95);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  .modal-icon {
    margin-bottom: 1rem;
  }

  h2 {
    margin: 0 0 0.5rem 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  p {
    margin: 0 0 1.5rem 0;
    color: var(--text-secondary);
    font-size: 0.9375rem;
    line-height: 1.5;
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
  }

  .btn-secondary, .btn-confirm {
    padding: 0.625rem 1.25rem;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    min-width: 100px;
  }

  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .btn-secondary:hover {
    background: var(--bg-primary);
  }

  .btn-primary {
    background: var(--accent);
    color: white;
  }

  .btn-primary:hover {
    background: var(--accent-hover);
  }

  .btn-danger {
    background: var(--color-error, #ef4444);
    color: white;
  }

  .btn-danger:hover {
    background: var(--color-error-dark, #dc2626);
  }

  .btn-warning {
    background: var(--color-warning, #f59e0b);
    color: white;
  }

  .btn-warning:hover {
    background: var(--color-warning-dark, #d97706);
  }
</style>
