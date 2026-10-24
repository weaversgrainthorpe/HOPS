<script lang="ts">
  /**
   * The drag's ghost and highlight, portalled to <body> above everything but toasts. It only
   * draws state.target (the one resolver's result): the target cells, the neighbours' pushed
   * positions (exactly the push map the drop will apply) and, for an invalid target, the reason.
   * Every size comes from geometry.nodeBox with the target container's rendered metrics; a pushed
   * collapsed folder is drawn as the tile of its size it renders as (Ruling 13). Task 8: the merge /
   * into-folder / tab-append cue on the item or tab under the pointer, the
   * tab-reorder marker, and the DragBreadcrumb. Task 9: a resize shows the resulting box and any
   * push (no ghost); a stacked (phone) drop shows its reading-order insertion marker.
   */
  import { drag, setActiveTab, setTabSwitcher, MERGE_DWELL_MS } from './dragController';
  import DragBreadcrumb from './DragBreadcrumb.svelte';
  import { cancelDropAnimations } from './dropAnimation';
  import { watchEdits } from './flourishes';

  interface Props {
    /** The editor's active tab: a change during a drag cancels it (unless the drag switched it). */
    tabId?: string | null;
    /** Show a tab (the drag's tab dwell and the breadcrumb use it to continue on another tab). */
    onSwitchTab?: (tabId: string) => boolean | void;
  }
  let { tabId = null, onSwitchTab }: Props = $props();
  $effect(() => setActiveTab(tabId));
  // The editor's canvas going away (leaving edit mode or the dashboard) stops any drop animation.
  $effect(() => () => cancelDropAnimations());
  // §9: every edit while the editor is open glides, pops in or fades out (decoration only).
  $effect(() => watchEdits());
  $effect(() => {
    setTabSwitcher(onSwitchTab ?? null);
    return () => setTabSwitcher(null);
  });
  import { session } from '$lib/stores/editSession';
  import { minimisedPlacement, nodeBox, type NodeBox } from '$lib/layout/geometry';
  import { portal } from '$lib/utils/overlayActions';
  import { findIn } from '../editorActions';

  const s = $derived($drag);
  const px = (v: number) => `${Math.round((Number.isFinite(v) ? v : 0) * 100) / 100}px`;

  const boxes = $derived.by((): { at: NodeBox[]; push: NodeBox[] } => {
    const t = s?.target;
    const view = s?.view;
    if (!s || !view || !t || (t.kind !== 'place' && t.kind !== 'resize')) return { at: [], push: [] };
    const m = view.metrics;
    const d = $session?.draft;
    const push: NodeBox[] = [];
    for (const [id, p] of t.push) {
      const n = d ? findIn(d, id) : undefined;
      const shown = n?.kind === 'folder' && n.display === 'collapsed' ? minimisedPlacement(p, n.size) : p;
      push.push(nodeBox(shown, m));
    }
    return { at: (t.kind === 'resize' ? [t.at] : t.at).map((p) => nodeBox(p, m)), push };
  });

  const box = (b: NodeBox, left: number, top: number) =>
    `left:${px(left + b.leftPx)};top:${px(top + b.topPx)};width:${px(b.widthPx)};height:${px(b.heightPx)};`;

  const invalid = $derived(s?.target?.kind === 'invalid' ? s.target.reason : null);
  /** A merge dwell is running (the dragged item's centre is in a tile's centre zone): show progress. */
  const holding = $derived(!!s?.dwell && s.dwell.key.startsWith('merge:') && !s.dwell.ripe && s.target?.kind === 'place');
  const cue = $derived.by((): string | null => {
    const t = s?.target;
    const d = $session?.draft;
    if (!t || !s?.over) return null;
    if (t.kind === 'merge') return 'Make a folder';
    if (holding) return 'Hold to make a folder';
    if (t.kind === 'into-folder') return `Into "${(d && findIn(d, t.folderId)?.name) || 'folder'}"`;
    if (t.kind === 'tab-append') return `Add to "${d?.tabs.find((x) => x.id === t.tabId)?.name || 'tab'}"`;
    return null;
  });
  const ghostStyle = $derived.by(() => {
    if (!s || !s.ghost) return '';
    const g = s.grab ?? { fx: 0, fy: 0 };
    // Over a folder's page the ghost is that folder's item size (ghostShown), held at the same point.
    const size = s.ghostShown ?? s.ghost;
    const left = s.pointer.x - g.fx * size.widthPx;
    const top = s.pointer.y - g.fy * size.heightPx;
    return `left:${px(left)};top:${px(top)};width:${px(size.widthPx)};height:${px(size.heightPx)};`;
  });
</script>

<DragBreadcrumb />

<!-- The layer below is aria-hidden (pure visuals); this always-mounted polite region announces
     why a drop is not allowed while the pointer is over such a target (final review Minor 10). -->
