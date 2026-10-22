<script lang="ts">
  import Icon from '@iconify/svelte';
  import type { LayoutDashboard, LayoutTab } from '$lib/types/layout';
  import type { CanvasPlan } from '$lib/layout/geometry';
  import { overlayBodyPx, overlayMetrics } from '$lib/layout/geometry';
  import { layoutStale } from '$lib/stores/config';
  import { tick } from 'svelte';
  import { overlayStack } from '$lib/stores/folderOverlay';
  import { clearFolderView, findFolderChain, setFolderView } from '$lib/stores/folderView';
  import { focusTrap } from '$lib/utils/focusTrap';
  import { portal, inertUnless, restoreFocus, focusFolderControl } from '$lib/utils/overlayActions';
  import ContainerView from './ContainerView.svelte';
  import FolderSurface from '../background/FolderSurface.svelte';

  interface Props {
    dashboard: LayoutDashboard;
    tab: LayoutTab;
    plan: CanvasPlan;
    folderId: string;
  }
  let { dashboard, tab, plan, folderId }: Props = $props();

  // The usable area starts below the top bar and the tab bar (their measured bottom edge);
  // measured on mount and resize only. Width: same viewport rule as the folder overlay.
  let topPx = $state(0);
  let bodyPx = $state(overlayBodyPx(1280, 0));
  // Top bar and the dashboard's own tab bar (a dedicated attribute, so no other `.tabs` counts).
  function barElements(): Element[] {
    return [document.querySelector('nav.navbar'), document.querySelector('[data-dashboard-tabs]')].filter(
      (e): e is Element => e !== null
    );
  }
  function measure() {
    let t = 0;
    for (const el of barElements()) {
      const b = el.getBoundingClientRect().bottom;
      if (typeof b === 'number' && Number.isFinite(b)) t = Math.max(t, b);
    }
    topPx = Math.round(t);
    bodyPx = overlayBodyPx(window.innerWidth, document.documentElement.clientWidth);
  }
  $effect(() => {
    measure();
    // Re-measure when either bar changes size (one observer on those two elements).
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    for (const el of barElements()) ro.observe(el);
    return () => ro.disconnect();
  });

  const chain = $derived(findFolderChain(tab.root, folderId));
  const folder = $derived(chain ? chain[chain.length - 1] : null);
  const size = $derived(chain && folder ? overlayMetrics(plan, folder, bodyPx) : null);

  const restore = () => clearFolderView(dashboard.id, folderId);
  async function minimise() {
    setFolderView(dashboard.id, folderId, 'collapsed');
    await tick();
    focusFolderControl(folderId);
  }

  function onWindowKey(e: KeyboardEvent) {
    // A folder overlay opened from here (or any other handler) takes this Escape first.
    if (e.key !== 'Escape' || e.defaultPrevented || $overlayStack.length > 0) return;
    if (document.querySelector('[role="dialog"][aria-modal="true"]:not(.overlay-panel)')) return;
    e.preventDefault();
    restore();
  }
</script>

<svelte:window onkeydown={onWindowKey} onresize={measure} />

{#if folder && size}
  <div class="max-host" use:portal style:top="{topPx}px" style:z-index="calc(var(--z-folder-overlay) - 1)">
    <!-- overlay-panel: lets the folder overlay's Escape rule recognise this as a folder panel -->
    <div
      class="max-panel overlay-panel"
      role="dialog"
      aria-modal="true"
      aria-label="{folder.name} (maximised)"
      tabindex="-1"
      use:inertUnless={$overlayStack.length === 0}
      use:restoreFocus
      use:focusTrap={{ initialFocus: '.restore-btn' }}
    >
      <!-- The folder's own background (at its opacity) over the host backdrop; the panel colour otherwise. -->
      <FolderSurface
        background={folder.background}
        color="var(--bg-primary)"
        mode="animated"
        dashboardId={dashboard.id}
      />
      <header class="max-header">
        <h2>{folder.name}</h2>
        <span class="max-actions">
        <button type="button" class="hdr-btn" aria-label="Minimise folder" title="Minimise folder" onclick={minimise}>
          <Icon icon="mdi:window-minimize" width="24" />
        </button>
        <button type="button" class="restore-btn" aria-label="Restore folder" title="Restore (Esc)" onclick={restore}>
          <Icon icon="mdi:restore" width="24" />
        </button>
        </span>
      </header>
      <div class="max-body" data-drag-scroll>
        <div class="max-content" style:width="{Math.round(size.metrics.innerWidthPx * 100) / 100}px">
          {#if $layoutStale}
            <div role="status" class="refreshing">Refreshing layout…</div>
          {:else}
            <ContainerView
              container={{ columns: size.metrics.columns, children: folder.content?.children }}
              metrics={size.metrics}
              {plan}
              {dashboard}
              {tab}
              folderChain={chain ?? []}
            />
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .max-host {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 1rem;
    /* Dimmed, translucent backdrop over the live dashboard (Ruling 10.1); the
       panel's surface draws the folder background or the panel colour. */
    background: var(--folder-backdrop, rgba(0, 0, 0, 0.6));
    box-sizing: border-box;
  }
  .max-panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    /* The surface (FolderSurface) draws the panel colour or the folder's background. */
    position: relative;
    isolation: isolate;
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
  }
  .max-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    margin: 0;
    font-size: 1.25rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .max-actions {
    display: inline-flex;
    gap: 0.5rem;
  }
  .hdr-btn,
  .restore-btn {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
  }
  .max-body {
    padding: 1rem;
    /* Room above a row-0 folder for its corner tab (controls / failure badge), M4 call 6. */
    padding-top: 2rem;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .max-content {
    margin: 0 auto;
    max-width: 100%;
  }
  .refreshing {
    padding: 1rem;
    color: var(--text-secondary);
  }
</style>
