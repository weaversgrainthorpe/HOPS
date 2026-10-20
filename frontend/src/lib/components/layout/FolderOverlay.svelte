<script lang="ts">
  import Icon from '@iconify/svelte';
  import type { FolderNode, LayoutDashboard, LayoutTab } from '$lib/types/layout';
  import type { CanvasPlan } from '$lib/layout/geometry';
  import { overlayBodyPx, overlayMetrics, resolveMode } from '$lib/layout/geometry';
  import { layoutStale } from '$lib/stores/config';
  import { focusTrap } from '$lib/utils/focusTrap';
  import { overlayStack, closeTop, closeTo } from '$lib/stores/folderOverlay';
  import { portal, inertUnless, restoreFocus } from '$lib/utils/overlayActions';
  import { findFolderChain } from '$lib/stores/folderView';
  import ContainerView from './ContainerView.svelte';

  interface Props {
    dashboard: LayoutDashboard;
    tab: LayoutTab;
    plan: CanvasPlan;
  }
  let { dashboard, tab, plan }: Props = $props();
  // Widest content box the viewport allows (minus the measured page scrollbar,
  // backdrop padding and panel chrome); measured on mount and resize only.
  let bodyPx = $state(overlayBodyPx(1280, 0));
  function measureViewport() {
    bodyPx = overlayBodyPx(window.innerWidth, document.documentElement.clientWidth);
  }
  $effect(() => measureViewport());
  const px = (v: number) => `${Math.round(v * 100) / 100}px`;

  /** Content sizing for one panel (Ruling 23): cells keep the dashboard's size, capped by the viewport. */
  function sizing(chain: FolderNode[]) {
    return overlayMetrics(plan, tab, resolveMode(dashboard, tab, chain), chain[chain.length - 1], bodyPx);
  }

  // Each open id resolved to its folder (and enclosing chain) from the live tab,
  // so a reload shows fresh content. Ids not in this tab render nothing; the
  // reconcile step in TabCanvas drops them from the stack with a notice.
  const panels = $derived(
    $overlayStack.flatMap((id, i) => {
      const chain = findFolderChain(tab.root, id);
      return chain ? [{ id, depth: i + 1, chain }] : [];
    })
  );

  // Escape closes the top overlay wherever focus is, unless a tile modal is open
  // above it (that modal handles its own Escape).
  function onWindowKey(e: KeyboardEvent) {
    // Another handler (a menu, a picker, the editor) already dealt with this Escape.
    if (e.key !== 'Escape' || e.defaultPrevented || panels.length === 0) return;
    if (document.querySelector('[role="dialog"][aria-modal="true"]:not(.overlay-panel)')) return;
    e.preventDefault(); // handled: a maximised panel below must not also close on this Escape
    closeTop();
  }
</script>

<svelte:window onkeydown={onWindowKey} onresize={measureViewport} />

<div class="overlay-host" use:portal>
{#each panels as p, i (p.id)}
  {@const folder = p.chain[p.chain.length - 1]}
  {@const isTop = i === panels.length - 1}
  {@const size = sizing(p.chain)}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="overlay-backdrop"
    style:z-index="calc(var(--z-folder-overlay) + {p.depth})"
    onclick={(e) => {
      if (e.target === e.currentTarget && isTop) closeTop();
    }}
  >
    <div
      class="overlay-panel"
      role="dialog"
      aria-modal="true"
      aria-label={folder.name}
      tabindex="-1"
      style:width={px(size.panelWidthPx)}
      style:max-width="100%"
      use:inertUnless={isTop}
      use:restoreFocus
      use:focusTrap={{ initialFocus: '.close-btn' }}
    >
      <header class="overlay-header">
        <nav aria-label="Folder path" class="crumbs">
          <button type="button" class="crumb" data-crumb="" onclick={() => closeTo(0)}>{tab.name}</button>
          {#each p.chain as c, ci (c.id)}
            <span class="sep" aria-hidden="true">›</span>
            {#if ci === p.chain.length - 1}
              <span class="crumb current" aria-current="page">{c.name}</span>
            {:else}
              <button
                type="button"
                class="crumb"
                data-crumb={c.id}
                onclick={() => {
                  const idx = $overlayStack.indexOf(c.id);
                  if (idx >= 0) closeTo(idx + 1);
                }}>{c.name}</button
              >
            {/if}
          {/each}
        </nav>
        <button type="button" class="close-btn" aria-label="Close folder" title="Close (Esc)" onclick={closeTop}>
          <Icon icon="mdi:close" width="24" />
        </button>
      </header>
      <div class="overlay-body">
        <div class="overlay-content" style:width={px(size.metrics.innerWidthPx)}>
          {#if $layoutStale}
            <!-- The held tree is older than the server's: never show it as current. -->
            <div role="status" class="refreshing">Refreshing layout…</div>
          {:else}
            <ContainerView
              container={{ columns: size.metrics.columns, children: folder.content?.children }}
              metrics={size.metrics}
              {plan}
              {dashboard}
              {tab}
              folderChain={p.chain}
            />
          {/if}
        </div>
      </div>
    </div>
  </div>
{/each}
</div>

<style>
  .overlay-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .overlay-panel {
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    box-shadow: 0 10px 40px var(--shadow);
    /* Width is set inline: content (columns × cell) + chrome, capped at the viewport. */
    min-width: min(320px, 100%);
    box-sizing: border-box;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
  }
  .overlay-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  .crumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }
  .crumb {
    background: none;
    border: none;
    color: var(--text-secondary);
    font: inherit;
    cursor: pointer;
    padding: 0.1rem 0.25rem;
  }
  .crumb:hover {
    text-decoration: underline;
  }
  .crumb.current {
    color: var(--text-primary);
    font-weight: 600;
    cursor: default;
  }
  .sep {
    color: var(--text-secondary);
  }
  .close-btn {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
  }
  .overlay-body {
    padding: 1rem;
    overflow-y: auto;
    overflow-x: auto;
  }
  .refreshing {
    padding: 1rem;
    color: var(--text-secondary);
  }
  .overlay-content {
    margin: 0 auto;
    max-width: 100%;
  }
</style>
