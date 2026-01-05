<script lang="ts">
  import { toast, type Toast } from '$lib/stores/toast';
  import Icon from '@iconify/svelte';

  let toasts = $state<Toast[]>([]);

  $effect(() => {
    const unsubscribe = toast.subscribe(value => {
      toasts = value;
    });
    return unsubscribe;
  });

  function getIcon(type: Toast['type']): string {
    switch (type) {
      case 'success': return 'mdi:check-circle';
      case 'error': return 'mdi:alert-circle';
      case 'warning': return 'mdi:alert';
      case 'info': return 'mdi:information';
    }
  }
</script>

{#if toasts.length > 0}
  <div class="toast-container">
    {#each toasts as t (t.id)}
      <div class="toast toast-{t.type}" role="alert">
        <Icon icon={getIcon(t.type)} width="20" />
        <span class="toast-message">{t.message}</span>
        <button class="toast-close" onclick={() => toast.remove(t.id)} aria-label="Dismiss">
          <Icon icon="mdi:close" width="16" />
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    z-index: var(--z-toast);
    max-width: 400px;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    border-radius: 0.5rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: slideIn 0.3s ease-out;
    color: white;
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  .toast-success {
    background: var(--color-success, #10b981);
  }

  .toast-error {
    background: var(--color-error, #ef4444);
  }

  .toast-warning {
    background: var(--color-warning, #f59e0b);
  }

  .toast-info {
    background: var(--color-primary, #3b82f6);
  }

  .toast-message {
    flex: 1;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .toast-close {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.2);
    border: none;
    border-radius: 0.25rem;
    padding: 0.25rem;
    cursor: pointer;
    transition: background 0.2s;
    color: inherit;
  }

  .toast-close:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  @media (max-width: 480px) {
    .toast-container {
      left: 1rem;
      right: 1rem;
      max-width: none;
    }
  }
</style>
