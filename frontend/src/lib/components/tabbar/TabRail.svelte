<script lang="ts" module>
  import { revealScrollLeft } from './tabRail';

  /**
   * Scroll the strip so a tab is in view (keyboard moves, a newly open tab). Only scrolls: it never
   * selects anything. Smooth only when asked (the Animations setting and reduced motion decide).
   */
  export function revealTab(strip: HTMLElement, tabId: string, smooth: boolean): void {
    const tab = strip.querySelector<HTMLElement>(`[data-tab-button="${CSS.escape(tabId)}"]`);
    if (!tab) return;
    // Position inside the strip's content, summed up the offset chain (the strip is positioned).
    let left = 0;
    for (let el: HTMLElement | null = tab; el && el !== strip; el = el.offsetParent as HTMLElement | null) {
      left += el.offsetLeft;
    }
    const to = revealScrollLeft(
      { left, width: tab.offsetWidth },
      { scrollLeft: strip.scrollLeft, clientWidth: strip.clientWidth, scrollWidth: strip.scrollWidth }
    );
    // (jsdom has no element scrolling; real browsers always do.)
    if (to !== null && typeof strip.scrollTo === 'function') strip.scrollTo({ left: to, behavior: smooth ? 'smooth' : 'auto' });
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount, untrack } from 'svelte';
  import { railState, pageStep, wheelDelta } from './tabRail';

  let { activeTabId, animate, children }: { activeTabId: string | null; animate: boolean; children: Snippet } = $props();

  let railEl = $state<HTMLElement>();
  let strip = $state<HTMLElement>();
  let overflow = $state(false);
  let atStart = $state(true);
  let atEnd = $state(true);

  const behavior = (): ScrollBehavior => (animate ? 'smooth' : 'auto');
  const metrics = (s: HTMLElement) => ({ scrollLeft: s.scrollLeft, clientWidth: s.clientWidth, scrollWidth: s.scrollWidth });

  function update() {
    if (!strip) return;
    const st = railState(metrics(strip));
    overflow = st.overflow;
    atStart = st.atStart;
    atEnd = st.atEnd;
  }

  // The rail's job: the child tablist becomes the scroller; arrows appear only when it overflows.
  onMount(() => {
    const s = railEl?.querySelector<HTMLElement>('[role="tablist"]');
    if (!s) return;
    strip = s;

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    const watch = () => {
      if (!ro) return;
      ro.disconnect();
      ro.observe(s);
      if (s.firstElementChild) ro.observe(s.firstElementChild);
      if (s.lastElementChild) ro.observe(s.lastElementChild);
    };
    // Tabs added, removed or reordered change the content width without resizing the strip.
    const mo = new MutationObserver(() => {
      watch();
      update();
    });
    mo.observe(s, { childList: true });
    watch();
    update();

    const onWheel = (e: WheelEvent) => {
      const d = wheelDelta(e.deltaX, e.deltaY, metrics(s));
      if (d === 0) return;
      e.preventDefault();
      s.scrollBy({ left: d });
    };
    s.addEventListener('wheel', onWheel, { passive: false });
    s.addEventListener('scroll', update, { passive: true });
    return () => {
      ro?.disconnect();
      mo.disconnect();
      s.removeEventListener('wheel', onWheel);
      s.removeEventListener('scroll', update);
    };
  });

  // The open tab is always shown: scroll (never select) when it changes, and on first mount.
  $effect(() => {
    const id = activeTabId;
    const s = strip;
    if (!s || !id) return;
    untrack(() => {
      revealTab(s, id, animate);
      update();
    });
  });

  function go(kind: 'first' | 'prev' | 'next' | 'last') {
    if (!strip) return;
    const b = behavior();
    if (kind === 'first') strip.scrollTo({ left: 0, behavior: b });
    else if (kind === 'last') strip.scrollTo({ left: strip.scrollWidth - strip.clientWidth, behavior: b });
    else strip.scrollBy({ left: (kind === 'next' ? 1 : -1) * pageStep(strip.clientWidth), behavior: b });
    update();
  }
</script>

<div class="tab-rail" data-drag-tabrail bind:this={railEl}>
  {#if overflow}
    <button type="button" class="rail-arrow" data-rail-arrow="first" aria-label="Scroll to the first tab" title="Scroll to the first tab" disabled={atStart} onclick={() => go('first')}>«</button>
    <button type="button" class="rail-arrow" data-rail-arrow="prev" aria-label="Scroll tabs left" title="Scroll tabs left" disabled={atStart} onclick={() => go('prev')}>‹</button>
  {/if}
  {@render children()}
  {#if overflow}
    <button type="button" class="rail-arrow" data-rail-arrow="next" aria-label="Scroll tabs right" title="Scroll tabs right" disabled={atEnd} onclick={() => go('next')}>›</button>
    <button type="button" class="rail-arrow" data-rail-arrow="last" aria-label="Scroll to the last tab" title="Scroll to the last tab" disabled={atEnd} onclick={() => go('last')}>»</button>
  {/if}
</div>

<style>
  .tab-rail {
    display: flex;
    align-items: flex-end;
    gap: 0.25rem;
    min-width: 0;
  }

  /* The tablist is the scroller: one row, no scrollbar. The top padding keeps the open tab's accent
     line from being clipped (overflow-x makes overflow-y clip too); the negative margin cancels it. */
  .tab-rail :global(.tabs) {
    flex: 1;
    min-width: 0;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    padding-top: 4px;
    margin-top: -4px;
    overscroll-behavior-x: contain;
  }
  .tab-rail :global(.tabs)::-webkit-scrollbar {
    display: none;
  }

  .rail-arrow {
    flex: 0 0 auto;
    width: 34px;
    height: 36px;
    margin-bottom: 4px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
  }
  .rail-arrow:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .rail-arrow:disabled {
    opacity: 0.3;
    cursor: default;
  }
  @media (pointer: coarse) {
    .rail-arrow {
      width: 40px;
      min-width: 40px;
    }
  }
</style>
