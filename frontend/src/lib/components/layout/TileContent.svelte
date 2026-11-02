<script lang="ts">
  /**
   * What is drawn inside a tile or a minimised folder, by ONE rule at every size (Small, Medium, Large),
   * for every tile style and on a phone:
   *  - the name keeps its place at the top;
   *  - the icon (a minimised folder: its 2 x 2 preview or its own icon) is a fixed share of the
   *    box's inner height (ICON_SHARE), never wider than the box; it shrinks only to make room for a
   *    two-line name;
   *  - the description, when there is one, takes the room under the icon WITHOUT moving or resizing the
   *    icon, so tiles in a row line up whether or not they have one. It shows as many whole lines as
   *    fit (two at most), with an ellipsis; none fit, it is hidden.
   * Shares are of the box (a size container, so 1cqmin is 1% of its shorter side). The dashboard's
   * "Tile content size" (--content-scale, set on the tab canvas) multiplies the icon, name and
   * description, and everything is clamped to the box, so nothing spills out at 125%.
   * A name made of one long word shrinks its font to fit the width (down to NAME_FIT_MIN_PX) before it
   * breaks mid-word.
   */
  import type { Snippet } from 'svelte';
  import { longestWordEm } from '$lib/layout/contentScale';

  interface Props {
    name: string;
    /** The size drawn: Small's name takes up to two lines; Medium's and Large's one. */
    size: 'small' | 'medium' | 'large';
    description?: string;
    /** Extra room at the top (a tab shape's tab): the content sits inside the body. */
    topPx?: number;
    /** The name's own class (a hook for its component: Entry's title, a folder's collapsed-name). */
    nameClass?: string;
    textOpacity?: string;
    /** The icon square's content (an icon, the 2 x 2 preview, or a short note). */
    icon: Snippet;
  }

  let { name, size, description, topPx = 0, nameClass = 'title', textOpacity, icon }: Props = $props();
  const wordEm = $derived(longestWordEm(name));
</script>

<div class="tc-box" style:--tc-top={`${Math.max(0, topPx)}px`} style:--name-word-em={wordEm}>
  <div class="tc {size}">
    <div class="tc-name {nameClass}" style:opacity={textOpacity}>{name}</div>
    <div class="tc-icon">
      {@render icon()}
    </div>
    {#if description}
      <div class="tc-desc-slot">
        <div class="tc-desc subtitle" style:opacity={textOpacity}>{description}</div>
      </div>
    {/if}
  </div>
</div>

<style>
  /* The box: the whole tile (inside its border). Everything below is a share of it. */
  .tc-box {
    position: absolute;
    inset: 0;
    container: tc / size;
    pointer-events: none;
    /* The dashboard's Tile content size (1 = 100%), set on the tab canvas; anything else reads as 1. */
    --s: var(--content-scale, 1);
    /* On a phone (stacked) the text follows the text-size buttons, as it always has there; the tab canvas
       sets --tile-text-scale only then. */
    --tk: var(--tile-text-scale, 1);
  }
  .tc {
    /* Padding shrinks as the content grows: at 125% the content fills nearly the whole tile. */
    --pad: max(3px, calc(5cqmin * (2.25 - var(--s))));
    --gap: max(2px, calc(3cqmin * var(--s)));
    /* The box inside the padding (the tab, on a tab shape, comes off the top). */
    --inner-h: calc(100cqh - 2 * var(--pad) - var(--tc-top, 0px));
    --inner-w: calc(100cqw - 2 * var(--pad));
    /* THE icon share (ICON_SHARE): 60% of the inner height, times the scale, never wider or taller than the box.
       60% leaves one line of description under a Medium icon at typical desktop widths. */
    --icon: max(12px, min(calc(var(--inner-h) * 0.6 * var(--s)), var(--inner-w)));
    /* The name: 10% of the box, a 12 px floor; a long word shrinks to fit the width (to NAME_FIT_MIN_PX). */
    --name-nominal: calc(max(12px, calc(10cqmin * var(--s))) * var(--tk));
    --name-fit: calc((100cqw - 6px) / var(--name-word-em, 1));
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    padding: calc(var(--pad) + var(--tc-top, 0px)) var(--pad) var(--pad);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: var(--gap);
    overflow: hidden;
  }

  .tc-name {
    flex: none;
    width: calc(100cqw - 6px);
    max-width: calc(100cqw - 6px);
    /* NAME_FIT_MIN_PX = 10: below it a long word breaks mid-word (and only then). */
    font-size: max(calc(10px * var(--tk)), min(var(--name-nominal), var(--name-fit)));
    font-weight: 600;
    line-height: 1.2;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Small: the name takes up to two lines, wrapping at spaces; a word wider than the tile even at the
     minimum breaks rather than being lost. */
  .small .tc-name {
    line-height: 1.1;
    white-space: normal;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  /* Too short for two lines and an icon (SMALL_TWO_LINES_MIN_PX, a tile 50 px high with its 1 px border; the
     box here is inside the border): one line. */
  @container tc (max-height: 47.99px) {
    .small .tc-name {
      display: block;
      white-space: nowrap;
      line-height: 1.2;
    }
  }

  /* The icon square: its size is fixed by the rule; it gives way only to a two-line name. */
  .tc-icon {
    flex: 0 1 var(--icon);
    width: var(--icon);
    height: var(--icon);
    max-width: 100%;
    min-height: 0;
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .tc-icon > :global(*) {
    max-width: 100%;
    max-height: 100%;
  }

  /* The description: the room under the icon (never taking any from it). The slot is its own size
     container, so it shows only the whole lines that fit: two, one, or none (hidden). */
  .tc-desc-slot {
    flex: 1 1 0;
    min-height: 0;
    width: 100%;
    container: tcdesc / size;
    font-size: calc(max(11px, min(calc(8cqmin * var(--s)), calc(20px * var(--s)))) * var(--tk));
    line-height: 1.2;
  }
  .tc-desc {
    font-size: inherit;
    line-height: inherit;
    color: var(--text-secondary);
    text-align: center;
    width: 100%;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  @container tcdesc (max-height: 2.39em) {
    .tc-desc {
      -webkit-line-clamp: 1;
      line-clamp: 1;
    }
  }
  @container tcdesc (max-height: 1.19em) {
    .tc-desc {
      display: none;
    }
  }
</style>
