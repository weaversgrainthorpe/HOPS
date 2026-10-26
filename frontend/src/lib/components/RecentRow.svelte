<script lang="ts">
  // "Recently used": this browser's most-used tiles on this dashboard, above the tabs (it spans
  // every tab, so it never belongs to one). Kept only in this browser (recentTiles.ts). Each is
  // the ordinary tile at Small size, so status dot, Home/Away address and open mode all behave
  // exactly as on the grid. A tile that no longer exists is simply left out; empty, the row hides.
  // View mode only: Dashboard never draws it while editing, and it is never part of the layout.
  import Icon from '@iconify/svelte';
  import Entry from './Entry.svelte';
  import type { Entry as EntryT } from '$lib/types';
  import type { LayoutDashboard } from '$lib/types/layout';
  import { liveTiles, loadRecent, rankRecent, recentVersion, clearRecent, setRecentOn } from '$lib/utils/recentTiles';

  let { dashboard }: { dashboard: LayoutDashboard } = $props();

  // Re-ranked only when the history or the dashboard changes, never on an unrelated render.
  const shown = $derived.by(() => {
    void $recentVersion;
    const live = liveTiles(dashboard);
    return rankRecent(loadRecent(dashboard.id), Date.now(), (id) => live.has(id)).map(
      (id) => ({ ...(live.get(id) as unknown as EntryT), size: 'small' }) as EntryT
    );
  });

  let menuOpen = $state(false);
  let menuBtn = $state<HTMLButtonElement | null>(null);
  let menuEl = $state<HTMLElement | null>(null);

  function closeMenu(refocus = false) {
    menuOpen = false;
    if (refocus) menuBtn?.focus();
  }
  function onMenuKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    }
  }
  function onWindowDown(e: PointerEvent) {
    if (!menuOpen) return;
    const t = e.target as Node | null;
    if (t && (menuEl?.contains(t) || menuBtn?.contains(t))) return;
    closeMenu();
  }
</script>

<svelte:window onpointerdown={onWindowDown} />

{#if shown.length > 0}
  <section class="recent-row" aria-label="Recently used" data-recent-row>
    <div class="recent-head">
      <h2 class="recent-title">Recently used</h2>
      <div class="recent-menu-wrap">
        <button
          type="button"
          class="recent-menu-btn"
          bind:this={menuBtn}
          aria-label="Recently used options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onclick={() => (menuOpen = !menuOpen)}
        >
          <Icon icon="mdi:dots-horizontal" width="20" height="20" />
        </button>
        {#if menuOpen}
          <!-- svelte-ignore a11y_interactive_supports_focus -->
          <div class="recent-menu" role="menu" tabindex="-1" bind:this={menuEl} onkeydown={onMenuKey}>
            <button type="button" role="menuitem" onclick={() => { clearRecent(); closeMenu(); }}>
              <Icon icon="mdi:history" width="18" height="18" /> Clear history
            </button>
            <button type="button" role="menuitem" onclick={() => { setRecentOn(false); closeMenu(); }}>
              <Icon icon="mdi:eye-off-outline" width="18" height="18" /> Hide recently used
            </button>
          </div>
        {/if}
      </div>
    </div>
    <ul class="recent-tiles">
      {#each shown as tile (tile.id)}
        <li class="recent-cell" data-recent-id={tile.id}>
          <Entry entry={tile} fit="fill" />
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .recent-row {
    margin: 0.5rem 2rem 0;
    padding: 0.5rem 0.75rem 0.75rem;
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--bg-primary) 70%, transparent);
    border: 1px solid var(--border);
    min-width: 0;
  }
  .recent-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
  }
  .recent-title {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
    letter-spacing: 0.02em;
  }
  .recent-menu-wrap {
    position: relative;
  }
  .recent-menu-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 0.375rem;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .recent-menu-btn:hover,
  .recent-menu-btn:focus-visible {
    border-color: var(--border);
    color: var(--text-primary);
  }
  .recent-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 0.25rem);
    z-index: 50;
    min-width: 12rem;
    padding: 0.25rem;
    border-radius: 0.5rem;
    border: 1px solid var(--border);
    background: var(--bg-secondary);
    box-shadow: 0 8px 24px var(--shadow);
  }
  .recent-menu button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: none;
    border-radius: 0.375rem;
    background: transparent;
    color: var(--text-primary);
    font-size: 0.875rem;
    text-align: left;
    cursor: pointer;
  }
  .recent-menu button:hover,
  .recent-menu button:focus-visible {
    background: var(--bg-tertiary);
  }
  /* Up to 8 Small tiles in one row; they share the width, never wider than a Small tile. Phones
     show the first 4 (the best ranked), so the row never scrolls sideways. */
  .recent-tiles {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 7.5rem));
    gap: 0.5rem;
  }
  .recent-cell {
    height: 6rem;
    min-width: 0;
  }
  @media (max-width: 768px) {
    .recent-row {
      margin: 0.5rem 1rem 0;
    }
    .recent-tiles {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .recent-cell:nth-child(n + 5) {
      display: none;
    }
    .recent-cell {
      height: 5.25rem;
    }
  }
</style>
