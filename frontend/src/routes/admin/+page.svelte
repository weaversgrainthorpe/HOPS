<script lang="ts">
  import { isAuthenticated, login, isLoggingIn } from '$lib/stores/auth';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  let username = 'admin';
  let password = '';
  let error = '';

  onMount(() => {
    // If already authenticated, could show admin panel
    // For now, just allow re-login
  });

  async function handleLogin(e: Event) {
    e.preventDefault();
    error = '';

    const success = await login(username, password);

    if (success) {
      // Successfully logged in
      // For now, just show a message
      // Later we'll show the admin interface
    } else {
      error = 'Invalid credentials. Default is admin/admin';
    }
  }

  function handleLogout() {
    // Will implement logout
  }
</script>

<div class="admin-container">
  {#if !$isAuthenticated}
    <div class="login-card card">
      <h1>HOPS Admin</h1>
      <p>Login to manage your dashboards</p>

      <form on:submit={handleLogin}>
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
      <h1>HOPS Admin Panel</h1>
      <p>You are logged in!</p>
      <p class="hint">Admin interface coming soon...</p>
      <div class="actions">
        <a href="/" class="button">View Dashboards</a>
        <button on:click={handleLogout}>Logout</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .admin-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
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
    text-align: center;
  }

  .actions {
    display: flex;
    gap: 1rem;
    justify-content: center;
    margin-top: 2rem;
  }

  .button {
    display: inline-block;
    padding: 0.5rem 1rem;
    background: var(--accent);
    color: white;
    border-radius: 0.375rem;
    text-decoration: none;
  }

  .button:hover {
    background: var(--accent-hover);
  }
</style>
