<script lang="ts">
  import Icon from '@iconify/svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    /** Whether content is loading */
    loading?: boolean;
    /** Error message if any */
    error?: string | null;
    /** Content to render when loaded */
    children: Snippet;
    /** Custom loading content */
    loadingContent?: Snippet;
    /** Custom error content */
    errorContent?: Snippet<[{ error: string; retry?: () => void }]>;
    /** Retry callback for error state */
    onRetry?: () => void;
    /** Skeleton variant for loading */
    skeletonVariant?: 'text' | 'rect' | 'tile';
    /** Number of skeleton lines */
    skeletonLines?: number;
    /** Minimum height for loading/error states */
    minHeight?: string;
  }

  let {
    loading = false,
    error = null,
    children,
    loadingContent,
    errorContent,
    onRetry,
    skeletonVariant = 'rect',
    skeletonLines = 3,
    minHeight = '100px'
  }: Props = $props();
</script>

{#if loading}
  {#if loadingContent}
    {@render loadingContent()}
  {:else}
    <div class="async-loading" style:min-height={minHeight}>
      <Skeleton variant={skeletonVariant} lines={skeletonLines} />
    </div>
  {/if}
{:else if error}
  {#if errorContent}
    {@render errorContent({ error, retry: onRetry })}
  {:else}
    <div class="async-error" style:min-height={minHeight}>
      <Icon icon="mdi:alert-circle-outline" width="32" class="error-icon" />
      <p class="error-text">{error}</p>
      {#if onRetry}
        <button class="retry-btn" onclick={onRetry}>
          <Icon icon="mdi:refresh" width="18" />
          Retry
        </button>
      {/if}
    </div>
  {/if}
{:else}
  {@render children()}
{/if}

<style>
  .async-loading {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1rem;
  }

  .async-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 1.5rem;
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
    text-align: center;
  }

  .async-error :global(.error-icon) {
    color: var(--color-error, #ef4444);
  }

  .error-text {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .retry-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 1rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .retry-btn:hover {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
</style>
