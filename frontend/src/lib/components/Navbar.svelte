<script lang="ts">
  import { dashboards, currentRoute, dashboardHref } from '$lib/stores/config';
  import { page } from '$app/stores';
  import { tick, untrack } from 'svelte';
  import { fitLinks } from '$lib/utils/navFit';
  import type { HeaderConfig } from '$lib/types';
  import { isAuthenticated, logout, whenPasswordSettled } from '$lib/stores/auth';
  import { goto } from '$app/navigation';
  import { theme, toggleTheme } from '$lib/stores/theme';
  import { editMode, toggleEditMode, enableEditMode } from '$lib/stores/editMode';
  import { session } from '$lib/stores/editSession';
  import { textSize, increaseTextSize, decreaseTextSize, canIncrease, canDecrease, textSizeConfigs } from '$lib/stores/textSize';
  import { triggerHopAnimation } from '$lib/stores/easterEggs';
  import Icon from '@iconify/svelte';
  import ThemePickerModal from './admin/ThemePickerModal.svelte';
  import ExportModal from './admin/ExportModal.svelte';
  import HelpModal from './HelpModal.svelte';
  import AboutModal from './AboutModal.svelte';
  import LoginDialog from './LoginDialog.svelte';

  let { onSearch }: { onSearch?: () => void } = $props();

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
  // The admin pages: Settings (the admin home) and the tools under /admin.
  let isAdminPage = $derived(
    currentPath === '/settings' || currentPath.startsWith('/settings/') ||
    currentPath === '/admin' || currentPath.startsWith('/admin/')
  );
  // True only when the current page is an actual dashboard (i.e. somewhere
  // that has tiles to edit). "/" only forwards to a dashboard (or says there
  // is none) and the admin pages have their own UI — on neither does
  // dashboard edit-mode make sense, so the navbar's Edit toggle hides there.
  let isDashboardPage = $derived(currentPath !== '/' && !isAdminPage);
  let showThemePicker = $state(false);
  let showExport = $state(false);
  let showHelp = $state(false);
  let showAbout = $state(false);
  // The page the sign-in dialog was opened on (null: closed). The dialog belongs to that page:
  // navigating anywhere else (Back, a link, /settings with its own dialog) closes it, so it can
  // never sign in to edit a different dashboard or stack on Settings' own sign-in dialog.
  let loginPath = $state<string | null>(null);
  let showLogin = $derived(loginPath !== null && loginPath === currentPath && isDashboardPage);
  $effect(() => {
    if (loginPath !== null && loginPath !== currentPath) loginPath = null;
  });

  // The pencil is on every dashboard page. Logged out, it signs in first, in
  // place (no trip to the admin page), then starts editing this dashboard.
  function handlePencil() {
    if ($isAuthenticated) {
      void toggleEditMode();
      return;
    }
    loginPath = currentPath;
  }

  // Editing starts once the user may act: a forced password change (its dialog can't be
  // dismissed) comes first.
  let cancelPendingEdit: (() => void) | null = null;
  function handleLoginSuccess() {
    const signedInOn = loginPath;
    loginPath = null;
    cancelPendingEdit?.();
    cancelPendingEdit = whenPasswordSettled(() => {
      cancelPendingEdit = null;
      // Only the dashboard the pencil was pressed on: a forced password change may have
      // taken long enough for the user to go elsewhere.
      if (currentPath === signedInOn) enableEditMode();
    });
  }
  $effect(() => () => cancelPendingEdit?.());

  // Log out from anywhere (a shared tablet). Unsaved edits are asked about first (logout()
  // returns false if the user keeps editing). An admin page needs a session, so leave it; a
  // dashboard stays, read-only.
  async function handleLogout() {
    const done = await logout();
    if (done && isAdminPage) await goto('/');
  }

  // Every dashboard for the nav links, in display order.
  let navDashboards = $derived($dashboards.map((d) => ({ id: d.id, name: d.name, path: dashboardHref(d.path) })));

  // ---- the dashboard links (Ruling 12): the links that fit, in order; the rest in a "More" menu.
  // No scrolling strip and no scrollbar. A hidden copy of every link (and of the More button) is
  // measured; the room is .nav-dash's width, which never depends on how many links show (it takes
  // the column's spare width), so showing or hiding links never feeds back into the measurement.
  let dashEl = $state<HTMLElement | null>(null);
  let measureEl = $state<HTMLElement | null>(null);
  let shownCount = $state(Number.POSITIVE_INFINITY);
  let moreWidthPx = $state(0);
  function measureLinks() {
    if (!dashEl || !measureEl) return;
    const widths = Array.from(measureEl.querySelectorAll<HTMLElement>('[data-measure-link]')).map(
      (e) => e.getBoundingClientRect().width
    );
    const more = measureEl.querySelector<HTMLElement>('[data-measure-more]')?.getBoundingClientRect().width ?? 0;
    const gap = parseFloat(getComputedStyle(dashEl).columnGap) || 0;
    moreWidthPx = Math.ceil(more);
    shownCount = fitLinks(widths, gap, more, dashEl.getBoundingClientRect().width);
  }
  $effect(() => {
    if (!dashEl || !measureEl) return;
    void navDashboards; // a renamed, added or removed dashboard: measure again
    measureLinks();
    // (No ResizeObserver — very old browsers, test DOMs — measures once per change of the list.)
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measureLinks());
    ro.observe(dashEl);
    ro.observe(measureEl);
    return () => ro.disconnect();
  });
  let shownLinks = $derived(navDashboards.slice(0, Math.min(shownCount, navDashboards.length)));
  let moreLinks = $derived(navDashboards.slice(shownLinks.length));
  let moreHasCurrent = $derived(moreLinks.some((d) => d.path === currentPath));

  let moreOpen = $state(false);
  let moreBtn = $state<HTMLButtonElement | null>(null);
  let moreMenu = $state<HTMLElement | null>(null);
  const moreItems = () => Array.from(moreMenu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  async function openMore(focus: 'first' | 'last' | null) {
    moreOpen = true;
    await tick();
    const items = moreItems();
    if (focus === 'first') items[0]?.focus();
    else if (focus === 'last') items[items.length - 1]?.focus();
  }
  function closeMore(refocus = false) {
    moreOpen = false;
    if (refocus) moreBtn?.focus();
  }
  function onMoreKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      void openMore('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      void openMore('last');
    } else if (e.key === 'Escape' && moreOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeMore(true);
    }
  }
  function onMenuKey(e: KeyboardEvent) {
    const items = moreItems();
    const at = items.indexOf(document.activeElement as HTMLElement);
    // The menu's keys are its own (the page's shortcuts, e.g. arrow-key tile moves, never see them).
    const go = (i: number) => {
      e.preventDefault();
      e.stopPropagation();
      items[(i + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMore(true);
    } else if (e.key === 'Tab') closeMore();
  }
  // A press anywhere outside the button and its menu closes it.
  function onWindowPointerDown(e: PointerEvent) {
    if (!moreOpen) return;
    const t = e.target as Node | null;
    if (t && (moreBtn?.contains(t) || moreMenu?.contains(t))) return;
    closeMore();
  }
  // Going to another page, or every link fitting again, closes it.
  $effect(() => {
    void currentPath;
    untrack(() => closeMore());
  });
  $effect(() => {
    if (moreLinks.length === 0) untrack(() => closeMore());
  });

  let themeIcon = $derived(
    $theme === 'dark' ? 'mdi:weather-night' :
    $theme === 'light' ? 'mdi:weather-sunny' :
    'mdi:theme-light-dark'
  );

  // Header config from the current dashboard (or defaults). While editing, the
  // header shows the edit session's draft (the Header dialog edits the draft).
  let pageDashboard = $derived($currentRoute);
  let headerConfig = $derived(
    ($editMode && $session && pageDashboard && $session.dashboardId === pageDashboard.id
      ? $session.draft.header
      : pageDashboard?.header) as HeaderConfig | undefined
  );
  let showLeft = $derived(headerConfig?.showLeft !== false); // Default true
  let showCenter = $derived(headerConfig?.showCenter !== false); // Default true
  let leftText = $derived(headerConfig?.leftText);
  let centerTitle = $derived(headerConfig?.centerTitle);
  // ---- the bar never outgrows the screen: step down (CSS .c1–.c6) until it fits. Measured on the
  // bar's own width (a window resize) and whenever what it holds changes; all before the next paint
  // (a ResizeObserver callback, then microtasks), so no level flashes. The bar's width never depends
  // on the level, so this never loops.
  //
  // First, the dashboard links (walkthrough 1 C): while some are in More, the right-hand controls go
  // compact (.tight: icons only — no "Editing" text, Log out as its icon — and tighter gaps) when
  // that shows more links. Nothing is hidden or moved into a menu: every control stays, smaller.
  const MAX_COMPACT = 6;
  let navContentEl = $state<HTMLElement | null>(null);
  let compact = $state(0);
  let tight = $state(false);
  let fitting = false;
  let fitAgain = false;
  /** How many links show now (measured at once, not on the next ResizeObserver round). */
  function linksShown(): number {
    measureLinks();
    return Math.min(shownCount, navDashboards.length);
  }
  async function fitBar() {
    if (!navContentEl) return;
    if (fitting) {
      fitAgain = true;
      return;
    }
    fitting = true;
    try {
      do {
        fitAgain = false;
        compact = 0;
        tight = false;
        await tick();
        if (dashEl && measureEl && navDashboards.length > 0) {
          const roomy = linksShown();
          if (roomy < navDashboards.length) {
            tight = true;
            await tick();
            // Compact only when it shows more links (the title stays centred, so it may not).
            if (linksShown() <= roomy) {
              tight = false;
              await tick();
              measureLinks();
            }
          }
        }
        while (navContentEl && compact < MAX_COMPACT && navContentEl.scrollWidth > navContentEl.clientWidth + 0.5) {
          compact++;
          await tick();
        }
        // Let the effects of this run's own changes (how many links show) settle while it still
        // counts as fitting, so they never start another run.
        await tick();
      } while (fitAgain);
    } finally {
      fitting = false;
    }
  }
  $effect(() => {
    if (!navContentEl || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => void fitBar());
    ro.observe(navContentEl);
    return () => ro.disconnect();
  });
  // What the bar holds: edit mode, signed in or not, the page, the title, the text size, the links.
  $effect(() => {
    void [$editMode, $isAuthenticated, isDashboardPage, showLeft, showCenter, leftText, centerTitle, pageDashboard?.name, $textSize, navDashboards];
    untrack(() => void fitBar());
  });
  // The More button coming or going changes what the bar needs. fitBar itself changes how many links
  // show while it runs (it measures with and without .tight): those changes are its own, not news.
  $effect(() => {
    void [moreWidthPx, moreLinks.length];
    untrack(() => {
      if (!fitting) void fitBar();
    });
  });
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<nav class="navbar">
  <div
    class="nav-content"
    class:c1={compact >= 1}
    class:c2={compact >= 2}
    class:c3={compact >= 3}
    class:c4={compact >= 4}
    class:c5={compact >= 5}
    class:c6={compact >= 6}
    class:tight
    bind:this={navContentEl}
  >
    <div class="nav-left">
      {#if showLeft}
        {#if leftText}
          <div class="custom-text">{leftText}</div>
        {:else}
          <a href="/" class="logo" onclick={handleLogoClick}>
            <img src="/logo.svg" alt="HOPS" />
            <span class="wordmark">HOPS</span>
            <span class="version">v{appVersion}</span>
          </a>

          {#if $isAuthenticated && isDashboardPage}
            <div class="nav-dash" bind:this={dashEl} style:min-width="{moreWidthPx}px">
              <!-- Measured, never seen: every link and the More button at their natural widths. -->
              <div class="nav-measure-clip" aria-hidden="true">
                <div class="nav-measure" bind:this={measureEl}>
                  {#each navDashboards as dashboard (dashboard.id)}
                    <span class="nav-link" data-measure-link>{dashboard.name}</span>
                  {/each}
                  <span class="nav-more-btn" data-measure-more>More <Icon icon="mdi:chevron-down" width="18" height="18" /></span>
                </div>
              </div>
              {#if shownLinks.length > 0}
                <div class="nav-links">
                  {#each shownLinks as dashboard (dashboard.id)}
                    <a
                      href={dashboard.path}
                      class="nav-link"
                      class:active={currentPath === dashboard.path}
                      aria-current={currentPath === dashboard.path ? 'page' : undefined}
                    >
                      {dashboard.name}
                    </a>
                  {/each}
                </div>
              {/if}
              {#if moreLinks.length > 0}
                <div class="nav-more">
                  <button
                    type="button"
                    class="nav-more-btn"
                    class:active={moreHasCurrent}
                    bind:this={moreBtn}
                    aria-label="More dashboards"
                    aria-haspopup="menu"
                    aria-expanded={moreOpen}
                    aria-controls="nav-more-menu"
                    title="More dashboards"
                    onclick={() => (moreOpen ? closeMore() : void openMore(null))}
                    onkeydown={onMoreKey}
                  >
                    More <Icon icon="mdi:chevron-down" width="18" height="18" />
                  </button>
                  {#if moreOpen}
                    <!-- svelte-ignore a11y_interactive_supports_focus -->
                    <div
                      class="more-menu"
                      id="nav-more-menu"
                      role="menu"
                      aria-label="More dashboards"
                      bind:this={moreMenu}
                      onkeydown={onMenuKey}
                    >
                      {#each moreLinks as dashboard (dashboard.id)}
                        <a
                          href={dashboard.path}
                          role="menuitem"
                          tabindex="-1"
                          class="more-item"
                          class:active={currentPath === dashboard.path}
                          aria-current={currentPath === dashboard.path ? 'page' : undefined}
                          onclick={() => closeMore()}
                        >
                          {dashboard.name}
                        </a>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        {/if}
      {/if}
    </div>

    <div class="nav-center">
      {#if showCenter}
        {#if centerTitle}
          <h1 class="center-title">{centerTitle}</h1>
        {:else if pageDashboard}
          <h1 class="center-title">{pageDashboard.name}</h1>
        {/if}
      {/if}
    </div>

    <div class="nav-right">
      <button type="button" onclick={() => onSearch?.()} class="search-btn" title="Search (/)" aria-label="Search">
        <span class="icon-wrapper">
          <Icon icon="mdi:magnify" width="32" height="32" />
        </span>
      </button>

      {#if isDashboardPage}
        <div class="text-size-controls" title="Text Size: {textSizeConfigs[$textSize].label}">
          <button
            onclick={decreaseTextSize}
            class="text-size-btn"
            disabled={!canDecrease($textSize)}
            aria-label="Decrease text size"
            title="Decrease text size"
          >
            <span class="text-size-icon small">A</span>
            <Icon icon="mdi:arrow-down" width="10" height="10" class="text-size-arrow" />
          </button>
          <button
            onclick={increaseTextSize}
            class="text-size-btn"
            disabled={!canIncrease($textSize)}
            aria-label="Increase text size"
            title="Increase text size"
          >
            <span class="text-size-icon large">A</span>
            <Icon icon="mdi:arrow-up" width="10" height="10" class="text-size-arrow" />
          </button>
        </div>

        <button onclick={() => showThemePicker = true} class="theme-toggle" title="Theme Settings" aria-label="Theme Settings">
          <span class="icon-wrapper">
            <Icon icon={themeIcon} width="32" height="32" />
          </span>
        </button>
      {/if}

      {#if $editMode && isDashboardPage}
        <button onclick={() => showExport = true} class="export-btn" title="Export Dashboard" aria-label="Export Dashboard">
          <span class="icon-wrapper">
            <Icon icon="mdi:tray-arrow-up" width="32" height="32" />
          </span>
        </button>
      {/if}

      {#if isDashboardPage}
        <button
          onclick={handlePencil}
          class="edit-toggle"
          class:active={$editMode}
          title={$editMode ? "Exit Edit Mode" : $isAuthenticated ? "Enter Edit Mode" : "Sign in to edit this dashboard"}
          aria-label={$editMode ? "Exit Edit Mode" : "Enter Edit Mode"}
        >
          <Icon icon={$editMode ? 'mdi:pencil-off' : 'mdi:pencil'} width="32" height="32" />
          {#if $editMode}
            <span class="edit-label">Editing</span>
          {/if}
        </button>
      {/if}

      {#if $isAuthenticated}
        <button onclick={() => showHelp = true} class="help-btn" title="Help" aria-label="Help">
          <span class="icon-wrapper">
            <Icon icon="mdi:help-circle-outline" width="32" height="32" />
          </span>
        </button>
      {/if}

      {#if $isAuthenticated}
        <button onclick={() => showAbout = true} class="about-btn" title="About HOPS" aria-label="About HOPS">
          <span class="icon-wrapper">
            <Icon icon="mdi:information-outline" width="32" height="32" />
          </span>
        </button>
      {/if}

      <!-- Settings is the admin home; logged out, it asks for the password in place. -->
      <a href="/settings" class="admin-link" title="Settings" aria-label="Settings">
        <Icon icon="mdi:cog" width="32" height="32" />
        {#if $isAuthenticated}
          <span class="admin-badge"></span>
        {/if}
      </a>

      {#if $isAuthenticated}
        <button type="button" onclick={handleLogout} class="logout-btn" title="Log out" aria-label="Log out">
          <Icon icon="mdi:logout" width="18" height="18" />
          <span class="logout-label">Log out</span>
        </button>
      {/if}
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

{#if showLogin}
  <LoginDialog onSuccess={handleLoginSuccess} onCancel={() => (loginPath = null)} />
{/if}

<style>
  .navbar {
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: var(--z-navbar);
    backdrop-filter: blur(10px);
    /* On iOS standalone PWA the notch sits over the top of the navbar.
       Add the safe-area inset so brand + actions stay clear. */
    padding-top: env(safe-area-inset-top, 0);
  }

  .nav-content {
    max-width: 1400px;
    margin: 0 auto;
    /* Match the navbar safe-area on the sides too, so the brand/actions
       don't sit under the rounded screen corners in landscape. */
    padding: 0 max(1rem, env(safe-area-inset-left, 0)) 0 max(1rem, env(safe-area-inset-right, 0));
    display: grid;
    /* The right-hand controls (pencil, gear, Log out…) always get their full width; the logo and
       room for the More button keep theirs; the dashboard links take what is left of their side
       (those that fit; the rest are in More); the centre title shrinks (ellipsis). With room to
       spare both sides are equal, so the title stays centred. Never wider than the screen. */
    grid-template-columns: minmax(min-content, 1fr) minmax(0, auto) minmax(max-content, 1fr);
    align-items: center;
    gap: 2rem;
    height: 70px;
  }

  .nav-left {
    display: flex;
    align-items: center;
    gap: 2rem;
    justify-content: flex-start;
    min-width: 0;
  }

  .nav-left .logo {
    flex-shrink: 0;
  }

  .nav-center {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
  }

  .center-title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-tertiary);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    margin-left: 0.25rem;
    opacity: 0.8;
  }

  /* The dashboard links and the More button (Ruling 12). It takes the column's spare width — never
     its content's (width 0, then it grows) — so the column's smallest width is the logo plus room for
     the More button, and the bar is never wider than the screen however many dashboards there are. */
  .nav-dash {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1 1 0;
    width: 0;
  }

  /* Only links that fit are drawn, so nothing is cut off; clip (never scroll) a sub-pixel rounding. */
  .nav-links {
    display: flex;
    gap: 0.5rem;
    min-width: 0;
    overflow: hidden;
    overflow: clip;
  }

  /* The measuring copy: laid out at natural widths inside a zero-size clipped box, so it is never
     seen, never takes space and never widens the page. */
  .nav-measure-clip {
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    overflow: hidden;
    visibility: hidden;
    pointer-events: none;
  }

  .nav-measure {
    display: flex;
    gap: 0.5rem;
    width: max-content;
  }

  .nav-more {
    position: relative;
    flex: none;
  }

  .nav-more-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    white-space: nowrap;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-weight: 500;
    font-size: 1rem;
    line-height: 1.6;
    cursor: pointer;
    transition: all 0.2s;
  }

  .nav-more-btn:hover,
  .nav-more-btn[aria-expanded='true'] {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  /* The current dashboard is in the menu: the button says so. */
  .nav-more-btn.active {
    box-shadow: inset 0 -2px 0 var(--accent);
    color: var(--text-primary);
  }

  .more-menu {
    position: absolute;
    top: calc(100% + 0.5rem);
    left: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    min-width: 12rem;
    max-width: min(20rem, calc(100vw - 2rem));
    max-height: min(60vh, 24rem);
    overflow-y: auto;
    padding: 0.25rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    box-shadow: 0 8px 24px var(--shadow, rgba(0, 0, 0, 0.35));
  }

  .more-item {
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    color: var(--text-secondary);
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .more-item:hover,
  .more-item:focus-visible {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    outline: none;
  }

  .more-item.active {
    background: var(--accent);
    color: white;
  }

  .nav-link {
    flex-shrink: 0;
    white-space: nowrap;
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

  .search-btn, .theme-toggle, .admin-link, .edit-toggle, .export-btn, .help-btn, .about-btn {
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

  .search-btn:hover, .theme-toggle:hover, .admin-link:hover, .edit-toggle:hover, .export-btn:hover, .help-btn:hover, .about-btn:hover {
    background: var(--accent);
    color: white;
  }

  .edit-toggle {
    width: auto;
    padding: 0 1rem;
    border-radius: 2rem;
  }

  .edit-toggle.active {
    background: var(--color-warning);
    color: white;
  }

  .edit-label {
    font-size: 0.875rem;
    font-weight: 500;
  }

  /* Small: a text button next to the gear, not another big round icon. */
  .logout-btn {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    height: 32px;
    padding: 0 0.7rem;
    border-radius: 1rem;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.8rem;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.2s;
  }

  .logout-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .admin-badge {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 8px;
    height: 8px;
    background: var(--color-success);
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

  /* Tablet: tighten gaps and shrink the dashboard center title */
  @media (max-width: 1024px) {
    .nav-content {
      gap: 1rem;
      padding: 0 0.75rem;
    }

    .nav-left {
      gap: 1rem;
    }

    .center-title {
      font-size: 1.25rem;
    }

    .nav-right {
      gap: 0.5rem;
    }
  }

  /* Mobile landscape / small tablet: hide the dashboard links (and More) and the text-size
     controls. */
  @media (max-width: 768px) {
    .nav-dash {
      display: none;
    }

    .text-size-controls {
      display: none;
    }

    .center-title {
      font-size: 1.125rem;
    }

    .nav-content {
      height: 60px;
    }

    .logo img {
      width: 40px;
      height: 40px;
    }
  }

  /* Mobile portrait: tighten layout but keep all icons + version visible.
     Only the HOPS wordmark drops (logo image is still there for branding),
     and the dev badge drops (it's dev-only). */
  @media (max-width: 480px) {
    .nav-content {
      padding: 0 0.5rem;
      gap: 0.5rem;
    }

    .wordmark {
      display: none;
    }

    /* Editing dashboards on a touchscreen is awkward (drag-and-drop, dense
       modals). Hide the edit + export controls on phones — admin can still
       reach the full panel via the gear icon. */
    .edit-toggle,
    .export-btn {
      display: none;
    }

    .center-title {
      font-size: 1rem;
    }

    /* Slightly smaller buttons (40px vs 44px default) so all icons fit
       on ~400px phones. Icons stay at their native 32px — leaves a clean
       4px ring of padding inside each button. */
    .search-btn,
    .theme-toggle,
    .admin-link,
    .help-btn,
    .about-btn {
      width: 40px;
      height: 40px;
    }
  }

  /* Tiny phones (<360px): drop the version chip and the secondary action icons
     to avoid horizontal overflow */
  @media (max-width: 360px) {
    .version {
      display: none;
    }

    .help-btn,
    .about-btn {
      display: none;
    }
  }

  /* Phones: no room for Log out beside the gear (it pushed the page wider than a 375–390px
     screen). It stays one tap away, in Settings (its Log out section). */
  @media (max-width: 480px) {
    .logout-btn {
      display: none;
    }
  }
  /* The bar never outgrows the screen (walkthrough 1: the page never scrolls sideways), at any width
     or text size: while it would, it steps down one level at a time (fitBar), least useful first —
     tighter gaps, no wordmark, no text-size buttons or "Editing" label, smaller buttons and Log out as
     an icon, no version, then no Help/About (still in Settings' reach for an admin). The pencil, gear
     and Log out always stay (phones keep their own rules above). */
  @media (min-width: 481px) {
    .nav-content.c1 {
      gap: 1rem;
      padding: 0 0.75rem;
    }

    .c1 .nav-left {
      gap: 1rem;
    }

    .c1 .nav-right {
      gap: 0.5rem;
    }
  }

  /* Some dashboard links are in More: the controls go compact so more links show (fitBar). Icons
     only and tighter gaps; every control stays, at its full tap size. */
  .tight .nav-right {
    gap: 0.5rem;
  }

  .tight .edit-label,
  .tight .logout-label {
    display: none;
  }

  .tight .edit-toggle {
    width: 44px;
    padding: 0;
    border-radius: 50%;
  }

  .tight .logout-btn {
    padding: 0 0.5rem;
  }

  .c2 .wordmark {
    display: none;
  }

  .c3 .text-size-controls,
  .c3 .edit-label {
    display: none;
  }

  .nav-content.c4 {
    gap: 0.375rem;
    padding: 0 0.5rem;
  }

  .c4 .nav-left {
    gap: 0.5rem;
  }

  .c4 .nav-right {
    gap: 0.25rem;
  }

  .c4 .search-btn,
  .c4 .theme-toggle,
  .c4 .admin-link,
  .c4 .export-btn,
  .c4 .help-btn,
  .c4 .about-btn {
    width: 40px;
    height: 40px;
  }

  .c4 .edit-toggle {
    height: 40px;
    padding: 0 0.6rem;
  }

  .c4.tight .edit-toggle {
    width: 40px;
    padding: 0;
  }

  .c4 .logout-label {
    display: none;
  }

  .c4 .logout-btn {
    padding: 0 0.5rem;
  }

  .c5 .version {
    display: none;
  }

  .c6 .help-btn,
  .c6 .about-btn {
    display: none;
  }
</style>