<div class="sr-only" role="status" aria-live="polite" data-testid="drag-announce">
  {invalid !== null ? `Not allowed: ${invalid}` : ''}
</div>

{#if s}
  <div class="drag-layer" use:portal aria-hidden="true">
    {#if s.view}
      {#each boxes.push as b, i (i)}
        <div class="push" style={box(b, s.view.left, s.view.top)}></div>
      {/each}
      {#each boxes.at as b, i (i)}
        <div class="target" class:copy={s.copy} style={box(b, s.view.left, s.view.top)}></div>
      {/each}
    {/if}
    {#if cue !== null && s.over}
      <div
        class="cue"
        class:hold={holding}
        style="left:{px(s.over.left)};top:{px(s.over.top)};width:{px(s.over.width)};height:{px(s.over.height)};"
      >
        {#if holding && s.dwell}
          {#key s.dwell.since}
            <span class="cue-progress" style="animation-duration:{MERGE_DWELL_MS}ms;"></span>
          {/key}
        {/if}
        <span class="cue-label">{cue}</span>
      </div>
    {/if}
    {#if s.marker}
      {#if s.marker.width !== undefined}
        <div class="marker" style="left:{px(s.marker.left)};top:{px(s.marker.top - 2)};width:{px(s.marker.width)};height:4px;"></div>
      {:else}
        <div class="marker" style="left:{px(s.marker.left - 2)};top:{px(s.marker.top)};width:4px;height:{px(s.marker.height)};"></div>
      {/if}
    {/if}
    {#if !s.resize}
      <div class="ghost" class:invalid={invalid !== null} style={ghostStyle}>
        <span class="ghost-label">{s.ghost?.label ?? ''}</span>
        {#if s.copy}<span class="badge" title="Copy">+</span>{/if}
      </div>
    {/if}
    {#if invalid !== null}
      <div class="reason" style="left:{px(s.pointer.x + 16)};top:{px(s.pointer.y + 16)};">{invalid}</div>
    {/if}
  </div>
{/if}

<style>
  .drag-layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: calc(var(--z-toast) - 10);
  }
  .drag-layer > div {
    position: fixed;
    pointer-events: none;
    box-sizing: border-box;
  }
  .target {
    border: 2px solid var(--accent);
    background: color-mix(in srgb, var(--accent-solid) 18%, transparent);
    border-radius: 0.75rem;
  }
  .push {
    border: 2px dashed var(--text-secondary);
    border-radius: 0.75rem;
  }
  .ghost {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--bg-secondary) 85%, transparent);
    border: 2px solid var(--accent);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    opacity: 0.9;
    color: var(--text-primary);
  }
  .ghost.invalid {
    border-color: var(--color-error, #ef4444);
    cursor: not-allowed;
  }
  .ghost-label {
    font-weight: 600;
    font-size: 0.875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .badge {
    position: absolute;
    top: -0.6rem;
    right: -0.6rem;
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-solid);
    color: var(--on-accent);
    font-weight: 700;
  }
  .cue {
    border: 3px solid var(--accent);
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--accent-solid) 25%, transparent);
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .cue.hold {
    border-style: dashed;
    background: color-mix(in srgb, var(--accent-solid) 12%, transparent);
  }
  /* The merge dwell's progress: a bar filling along the tile's top edge over MERGE_DWELL_MS. */
  .cue-progress {
    position: absolute;
    left: 0;
    top: 0;
    height: 5px;
    width: 100%;
    border-radius: 0.75rem 0.75rem 0 0;
    background: var(--accent);
    transform-origin: left center;
    animation-name: cue-fill;
    animation-timing-function: linear;
    animation-fill-mode: both;
  }
  @keyframes cue-fill {
    from { transform: scaleX(0); }
    to { transform: scaleX(1); }
  }
  .cue-label {
    margin-bottom: -1.6rem;
    padding: 0.15rem 0.5rem;
    border-radius: 0.375rem;
    background: var(--accent-solid);
    color: var(--on-accent);
    font-size: 0.8125rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .marker {
    background: var(--accent);
    border-radius: 2px;
  }
  .reason {
    max-width: 280px;
    padding: 0.35rem 0.6rem;
    border-radius: 0.375rem;
    background: var(--danger-solid);
    color: white;
    font-size: 0.8125rem;
  }
  :global(body.hops-resizing) {
    user-select: none;
    -webkit-user-select: none;
  }
  :global(body.hops-resize-corner),
  :global(body.hops-resize-corner *) {
    cursor: nwse-resize !important;
  }
  :global(body.hops-resize-right),
  :global(body.hops-resize-right *) {
    cursor: ew-resize !important;
  }
  :global(body.hops-resize-bottom),
  :global(body.hops-resize-bottom *) {
    cursor: ns-resize !important;
  }
  :global(body.hops-dragging) {
    user-select: none;
    -webkit-user-select: none;
    cursor: grabbing;
  }
</style>
