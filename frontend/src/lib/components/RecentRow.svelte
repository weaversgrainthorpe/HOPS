<script lang="ts">
  // "Recently used": this browser's most-used tiles on this dashboard, above the tabs (it spans
  // every tab, so it never belongs to one). Kept only in this browser (recentTiles.ts). A slim
  // single-line strip of chips (icon, name, status) about as tall as the tab bar (48px: the
  // chips are 40px, the phone tap target). Each chip is the ordinary tile's Entry in chip form, so
  // Home/Away, open mode and the recorder are the grid's own. A tile that no longer exists is left
  // out; empty, the row hides. While editing it stays at the same size and place (so nothing
  // below jumps) but dimmed and inert (no clicks, no tab stops, no drag or selection); it is never
  // part of the layout.
  import Icon from '@iconify/svelte';
  import Entry from './Entry.svelte';
  import type { Entry as EntryT } from '$lib/types';
  import type { LayoutDashboard } from '$lib/types/layout';
  import { liveTiles, loadRecent, rankRecent, recentVersion, clearRecent, setRecentOn } from '$lib/utils/recentTiles';

  let { dashboard, editing = false }: { dashboard: LayoutDashboard; editing?: boolean } = $props();

  // Re-ranked only when the history or the dashboard changes, never on an unrelated render.
  const shown = $derived.by(() => {
    void $recentVersion;
    const live = liveTiles(dashboard);
    return rankRecent(loadRecent(dashboard.id), Date.now(), (id) => live.has(id)).map(
      (id) => live.get(id) as unknown as EntryT
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
  <section
    class="recent-row"
    class:editing
    aria-label="Recently used"
    data-recent-row
    data-recent-editing={editing ? '' : undefined}
    inert={editing}
    title={editing ? 'Recently used — not part of the layout' : undefined}
  >
    <h2 class="recent-title">Recently used</h2>
    <ul class="recent-tiles">
      {#each shown as tile (tile.id)}
        <li class="recent-cell" data-recent-id={tile.id}>
          <Entry entry={tile} chip />
        </li>
      {/each}
    </ul>
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
      {#if menuOpen && !editing}
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
    {#if editing}
      <span class="recent-note" data-recent-note>Recently used — not part of the layout</span>
    {/if}
  </section>
{/if}

<style>
  /* One line, 48px (the tab bar's height): 40px chips (the phone tap target) + 3px padding + 1px
     border. Same box in view and edit mode, so entering edit mode moves nothing. */
  .recent-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    box-sizing: border-box;
    height: 48px;
    margin: 0.5rem 2rem 0;
    padding: 0 0.5rem 0 0.75rem;
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--bg-primary) 70%, transparent);
    border: 1px solid var(--border);
    min-width: 0;
  }
  .recent-row.editing {
    opacity: 0.45;
    pointer-events: none;
    user-select: none;
  }
  .recent-title {
    flex: 0 0 auto;
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .recent-note {
    position: absolute;
    right: 3rem;
    top: 50%;
    transform: translateY(-50%);
    padding: 0.125rem 0.5rem;
    border-radius: 0.375rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-size: 0.75rem;
    white-space: nowrap;
    pointer-events: none;
  }
  .recent-menu-wrap {
    position: relative;
    flex: 0 0 auto;
  }
  .recent-menu-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
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
    min-height: 40px;
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
  /* The chips scroll sideways inside the strip (never wrap, never widen the page). */
  .recent-tiles {
    flex: 1 1 0;
    min-width: 0;
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0.4rem;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .recent-tiles::-webkit-scrollbar {
    display: none;
  }
  .recent-cell {
    flex: 0 0 auto;
    min-width: 0;
  }
  @media (max-width: 768px) {
    .recent-row {
      margin: 0.5rem 1rem 0;
    }
  }
</style>
