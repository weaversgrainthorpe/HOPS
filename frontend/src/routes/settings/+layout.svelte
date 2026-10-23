<script lang="ts">
  import { goto, afterNavigate } from '$app/navigation';
  import { page } from '$app/stores';
  import Icon from '@iconify/svelte';
  import { toast } from '$lib/stores/toast';
  import { isAuthenticated, authChecked, mustChangePassword, logout, isAdminOnlyPath } from '$lib/stores/auth';
  import { isBackendOffline, backendStatus } from '$lib/stores/backendStatus';
  import { migrationFailure } from '$lib/stores/config';
  import LoginDialog from '$lib/components/LoginDialog.svelte';
  import BackupModal from '$lib/components/admin/BackupModal.svelte';
  import MigrationFailed from '$lib/components/MigrationFailed.svelte';
  import NoticesBanner from '$lib/components/NoticesBanner.svelte';
  import BackendStatus from '$lib/components/BackendStatus.svelte';
  import { provideSettingsShell } from './settingsShell';

  // Settings is the one admin home (spec §4D), one page per section (M5 §9): this shell is shared
  // by all of them. It holds what every settings page needs: the sidebar, the MigrationFailed and
  // notices on top, and the sign-in. Logged out, ANY settings address asks for the password in
  // place (the same dialog as the dashboard pencil) and then shows that same page; Cancel goes
  // back where you came from. An expired session asks again, in place.

  let { children } = $props();

  // The sections, in order. Discovery keeps its own address; Log out is an action (below).
  const sections = [
    { href: '/settings/dashboards', label: 'Dashboards', icon: 'mdi:view-dashboard-outline' },
    { href: '/settings/global', label: 'Global settings', icon: 'mdi:tune' },
    { href: '/admin/discovery', label: 'Discovery', icon: 'mdi:radar' },
    { href: '/settings/backups', label: 'Backups', icon: 'mdi:backup-restore' },
    { href: '/settings/password', label: 'Password', icon: 'mdi:key' },
    { href: '/settings/reset', label: 'Factory reset', icon: 'mdi:delete-forever' },
  ];

  let pathname = $derived($page.url.pathname);
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  // Where Cancel on the sign-in dialog goes: the page you came from, else "/". Never an admin
  // page (another settings page included): signed out, it would send you straight back here
  // (a loop you can't leave). The shell stays mounted across the settings pages, so moving
  // between them keeps the page you originally came from.
  let previous = $state<string | null>(null);
  afterNavigate((nav) => {
    const from = nav?.from?.url;
    if (from && !isAdminOnlyPath(from.pathname)) previous = from.pathname + from.search + from.hash;
  });

  // Set while Log out runs: the page is being left, so neither the admin content nor a sign-in
  // dialog shows meanwhile.
  let leaving = $state(false);
  // Logged out (once the first auth check has answered — never on a guess): sign in here.
  let needsLogin = $derived($authChecked && !$isAuthenticated);
  // The admin content needs a session and no pending forced password change (its dialog can't
  // be dismissed, and the server refuses the rest until it is done).
  let ready = $derived($authChecked && $isAuthenticated && !$mustChangePassword);
  // The sidebar and the page show together, only while signed in.
  let showShell = $derived(ready && !leaving);

  function cancelLogin() {
    void goto(previous ?? '/');
  }

  // The backups dialog is the shell's: the MigrationFailed notice opens it from any page, and
  // the Backups page opens it too.
  let showBackupModal = $state(false);
  const openBackups = () => (showBackupModal = true);
  provideSettingsShell({ openBackups });
  // It needs the session too: when the session ends (idle expiry, a Log out from the navbar) it
  // closes with the rest of the admin content, and signing back in doesn't reopen it. A page's
  // own dialogs (Change Password) go with the page, which is only shown while ready.
  $effect(() => {
    if (!ready) showBackupModal = false;
  });

  async function handleLogout() {
    // logout() asks about unsaved edits first; false = the user kept editing.
    leaving = true;
    try {
      if (!(await logout())) {
        leaving = false;
        return;
      }
      await goto('/');
    } catch (e) {
      // Signed out but still here: say why, and show the sign-in dialog rather than an empty page.
      leaving = false;
      toast.error(`Signed out, but couldn't leave Settings: ${e instanceof Error && e.message ? e.message : 'navigation failed'}`);
    }
  }
</script>

