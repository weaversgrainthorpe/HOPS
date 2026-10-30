<script lang="ts">
  /**
   * Resize handles for one node in the editing renderer: the right edge, the bottom edge
   * and the bottom-right corner of its RENDERED box. Dragging one is a drag of the
   * drag engine (dragController.resizeSource): snapped to whole cells, pushes grid neighbours aside
   * as previewed, Escape cancels, each resize is one undo step. The parent renders these only where
   * resizing applies: open folders on a tab — never tiles, minimised folders, items inside a
   * folder or the phone (stacked) layout.
   * Keyboard: select the item and press Shift+Arrow keys (EditToolbar).
   */
  import type { ContainerMetrics } from '$lib/layout/geometry';
  import { resizeSource } from '$lib/editor/drag/dragController';
  import type { ResizeEdge } from '$lib/editor/resize';

  interface Props {
    id: string;
    name: string;
    /** The rendered metrics of the container the node sits in. */
    metrics: ContainerMetrics;
  }
  let { id, name, metrics }: Props = $props();

  const edges: { edge: ResizeEdge; what: string }[] = [
    { edge: 'right', what: 'width' },
    { edge: 'bottom', what: 'height' },
    { edge: 'corner', what: 'width and height' }
  ];
  // Always drawn in edit mode (not only on hover): a grip on the right edge, one on the bottom edge
  // and the corner, each a >= 12 px hit area kept clear of the title bar, edit handle and page bar.
</script>

{#each edges as h (h.edge)}
  <button
    type="button"
    class="rh rh-{h.edge}"
    data-resize={h.edge}
    tabindex="-1"
    aria-label="Drag to change {h.what} of {name || 'Untitled'}"
    title="Drag to change {h.what} — or select it and press Shift+Arrow keys"
    use:resizeSource={{ id, edge: h.edge, metrics, enabled: true }}
    ondblclick={(e) => e.stopPropagation()}
  ></button>
{/each}

<style>
  /* Hit areas straddle the box's edge: 3 px outside, 9 px inside (the folder's 8 px padding + 1 px
     border; the offsets of -4 px count from inside that border), so they never cover its items,
     page bar, title bar or edit handle. */
  .rh {
    position: absolute;
    z-index: 5;
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    touch-action: none;
  }
  /* The visible grip: accent with a page-coloured ring, so it reads (>= 3:1) on the folder and the page. */
  .rh::before {
    content: '';
    position: absolute;
    border-radius: 2px;
    background: var(--accent-solid);
    box-shadow: 0 0 0 1px var(--bg-primary);
    opacity: 0.9;
  }
  .rh-right {
    top: 64px; /* below the title bar (and a tab shape's tab) and the edit handle */
    bottom: 44px; /* above the page bar (32 px) and the bottom padding */
    right: -4px;
    width: 12px;
    cursor: ew-resize;
  }
  .rh-right::before {
    left: 4px;
    top: 50%;
    width: 4px;
    height: 28px;
    max-height: 100%;
    transform: translateY(-50%);
  }
  .rh-bottom {
    left: 20px;
    right: 20px;
    bottom: -4px;
    height: 12px;
    cursor: ns-resize;
  }
  .rh-bottom::before {
    top: 4px;
    left: 50%;
    width: 28px;
    height: 4px;
    transform: translateX(-50%);
  }
  .rh-corner {
    right: -4px;
    bottom: -4px;
    width: 12px;
    height: 12px;
    cursor: nwse-resize;
  }
  .rh-corner::before {
    right: 2px;
    bottom: 2px;
    width: 10px;
    height: 10px;
    border-radius: 0 0 3px 0;
    background: transparent;
    border-right: 4px solid var(--accent-solid);
    border-bottom: 4px solid var(--accent-solid);
    box-sizing: border-box;
    box-shadow: none;
    filter: drop-shadow(0 0 1px var(--bg-primary));
  }
  .rh:hover::before,
  .rh:focus-visible::before,
  :global(.selected) > .rh::before {
    opacity: 1;
  }
  .rh-right:hover::before {
    width: 6px;
    left: 3px;
  }
  .rh-bottom:hover::before {
    height: 6px;
    top: 3px;
  }
</style>
