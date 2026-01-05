<script lang="ts">
  import Icon from '@iconify/svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    /** Content to render when no error */
    children: Snippet;
    /** Custom fallback content */
    fallback?: Snippet<[{ error: Error; reset: () => void }]>;
    /** Called when an error is caught */
    onError?: (error: Error) => void;
  }

  let { children, fallback, onError }: Props = $props();

  let error = $state<Error | null>(null);

  function reset() {
    error = null;
  }

  // Note: Svelte doesn't have built-in error boundaries like React
  // This component provides a pattern for handling errors in async operations
  // For synchronous render errors, use +error.svelte pages
</script>

{#if error}
  {#if fallback}
    {@render fallback({ error, reset })}
  {:else}
    <div class="error-boundary">
      <div class="error-content">
        <Icon icon="mdi:alert-circle" width="48" class="error-icon" />
        <h3>Something went wrong</h3>
        <p class="error-message">{error.message}</p>
        <button class="retry-btn" onclick={reset}>
          <Icon icon="mdi:refresh" width="20" />
          Try Again
        </button>
      </div>
    </div>
  {/if}
{:else}
  {@render children()}
{/if}

<style>
  .error-boundary {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    padding: 2rem;
  }

  .error-content {
    text-align: center;
    max-width: 400px;
  }

  .error-content :global(.error-icon) {
    color: var(--color-error, #ef4444);
    margin-bottom: 1rem;
  }

  h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .error-message {
    margin: 0 0 1.5rem 0;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .retry-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1.25rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .retry-btn:hover {
    background: var(--accent-hover);
  }
</style>
