<script lang="ts">
  import Icon from '@iconify/svelte';
  import Modal from '$lib/components/shared/Modal.svelte';
  import { changePassword } from '$lib/utils/api';
  import { validatePassword, validateMatch } from '$lib/utils/validation';
  import { clearMustChangePassword } from '$lib/stores/auth';

  interface Props {
    onClose: () => void;
    /** When true, the modal cannot be dismissed and shows a forced-change message */
    forced?: boolean;
  }

  let { onClose, forced = false }: Props = $props();

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let error = $state('');
  let success = $state(false);
  let isSubmitting = $state(false);

  // Derived validation states
  let newPasswordValidation = $derived(validatePassword(newPassword, { minLength: 4 }));
  let confirmValidation = $derived(validateMatch(newPassword, confirmPassword, 'passwords'));

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = '';

    // Validate new password
    if (!newPasswordValidation.valid) {
      error = newPasswordValidation.message || 'Invalid password';
      return;
    }

    // Validate passwords match
    if (!confirmValidation.valid) {
      error = confirmValidation.message || 'Passwords do not match';
      return;
    }

    // Check new password is different
    if (newPassword === currentPassword) {
      error = 'New password must be different from current password';
      return;
    }

    isSubmitting = true;

    try {
      await changePassword(currentPassword, newPassword);
      success = true;
      clearMustChangePassword();
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to change password';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<Modal
  id="change-password"
  title={forced ? 'Set a New Password' : 'Change Password'}
  titleIcon="mdi:key"
  onClose={onClose}
  onBeforeClose={() => !forced || success}
  showCloseButton={!forced || success}
  maxWidth="400px"
>
  {#if success}
    <div class="success-message">
      <Icon icon="mdi:check-circle" width="48" />
      <p>Password changed successfully!</p>
    </div>
  {:else}
    {#if forced}
      <div class="forced-notice" role="alert">
        <Icon icon="mdi:shield-alert" width="20" />
        <span>You're using the default password. Please set a new password to continue.</span>
      </div>
    {/if}
    <form id="change-password-form" onsubmit={handleSubmit}>
      <div class="form-group">
        <label for="current-password">Current Password</label>
        <input
          id="current-password"
          type="password"
          bind:value={currentPassword}
          required
          autocomplete="current-password"
          disabled={isSubmitting}
        />
      </div>

      <div class="form-group">
        <label for="new-password">New Password</label>
        <input
          id="new-password"
          type="password"
          bind:value={newPassword}
          required
          autocomplete="new-password"
          disabled={isSubmitting}
          class:invalid={newPassword && !newPasswordValidation.valid}
        />
        {#if newPassword && !newPasswordValidation.valid}
          <span class="field-error">{newPasswordValidation.message}</span>
        {/if}
      </div>

      <div class="form-group">
        <label for="confirm-password">Confirm New Password</label>
        <input
          id="confirm-password"
          type="password"
          bind:value={confirmPassword}
          required
          autocomplete="new-password"
          disabled={isSubmitting}
          class:invalid={confirmPassword && !confirmValidation.valid}
        />
        {#if confirmPassword && !confirmValidation.valid}
          <span class="field-error">{confirmValidation.message}</span>
        {/if}
      </div>

      {#if error}
        <div class="error-message">
          <Icon icon="mdi:alert-circle" width="18" />
          {error}
        </div>
      {/if}
    </form>
  {/if}

  {#snippet footer()}
    {#if !success}
      <div class="modal-actions">
        {#if !forced}
          <button type="button" class="btn-secondary" onclick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
        {/if}
        <button type="submit" form="change-password-form" class="btn-primary" disabled={isSubmitting}>
          {#if isSubmitting}
            <Icon icon="mdi:loading" width="18" class="spin" />
            Changing...
          {:else}
            {forced ? 'Set Password' : 'Change Password'}
          {/if}
        </button>
      </div>
    {/if}
  {/snippet}
</Modal>

<style>
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

  input.invalid {
    border-color: var(--color-error, #ef4444);
  }

  .field-error {
    font-size: 0.75rem;
    color: var(--color-error, #ef4444);
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

  .forced-notice {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    margin-bottom: 1rem;
    background: color-mix(in srgb, var(--color-warning) 15%, transparent);
    color: var(--text-primary);
    border-left: 3px solid var(--color-warning);
    border-radius: 0.375rem;
    font-size: 0.875rem;
  }

  .success-message {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 2rem;
    color: var(--color-success);
    text-align: center;
  }

  .success-message p {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    width: 100%;
  }

  /* .btn-primary, .btn-secondary styles are defined globally in app.css */
  /* .spin animation is defined globally in app.css */
</style>
