<script lang="ts">
  import { isAuthenticated, login, logout, isLoggingIn } from '$lib/stores/auth';
  import { isBackendOffline, backendStatus } from '$lib/stores/backendStatus';
  import { confirm } from '$lib/stores/confirmModal';
  import { toast } from '$lib/stores/toast';
  import { loadConfig } from '$lib/stores/config';
  import DashboardList from '$lib/components/admin/DashboardList.svelte';
  import ChangePasswordModal from '$lib/components/admin/ChangePasswordModal.svelte';
  import BackupModal from '$lib/components/admin/BackupModal.svelte';
  import BackendStatus from '$lib/components/BackendStatus.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import Icon from '@iconify/svelte';
  import { resetConfig } from '$lib/utils/api';
  import { goto } from '$app/navigation';

  let username = $state('admin');
  let password = $state('');
  let error = $state('');
  let showChangePassword = $state(false);
  let showBackupModal = $state(false);

  async function handleLogin(e: Event) {
    e.preventDefault();
    error = '';

    const success = await login(username, password);

    if (!success) {
      error = 'Invalid credentials. Default is admin/admin';
    }
  }

  async function handleLogout() {
    await logout();
  }

  async function handleFactoryReset() {
    const confirmed = await confirm({
      title: 'Factory Reset',
      message: 'This will permanently delete all dashboards, tabs, groups, and entries, resetting everything to defaults. A backup will be created automatically. This action cannot be undone.',
      confirmText: 'Reset Everything',
      confirmStyle: 'danger',
    });

    if (!confirmed) return;

    try {
      await resetConfig();
      await loadConfig();
      toast.success('Configuration reset to factory defaults');
    } catch (err) {
      toast.error('Failed to reset configuration');
    }
  }
</script>

<div class="admin-container">
  {#if !$isAuthenticated}
    <div class="login-card card">
      <h1>HOPS Admin</h1>
      <p>Login to manage your dashboards</p>

      <form onsubmit={handleLogin}>
        <div class="form-group">
          <label for="username">Username</label>
          <input
            id="username"
            type="text"
            bind:value={username}
            required
            autocomplete="username"
          />
        </div>

        <div class="form-group">
          <label for="password">Password</label>
          <input
            id="password"
            type="password"
            bind:value={password}
            required
            autocomplete="current-password"
          />
        </div>

        {#if error}
          <div class="error-message">{error}</div>
        {/if}

        <Button
          type="submit"
          variant="primary"
          fullWidth
          loading={$isLoggingIn}
          disabled={$isBackendOffline}
        >
          {$isLoggingIn ? 'Logging in...' : 'Login'}
        </Button>
      </form>

      <p class="hint">Default credentials: admin / admin</p>

      <BackendStatus />
    </div>
  {:else}
    <div class="admin-panel" class:disabled={$isBackendOffline}>
      {#if $isBackendOffline}
        <div class="offline-banner">
          <Icon icon="mdi:cloud-off-outline" width="24" />
          <div class="offline-content">
            <strong>Backend Offline</strong>
            <span>All admin functions are disabled until the backend is available.</span>
          </div>
          <button class="retry-btn" onclick={() => backendStatus.check()}>
            <Icon icon="mdi:refresh" width="18" />
            Retry
          </button>
        </div>
      {/if}

      <div class="admin-header">
        <h1>HOPS Admin Panel</h1>
        <div class="header-actions">
          <Button
            variant="secondary"
            icon="mdi:cog"
            onclick={() => goto('/settings')}
            disabled={$isBackendOffline}
          >
            Settings
          </Button>
          <Button
            variant="secondary"
            icon="mdi:backup-restore"
            onclick={() => showBackupModal = true}
            disabled={$isBackendOffline}
          >
            Backups
          </Button>
          <Button
            variant="secondary"
            icon="mdi:key"
            onclick={() => showChangePassword = true}
            disabled={$isBackendOffline}
          >
            Change Password
          </Button>
          <Button
            variant="danger"
            icon="mdi:delete-forever"
            onclick={handleFactoryReset}
            disabled={$isBackendOffline}
          >
            Factory Reset
          </Button>
          <Button
            variant="secondary"
            icon="mdi:logout"
            onclick={handleLogout}
          >
            Logout
          </Button>
        </div>
      </div>

      <div class="admin-content" class:greyed-out={$isBackendOffline}>
        <DashboardList />
      </div>

      <div class="status-section">
        <BackendStatus />
      </div>
    </div>
  {/if}
</div>

{#if showChangePassword}
  <ChangePasswordModal onClose={() => showChangePassword = false} />
{/if}

{#if showBackupModal}
  <BackupModal onClose={() => showBackupModal = false} />
{/if}

<style>
  .admin-container {
    min-height: calc(100vh - 60px);
    padding: 2rem;
  }

  .admin-container > * {
    margin: 0 auto;
  }

  .login-card {
    max-width: 400px;
    width: 100%;
  }

  h1 {
    margin-bottom: 0.5rem;
    font-size: 2rem;
  }

  p {
    margin-bottom: 1.5rem;
    color: var(--text-secondary);
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
  }

  input {
    width: 100%;
  }

  button {
    margin-top: 0.5rem;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error-message {
    padding: 0.75rem;
    background: color-mix(in srgb, var(--color-error) 15%, transparent);
    color: var(--color-error);
    border-radius: 0.375rem;
    font-size: 0.875rem;
  }

  .hint {
    margin-top: 1rem;
    font-size: 0.875rem;
    text-align: center;
  }

  .admin-panel {
    max-width: 1200px;
    margin: 0 auto;
  }

  .admin-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2rem;
  }

  .admin-header h1 {
    margin: 0;
  }

  .header-actions {
    display: flex;
    gap: 0.75rem;
  }

  /* All button styling now comes from the shared Button component */

  .status-section {
    margin-top: 2rem;
    max-width: 300px;
  }

  /* Offline banner */
  .offline-banner {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.5rem;
    background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05));
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 0.75rem;
    margin-bottom: 1.5rem;
    color: #ef4444;
  }

  .offline-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .offline-content strong {
    font-size: 0.9rem;
  }

  .offline-content span {
    font-size: 0.8rem;
    opacity: 0.8;
  }

  .offline-banner .retry-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: rgba(239, 68, 68, 0.2);
    border: 1px solid rgba(239, 68, 68, 0.4);
    border-radius: 0.5rem;
    color: #ef4444;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    margin: 0;
  }

  .offline-banner .retry-btn:hover {
    background: rgba(239, 68, 68, 0.3);
  }

  /* Greyed out content when offline */
  .admin-content.greyed-out {
    opacity: 0.4;
    pointer-events: none;
    user-select: none;
    filter: grayscale(50%);
  }

  /* Tablet: tighter padding, allow header to wrap */
  @media (max-width: 1024px) {
    .admin-container {
      padding: 1.5rem;
    }

    .admin-header {
      flex-wrap: wrap;
      gap: 1rem;
    }
  }

  /* Mobile landscape */
  @media (max-width: 768px) {
    .admin-container {
      padding: 1rem;
    }

    .admin-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .header-actions {
      width: 100%;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    h1 {
      font-size: 1.5rem;
    }
  }

  /* Mobile portrait: stack header buttons full-width */
  @media (max-width: 480px) {
    .admin-container {
      padding: 0.75rem;
    }

    .header-actions {
      flex-direction: column;
    }

    .header-actions :global(.btn) {
      width: 100%;
    }

    .offline-banner {
      flex-direction: column;
      align-items: flex-start;
      padding: 0.75rem 1rem;
    }
  }
</style>
