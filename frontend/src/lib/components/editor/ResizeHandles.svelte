<script lang="ts">
  /**
   * Resize handles for one node in the editing renderer (M3 §5.6): the right edge, the bottom edge
   * and the bottom-right corner of its RENDERED box (Ruling 13). Dragging one is a drag of the
   * drag engine (dragController.resizeSource): snapped to whole cells, pushes grid neighbours aside
   * as previewed, Escape cancels, each resize is one undo step. The parent renders these only where
   * resizing applies: open folders on a tab (M5) — never tiles, minimised folders, items inside a
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
</script>

{#each edges as h (h.edge)}
  <button
    type="button"
    class="rh rh-{h.edge}"
    data-resize={h.edge}
    tabindex="-1"
    aria-label="Resize {name || 'Untitled'}: {h.what}"
    title="Drag to resize — or select it and press Shift+Arrow keys"
    use:resizeSource={{ id, edge: h.edge, metrics, enabled: true }}
    ondblclick={(e) => e.stopPropagation()}
  ></button>
{/each}

<style>
  .rh {
    position: absolute;
    z-index: 5;
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    touch-action: none;
  }
  .rh-right {
    top: 0;
    right: -5px;
    width: 10px;
    height: 100%;
    cursor: ew-resize;
  }
  .rh-bottom {
    left: 0;
    bottom: -5px;
    width: 100%;
    height: 10px;
    cursor: ns-resize;
  }
  .rh-corner {
    right: -7px;
    bottom: -7px;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    border: 2px solid var(--accent);
    background: var(--bg-primary);
    cursor: nwse-resize;
    opacity: 0.55;
  }
  .rh-right:hover,
  .rh-bottom:hover {
    background: color-mix(in srgb, var(--accent-solid) 35%, transparent);
  }
  .rh-corner:hover {
    opacity: 1;
  }
  /* The selected item shows its corner handle fully. */
  :global(.selected) > .rh-corner {
    opacity: 1;
  }
</style>
