<script lang="ts">
  // "Add to HOPS" (/add): where the bookmarklet lands. The query parameters only PREFILL this form
  // (as plain text, checked: addToHops.parseAddParams); nothing is created until a signed-in user
  // clicks Add, which saves the dashboard through the normal save (PUT /api/dashboards/{id}, with
  // CSRF and the revision check). The tile is placed by the tile dialog's own rules (withNewTile).
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import LoginDialog from '$lib/components/LoginDialog.svelte';
  import { isAuthenticated, authChecked, mustChangePassword } from '$lib/stores/auth';
  import {
    config, configError, configLoading, layoutStale, sortedDashboards, findLayoutDashboard, layoutDoc,
    applySavedLayout, loadConfig, layoutFormProblem, showSaveWarning, dashboardHref
  } from '$lib/stores/config';
  import { saveDashboardV3, getPackagedIcons, ConflictError } from '$lib/utils/api';
  import { blankTile, withNewTile } from '$lib/editor/editorActions';
  import { parseAddParams, pickDashboardIcon, foldersOf, readLastTarget, writeLastTarget, cleanName, URL_MAX } from '$lib/utils/addToHops';
  import type { TileNode } from '$lib/types/layout';

  const params = parseAddParams($page.url.searchParams);
  let name = $state(params.name);
  let url = $state(params.url);
  let iconUrl = $state(params.iconUrl);
  let iconNote = $state('');
  const last = readLastTarget();

  const list = $derived(sortedDashboards($config?.dashboards));
  let dashboardId = $state('');
  let tabId = $state('');
  let folderId = $state('');
  const dash = $derived(list.find((d) => d.id === dashboardId));
  const tabs = $derived(dash?.tabs ?? []);
  const folders = $derived(dash && tabId ? foldersOf(dash, tabId) : []);

  // Defaults: the last dashboard/tab/folder this browser added to, while they still exist.
  $effect(() => {
    if (!dashboardId && list.length) {
      dashboardId = list.some((d) => d.id === last?.dashboardId) ? last!.dashboardId : list[0].id;
    }
  });
  $effect(() => {
    if (dash && !tabs.some((t) => t.id === tabId)) {
      tabId = dash.id === last?.dashboardId && tabs.some((t) => t.id === last?.tabId) ? last!.tabId! : (tabs[0]?.id ?? '');
      folderId = dash.id === last?.dashboardId && last?.tabId === tabId && last?.folderId ? last.folderId : '';
    }
  });
  $effect(() => {
    if (folderId && !folders.some((f) => f.id === folderId)) folderId = '';
  });

  const ready = $derived($authChecked && $isAuthenticated && !$mustChangePassword);

  // Prefer HOPS's bundled Dashboard Icon when the page's name or host matches one exactly.
  let iconChecked = false;
  $effect(() => {
    if (!ready || iconChecked || !url) return;
    iconChecked = true;
    getPackagedIcons()
      .then((p) => {
        const hit = pickDashboardIcon(p.dashboardNames, name, url);
        if (hit) {
          iconUrl = hit;
          iconNote = "Using HOPS's bundled icon for this service.";
        }
      })
      .catch((e) => {
        iconNote = `Couldn't check HOPS's bundled icons (${e instanceof Error && e.message ? e.message : 'request failed'}), so the page's own icon is used.`;
      });
  });

  let busy = $state(false);
  let error = $state('');
  let added = $state<{ href: string; dashboardName: string } | null>(null);
  let closeNote = $state('');

  onMount(() => {
    // The layout loads the config; a stale one is reloaded so Add starts from the current layout.
    if ($layoutStale) void loadConfig({ background: true });
  });

  async function add(e: Event) {
    e.preventDefault();
    if (busy) return;
    error = '';
    const target = $layoutDoc ? findLayoutDashboard(dashboardId, $layoutDoc) : undefined;
    if (!target || !tabId) {
      error = 'Pick a dashboard and a tab first.';
      return;
    }
    if ($layoutStale) {
      error = 'The layout is refreshing. Try again in a moment.';
      return;
    }
    const form = layoutFormProblem($config);
    if (form) {
      error = form;
      return;
    }
    const cleaned = cleanName(name);
    const address = url.trim();
    if (address.length > URL_MAX) {
      error = `That address is too long (over ${URL_MAX} characters).`;
      return;
    }
    const icon = iconUrl.trim();
    if (icon && !/^(https?:\/\/|\/api\/icons\/)/i.test(icon)) {
      error = 'The icon must be an http:// or https:// image address (or leave it empty).';
      return;
    }
    const tile: TileNode = { ...blankTile(), name: cleaned, url: address, ...(icon ? { iconUrl: icon } : {}) };
    const to = folderId ? { tabId, folderId } : { tabId };
    let next;
    try {
      next = withNewTile(target, tile, to);
    } catch (err) {
      error = err instanceof Error && err.message ? err.message : "That tile can't be added.";
      return;
    }
    busy = true;
    try {
      const resp = await saveDashboardV3(target.id, next.dashboard, target.revision);
      applySavedLayout(resp);
      if (resp.warning) showSaveWarning(resp.warning);
      writeLastTarget({ dashboardId: target.id, tabId, ...(folderId ? { folderId } : {}) });
      added = { href: dashboardHref(target.path), dashboardName: target.name };
    } catch (err) {
      if (err instanceof ConflictError) {
        error = 'That dashboard was changed somewhere else, so the tile was not added. It has been reloaded: click Add again.';
        void loadConfig({ background: true });
      } else if (err instanceof Error && err.message === 'SESSION_EXPIRED') {
        error = 'You were signed out, so the tile was not added. Sign in and click Add again.';
      } else {
        error = `The tile was not added: ${err instanceof Error && err.message ? err.message : 'the save failed'}`;
      }
    } finally {
      busy = false;
    }
  }

  function closeWindow() {
    window.close();
    // Browsers only let a page close a window a script opened; say so when it stays open.
    setTimeout(() => (closeNote = 'Your browser kept this tab open: you can close it yourself.'), 200);
  }
