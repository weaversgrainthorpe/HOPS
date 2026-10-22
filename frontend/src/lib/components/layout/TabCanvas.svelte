<script lang="ts">
  import { onDestroy, setContext, untrack } from 'svelte';
  import type { Container, FolderNode, LayoutDashboard, LayoutDoc, LayoutTab } from '$lib/types/layout';
  import { containerMetrics, planCanvas, rootBoxWidthPx } from '$lib/layout/geometry';
  import { layoutDoc, layoutStale } from '$lib/stores/config';
  import { closeAll, overlayStack, reconcile } from '$lib/stores/folderOverlay';
  import { toast } from '$lib/stores/toast';
  import { editMode } from '$lib/stores/editMode';
  import { canvasStacked } from '$lib/editor/editorUi';
  import {
    FOLDER_VIEW_CONTEXT, applyFolderViews, findFolderChain, folderViewFor, type FolderViewContext
  } from '$lib/stores/folderView';
  import FolderOverlay from './FolderOverlay.svelte';
  import MaximisedFolder from './MaximisedFolder.svelte';
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

  // Leaving the canvas (e.g. browser Back with an overlay open) closes every overlay:
  // the stack is global, and a stale entry would block arrow-key navigation.
  onDestroy(() => closeAll());

  // Switching tab closes every open folder overlay. Keyed on the id (a derived
  // only notifies on a changed value), so a reload that hands a fresh tab
  // object for the SAME tab keeps the overlays open.
  const tabId = $derived(tab.id);
  $effect(() => {
    void tabId;
    untrack(() => closeAll());
  });

  // A config reload may remove a folder the user has open: close it and say so.
  // In edit mode the tree is the session draft: an undo or delete there can remove an open folder.
  $effect(() => {
    const doc: LayoutDoc | null = editing ? { schemaVersion: 3, dashboards: [dashboard] } : $layoutDoc;
    // A transient reload gap (no layout held) must not close overlays or toast.
    if (!doc) return;
    untrack(() => {
      const dropped = reconcile(doc, dashboard.id, tab.id);
      if (dropped.length > 0) {
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
  // At most one maximised folder; one whose folder is not in this tab shows nothing (ignored silently).
  const maximisedId = $derived(
    Object.keys(remembered).find((id) => remembered[id] === 'maximised' && findFolderChain(viewTab.root, id)) ?? null
  );
  $effect(() => {
    el?.toggleAttribute('inert', $overlayStack.length > 0 || maximisedId !== null);
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
<!-- Outside the conditional above and portalled to <body>: survives stale flips. -->
<FolderOverlay {dashboard} tab={viewTab} {plan} {editing} />
{#if maximisedId && !$layoutStale}
  <MaximisedFolder {dashboard} tab={viewTab} {plan} folderId={maximisedId} />
{/if}

<style>
  .tab-canvas {
    width: 100%;
  }
.refreshing {
    padding: 1rem;
    color: var(--text-secondary);
  }
</style>