<div class="settings-shell" class:has-sidebar={showShell}>
  {#if showShell}
    <aside class="sidebar">
      <div class="sidebar-inner">
        <h1 class="sidebar-title">Settings</h1>
        <nav aria-label="Settings sections">
          <ul>
            {#each sections as sec (sec.href)}
              <li>
                <a
                  class="side-item"
                  href={sec.href}
                  aria-current={isCurrent(sec.href) ? 'page' : undefined}
                >
                  <Icon icon={sec.icon} width="18" />
                  <span>{sec.label}</span>
                </a>
              </li>
            {/each}
            <li class="logout-item">
              <button type="button" class="side-item" onclick={handleLogout}>
                <Icon icon="mdi:logout" width="18" />
                <span>Log out</span>
              </button>
            </li>
          </ul>
        </nav>
      </div>
    </aside>
  {/if}

  <div class="settings-main">
    <div class="settings-content">
      {#if !showShell}
        <h1 class="page-title">Settings</h1>
      {/if}

      {#if $migrationFailure}
        <!-- On top: the stored config could not be migrated; Backups is the remedy. -->
        <MigrationFailed onOpenBackups={ready ? openBackups : undefined} onSettingsPage />
      {/if}

      {#if $isBackendOffline}
        <div class="offline-banner" role="alert">
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

      {#if leaving}
        <p class="muted" role="status">Signing out…</p>
      {:else if !$authChecked}
        <p class="muted" role="status">Checking sign-in…</p>
      {:else if needsLogin}
        <p class="muted">Sign in to manage HOPS.</p>
        <div class="status-section"><BackendStatus /></div>
      {:else if $mustChangePassword}
        <p class="muted" role="status">Set a new password to continue.</p>
      {:else}
        {#if !$migrationFailure}
          <NoticesBanner />
        {/if}

        <div class="page-body" class:greyed-out={$isBackendOffline}>
          {@render children()}
        </div>

        <div class="status-section"><BackendStatus /></div>
      {/if}
    </div>
  </div>
</div>

{#if needsLogin && !leaving}
  <LoginDialog intro="Sign in to open Settings." onSuccess={() => {}} onCancel={cancelLogin} />
{/if}

{#if ready && showBackupModal}
  <BackupModal onClose={() => (showBackupModal = false)} />
{/if}

<style>
  /* The sidebar is always light-on-dark, whatever the theme, with its own fixed colours so its
     contrast is known (M5 §9, WCAG AA, checked by the settings-sidebar e2e):
       item text   #e2e8f0 on #0b1220 ≈ 15:1
       current     #ffffff on #1d4ed8 ≈ 6.7:1 (plus a light bar on the left)
       hover       #ffffff on #1e293b ≈ 14:1
       focus ring  #fbbf24 on #0b1220 ≈ 11:1 */
  .settings-shell {
    --sb-bg: #0b1220;
    --sb-text: #e2e8f0;
    --sb-hover-bg: #1e293b;
    --sb-current-bg: #1d4ed8;
    --sb-current-bar: #bfdbfe;
    --sb-focus: #fbbf24;
    --sb-border: #1e293b;
    display: flex;
    align-items: stretch;
    min-height: calc(100vh - 70px);
    color: var(--text-primary);
  }

  .sidebar {
    flex: 0 0 15rem;
    background: var(--sb-bg);
    color: var(--sb-text);
    border-right: 1px solid var(--sb-border);
    padding: 1.5rem 0.75rem;
  }

  /* The menu stays in view below the sticky navbar while a long page scrolls. */
  .sidebar-inner {
    position: sticky;
    top: 5.5rem;
  }

  .sidebar-title {
    margin: 0 0 1rem;
    padding: 0 0.75rem;
    font-size: 1.35rem;
    color: #f8fafc;
  }

  .sidebar ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .side-item {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    width: 100%;
    padding: 0.6rem 0.75rem;
    border: none;
    border-left: 4px solid transparent;
    border-radius: 0.375rem;
    background: transparent;
    color: var(--sb-text);
    font: inherit;
    font-size: 0.95rem;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }

  .side-item:hover {
    background: var(--sb-hover-bg);
    color: #ffffff;
  }

  .side-item[aria-current='page'] {
    background: var(--sb-current-bg);
    border-left-color: var(--sb-current-bar);
    color: #ffffff;
    font-weight: 600;
  }

  .side-item:focus-visible {
    outline: 3px solid var(--sb-focus);
    outline-offset: -3px;
  }

  .side-item :global(svg) {
    flex-shrink: 0;
  }

  .logout-item {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--sb-hover-bg);
  }

  /* The content fills the space to the right of the sidebar, up to ~1100px of content, starting
     right beside the sidebar: no centred narrow column with big empty margins. */
  .settings-main {
    flex: 1 1 auto;
    min-width: 0;
    padding: 2rem 2rem 4rem;
  }

  .settings-content {
    max-width: 1100px;
  }

  .page-title {
    margin: 0 0 1.5rem;
    font-size: var(--font-h1);
  }

  /* Shared by every settings page. */
  .settings-content :global(.section-title) {
    margin: 0 0 0.75rem;
    font-size: 1.4rem;
  }

  .settings-content :global(.lede) {
    color: var(--text-secondary);
    max-width: 640px;
    margin: 0 0 1rem;
  }

  .muted {
    color: var(--text-secondary);
  }

  .status-section {
    margin-top: 2.5rem;
    max-width: 300px;
  }

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
  }

  .offline-banner .retry-btn:hover {
    background: rgba(239, 68, 68, 0.3);
  }

  /* Greyed out while the backend is offline */
  .page-body.greyed-out {
    opacity: 0.4;
    pointer-events: none;
    user-select: none;
    filter: grayscale(50%);
  }

  /* Phones: the sidebar becomes a section menu at the top of the page. */
  @media (max-width: 640px) {
    .settings-shell {
      flex-direction: column;
      min-height: 0;
    }

    .sidebar {
      flex: none;
      border-right: none;
      border-bottom: 1px solid var(--sb-border);
      padding: 0.9rem 1rem 1rem;
    }

    .sidebar-inner {
      position: static;
    }

    .sidebar-title {
      margin-bottom: 0.6rem;
      padding: 0;
      font-size: 1.2rem;
    }

    .sidebar ul {
      flex-direction: row;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    .side-item {
      width: auto;
      padding: 0.45rem 0.7rem;
      border-left: none;
      border: 1px solid #334155;
      border-radius: 999px;
      font-size: 0.875rem;
    }

    .side-item[aria-current='page'] {
      border-color: var(--sb-current-bar);
    }

    .logout-item {
      margin-top: 0;
      padding-top: 0;
      border-top: none;
    }

    .settings-main {
      padding: 1.25rem 1rem 3rem;
    }

    .offline-banner {
      flex-direction: column;
      align-items: flex-start;
      padding: 0.75rem 1rem;
    }
  }
</style>