</script>

<svelte:head>
  <title>Add to HOPS</title>
</svelte:head>

<main class="add-page">
  <section class="card" aria-labelledby="add-title">
    <h1 id="add-title">Add to HOPS</h1>

    {#if !$authChecked}
      <p class="muted" role="status">Checking sign-in…</p>
    {:else if !$isAuthenticated}
      <p class="muted">Sign in to add this page as a tile.</p>
    {:else if $mustChangePassword}
      <p class="muted" role="status">Set a new password to continue.</p>
    {:else if added}
      <p class="ok" role="status">Added “{cleanName(name)}” to {added.dashboardName}.</p>
      <div class="actions">
        <a class="btn-primary" href={added.href}>Open the dashboard</a>
        <button type="button" class="btn-secondary" onclick={closeWindow}>Close</button>
      </div>
      {#if closeNote}<p class="muted" role="status">{closeNote}</p>{/if}
    {:else if $configError && !$config}
      <p class="error" role="alert">Your dashboards couldn't be loaded: {$configError}</p>
      <button type="button" class="btn-secondary" onclick={() => loadConfig()}>Try again</button>
    {:else if !$config || $configLoading}
      <p class="muted" role="status">Loading your dashboards…</p>
    {:else if list.length === 0}
      <p class="error" role="alert">You have no dashboards yet. Create one in Settings › Dashboards, then use the bookmark again.</p>
    {:else}
      {#if params.problems.length}
        <ul class="problems" role="alert" aria-label="Problems with the page details">
          {#each params.problems as p (p)}<li>{p}</li>{/each}
        </ul>
      {/if}
      <form onsubmit={add} aria-label="Add to HOPS">
        <label for="add-dashboard">Dashboard</label>
        <select id="add-dashboard" bind:value={dashboardId} onchange={() => { tabId = ''; folderId = ''; }}>
          {#each list as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
        </select>

        <label for="add-tab">Tab</label>
        <select id="add-tab" bind:value={tabId} onchange={() => (folderId = '')}>
          {#each tabs as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
        </select>

        <label for="add-folder">Folder (optional)</label>
        <select id="add-folder" bind:value={folderId}>
          <option value="">None: straight on the tab</option>
          {#each folders as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
        </select>

        <label for="add-name">Name</label>
        <input id="add-name" type="text" bind:value={name} maxlength="100" autocomplete="off" />

        <label for="add-url">Address</label>
        <input id="add-url" type="url" bind:value={url} maxlength={URL_MAX} autocomplete="off" placeholder="https://" />

        <label for="add-icon">Icon image address (optional)</label>
        <div class="icon-row">
          {#if iconUrl}<img src={iconUrl} alt="" width="32" height="32" />{/if}
          <input id="add-icon" type="url" bind:value={iconUrl} maxlength={URL_MAX} autocomplete="off" />
        </div>
        {#if iconNote}<p class="muted small">{iconNote}</p>{/if}

        {#if error}<p class="error" role="alert" id="add-error">{error}</p>{/if}

        <div class="actions">
          <button type="submit" class="btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
          <button type="button" class="btn-secondary" onclick={() => goto('/')}>Cancel</button>
        </div>
      </form>
    {/if}
  </section>
</main>

{#if $authChecked && !$isAuthenticated}
  <LoginDialog intro="Sign in to add this page to HOPS." onSuccess={() => {}} onCancel={() => goto('/')} />
{/if}

<style>
  .add-page {
    display: flex;
    justify-content: center;
    padding: 2rem 1rem;
  }
  .card {
    width: 100%;
    max-width: 32rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    padding: 1.25rem 1.5rem;
  }
  h1 {
    margin: 0 0 1rem;
    font-size: 1.35rem;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  label {
    margin-top: 0.5rem;
    font-weight: 600;
    font-size: 0.9rem;
  }
  input,
  select {
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--field-border);
    border-radius: 0.35rem;
    background: var(--bg-primary);
    color: var(--text-primary);
    font: inherit;
  }
  .icon-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .icon-row img {
    flex-shrink: 0;
    object-fit: contain;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 1rem;
    flex-wrap: wrap;
  }
  .actions a {
    text-decoration: none;
  }
  .muted {
    color: var(--text-secondary);
  }
  .small {
    font-size: 0.85rem;
    margin: 0.2rem 0 0;
  }
  .error,
  .problems {
    color: var(--color-error-text);
  }
  .problems {
    margin: 0 0 0.75rem;
    padding-left: 1.2rem;
  }
  .ok {
    color: var(--text-primary);
  }
</style>
