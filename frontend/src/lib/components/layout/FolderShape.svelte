<script lang="ts">
  /**
   * THE folder shape (M6 Task 3): one component draws every folder's look — minimised, open and nested
   * (and the dialog's previews) — behind the folder's real content (z-index -1 in the folder's
   * stacking context). It is decoration only: aria-hidden; the name and controls are real text and
   * buttons drawn by Folder.svelte.
   *  - Rounded (and a missing or unknown shape): the M5 box surface (FolderSurface), unchanged.
   *  - Tab shapes: static SVG paths from folderShapePaths.shapeParts, sized to the measured box —
   *    no filters, at most one gradient (Paper), no animation (Tenet 4). The folder's colour drives
   *    the panels (deriveFolderColours). A background of its own fills the front panel, clipped to it;
   *    the back panel and tab stay the folder colour; the opacity applies to the whole shape (§3a.10).
   *  - The silhouette is also the focus ring: shown while the folder's tile has keyboard focus, so the
   *    focus outline follows the shape.
   */
  import type { FolderNode } from '$lib/types/layout';
  import { deriveFolderColours } from '$lib/layout/folderColours';
  import { shapeParts, type ShapeState } from '$lib/layout/folderShapePaths';
  import type { InsetRect } from '$lib/layout/geometry';
  import FolderSurface from '../background/FolderSurface.svelte';
  import { getContext } from 'svelte';
  import { SHAPE_MEASURE_CONTEXT, type ShapeMeasure } from '$lib/layout/shapeMeasure';

  type Look = Partial<Pick<FolderNode, 'shape' | 'tabPosition' | 'color' | 'textColor' | 'opacity' | 'background'>>;
  interface Props {
    look: Look;
    variant: ShapeState;
    dashboardId: string;
    /** Open / nested: where the real label's tab is (Folder.svelte's folderTabRect), so both line up. */
    tabRect?: InsetRect | null;
    /** The background's mode: a minimised tile and a preview are still. */
    mode?: 'animated' | 'still';
    /** A given size (the dialog's previews); on a canvas the shape is measured instead. */
    widthPx?: number;
    heightPx?: number;
    /** Told the measured size (a minimised tile lays its name out on the front panel, §3a.6). */
    onSize?: (widthPx: number, heightPx: number) => void;
  }
  let { look, variant, dashboardId, tabRect = null, mode = variant === 'minimised' ? 'still' : 'animated', widthPx, heightPx, onSize }: Props = $props();

  const uid = $props.id();
  let w = $state(0);
  let h = $state(0);
  const measure = getContext<ShapeMeasure | undefined>(SHAPE_MEASURE_CONTEXT);
  /** Measured by the canvas's one ResizeObserver (never an observer of its own, Tenet 4). */
  function measured(el: HTMLElement) {
    if (!measure) return;
    const stop = measure.observe(el, (mw, mh) => {
      w = mw;
      h = mh;
      onSize?.(mw, mh);
    });
    return { destroy: stop };
  }
  // A given size wins; until a measurement arrives (jsdom, the first frame) a nominal size is drawn.
  const box = $derived({
    widthPx: widthPx ?? (w > 0 ? w : 160),
    heightPx: heightPx ?? (h > 0 ? h : 120)
  });
  const parts = $derived.by(() => {
    const p = shapeParts(look.shape, look.tabPosition, variant, box, undefined);
    // The real label decides an open / nested tab's width: draw the tab where it is.
    return p.tab && tabRect && variant !== 'minimised' ? shapeParts(look.shape, look.tabPosition, variant, box, tabRect.widthPx) : p;
  });
  const colours = $derived(deriveFolderColours(look.color, look.textColor));
  const opacity = $derived(typeof look.opacity === 'number' && Number.isFinite(look.opacity) ? look.opacity : 0.95);
  const ownBackground = $derived(!!(look.background && !look.background.inherit && look.background.type));
  const pos = $derived(look.tabPosition === 'centre' || look.tabPosition === 'right' ? look.tabPosition : 'left');
  const strokeColour = $derived(parts.stroke === 'dark' ? '#0b1020' : parts.stroke === 'colour' ? (colours.themed ? 'var(--text-secondary)' : colours.base) : 'none');
  const frontFill = $derived(parts.gradient ? `url(#${uid}-g)` : parts.shape === 'simple-tab' ? colours.base : colours.front);
