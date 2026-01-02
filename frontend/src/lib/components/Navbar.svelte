<script lang="ts">
  import { dashboards } from '$lib/stores/config';
  import { page } from '$app/stores';
  import { isAuthenticated } from '$lib/stores/auth';
  import { theme, toggleTheme } from '$lib/stores/theme';
  import { editMode, toggleEditMode } from '$lib/stores/editMode';
  import Icon from '@iconify/svelte';

  let currentPath = $derived($page.url.pathname);
  let isDashboardPage = $derived(currentPath !== '/' && currentPath !== '/admin');

  let themeIcon = $derived(
    $theme === 'dark' ? 'mdi:weather-night' :
    $theme === 'light' ? 'mdi:weather-sunny' :
    'mdi:theme-light-dark'
  );
</script>

<nav class="navbar">
  <div class="nav-content">
    <div class="nav-left">
      <a href="/" class="logo">
        <img src="/logo.svg" alt="HOPS" />
        <span>HOPS</span>
      </a>

      <div class="nav-links">
        {#each $dashboards as dashboard (dashboard.id)}
          <a
            href={dashboard.path}
            class="nav-link"
            class:active={currentPath === dashboard.path}
          >
            {dashboard.name}
          </a>
        {/each}
      </div>
    </div>

    <div class="nav-right">
      <button onclick={toggleTheme} class="theme-toggle" title={`Theme: ${$theme}`}>
        <Icon icon={themeIcon} width="24" />
      </button>

      {#if $isAuthenticated && isDashboardPage}
        <button onclick={toggleEditMode} class="edit-toggle" class:active={$editMode} title="Edit Mode">
          <Icon icon={$editMode ? 'mdi:pencil-off' : 'mdi:pencil'} width="24" />
          {#if $editMode}
            <span class="edit-label">Editing</span>
          {/if}
        </button>
      {/if}

      <a href="/admin" class="admin-link" title="Admin Panel">
        <Icon icon="mdi:cog" width="24" />
        {#if $isAuthenticated}
          <span class="admin-badge"></span>
        {/if}
      </a>
    </div>
  </div>
</nav>

<style>
  .navbar {
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 100;
    backdrop-filter: blur(10px);
  }

  .nav-content {
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 60px;
  }

  .nav-left {
    display: flex;
    align-items: center;
    gap: 2rem;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    text-decoration: none;
    color: var(--text-primary);
    font-weight: 600;
    font-size: 1.25rem;
  }

  .logo img {
    width: 32px;
    height: 32px;
  }

  .nav-links {
    display: flex;
    gap: 0.5rem;
  }

  .nav-link {
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    text-decoration: none;
    color: var(--text-secondary);
    font-weight: 500;
    transition: all 0.2s;
  }

  .nav-link:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .nav-link.active {
    background: var(--accent);
    color: white;
  }

  .nav-right {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .theme-toggle, .admin-link, .edit-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: none;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
  }

  .theme-toggle:hover, .admin-link:hover, .edit-toggle:hover {
    background: var(--accent);
    color: white;
  }

  .edit-toggle {
    width: auto;
    padding: 0 1rem;
    border-radius: 2rem;
  }

  .edit-toggle.active {
    background: #f59e0b;
    color: white;
  }

  .edit-label {
    font-size: 0.875rem;
    font-weight: 500;
  }

  .admin-badge {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 8px;
    height: 8px;
    background: #10b981;
    border-radius: 50%;
    border: 2px solid var(--bg-secondary);
  }

  @media (max-width: 768px) {
    .nav-links {
      display: none;
    }

    .logo span {
      display: none;
    }
  }
</style>
