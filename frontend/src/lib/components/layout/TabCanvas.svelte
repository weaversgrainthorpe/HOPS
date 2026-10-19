<script lang="ts">
  import { untrack } from 'svelte';
  import type { LayoutDashboard, LayoutTab } from '$lib/types/layout';
  import { planCanvas, resolveMode } from '$lib/layout/geometry';
  import { layoutDoc, layoutStale } from '$lib/stores/config';
  import { closeAll, overlayStack, reconcile } from '$lib/stores/folderOverlay';
  import { toast } from '$lib/stores/toast';
  import FolderOverlay from './FolderOverlay.svelte';
  import ContainerView from './ContainerView.svelte';

  interface Props {
    dashboard: LayoutDashboard;
    tab: LayoutTab;
  }
  let { dashboard, tab }: Props = $props();

  let el = $state<HTMLElement | null>(null);
  let width = $state(0);

  // One ResizeObserver per canvas; geometry is derived once per width change.
  $effect(() => {
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number' && Number.isFinite(w)) width = w;
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Background is inert while any folder overlay is open (attribute set directly).
  $effect(() => {
    el?.toggleAttribute('inert', $overlayStack.length > 0);
  });

  // Switching tab closes every open folder overlay.
  $effect(() => {
    void tab.id;
    untrack(() => closeAll());
  });

  // A config reload may remove a folder the user has open: close it and say so.
  $effect(() => {
    const doc = $layoutDoc;
    // A transient reload gap (no layout held) must not close overlays or toast.
    if (!doc) return;
    untrack(() => {
      const dropped = reconcile(doc, dashboard.id, tab.id);
      if (dropped.length > 0) toast.info('A folder you had open was changed elsewhere and has been closed');
    });
  });

  const mode = $derived(resolveMode(dashboard, tab, []));
  const plan = $derived(planCanvas(mode, width, tab));
</script>

<div class="tab-canvas" bind:this={el} data-tab-id={tab.id}>
  {#if $layoutStale}
    <div role="status" class="refreshing">Refreshing layout…</div>
  {:else if width > 0}
    <ContainerView container={tab.root} {mode} {plan} {dashboard} {tab} folderChain={[]} />
  {/if}
</div>
<!-- Outside the conditional above and portalled to <body>: survives stale flips. -->
<FolderOverlay {dashboard} {tab} {plan} />

<style>
  .tab-canvas {
    width: 100%;
  }
.refreshing {
    padding: 1rem;
    color: var(--text-secondary);
  }
</style>
