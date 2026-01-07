<script lang="ts">
  import { isAuthenticated, login, logout, isLoggingIn } from '$lib/stores/auth';
  import { isBackendOffline, backendStatus } from '$lib/stores/backendStatus';
  import DashboardList from '$lib/components/admin/DashboardList.svelte';
  import ChangePasswordModal from '$lib/components/admin/ChangePasswordModal.svelte';
  import BackendStatus from '$lib/components/BackendStatus.svelte';
  import Icon from '@iconify/svelte';

  let username = $state('admin');
  let password = $state('');
  let error = $state('');
  let showChangePassword = $state(false);

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

        <button type="submit" disabled={$isLoggingIn || $isBackendOffline}>
          {$isLoggingIn ? 'Logging in...' : 'Login'}
        </button>
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
          <button onclick={() => showChangePassword = true} class="btn-secondary" disabled={$isBackendOffline}>
            <Icon icon="mdi:key" width="18" />
            Change Password
          </button>
          <button onclick={handleLogout} class="btn-secondary">
            <Icon icon="mdi:logout" width="18" />
            Logout
          </button>
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

  .btn-secondary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
    margin: 0;
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-secondary);
  }

  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

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
</style>
