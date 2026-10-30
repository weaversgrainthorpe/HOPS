<script lang="ts" module>
  import { contrastRatio, deriveFolderColours } from '$lib/layout/folderColours';

  /** The light, neutral card every look preview sits on, in both themes. */
  export const PREVIEW_CARD = '#eef2f7';
  /** The edge drawn round a preview whose colours are too close to the card (9.7:1 on the card). */
  export const PREVIEW_EDGE = '#334155';
  /** WCAG 1.4.11: a graphic needs 3:1 against what is next to it. */
  export const MIN_NON_TEXT_CONTRAST = 3;

  /**
   * Does a look in this colour need the edge to reach 3:1 on the card? A themed folder (no colour of its
   * own) follows the theme, so it always gets the edge; a coloured one when any of its panel colours is
   * below 3:1 on the card.
   */
  export function previewNeedsEdge(color: string | undefined, textColor?: string): boolean {
    const c = deriveFolderColours(color, textColor);
    if (c.themed) return true;
    return Math.min(...[c.back, c.front, c.base].map((x) => contrastRatio(x, PREVIEW_CARD))) < MIN_NON_TEXT_CONTRAST;
  }
</script>

<script lang="ts">
  /**
   * One look's preview in the folder dialog's picker: the shape in the folder's colour and tab
   * position, on a light neutral card so every look is readable whatever the folder colour (a dark folder
   * on the dark dialog was not). A colour too close to the card gets a dark edge, so the preview keeps
   * 3:1 against its card. The preview is drawn opaque: it shows the look, and the opacity has its own
   * slider. Decoration only (aria-hidden); the radio beside it is named by its label.
   */
  import FolderShapeView from '../layout/FolderShape.svelte';
  import { shapeParts } from '$lib/layout/folderShapePaths';
  import type { FolderShape, TabPosition } from '$lib/types/layout';

  interface Props {
    shape: FolderShape;
    tabPosition: TabPosition;
    color?: string;
    textColor?: 'auto' | 'light' | 'dark';
  }
  let { shape, tabPosition, color, textColor }: Props = $props();

  const W = 72;
  const H = 56;
  const edge = $derived(previewNeedsEdge(color, textColor));
  const parts = $derived(shapeParts(shape, tabPosition, 'minimised', { widthPx: W, heightPx: H }));
</script>

<span class="look-card" data-preview-card style:background-color={PREVIEW_CARD} aria-hidden="true">
  <span class="look-shape" class:rounded={parts.shape === 'rounded'} class:edged={edge && parts.shape === 'rounded'} style:--edge={PREVIEW_EDGE}>
    <FolderShapeView look={{ shape, tabPosition, color, textColor, opacity: 1 }} variant="minimised" dashboardId="" widthPx={W} heightPx={H} />
    {#if edge && parts.shape !== 'rounded'}
      <svg class="look-edge" data-preview-edge width={W} height={H} viewBox="0 0 {W} {H}" focusable="false">
        <path d={parts.silhouette} fill="none" stroke={PREVIEW_EDGE} stroke-width="1.5" stroke-linejoin="round" />
        {#if parts.front}
          <path d={parts.front} fill="none" stroke={PREVIEW_EDGE} stroke-width="1.5" stroke-linejoin="round" />
        {/if}
      </svg>
    {/if}
  </span>
</span>

<style>
  .look-card {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.4rem 0.5rem;
    border-radius: 0.375rem;
  }
  .look-shape {
    position: relative;
    isolation: isolate;
    display: block;
    width: 72px;
    height: 56px;
  }
  .look-shape.rounded {
    border-radius: 0.5rem;
  }
  .look-shape.rounded.edged {
    box-shadow: 0 0 0 1.5px var(--edge);
  }
  .look-edge {
    position: absolute;
    inset: 0;
    overflow: visible;
    pointer-events: none;
  }
</style>
