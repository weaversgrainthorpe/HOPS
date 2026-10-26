<script lang="ts">
  import { dashboards, currentRoute, dashboardHref } from '$lib/stores/config';
  import { page } from '$app/stores';
  import { tick, untrack } from 'svelte';
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
  import BackendStatus from './BackendStatus.svelte';

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

  // Every dashboard for the switcher, in display (Settings) order.
  let navDashboards = $derived($dashboards.map((d) => ({ id: d.id, name: d.name, path: dashboardHref(d.path) })));

  // ---- the dashboard switcher (Ruling 16, M5 §8): signed in, the title is a menu button listing every
  // dashboard, the current one marked; choosing one navigates (a plain link, so the unsaved-changes
  // guard in +layout applies). Enter, Space or ArrowDown opens it on the current dashboard (ArrowUp on
  // the last); the arrows, Home and End move (wrapping); Escape closes it and focus returns to the title;
  // Tab or a press outside closes it. Signed out: a plain title, no switcher (no users or roles).
  let switcherOpen = $state(false);
  let switcherBtn = $state<HTMLButtonElement | null>(null);
  let switcherMenu = $state<HTMLElement | null>(null);
  /** Keeps the open menu on screen: px it is moved sideways from centred under the title. */
  let menuShift = $state(0);
  const switcherItems = () => Array.from(switcherMenu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  async function openSwitcher(focus: 'current' | 'last') {
    menuShift = 0;
    switcherOpen = true;
    await tick();
    if (switcherMenu) {
      const r = switcherMenu.getBoundingClientRect();
      const view = document.documentElement.clientWidth;
      const margin = 8;
      if (r.left < margin) menuShift = margin - r.left;
      else if (r.right > view - margin) menuShift = Math.max(margin - r.left, view - margin - r.right);
    }
    const items = switcherItems();
    const current = items.findIndex((el) => el.getAttribute('aria-current') === 'page');
    (focus === 'last' ? items[items.length - 1] : items[current >= 0 ? current : 0])?.focus();
  }
  function closeSwitcher(refocus = false) {
    switcherOpen = false;
    if (refocus) switcherBtn?.focus();
  }
  function onSwitcherKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      void openSwitcher('current');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      void openSwitcher('last');
    } else if (e.key === 'Escape' && switcherOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeSwitcher(true);
    }
  }
  function onSwitcherMenuKey(e: KeyboardEvent) {
    const items = switcherItems();
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
      closeSwitcher(true);
    } else if (e.key === ' ' && at >= 0) {
      // Space chooses, as Enter does (a link only answers Enter by itself).
      e.preventDefault();
      e.stopPropagation();
      items[at].click();
    } else if (e.key === 'Enter') {
      e.stopPropagation(); // the link's own Enter navigates
    } else if (e.key === 'Tab') closeSwitcher();
  }
  // A press anywhere outside the title and its menu closes it.
  function onWindowPointerDown(e: PointerEvent) {
    if (textSizeOpen) {
      const t = e.target as Node | null;
      if (!(t && textSizeWrap?.contains(t))) closeTextSize();
    }
    if (!switcherOpen) return;
    const t = e.target as Node | null;
    if (t && (switcherBtn?.contains(t) || switcherMenu?.contains(t))) return;
    closeSwitcher();
  }
  // Going to another page closes it.
  $effect(() => {
    void currentPath;
    untrack(() => closeSwitcher());
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
  /** The title: the header's own, else the dashboard's name — centred in the bar (M5 §8). */
  let titleText = $derived(showCenter ? centerTitle || pageDashboard?.name || '' : '');
  /** Signed in, on a dashboard, the title is the switcher (Ruling 16); signed out it is plain text.
   *  With the title hidden (the header's showCenter off), an admin still gets the switcher — a compact
   *  "Dashboards ▾" in the title's place (Ruling 20); signed out, nothing is there. */
  let showSwitcher = $derived($isAuthenticated && isDashboardPage);
  $effect(() => {
    if (!showSwitcher) untrack(() => closeSwitcher());
  });
  // ---- the bar never outgrows the screen, and the title stays centred (M5 §8): the lowest level of
  // compaction (CSS .c1–.c7) at which the bar fits, the title is whole and it sits in the bar's centre.
  // When no level centres it (a long title on a phone), the lowest level at which the bar fits with the
  // title whole — the title then sits as near the centre as the wider side allows, never overlapping
  // it; controls are never dropped for a centring that cannot happen. Measured on the bar's own width (a window resize) and whenever what it holds changes; all before
  // the next paint (a ResizeObserver callback, then microtasks), so no level flashes. The bar's width
  // never depends on the level, so this never loops. Nothing is hidden or moved into a menu but the
  // levels' own (least useful first); the text-size buttons never hide. The last level (CSS .c8) is a
  // phone's narrowest screens only (under 360 px): the two text-size buttons fold into one "Text size"
  // button that opens them in a small menu. It is taken only when it makes the title whole; when even
  // it cannot, the bar stays at the level before it, the buttons in the bar — unless the bar would then
  // spill sideways (a title shortened to its least, beside every control) and folding stops that.
  const MAX_COMPACT = 8;
  const FOLDED = 8;
  let navContentEl = $state<HTMLElement | null>(null);
  let titleEl = $state<HTMLElement | null>(null);
  let compact = $state(0);
  let fitting = false;
  let fitAgain = false;
  /** While fitBar measures, the controls' transitions are off: a button mid-animation (a padding or
   *  width easing to a level's value) would be measured at a size it is about to leave. */
  let measuring = $state(false);
  /** How the bar sits now: fits (no sideways overflow, the title whole) and centred (the title's middle
   *  on the bar's). No title: centred trivially. `spills`: the bar or its centre box overflows sideways. */
  function barState(): { fits: boolean; centred: boolean; spills: boolean } {
    const bar = navContentEl;
    if (!bar) return { fits: true, centred: true, spills: false };
    let spills = bar.scrollWidth > bar.clientWidth + 0.5;
    // The compact "Dashboards ▾" (Ruling 20) never shrinks: squeezed, it spills out of the centre box.
    const center = bar.querySelector<HTMLElement>('.nav-center');
    if (center && center.scrollWidth > center.clientWidth + 0.5) spills = true;
    let fits = !spills;
    const title = titleEl;
    if (!title) return { fits, centred: true, spills };
    const text = title.querySelector<HTMLElement>('.title-text');
    if (text && text.scrollWidth > text.clientWidth + 0.5) fits = false;
    const cs = getComputedStyle(bar);
    const b = bar.getBoundingClientRect();
    const t = title.getBoundingClientRect();
    const barMid = (b.left + (parseFloat(cs.paddingLeft) || 0) + b.right - (parseFloat(cs.paddingRight) || 0)) / 2;
    return { fits, centred: Math.abs((t.left + t.right) / 2 - barMid) <= 0.5, spills };
  }
  async function fitBar() {
    if (!navContentEl) return;
    if (fitting) {
      fitAgain = true;
      return;
    }
    fitting = true;
    measuring = true;
    try {
      do {
        fitAgain = false;
        let best = -1;
        let fallback = -1;
        let lastSpills = false;
        let foldedSpills = true;
        for (let level = 0; level <= MAX_COMPACT; level++) {
          compact = level;
          await tick();
          const { fits, centred, spills } = barState();
          if (fits && centred) {
            best = level;
            break;
          }
          if (fits && fallback < 0) fallback = level;
          if (level === FOLDED - 1) lastSpills = spills;
          if (level === FOLDED) foldedSpills = spills;
        }
        // Nothing fits: the last unfolded level, the title shortened — folded only if that alone keeps
        // the bar from spilling sideways (and only where the fold exists: under 360 px).
        const lastResort = lastSpills && !foldedSpills ? FOLDED : FOLDED - 1;
        const pick = best >= 0 ? best : fallback >= 0 ? fallback : lastResort;
        if (compact !== pick) {
          compact = pick;
          await tick();
        }
      } while (fitAgain);
      // Unfolded (a wider screen, or room again at a lower level): the folded menu has nothing to show.
      if (!isFolded()) textSizeOpen = false;
    } finally {
      fitting = false;
      measuring = false;
    }
  }
  $effect(() => {
    if (!navContentEl || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => void fitBar());
    ro.observe(navContentEl);
    return () => ro.disconnect();
  });
  // Web fonts change the title's width without resizing the bar: fit again once they load.
  $effect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    const fonts = document.fonts;
    const refit = () => void fitBar();
    let live = true;
    void fonts.ready.then(() => {
      if (live) refit();
    });
    fonts.addEventListener('loadingdone', refit);
    return () => {
      live = false;
      fonts.removeEventListener('loadingdone', refit);
    };
  });
  // ---- the folded text-size buttons (.c8, under 360 px): the "Text size" button opens them below it,
  // focus moving to A- (A+ when A- is disabled); a press outside, Escape, Tab out of them or the bar
  // unfolding closes them. Pressing one keeps them open (a user often steps more than once).
  let textSizeOpen = $state(false);
  let textSizeWrap = $state<HTMLElement | null>(null);
  let textSizeMoreBtn = $state<HTMLButtonElement | null>(null);
  /** Folded: the bar is at the fold level and the "Text size" button shows (a phone under 360 px). */
  function isFolded() {
    return !!textSizeMoreBtn && textSizeMoreBtn.getClientRects().length > 0;
  }
  function closeTextSize(refocus = false) {
    if (!textSizeOpen) return;
    textSizeOpen = false;
    if (refocus) textSizeMoreBtn?.focus();
  }
  async function toggleTextSize() {
    if (!isFolded()) {
      textSizeOpen = false;
      return;
    }
    textSizeOpen = !textSizeOpen;
    if (!textSizeOpen) return;
    await tick();
    const first = [...(textSizeWrap?.querySelectorAll<HTMLButtonElement>('.text-size-btn') ?? [])].find((b) => !b.disabled);
    first?.focus();
  }
  // Focus leaving the toggle and its pair (Tab past A+, or Shift+Tab before the toggle) closes it.
  function onTextSizeFocusOut(e: FocusEvent) {
    const to = e.relatedTarget as Node | null;
    if (textSizeOpen && to && !textSizeWrap?.contains(to)) closeTextSize();
  }
  function onTextSizeKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && textSizeOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeTextSize(true);
    }
  }
  // Going to another page closes it.
  $effect(() => {
    void currentPath;
    untrack(() => closeTextSize());
  });

  // What the bar holds: edit mode, signed in or not, the page, the title, the text size.
  $effect(() => {
    void [$editMode, $isAuthenticated, isDashboardPage, showLeft, showCenter, leftText, titleText, showSwitcher, $textSize];
    untrack(() => void fitBar());
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
    class:c7={compact >= 7}
    class:c8={compact >= 8}
    class:measuring
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
        {/if}
      {/if}
      <!-- The backend status dot (M6 §7.12) sits next to the logo, and stays even when the logo is hidden. -->
      <BackendStatus />
    </div>

    <!-- The title, centred (M5 §8). Signed in, it is the dashboard switcher (Ruling 16); with the title
         hidden, a compact "Dashboards ▾" switcher takes its place (Ruling 20). -->
    {#snippet switcherButton(label: string, compactLabel: boolean)}
      <button
        type="button"
        class="switcher-btn"
        bind:this={switcherBtn}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={switcherOpen}
        aria-controls={switcherOpen ? 'nav-switcher-menu' : undefined}
        title={label}
        onclick={() => (switcherOpen ? closeSwitcher() : void openSwitcher('current'))}
        onkeydown={onSwitcherKey}
      >
        {#if compactLabel}
          <!-- A phone's tightest levels show the icon in place of the word (the name keeps it). -->
          <Icon icon="mdi:view-dashboard-outline" class="switcher-compact-icon" width="24" height="24" />
          <span class="switcher-compact-text">Dashboards</span>
        {:else}
          <!-- Shortened with an ellipsis on a narrow bar: the full title is its tooltip (never silent). -->
          <span class="title-text" title={titleText}>{titleText}</span>
        {/if}
        <Icon icon="mdi:chevron-down" class="switcher-chevron" width="1em" height="1em" />
      </button>
    {/snippet}
    <div class="nav-center">
      {#if titleText}
        <h1 class="center-title" bind:this={titleEl} title={showSwitcher ? undefined : titleText}>
          {#if showSwitcher}
            {@render switcherButton(`${titleText} — switch dashboard`, false)}
          {:else}
            <span class="title-text" title={titleText}>{titleText}</span>
          {/if}
        </h1>
      {:else if showSwitcher}
        <!-- Not a title (no h1): the bar's centring treats it as no title (fitBar). -->
        <div class="switcher-compact">
          {@render switcherButton('Dashboards — switch dashboard', true)}
        </div>
      {/if}
      {#if showSwitcher && switcherOpen}
        <!-- svelte-ignore a11y_interactive_supports_focus -->
        <div
          class="switcher-menu"
          id="nav-switcher-menu"
          role="menu"
          aria-label="Dashboards"
          style:--menu-shift="{menuShift}px"
          bind:this={switcherMenu}
          onkeydown={onSwitcherMenuKey}
        >
          {#each navDashboards as dashboard (dashboard.id)}
            <a
              href={dashboard.path}
              role="menuitem"
              tabindex="-1"
              class="switcher-item"
              class:active={currentPath === dashboard.path}
              aria-current={currentPath === dashboard.path ? 'page' : undefined}
              onclick={() => closeSwitcher()}
            >
              <span class="switcher-mark" aria-hidden="true">
                {#if currentPath === dashboard.path}<Icon icon="mdi:check" width="18" height="18" />{/if}
              </span>
              <span class="switcher-name">{dashboard.name}</span>
            </a>
          {/each}
        </div>
      {/if}
    </div>

    <div class="nav-right">
      <button type="button" onclick={() => onSearch?.()} class="search-btn" title="Search (/)" aria-label="Search">
        <span class="icon-wrapper">
          <Icon icon="mdi:magnify" width="32" height="32" />
        </span>
      </button>

      {#if isDashboardPage}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="text-size" class:open={textSizeOpen} bind:this={textSizeWrap} onkeydown={onTextSizeKey} onfocusout={onTextSizeFocusOut}>
          <!-- Folded (a phone under 360 px, .c8): one button that opens the two below it. -->
          <button
            type="button"
            class="text-size-more"
            bind:this={textSizeMoreBtn}
            aria-label="Text size"
            aria-expanded={textSizeOpen}
            aria-controls={textSizeOpen ? 'nav-text-size' : undefined}
            title="Text Size: {textSizeConfigs[$textSize].label}"
            onclick={() => void toggleTextSize()}
          >
            <Icon icon="mdi:format-size" width="26" height="26" />
          </button>
          <div class="text-size-controls" id="nav-text-size" title="Text Size: {textSizeConfigs[$textSize].label}">
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
    /* The full width, with the same 2rem side gutter as the tab bar and canvas below, so the logo
       lines up with the first tab and the controls with the canvas's right edge. Match the navbar
       safe-area on the sides too, so the brand/actions don't sit under the rounded screen corners. */
    padding: 0 max(2rem, env(safe-area-inset-left, 0)) 0 max(2rem, env(safe-area-inset-right, 0));
    /* M5 §8: the logo, the title, the right-hand controls. The two sides share the spare width
       equally (flex: 1 1 0), so the title sits in the bar's centre; a side never shrinks below its
       own content, so when one is too wide the title moves over rather than overlap it, and fitBar
       compacts the controls until it is centred again (or the levels run out). */
    display: flex;
    align-items: center;
    gap: 2rem;
    height: 70px;
  }

  .nav-left {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    justify-content: flex-start;
    flex: 1 1 0;
  }

  .nav-left .logo {
    flex-shrink: 0;
  }

  /* The title's box: only as wide as the title (it shrinks, with an ellipsis, before anything
     overlaps); the switcher's menu hangs below it. */
  .nav-center {
    position: relative;
    display: flex;
    justify-content: center;
    flex: 0 1 auto;
    min-width: 0;
  }

  .center-title {
    display: flex;
    min-width: 0;
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .title-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Signed in: the title is the switcher's button — the title's own look, plus a chevron. */
  .switcher-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    min-width: 0;
    max-width: 100%;
    padding: 0.125rem 0.25rem 0.125rem 0.5rem;
    border: none;
    border-radius: 0.5rem;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: background 0.2s;
  }

  /* The title hidden (Ruling 20): a compact "Dashboards ▾", smaller than a title, never shrinking. */
  .switcher-compact {
    display: flex;
    flex: none;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .switcher-btn :global(.switcher-compact-icon) {
    display: none;
    flex: none;
  }

  .switcher-btn:hover,
  .switcher-btn[aria-expanded='true'] {
    background: var(--bg-tertiary);
  }

  .switcher-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .switcher-btn :global(.switcher-chevron) {
    flex: none;
    color: var(--text-secondary);
  }

  .switcher-menu {
    position: absolute;
    top: calc(100% + 0.5rem);
    left: 50%;
    transform: translateX(calc(-50% + var(--menu-shift, 0px)));
    z-index: 1;
    display: flex;
    flex-direction: column;
    min-width: 12rem;
    max-width: min(20rem, calc(100vw - 1rem));
    max-height: min(60vh, 24rem);
    overflow-y: auto;
    padding: 0.25rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    box-shadow: 0 8px 24px var(--shadow, rgba(0, 0, 0, 0.35));
  }

  .switcher-item {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.75rem 0.5rem 0.375rem;
    border-radius: 0.375rem;
    color: var(--text-secondary);
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
  }

  .switcher-mark {
    display: inline-flex;
    flex: none;
    width: 18px;
  }

  .switcher-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .switcher-item:hover,
  .switcher-item:focus-visible {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    outline: none;
  }

  /* The current dashboard: marked (the tick) and in the accent colour. */
  .switcher-item.active {
    background: var(--accent-solid);
    color: var(--on-accent);
  }

  .switcher-item.active:focus-visible {
    outline: 2px solid var(--text-primary);
    outline-offset: -2px;
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
    color: var(--text-primary);
    background: var(--bg-primary);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    margin-left: 0.25rem;
    opacity: 0.8;
  }

  .nav-right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 1rem;
    flex: 1 1 0;
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
    background: var(--accent-solid);
    color: var(--on-accent);
  }

  .edit-toggle {
    width: auto;
    padding: 0 1rem;
    border-radius: 2rem;
  }

  .edit-toggle.active {
    background: var(--warning-solid);
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
    background: var(--accent-solid);
    color: var(--on-accent);
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
      gap: 0.125rem;
    }

    .center-title {
      font-size: 1.25rem;
    }

    .nav-right {
      gap: 0.5rem;
    }
  }

  /* Mobile landscape / small tablet. The text-size buttons show here too (they never hide, at any
     width): on a phone they fit through the compaction ladder below. */
  @media (max-width: 768px) {
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

    /* The title's switcher: a 40 px tap target (its width is the title's, shortened to no less). */
    .switcher-btn {
      min-height: 40px;
      min-width: 40px;
    }

    /* The text-size buttons: each a 40 px tap target, the pair one pill with no padding or gap. */
    .text-size-controls {
      gap: 0;
      padding: 0;
      border-radius: 20px;
    }

    .text-size-btn {
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
     tighter gaps, no wordmark, no "Editing" label, smaller buttons and Log out as an icon, no
     Help/About (still in Settings' reach for an admin), smaller text-size buttons (a phone keeps them
     at 40 px and tightens the gaps, padding and the title's own chrome instead), and last the version
     (a phone: the title a touch smaller, a hidden title's "Dashboards" an icon). The text-size buttons
     are NEVER hidden, phones included (they are the only text-size control: a user who enlarged the
     text must always be able to make it smaller again); only under 360 px may they fold into one
     "Text size" button that opens them (.c8, see fitBar). The pencil, gear and Log out always stay
     (phones keep their own rules above). */
  @media (min-width: 481px) {
    .nav-content.c1 {
      gap: 1rem;
      padding: 0 0.75rem;
    }

    .c1 .nav-left {
      gap: 0.125rem;
    }

    .c1 .nav-right {
      gap: 0.5rem;
    }
  }

  .c2 .wordmark {
    display: none;
  }

  .c3 .edit-label {
    display: none;
  }

  .nav-content.c4 {
    gap: 0.375rem;
    padding: 0 0.5rem;
  }

  .c4 .nav-left {
    gap: 0.125rem;
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

  .c4 .logout-label {
    display: none;
  }

  .c4 .logout-btn {
    padding: 0 0.5rem;
  }

  .measuring :global(*) {
    transition: none !important;
  }

  .c5 .help-btn,
  .c5 .about-btn {
    display: none;
  }

  /* Smaller, never hidden: still a 28 px tap target each (wider screens; a phone keeps 40 px). */
  @media (min-width: 481px) {
    .c6 .text-size-controls {
      gap: 0;
      padding: 0.125rem;
    }

    .c6 .text-size-btn {
      width: 28px;
      height: 28px;
    }
  }

  /* Phones: the controls never go under 40 px, so the last steps take the room from around them —
     the gaps and the bar's side padding. */
  @media (max-width: 480px) {
    .nav-content.c6 {
      gap: 0.25rem;
      padding: 0 0.25rem;
    }

    .c6 .nav-left {
      gap: 0;
    }

    .c6 .nav-right {
      gap: 2px;
    }

    /* The title's own chrome: the switcher's padding and its chevron's gap. */
    .c6 .switcher-btn {
      gap: 0;
      padding: 0.125rem 0 0.125rem 0.25rem;
    }

    .nav-content.c7 {
      gap: 2px;
    }

    .c7 .center-title {
      font-size: 0.9375rem;
    }

    /* The compact "Dashboards ▾" (Ruling 20) never shrinks, so at the last level it becomes an icon. */
    .c7 .switcher-compact-text {
      display: none;
    }

    .c7 .switcher-btn :global(.switcher-compact-icon) {
      display: block;
    }
  }

  .c7 .version {
    display: none;
  }

  /* The text-size buttons' wrapper: their own box in the bar; the anchor of their folded menu. */
  .text-size {
    position: relative;
    display: flex;
    align-items: center;
  }

  .text-size-more {
    display: none;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: none;
    cursor: pointer;
    transition: all 0.2s;
  }

  .text-size-more:hover,
  .text-size.open .text-size-more {
    background: var(--accent-solid);
    color: var(--on-accent);
  }

  /* Folded — a phone's narrowest screens only (under 360 px), and only when that makes the title whole
     (fitBar): one "Text size" button; the pair opens below it, the same two 40 px buttons. */
  @media (max-width: 359px) {
    .c8 .text-size-more {
      display: flex;
    }

    .c8 .text-size-controls {
      display: none;
    }

    .c8 .text-size.open .text-size-controls {
      display: flex;
      position: absolute;
      top: calc(100% + 0.5rem);
      right: 0;
      z-index: var(--z-dropdown);
      padding: 0.25rem;
      gap: 0.25rem;
      border-radius: 24px;
      border: 1px solid var(--border);
      background: var(--bg-secondary);
      box-shadow: 0 8px 24px var(--shadow, rgba(0, 0, 0, 0.35));
    }

    .c8 .text-size.open .text-size-btn {
      background: var(--bg-tertiary);
    }
  }
</style>
