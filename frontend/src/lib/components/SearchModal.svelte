<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import Icon from '@iconify/svelte';
  import { config, layoutDoc, resolveDashboardRoute, dashboardHref, currentRoute } from '$lib/stores/config';
  import { requestReveal, revealRequest } from '$lib/stores/reveal';
  import { toast } from '$lib/stores/toast';
  import { portal } from '$lib/utils/portal';
  import { safeOpenUrl, isValidUrl } from '$lib/utils/url';
  import { isSshUrl, openSshInPlace } from '$lib/utils/ssh';
  import { buildSearchIndex, rankSearch, type SearchItem } from '$lib/utils/searchIndex';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  type Result = SearchItem;

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();

  // On a dashboard page (resolved by the same route resolver the page uses)
  // search only that dashboard; anywhere else search them all.
  const scopedId = get(currentRoute)?.id;
  const scoped = scopedId !== undefined;
  // Indexed once per open (tiles AND folders, at any depth); each keystroke only filters it.
  const index = buildSearchIndex($layoutDoc, scopedId);
  const RESULT_CAP = 50;
  // No layout held, or the current dashboard's layout is absent from it
  // (failed load / stale): say so instead of "no matches".
  const layoutMissing =
    !$layoutDoc || (scoped && !($layoutDoc.dashboards ?? []).some((d) => d.id === scopedId));

  let results = $derived(rankSearch(index, query, RESULT_CAP));

  // Clamp the selection cursor whenever the result set shrinks.
  $effect(() => {
    if (selectedIndex >= results.length) selectedIndex = 0;
  });

  onMount(async () => {
    await tick();
    inputEl?.focus();
  });

  function navigateTo(r: Result) {
    const cfg = get(config);
    const seg = get(page).params?.dashboard;
    const here = cfg && seg ? resolveDashboardRoute(seg, cfg) : undefined;
    if (here?.id !== r.dashboardId) {
      goto(dashboardHref(r.dashboardPath)).catch((e) => {
        revealRequest.set(null);
        toast.error(`Couldn't open "${r.dashboardName}": ${e instanceof Error ? e.message : 'navigation failed'}`);
      });
    }
  }

  // "Show it": the Dashboard switches to the tile's tab, opens the folders on its path in place
  // (outermost first), drills down, flips to its page, scrolls to it and highlights it. A folder
  // result opens that folder. Navigate first when it lives on another dashboard. `activate` also
  // clicks the tile once shown (for tiles whose open mode needs the tile's own dialog).
  function showResult(r: Result, activate = false) {
    requestReveal({
      dashboardId: r.dashboardId,
      tabId: r.tabId,
      folderIds: r.folderIds,
      tileId: r.id,
      kind: r.kind,
      activate: activate && r.kind === 'tile'
    });
    navigateTo(r);
    onClose();
  }

  // Enter: open the tile exactly as a click would (plain URL for now; same modes as Entry). A folder,
  // a note, or a tile that opens in a dialog is shown (and, for the dialog kinds, clicked there).
  function openResult(r: Result) {
    const e = r.entry;
    if (r.kind !== 'tile' || !e || e.type === 'note') return showResult(r);
    if (isSshUrl(e.url)) {
      if (isValidUrl(e.url)) openSshInPlace(e.url);
      onClose();
      return;
    }
    if (e.openMode === 'iframe' || e.openMode === 'popup') return showResult(r, true);
    safeOpenUrl(e.url, e.openMode === 'sametab' ? '_self' : '_blank');
    onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length > 0) selectedIndex = (selectedIndex + 1) % results.length;
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0) selectedIndex = (selectedIndex - 1 + results.length) % results.length;
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[selectedIndex];
      if (r) (e.shiftKey ? showResult(r) : openResult(r));
      return;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  use:portal
  class="search-backdrop"
  onclick={onClose}
  onkeydown={handleKeydown}
>
  <div
    class="search-panel"
    role="dialog"
    aria-modal="true"
    aria-label="Global search"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <div class="search-input-row">
      <Icon icon="mdi:magnify" width="20" />
      <input
        bind:this={inputEl}
        bind:value={query}
        type="text"
        placeholder={scoped ? 'Search this dashboard' : 'Search all dashboards'}
        aria-label={scoped ? 'Search tiles on this dashboard by name, URL, or description' : 'Search tiles on all dashboards by name, URL, or description'}
        onkeydown={handleKeydown}
      />
      <kbd>Esc</kbd>
    </div>

    {#if layoutMissing}
      <div class="search-no-results" role="alert">Search unavailable: the dashboard layout hasn't loaded — reload the page.</div>
    {:else if !query.trim()}
      <div class="search-empty-hint">
        Start typing to search {scoped ? 'this dashboard' : 'across all dashboards'}. <kbd>↑</kbd><kbd>↓</kbd> to navigate, <kbd>Enter</kbd> to open, <kbd>Shift</kbd>+<kbd>Enter</kbd> (or Shift/Ctrl-click) to show where it lives.
      </div>
    {:else if results.length === 0}
      <div class="search-no-results">No tiles or folders match <code>{query}</code></div>
    {:else}
      <ul class="search-results">
        {#each results as r, i (r.dashboardId + '·' + r.tabId + '·' + r.kind + '·' + r.id)}
          <li class:selected={i === selectedIndex}>
            <button type="button" onclick={(ev) => (ev.shiftKey || ev.ctrlKey || ev.metaKey ? showResult(r) : openResult(r))} onmouseenter={() => selectedIndex = i}>
              <div class="result-icon">
                {#if r.kind === 'folder'}
                  <Icon icon="mdi:folder-outline" width="20" />
                {:else if r.entry?.type === 'note'}
                  <Icon icon="mdi:note-text-outline" width="20" />
                {:else}
                  <Icon icon="mdi:application-outline" width="20" />
                {/if}
              </div>
              <div class="result-text">
                <div class="result-name">{r.name}</div>
                <div class="result-meta">
                  {#if !scoped}{r.dashboardName} › {/if}<span class="result-path">{r.path}</span>
                  {#if r.entry && r.entry.type !== 'note' && r.entry.url}
                    <span class="result-url">— {r.entry.url}</span>
                  {/if}
                </div>
              </div>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .search-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 6rem 1rem 1rem;
    z-index: var(--z-modal-overlay, 1100);
  }

  .search-panel {
    width: 100%;
    max-width: 640px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .search-input-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--border);
    color: var(--text-secondary);
  }

  .search-input-row input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: 1.05rem;
  }

  kbd {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.78rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    padding: 0.1rem 0.4rem;
    color: var(--text-secondary);
  }

  .search-empty-hint,
  .search-no-results {
    padding: 1.25rem 1.1rem;
    color: var(--text-secondary);
    font-size: 0.92rem;
  }
  .search-no-results code {
    color: var(--text-primary);
  }

  .search-results {
    list-style: none;
    margin: 0;
    padding: 0.35rem 0;
    max-height: 60vh;
    overflow-y: auto;
  }

  .search-results li {
    margin: 0;
  }

  .search-results li button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.55rem 1rem;
    background: transparent;
    border: none;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
  }

  .search-results li.selected button {
    background: var(--bg-tertiary);
  }

  .result-icon {
    color: var(--accent-text);
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .result-text {
    flex: 1;
    min-width: 0;
  }

  .result-name {
    font-weight: 600;
    font-size: 0.95rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-meta {
    color: var(--text-secondary);
    font-size: 0.82rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-url {
    opacity: 0.75;
  }
</style>
