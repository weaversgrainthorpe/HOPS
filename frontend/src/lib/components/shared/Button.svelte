<script lang="ts">
  import Icon from '@iconify/svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    /** Button variant determines the color scheme */
    variant?: 'primary' | 'secondary' | 'danger' | 'warning' | 'success' | 'ghost';
    /** Size of the button */
    size?: 'small' | 'medium' | 'large';
    /** Whether the button takes full width */
    fullWidth?: boolean;
    /** Icon to display before the text (Iconify format) */
    icon?: string;
    /** Icon size (default: auto based on button size) */
    iconSize?: number;
    /** Whether the button is disabled */
    disabled?: boolean;
    /** Whether to show a loading spinner */
    loading?: boolean;
    /** Button type for form submission */
    type?: 'button' | 'submit' | 'reset';
    /** Additional CSS class */
    class?: string;
    /** Click handler */
    onclick?: (e: MouseEvent) => void;
    /** Button content */
    children?: Snippet;
  }

  let {
    variant = 'primary',
    size = 'medium',
    fullWidth = false,
    icon,
    iconSize,
    disabled = false,
    loading = false,
    type = 'button',
    class: className = '',
    onclick,
    children
  }: Props = $props();

  const defaultIconSizes = {
    small: 16,
    medium: 20,
    large: 24
  };

  const effectiveIconSize = $derived(iconSize || defaultIconSizes[size]);
  const isDisabled = $derived(disabled || loading);
</script>

<button
  {type}
  class="btn btn-{variant} btn-{size} {className}"
  class:full-width={fullWidth}
  class:loading
  disabled={isDisabled}
  onclick={onclick}
>
  {#if loading}
    <Icon icon="mdi:loading" width={effectiveIconSize} class="spinner" />
  {:else if icon}
    <Icon {icon} width={effectiveIconSize} />
  {/if}
  {#if children}
    {@render children()}
  {/if}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Sizes */
  .btn-small {
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    gap: 0.375rem;
  }

  .btn-medium {
    padding: 0.625rem 1.25rem;
    font-size: 0.875rem;
  }

  .btn-large {
    padding: 0.875rem 1.75rem;
    font-size: 1rem;
  }

  /* Variants */
  .btn-primary {
    background: var(--accent);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-primary);
  }

  .btn-danger {
    background: var(--color-error, #ef4444);
    color: white;
  }

  .btn-danger:hover:not(:disabled) {
    background: var(--color-error-dark, #dc2626);
  }

  .btn-warning {
    background: var(--color-warning, #f59e0b);
    color: white;
  }

  .btn-warning:hover:not(:disabled) {
    background: var(--color-warning-dark, #d97706);
  }

  .btn-success {
    background: var(--color-success-alt, #22c55e);
    color: white;
  }

  .btn-success:hover:not(:disabled) {
    background: var(--color-success-dark, #059669);
  }

  .btn-ghost {
    background: transparent;
    color: var(--text-secondary);
    padding: 0.5rem;
  }

  .btn-ghost:hover:not(:disabled) {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  /* Modifiers */
  .full-width {
    width: 100%;
  }

  .loading {
    pointer-events: none;
  }

  /* Loading spinner animation */
  :global(.spinner) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
