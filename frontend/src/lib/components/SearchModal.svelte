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
  import type { Entry } from '$lib/types';
  import type { Container, FolderNode, LayoutDoc } from '$lib/types/layout';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  // Every tile at any depth in the layout document (all dashboards,
  // including v3-only ones), with the folder path where it lives. Built once
  // on open, filtered on every keystroke.
  type Result = {
    entry: Entry;
    dashboardId: string;
    dashboardPath: string;
    dashboardName: string;
    tabId: string;
    /** "Tab › Folder › Sub" */
    path: string;
    /** Every folder enclosing the tile, outermost first (the reveal opens them in place). */
    folderIds: string[];
  };

  function walk(c: Container | undefined, chain: FolderNode[], visit: (e: Entry, chain: FolderNode[]) => void) {
    const kids = Array.isArray(c?.children) ? c!.children : [];
    for (const n of kids) {
      if (!n || typeof n !== 'object') continue;
      if (n.kind === 'folder') walk(n.content, [...chain, n], visit);
      else if (n.kind === 'tile' && typeof n.id === 'string') visit(n, chain);
    }
  }

  function buildIndex(doc: LayoutDoc | null, onlyDashboardId?: string): Result[] {
    if (!doc) return [];
    const out: Result[] = [];
    for (const d of doc.dashboards ?? []) {
      if (onlyDashboardId !== undefined && d.id !== onlyDashboardId) continue;
      for (const t of d.tabs ?? []) {
        walk(t.root, [], (e, chain) => {
          out.push({
            entry: e,
            dashboardId: d.id,
            dashboardPath: d.path,
            dashboardName: d.name,
            tabId: t.id,
            path: [t.name, ...chain.map((f) => f.name)].join(' \u203a '),
            folderIds: chain.map((f) => f.id)
          });
        });
      }
    }
    return out;
  }

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();

  // On a dashboard page (resolved by the same route resolver the page uses)
  // search only that dashboard; anywhere else search them all.
  const scopedId = get(currentRoute)?.id;
  const scoped = scopedId !== undefined;
  const index = buildIndex($layoutDoc, scopedId);
  // No layout held, or the current dashboard's layout is absent from it
  // (failed load / stale): say so instead of "no matches".
  const layoutMissing =
    !$layoutDoc || (scoped && !($layoutDoc.dashboards ?? []).some((d) => d.id === scopedId));

  let results = $derived.by<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Result[] = [];
    for (const r of index) {
      const hay = [
        r.entry.name,
        r.entry.url ?? '',
        r.entry.description ?? '',
      ].join(' ').toLowerCase();
      if (hay.includes(q)) out.push(r);
      if (out.length >= 50) break;
    }
    return out;
  });

  // Clamp the selection cursor whenever the result set shrinks.
  $effect(() => {
    if (selectedIndex >= results.length) selectedIndex = 0;
  });

  onMount(async () => {
    await tick();
    inputEl?.focus();
  });

  // Show the tile where it lives: the Dashboard switches to its tab, opens the
  // folders on its path in place (outermost first), drills down, flips to its
  // page and focuses it. Navigate first when it lives on another dashboard.
  function openResult(r: Result) {
    requestReveal({
      dashboardId: r.dashboardId,
      tabId: r.tabId,
      folderIds: r.folderIds,
      tileId: r.entry.id
    });
    const cfg = get(config);
    const seg = get(page).params?.dashboard;
    const here = cfg && seg ? resolveDashboardRoute(seg, cfg) : undefined;
    const hereId = here?.id;
    if (hereId !== r.dashboardId) {
      goto(dashboardHref(r.dashboardPath)).catch((e) => {
        revealRequest.set(null);
        toast.error(`Couldn't open "${r.dashboardName}": ${e instanceof Error ? e.message : 'navigation failed'}`);
      });
    }
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
      if (results[selectedIndex]) openResult(results[selectedIndex]);
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
        Start typing to search {scoped ? 'this dashboard' : 'across all dashboards'}. <kbd>↑</kbd><kbd>↓</kbd> to navigate, <kbd>Enter</kbd> to show the tile.
      </div>
    {:else if results.length === 0}
      <div class="search-no-results">No tiles match <code>{query}</code></div>
    {:else}
      <ul class="search-results">
        {#each results as r, i (r.dashboardId + '·' + r.tabId + '·' + r.entry.id)}
          <li class:selected={i === selectedIndex}>
            <button type="button" onclick={() => openResult(r)} onmouseenter={() => selectedIndex = i}>
              <div class="result-icon">
                {#if r.entry.type === 'note'}
                  <Icon icon="mdi:note-text-outline" width="20" />
                {:else}
                  <Icon icon="mdi:application-outline" width="20" />
                {/if}
              </div>
              <div class="result-text">
                <div class="result-name">{r.entry.name}</div>
                <div class="result-meta">
                  {#if !scoped}{r.dashboardName} › {/if}<span class="result-path">{r.path}</span>
                  {#if r.entry.type !== 'note' && r.entry.url}
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
