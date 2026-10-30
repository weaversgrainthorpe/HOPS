<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from '@iconify/svelte';
  import Modal from '$lib/components/shared/Modal.svelte';
  import { login, loginError, isLoggingIn } from '$lib/stores/auth';

  // Sign in without leaving the page: the dashboard pencil, and Settings (the gear). Credentials
  // go through the auth store's login(), so the session cookie + CSRF flow is the same everywhere.
  interface Props {
    onSuccess: () => void;
    onCancel: () => void;
    /** One line saying what signing in is for. */
    intro?: string;
  }

  let { onSuccess, onCancel, intro = 'Sign in to edit this dashboard.' }: Props = $props();

  // Per-instance ids: two dialogs must never share a form id (the footer's Sign in button finds
  // its form by id, so a duplicate would submit the wrong one).
  const uid = $props.id();
  const dialogId = `login-dialog-${uid}`;
  const formId = `login-dialog-form-${uid}`;
  const usernameId = `login-username-${uid}`;
  const passwordId = `login-password-${uid}`;

  let username = $state('');
  let password = $state('');
  let passwordEl = $state<HTMLInputElement | null>(null);

  // A failure from before this dialog opened is not this dialog's failure.
  onMount(() => loginError.set(''));

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if ($isLoggingIn) return;
    // The dialog shows the reason itself ($loginError), so login() sends no second copy to a toast.
    const ok = await login(username, password, { quietErrors: true });
    if (ok) {
      password = '';
      onSuccess();
      return;
    }
    // Never a silent failure: the reason (wrong password, server unreachable, rate-limited) is
    // shown below, in the dialog, which stays open. The fields were disabled during the attempt
    // (which drops focus); put the cursor back in the password to try again.
    await tick();
    passwordEl?.focus();
    passwordEl?.select();
  }

  function cancel() {
    if ($isLoggingIn) return;
    onCancel();
  }
</script>

<Modal
  id={dialogId}
  title="Sign in"
  titleIcon="mdi:account-key"
  onClose={cancel}
  maxWidth="400px"
  zIndex="var(--z-modal-overlay)"
  initialFocus={`#${usernameId}`}
>
  <p class="intro">{intro}</p>
  <form id={formId} onsubmit={handleSubmit}>
    <div class="form-group">
      <label for={usernameId}>Username</label>
      <input
        id={usernameId}
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
      <label for={passwordId}>Password</label>
      <input
        id={passwordId}
        type="password"
        bind:value={password}
        required
        autocomplete="current-password"
        disabled={$isLoggingIn}
        bind:this={passwordEl}
      />
    </div>

    {#if $loginError}
      <div class="error-message" role="alert">
        <Icon icon="mdi:alert-circle" width="18" />
        <span>{$loginError}</span>
      </div>
    {/if}
  </form>

  <details class="forgot">
    <summary>Forgot password?</summary>
    <p>
      On the computer that runs HOPS, run <code>hops reset-password</code> (add
      <code>--data &lt;folder&gt;</code> if HOPS is started with one). It prints a temporary password
      and signs out every browser; sign in with it and choose a new password.
    </p>
  </details>

  {#snippet footer()}
    <div class="modal-actions">
      <button type="button" class="btn-secondary" onclick={cancel} disabled={$isLoggingIn}>Cancel</button>
      <button type="submit" form={formId} class="btn-primary" disabled={$isLoggingIn}>
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

  .forgot {
    margin-top: 1rem;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .forgot summary {
    cursor: pointer;
    width: fit-content;
  }

  .forgot p {
    margin: 0.5rem 0 0 0;
    line-height: 1.5;
  }

  .forgot code {
    font-size: 0.8125rem;
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    width: 100%;
  }

  /* .btn-primary, .btn-secondary and .spin are defined globally in app.css */
</style>
