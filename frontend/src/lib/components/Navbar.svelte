<script lang="ts">
  import { dashboards, currentDashboard } from '$lib/stores/config';
  import { page } from '$app/stores';
  import { isAuthenticated } from '$lib/stores/auth';
  import { theme, toggleTheme } from '$lib/stores/theme';
  import { editMode, toggleEditMode } from '$lib/stores/editMode';
  import Icon from '@iconify/svelte';
  import ThemePickerModal from './admin/ThemePickerModal.svelte';
  import ImportExportModal from './admin/ImportExportModal.svelte';

  let currentPath = $derived($page.url.pathname);
  let isDashboardPage = $derived(currentPath !== '/' && currentPath !== '/admin');
  let showThemePicker = $state(false);
  let showImportExport = $state(false);

  let themeIcon = $derived(
    $theme === 'dark' ? 'mdi:weather-night' :
    $theme === 'light' ? 'mdi:weather-sunny' :
    'mdi:theme-light-dark'
  );

  // Get header config from current dashboard or use defaults
  let headerConfig = $derived($currentDashboard?.header);
  let showLeft = $derived(headerConfig?.showLeft !== false); // Default true
  let showCenter = $derived(headerConfig?.showCenter !== false); // Default true
  let leftText = $derived(headerConfig?.leftText);
  let centerTitle = $derived(headerConfig?.centerTitle);
</script>

<nav class="navbar">
  <div class="nav-content">
    <div class="nav-left">
      {#if showLeft}
        {#if leftText}
          <div class="custom-text">{leftText}</div>
        {:else}
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
        {/if}
      {/if}
    </div>

    <div class="nav-center">
      {#if showCenter}
        {#if centerTitle}
          <h1 class="center-title">{centerTitle}</h1>
        {:else if $currentDashboard}
          <h1 class="center-title">{$currentDashboard.name}</h1>
        {/if}
      {/if}
    </div>

    <div class="nav-right">
      {#if $isAuthenticated}
        <button onclick={() => showImportExport = true} class="import-export-btn" title="Import / Export">
          <Icon icon="mdi:database-import-export" width="24" height="24" />
        </button>
      {/if}

      <button onclick={() => showThemePicker = true} class="theme-toggle" title="Theme Settings">
        <span class="icon-wrapper">
          <Icon icon={themeIcon} width="32" height="32" />
        </span>
      </button>

      {#if $isAuthenticated && isDashboardPage}
        <button onclick={toggleEditMode} class="edit-toggle" class:active={$editMode} title="Edit Mode">
          <Icon icon={$editMode ? 'mdi:pencil-off' : 'mdi:pencil'} width="24" height="24" />
          {#if $editMode}
            <span class="edit-label">Editing</span>
          {/if}
        </button>
      {/if}

      <a href="/admin" class="admin-link" title="Admin Panel">
        <Icon icon="mdi:cog" width="32" height="32" />
        {#if $isAuthenticated}
          <span class="admin-badge"></span>
        {/if}
      </a>
    </div>
  </div>
</nav>

{#if showThemePicker}
  <ThemePickerModal onClose={() => showThemePicker = false} />
{/if}

{#if showImportExport}
  <ImportExportModal onClose={() => showImportExport = false} />
{/if}

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
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 2rem;
    height: 70px;
  }

  .nav-left {
    display: flex;
    align-items: center;
    gap: 2rem;
    justify-content: flex-start;
  }

  .nav-center {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .center-title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .custom-text {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
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
    width: 52px;
    height: 52px;
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
    justify-content: flex-end;
    gap: 1rem;
  }

  .theme-toggle, .admin-link, .edit-toggle, .import-export-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: none;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
    font-size: 32px;
  }

  .icon-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
  }

  .theme-toggle:hover, .admin-link:hover, .edit-toggle:hover, .import-export-btn:hover {
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
