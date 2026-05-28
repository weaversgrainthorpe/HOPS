<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import { config } from '$lib/stores/config';
  import { safeOpenUrl } from '$lib/utils/url';
  import { portal } from '$lib/utils/portal';
  import type { Entry, Config } from '$lib/types';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  // Flatten the config into one list-per-tile, with the breadcrumb of where
  // the tile lives. Built once on open (config doesn't mutate while the
  // modal is open in any meaningful way), filtered on every keystroke.
  type Result = {
    entry: Entry;
    dashboardPath: string;
    dashboardName: string;
    tabName: string;
    groupName: string;
  };

  function buildIndex(cfg: Config | null): Result[] {
    if (!cfg) return [];
    const out: Result[] = [];
    for (const d of cfg.dashboards ?? []) {
      for (const t of d.tabs ?? []) {
        for (const g of t.groups ?? []) {
          for (const e of g.entries ?? []) {
            out.push({
              entry: e,
              dashboardPath: d.path,
              dashboardName: d.name,
              tabName: t.name,
              groupName: g.name,
            });
          }
        }
      }
    }
    return out;
  }

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();

  const index = buildIndex($config);

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

  function openResult(r: Result) {
    if (r.entry.type === 'note') {
      // Notes have no URL — jump to the dashboard where the note lives.
      goto(r.dashboardPath);
    } else {
      safeOpenUrl(r.entry.url, '_blank');
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
        placeholder="Search tiles by name, URL, or description…"
        aria-label="Search tiles by name, URL, or description"
        onkeydown={handleKeydown}
      />
      <kbd>Esc</kbd>
    </div>

    {#if !query.trim()}
      <div class="search-empty-hint">
        Start typing to search across all dashboards. <kbd>↑</kbd><kbd>↓</kbd> to navigate, <kbd>Enter</kbd> to open.
      </div>
    {:else if results.length === 0}
      <div class="search-no-results">No tiles match <code>{query}</code></div>
    {:else}
      <ul class="search-results">
        {#each results as r, i (r.dashboardPath + '·' + r.entry.id)}
          <li class:selected={i === selectedIndex}>
            <button type="button" onclick={() => openResult(r)} onmouseenter={() => selectedIndex = i}>
              <div class="result-icon">
                {#if r.entry.type === 'note'}
                  <Icon icon="mdi:note-text-outline" width="20" />
                {:else}
                  <Icon icon="mdi:open-in-new" width="20" />
                {/if}
              </div>
              <div class="result-text">
                <div class="result-name">{r.entry.name}</div>
                <div class="result-meta">
                  {r.dashboardName} · {r.tabName} · {r.groupName}
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
    color: var(--accent);
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
