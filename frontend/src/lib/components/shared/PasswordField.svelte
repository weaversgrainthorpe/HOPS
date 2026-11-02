<script lang="ts">
  import Icon from '@iconify/svelte';

  // A password input with its own show/hide eye, so every browser gets one (only Edge has a built-in
  // eye, and it is hidden below so that one field never shows two).
  interface Props {
    id: string;
    value: string;
    autocomplete: 'current-password' | 'new-password';
    disabled?: boolean;
    required?: boolean;
    invalid?: boolean;
    describedby?: string;
    inputEl?: HTMLInputElement | null;
  }

  let {
    id,
    value = $bindable(),
    autocomplete,
    disabled = false,
    required = false,
    invalid = false,
    describedby,
    inputEl = $bindable(null)
  }: Props = $props();

  let shown = $state(false);

  // A submit disables the field: go back to dots, so a password never stays on screen afterwards.
  $effect(() => {
    if (disabled) shown = false;
  });
</script>

<div class="password-field">
  <input
    {id}
    type={shown ? 'text' : 'password'}
    bind:value
    bind:this={inputEl}
    {autocomplete}
    {required}
    {disabled}
    autocapitalize="none"
    spellcheck="false"
    aria-describedby={describedby}
    class:invalid
  />
  <button
    type="button"
    class="reveal"
    aria-label={shown ? 'Hide password' : 'Show password'}
    aria-controls={id}
    {disabled}
    onclick={() => (shown = !shown)}
  >
    <Icon icon={shown ? 'mdi:eye-off' : 'mdi:eye'} width="20" />
  </button>
</div>

<style>
  .password-field {
    position: relative;
  }

  input {
    width: 100%;
    padding: 0.625rem 2.75rem 0.625rem 0.75rem;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  input::-ms-reveal {
    display: none;
  }

  input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  input.invalid {
    border-color: var(--color-error, #ef4444);
  }

  .reveal {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    padding: 0;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .reveal:hover:not(:disabled) {
    background: none;
    color: var(--text-primary);
  }

  .reveal:disabled {
    cursor: not-allowed;
  }
</style>
