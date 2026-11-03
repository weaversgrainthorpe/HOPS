<script lang="ts">
  // The one hover popup for tiles and folders (see $lib/utils/hoverCard): mounted once, in the root
  // layout. Line 1 the name (larger, semibold), line 2 the description (smaller, muted), then any
  // notes. Hidden from screen readers: the item's own label and aria-describedby already say it.
  import { hoverCardState, hideHoverCard, placeCard, setHoverCardSuppressed } from '$lib/utils/hoverCard';
  import { drag } from '$lib/editor/drag/dragController';

  let el = $state<HTMLElement | undefined>();
  let pos = $state<{ left: number; top: number; side: 'below' | 'above' } | null>(null);
  const card = $derived($hoverCardState);

  // An editor drag: no popup for the whole drag (it would sit over the drop targets).
  $effect(() => {
    setHoverCardSuppressed(!!$drag);
  });

  // Measured once drawn (hidden until placed, so it never flashes in the wrong spot).
  $effect(() => {
    const c = card;
    pos = null;
    if (!c || !el) return;
    if (!c.anchor.isConnected) {
      hideHoverCard();
      return;
    }
    const r = el.getBoundingClientRect();
    pos = placeCard(
      c.anchor.getBoundingClientRect(),
      { width: r.width, height: r.height },
      { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight }
    );
  });
</script>

{#if card && !$drag}
  <div
    class="hover-card"
    bind:this={el}
    aria-hidden="true"
    data-testid="hover-card"
    data-side={pos?.side}
    style:left="{pos?.left ?? 0}px"
    style:top="{pos?.top ?? 0}px"
    style:visibility={pos ? 'visible' : 'hidden'}
  >
    <div class="hc-name">{card.content.name}</div>
    {#if card.content.description}
      <div class="hc-desc">{card.content.description}</div>
    {/if}
    {#each card.content.lines ?? [] as line, i (i)}
      <div class="hc-line">{line}</div>
    {/each}
  </div>
{/if}

<style>
  /* Theme tokens only: --text-primary and --text-secondary on --bg-secondary are the pairs every dialog
     uses (>= 4.5:1 in every theme preset). */
  .hover-card {
    position: fixed;
    z-index: var(--z-tooltip);
    max-width: min(22rem, calc(100vw - 16px));
    /* Never taller than the screen: a long description is clamped (below). */
    max-height: calc(100vh - 16px);
    overflow: hidden;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    box-shadow: var(--shadow-modal);
    pointer-events: none;
    text-align: left;
    overflow-wrap: anywhere;
  }
  .hc-name {
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.3;
  }
  .hc-desc {
    margin-top: 0.15rem;
    font-size: 0.875rem;
    line-height: 1.35;
    color: var(--text-secondary);
    white-space: pre-line;
    /* A long description (a note's body) is cut at eight lines, with an ellipsis. */
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 8;
    line-clamp: 8;
    overflow: hidden;
  }
  .hc-line {
    margin-top: 0.25rem;
    font-size: 0.8125rem;
    line-height: 1.3;
    color: var(--text-secondary);
  }
  @media (prefers-reduced-motion: no-preference) {
    .hover-card {
      animation: hc-in 0.12s ease-out;
    }
    @keyframes hc-in {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
  }
</style>
