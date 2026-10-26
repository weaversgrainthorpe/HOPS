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
    /** Accessible name — required for icon-only buttons (no children). */
    ariaLabel?: string;
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
    ariaLabel,
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
  aria-label={ariaLabel}
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
    background: var(--accent-solid);
    color: var(--on-accent);
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-solid-hover);
  }

  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-primary);
  }

  .btn-danger {
    background: var(--danger-solid);
    color: white;
  }

  .btn-danger:hover:not(:disabled) {
    background: var(--danger-solid-hover);
  }

  .btn-warning {
    background: var(--warning-solid);
    color: white;
  }

  .btn-warning:hover:not(:disabled) {
    background: var(--warning-solid-hover);
  }

  .btn-success {
    background: var(--success-solid);
    color: white;
  }

  .btn-success:hover:not(:disabled) {
    background: var(--success-solid-hover);
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

  /* Disabled: readable (>= 3:1), shown by a muted fill, a dashed edge, no shadow and the cursor —
     not by fading. Every variant's hover is :not(:disabled), so hovering one changes nothing. */
  .btn:disabled {
    opacity: 1;
    background: var(--disabled-bg);
    color: var(--disabled-text);
    outline: 1px dashed var(--disabled-edge);
    outline-offset: -1px;
    box-shadow: none;
    cursor: not-allowed;
  }

  .btn-ghost:disabled {
    background: transparent;
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
