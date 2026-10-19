<script lang="ts">
  import Icon from '@iconify/svelte';
  import type { Container, FolderNode, LayoutDashboard, LayoutTab } from '$lib/types/layout';
  import type { CanvasPlan } from '$lib/layout/geometry';
  import { resolveMode } from '$lib/layout/geometry';
  import { focusTrap } from '$lib/utils/focusTrap';
  import { overlayStack, closeTop, closeTo } from '$lib/stores/folderOverlay';
  import { tick } from 'svelte';
  import ContainerView from './ContainerView.svelte';

  interface Props {
    dashboard: LayoutDashboard;
    tab: LayoutTab;
    plan: CanvasPlan;
  }
  let { dashboard, tab, plan }: Props = $props();

  /** Outermost-first chain of folders ending at `id`, or null when not in this tab. */
  function findChain(c: Container | undefined, id: string): FolderNode[] | null {
    const kids = Array.isArray(c?.children) ? c!.children : [];
    for (const n of kids) {
      if (!n || (n as { kind?: unknown }).kind !== 'folder') continue;
      const f = n as FolderNode;
      if (f.id === id) return [f];
      const inner = findChain(f.content, id);
      if (inner) return [f, ...inner];
    }
    return null;
  }

  // Each open id resolved to its folder (and enclosing chain) from the live tab,
  // so a reload shows fresh content. Ids not in this tab render nothing; the
  // reconcile step in TabCanvas drops them from the stack with a notice.
  const panels = $derived(
    $overlayStack.flatMap((id, i) => {
      const chain = findChain(tab.root, id);
      return chain ? [{ id, depth: i + 1, chain }] : [];
    })
  );

  /** Move the node to <body> so no transformed/filtered ancestor can trap position:fixed. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  function inertUnless(node: HTMLElement, active: boolean) {
    node.toggleAttribute('inert', !active);
    return { update: (a: boolean) => node.toggleAttribute('inert', !a) };
  }

  /** Re-focus the opener after the DOM (and inert state) settle, if focus was lost. */
  function restoreFocus(node: HTMLElement) {
    const prev = document.activeElement as HTMLElement | null;
    return {
      destroy() {
        tick().then(() => {
          const a = document.activeElement;
          if (prev && prev.isConnected && (!a || a === document.body)) prev.focus();
        });
      }
    };
  }

  // Escape closes the top overlay wherever focus is, unless a tile modal is open
  // above it (that modal handles its own Escape).
  function onWindowKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || panels.length === 0) return;
    if (document.querySelector('[role="dialog"][aria-modal="true"]:not(.overlay-panel)')) return;
    closeTop();
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="overlay-host" use:portal>
{#each panels as p, i (p.id)}
  {@const folder = p.chain[p.chain.length - 1]}
  {@const isTop = i === panels.length - 1}
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
      use:inertUnless={isTop}
      use:restoreFocus
      use:focusTrap
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
        <ContainerView
          container={folder.content}
          mode={resolveMode(dashboard, tab, p.chain)}
          {plan}
          {dashboard}
          {tab}
          folderChain={p.chain}
        />
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
    width: 100%;
    max-width: 1100px;
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
    overflow: auto;
  }
</style>
