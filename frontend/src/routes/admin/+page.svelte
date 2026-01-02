<script lang="ts">
  import { isAuthenticated, login, logout, isLoggingIn } from '$lib/stores/auth';
  import DashboardList from '$lib/components/admin/DashboardList.svelte';
  import DashboardEditor from '$lib/components/admin/DashboardEditor.svelte';
  import type { Dashboard } from '$lib/types';

  let username = 'admin';
  let password = '';
  let error = '';
  let editingDashboard = $state<Dashboard | null>(null);

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

  function handleEdit(dashboard: Dashboard) {
    editingDashboard = dashboard;
  }

  function handleCloseEditor() {
    editingDashboard = null;
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

        <button type="submit" disabled={$isLoggingIn}>
          {$isLoggingIn ? 'Logging in...' : 'Login'}
        </button>
      </form>

      <p class="hint">Default credentials: admin / admin</p>
    </div>
  {:else}
    <div class="admin-panel">
      <div class="admin-header">
        <h1>HOPS Admin Panel</h1>
        <button onclick={handleLogout} class="btn-secondary">Logout</button>
      </div>

      <DashboardList onEdit={handleEdit} />
    </div>
  {/if}
</div>

{#if editingDashboard}
  <DashboardEditor dashboard={editingDashboard} onClose={handleCloseEditor} />
{/if}

<style>
  .admin-container {
    min-height: calc(100vh - 60px);
    padding: 2rem;
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

  .error-message {
    padding: 0.75rem;
    background: #fee2e2;
    color: #991b1b;
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

  .btn-secondary {
    padding: 0.5rem 1rem;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
  }

  .btn-secondary:hover {
    background: var(--bg-secondary);
  }
</style>