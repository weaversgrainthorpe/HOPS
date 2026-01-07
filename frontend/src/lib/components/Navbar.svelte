<script lang="ts">
  import { dashboards, currentDashboard } from '$lib/stores/config';
  import { page } from '$app/stores';
  import { isAuthenticated } from '$lib/stores/auth';
  import { theme, toggleTheme } from '$lib/stores/theme';
  import { editMode, toggleEditMode } from '$lib/stores/editMode';
  import { textSize, increaseTextSize, decreaseTextSize, canIncrease, canDecrease, textSizeConfigs } from '$lib/stores/textSize';
  import { triggerHopAnimation } from '$lib/stores/easterEggs';
  import Icon from '@iconify/svelte';
  import ThemePickerModal from './admin/ThemePickerModal.svelte';
  import ExportModal from './admin/ExportModal.svelte';
  import HelpModal from './HelpModal.svelte';
  import AboutModal from './AboutModal.svelte';

  const appVersion = __APP_VERSION__;

  let currentPath = $derived($page.url.pathname);

  // Easter egg: Triple-click logo in edit mode to trigger hop animation
  let logoClickCount = $state(0);
  let logoClickTimer: ReturnType<typeof setTimeout> | null = null;

  function handleLogoClick(e: MouseEvent) {
    // Only intercept clicks in edit mode
    if (!$editMode) return;

    // Prevent navigation while counting clicks
    e.preventDefault();

    logoClickCount++;

    if (logoClickTimer) {
      clearTimeout(logoClickTimer);
    }

    if (logoClickCount >= 3) {
      triggerHopAnimation();
      logoClickCount = 0;
    } else {
      logoClickTimer = setTimeout(() => {
        logoClickCount = 0;
      }, 500);
    }
  }
  let isDashboardPage = $derived(currentPath !== '/');
  let showThemePicker = $state(false);
  let showExport = $state(false);
  let showHelp = $state(false);
  let showAbout = $state(false);

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
          <a href="/" class="logo" onclick={handleLogoClick}>
            <img src="/logo.svg" alt="HOPS" />
            <span>HOPS</span>
            <span class="version">v{appVersion}</span>
          </a>

          {#if $isAuthenticated}
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
      <div class="text-size-controls" title="Text Size: {textSizeConfigs[$textSize].label}">
        <button
          onclick={decreaseTextSize}
          class="text-size-btn"
          disabled={!canDecrease($textSize)}
          title="Decrease text size"
        >
          <span class="text-size-icon small">A</span>
          <Icon icon="mdi:arrow-down" width="10" height="10" class="text-size-arrow" />
        </button>
        <button
          onclick={increaseTextSize}
          class="text-size-btn"
          disabled={!canIncrease($textSize)}
          title="Increase text size"
        >
          <span class="text-size-icon large">A</span>
          <Icon icon="mdi:arrow-up" width="10" height="10" class="text-size-arrow" />
        </button>
      </div>

      <button onclick={() => showThemePicker = true} class="theme-toggle" title="Theme Settings">
        <span class="icon-wrapper">
          <Icon icon={themeIcon} width="32" height="32" />
        </span>
      </button>

      {#if $editMode && isDashboardPage}
        <button onclick={() => showExport = true} class="export-btn" title="Export Dashboard">
          <span class="icon-wrapper">
            <Icon icon="mdi:download" width="32" height="32" />
          </span>
        </button>
      {/if}

      {#if $isAuthenticated && isDashboardPage}
        <button
          onclick={toggleEditMode}
          class="edit-toggle"
          class:active={$editMode}
          title={$editMode ? "Exit Edit Mode" : "Enter Edit Mode (Authentication Required)"}
        >
          <Icon icon={$editMode ? 'mdi:pencil-off' : 'mdi:pencil'} width="24" height="24" />
          {#if $editMode}
            <span class="edit-label">Editing</span>
          {/if}
        </button>
      {/if}

      {#if $isAuthenticated}
        <button onclick={() => showHelp = true} class="help-btn" title="Help">
          <span class="icon-wrapper">
            <Icon icon="mdi:help-circle-outline" width="32" height="32" />
          </span>
        </button>
      {/if}

      {#if $isAuthenticated}
        <button onclick={() => showAbout = true} class="about-btn" title="About HOPS">
          <span class="icon-wrapper">
            <Icon icon="mdi:information-outline" width="32" height="32" />
          </span>
        </button>
      {/if}

      <a href="/" class="admin-link" title="Admin Panel">
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

{#if showExport}
  <ExportModal onClose={() => showExport = false} />
{/if}

{#if showHelp}
  <HelpModal onClose={() => showHelp = false} />
{/if}

{#if showAbout}
  <AboutModal onClose={() => showAbout = false} />
{/if}

<style>
  .navbar {
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: var(--z-navbar);
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

  .version {
    font-size: 0.625rem;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-tertiary);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    margin-left: 0.25rem;
    opacity: 0.8;
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

  .theme-toggle, .admin-link, .edit-toggle, .export-btn, .help-btn, .about-btn {
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

  .theme-toggle:hover, .admin-link:hover, .edit-toggle:hover, .export-btn:hover, .help-btn:hover, .about-btn:hover {
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

  .text-size-controls {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    background: var(--bg-tertiary);
    border-radius: 1.5rem;
    padding: 0.25rem;
  }

  .text-size-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
  }

  .text-size-btn:hover:not(:disabled) {
    background: var(--accent);
    color: white;
  }

  .text-size-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .text-size-icon {
    font-weight: 700;
    font-family: serif;
    line-height: 1;
  }

  .text-size-icon.large {
    font-size: 16px;
  }

  .text-size-icon.small {
    font-size: 12px;
  }

  .text-size-btn :global(.text-size-arrow) {
    position: absolute;
    top: 4px;
    right: 4px;
  }

  @media (max-width: 768px) {
    .nav-links {
      display: none;
    }

    .logo span {
      display: none;
    }

    .text-size-controls {
      display: none;
    }
  }
</style>
