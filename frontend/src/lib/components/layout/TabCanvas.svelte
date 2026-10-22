<script lang="ts">
  import { setContext, untrack } from 'svelte';
  import type { Container, FolderNode, LayoutDashboard, LayoutDoc, LayoutTab } from '$lib/types/layout';
  import { containerMetrics, planCanvas, rootBoxWidthPx } from '$lib/layout/geometry';
  import { layoutDoc, layoutStale } from '$lib/stores/config';
  import { toast } from '$lib/stores/toast';
  import { editMode } from '$lib/stores/editMode';
  import { canvasStacked } from '$lib/editor/editorUi';
  import {
    FOLDER_VIEW_CONTEXT, applyFolderViews, folderViewFor, reconcileNav, type FolderViewContext
  } from '$lib/stores/folderView';
  import ContainerView from './ContainerView.svelte';

  interface Props {
    dashboard: LayoutDashboard;
    tab: LayoutTab;
    /** Edit mode: `dashboard` is the session draft; items are selectable and have a menu. */
    editing?: boolean;
  }
  let { dashboard, tab, editing = false }: Props = $props();

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

  // A config reload (or, in edit mode, an undo or delete in the draft) may remove a sub-folder this
  // browser is drilled into: that folder goes back up to the level that still holds, and says so.
  $effect(() => {
    const doc: LayoutDoc | null = editing ? { schemaVersion: 3, dashboards: [dashboard] } : $layoutDoc;
    const t = tab;
    // A transient reload gap (no layout held) must not close anything or toast.
    if (!doc) return;
    untrack(() => {
      const closed = reconcileNav(dashboard.id, t);
      if (closed.length > 0) {
        toast.info(
          editing
            ? 'A folder you had open is no longer there, so it has been closed'
            : 'A folder you had open was changed elsewhere and has been closed'
        );
      }
    });
  });

  // This viewer's remembered folder views (per browser). Edit mode shows the saved layout.
  const viewStore = $derived(folderViewFor(dashboard.id));
  const remembered = $derived($editMode || editing ? {} : $viewStore);
  // The tab as this viewer sees it; every size below derives from it (one geometry source).
  const viewTab = $derived(applyFolderViews(dashboard, tab, remembered));
  const savedDisplay = $derived.by(() => {
    const m = new Map<string, FolderNode['display']>();
    const walk = (c: Container | undefined) => {
      for (const n of Array.isArray(c?.children) ? c!.children : []) {
        if (n && (n as { kind?: unknown }).kind === 'folder') {
          m.set((n as FolderNode).id, (n as FolderNode).display);
          walk((n as FolderNode).content);
        }
      }
    };
    walk(tab.root);
    return m;
  });
  setContext<FolderViewContext>(FOLDER_VIEW_CONTEXT, {
    get dashboardId() { return dashboard.id; },
    remembered: (id) => remembered[id],
    saved: (id) => savedDisplay.get(id)
  });
  const plan = $derived(planCanvas(width, viewTab));
  // The root's sizes: one source (geometry.containerMetrics), recomputed per width change only.
  const metrics = $derived(containerMetrics(viewTab.root, rootBoxWidthPx(plan, viewTab)));
  // Editing on a phone (stacked plan, once measured): the toolbar says resizing needs more room.
  const stacked = $derived(width > 0 && plan.kind === 'stacked');
  $effect(() => {
    if (!editing) return;
    canvasStacked.set(stacked);
    return () => canvasStacked.set(false);
  });
</script>

<div class="tab-canvas" class:editing bind:this={el} data-tab-id={tab.id}>
  {#if $layoutStale}
    <div role="status" class="refreshing">Refreshing layout…</div>
  {:else if width > 0}
    <ContainerView container={viewTab.root} {metrics} {plan} {dashboard} tab={viewTab} folderChain={[]} {editing} />
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
