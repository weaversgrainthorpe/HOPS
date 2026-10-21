<script lang="ts">
  import Icon from '@iconify/svelte';
  import Modal from '$lib/components/shared/Modal.svelte';
  import { login, loginError, isLoggingIn } from '$lib/stores/auth';

  // Sign in without leaving the page (the dashboard pencil today; the gear and
  // Settings later). Credentials go through the auth store's login(), so the
  // session cookie + CSRF flow is the same as the admin login form.
  interface Props {
    onSuccess: () => void;
    onCancel: () => void;
  }

  let { onSuccess, onCancel }: Props = $props();

  let username = $state('');
  let password = $state('');
  let error = $state('');

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if ($isLoggingIn) return;
    error = '';
    const ok = await login(username, password);
    if (ok) {
      password = '';
      onSuccess();
      return;
    }
    // Never a silent failure: the reason (wrong password, server unreachable,
    // rate-limited) is shown here, in the dialog, which stays open.
    error = $loginError || 'Sign-in failed. Try again.';
  }

  function cancel() {
    if ($isLoggingIn) return;
    onCancel();
  }
</script>

<Modal
  id="login-dialog"
  title="Sign in"
  titleIcon="mdi:account-key"
  onClose={cancel}
  maxWidth="400px"
  zIndex="var(--z-modal-overlay)"
  initialFocus="#login-username"
>
  <p class="intro">Sign in to edit this dashboard.</p>
  <form id="login-dialog-form" onsubmit={handleSubmit}>
    <div class="form-group">
      <label for="login-username">Username</label>
      <input
        id="login-username"
        type="text"
        bind:value={username}
        required
        autocomplete="username"
        autocapitalize="none"
        spellcheck="false"
        disabled={$isLoggingIn}
      />
    </div>

    <div class="form-group">
      <label for="login-password">Password</label>
      <input
        id="login-password"
        type="password"
        bind:value={password}
        required
        autocomplete="current-password"
        disabled={$isLoggingIn}
      />
    </div>

    {#if error}
      <div class="error-message" role="alert">
        <Icon icon="mdi:alert-circle" width="18" />
        <span>{error}</span>
      </div>
    {/if}
  </form>

  {#snippet footer()}
    <div class="modal-actions">
      <button type="button" class="btn-secondary" onclick={cancel} disabled={$isLoggingIn}>Cancel</button>
      <button type="submit" form="login-dialog-form" class="btn-primary" disabled={$isLoggingIn}>
        {#if $isLoggingIn}
          <Icon icon="mdi:loading" width="18" class="spin" />
        {/if}
        Sign in
      </button>
    </div>
  {/snippet}
</Modal>

<style>
  .intro {
    margin: 0 0 1rem 0;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  label {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  input {
    width: 100%;
    padding: 0.625rem 0.75rem;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    color: var(--text-primary);
    font-size: 0.875rem;
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

  .error-message {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: color-mix(in srgb, var(--color-error) 15%, transparent);
    color: var(--color-error-text);
    border-radius: 0.375rem;
    font-size: 0.875rem;
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    width: 100%;
  }

  /* .btn-primary, .btn-secondary and .spin are defined globally in app.css */
</style>