</script>

{#if parts.shape === 'rounded'}
  <!-- Rounded: the M5 surface, its colour at the folder's opacity (the M5 rule). -->
  <div class="folder-shape rounded" aria-hidden="true" data-folder-shape="rounded" data-shape-state={variant}>
    <FolderSurface background={look.background} color={look.color || 'var(--bg-secondary)'} colorOpacity={opacity} {mode} {dashboardId} />
  </div>
{:else}
  <div
    class="folder-shape"
    aria-hidden="true"
    data-folder-shape={parts.shape}
    data-shape-state={variant}
    data-tab-position={pos}
    use:measured
  >
    <!-- The folder's opacity fades the painted shape only (§3a.10) — never the focus ring below. -->
    <div class="shape-paint" data-shape-paint style:opacity={String(opacity)}>
    <svg class="shape-svg" width="100%" height="100%" viewBox="0 0 {box.widthPx} {box.heightPx}" preserveAspectRatio="none" focusable="false">
      {#if parts.gradient}
        <defs>
          <linearGradient id="{uid}-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color={colours.gradient.from} />
            <stop offset="1" stop-color={colours.gradient.to} />
          </linearGradient>
        </defs>
      {/if}
      {#if parts.shape === 'simple-tab'}
        <path class="panel body" d={parts.silhouette} fill={colours.base} />
      {:else}
        <path
          class="panel back"
          d={parts.back}
          fill={parts.fill ? colours.back : 'none'}
          stroke={strokeColour}
          stroke-width={parts.strokePx}
          stroke-linejoin="round"
        />
        {#if parts.paper}
          <rect
            class="paper"
            x={parts.paper.leftPx}
            y={parts.paper.topPx}
            width={parts.paper.widthPx}
            height={parts.paper.heightPx}
            rx="3"
            fill="#f8fafc"
          />
        {/if}
        <path
          class="panel front"
          d={parts.front}
          fill={parts.fill ? frontFill : 'none'}
          stroke={strokeColour}
          stroke-width={parts.strokePx}
          stroke-linejoin="round"
        />
      {/if}
    </svg>
    {#if ownBackground}
      <!-- The picture fills the front panel, clipped to it (§3a.10). -->
      <div
        class="shape-front"
        data-shape-front
        style:left="{parts.frontRect.leftPx}px"
        style:top="{parts.frontRect.topPx}px"
        style:width="{parts.frontRect.widthPx}px"
        style:height="{parts.frontRect.heightPx}px"
        style:border-radius={parts.frontPolygon ? '0' : `${parts.radiusPx}px`}
        style:clip-path={parts.frontPolygon || undefined}
      >
        <FolderSurface background={look.background} color={colours.front} colorOpacity={1} {mode} {dashboardId} />
      </div>
    {/if}
    </div>
    <!-- The keyboard focus ring follows the shape (WCAG 2.4.7). It is OUTSIDE the faded layer, so it is
         fully opaque at every folder opacity (0 too), and two-tone — black under white, 21:1 to each
         other — so one tone is at least 3:1 against whatever surrounds it. -->
    <svg
      class="ring-svg"
      data-focus-ring
      width="100%"
      height="100%"
      viewBox="0 0 {box.widthPx} {box.heightPx}"
      preserveAspectRatio="none"
      focusable="false"
    >
      <path class="ring-outer" d={parts.silhouette} fill="none" stroke-width="5" stroke-linejoin="round" />
      <path class="ring-inner" d={parts.silhouette} fill="none" stroke-width="2" stroke-linejoin="round" />
    </svg>
  </div>
{/if}

<style>
  .folder-shape {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    border-radius: inherit;
  }
  .shape-svg {
    position: absolute;
    inset: 0;
    display: block;
    overflow: visible;
  }
  .shape-front {
    position: absolute;
    overflow: hidden;
    isolation: isolate;
  }
  .shape-paint {
    position: absolute;
    inset: 0;
  }
  .ring-svg {
    position: absolute;
    inset: 0;
    display: none;
    overflow: visible;
  }
  .ring-outer {
    stroke: #000000;
  }
  .ring-inner {
    stroke: #ffffff;
  }
  /* The focus outline follows the shape: the folder tile's keyboard focus shows the silhouette ring. */
  :global(:focus-visible) > .folder-shape > .ring-svg {
    display: block;
  }
</style>
