<script lang="ts">
  import type { LayoutDashboard, LayoutTab } from '$lib/types/layout';
  import { planCanvas, resolveMode } from '$lib/layout/geometry';
  import { layoutStale } from '$lib/stores/config';
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

<style>
  .tab-canvas {
    width: 100%;
  }
.refreshing {
    padding: 1rem;
    color: var(--text-secondary);
  }
</style>
