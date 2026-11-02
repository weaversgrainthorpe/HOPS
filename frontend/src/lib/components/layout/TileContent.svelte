<script lang="ts">
  /**
   * What is drawn inside a tile or a minimised folder, by ONE rule at every size (Small, Medium, Large),
   * for every tile style and on a phone:
   *  - the name keeps its place at the top;
   *  - ONE description line is reserved under the icon for every tile of a size (the same reserve whether
   *    or not a tile has a description, so tiles in a row line up). None is reserved when a line can't
   *    fit at its floor (a Small tile on the grid);
   *  - the icon (a minimised folder: its preview or its own icon) takes the rest of the height, capped by
   *    the width. It gives way only to a two-line Small name. At Small the icon's box is the full inner
   *    width (a minimised folder's preview can then be one row of two);
   *  - the description fills the reserve (two lines when there is room, with an ellipsis).
   * Shares are of the box (a size container, so 1cqmin is 1% of its shorter side). The dashboard's
   * "Tile content size" (--content-scale on the tab canvas) scales the text and the gaps; the icon takes
   * what is left, and the padding gives way (8cqmin at 100%, 3cqmin at 125%, 18cqmin at 75%), so the box
   * never changes and nothing spills out.
   * Long words: a word wider than the tile shrinks its font to fit (down to NAME_FIT_MIN_PX). At Small a
   * camel-case word too wide even then breaks at its case boundary ("Home / Assistant"), and only a word
   * with no such boundary breaks mid-word.
   */
  import type { Snippet } from 'svelte';
  import { camelParts, longestWordEm, widestSegmentEm } from '$lib/layout/contentScale';

  interface Props {
    name: string;
    /** The size drawn: Small's name takes up to two lines; Medium's and Large's one. */
    size: 'small' | 'medium' | 'large';
    description?: string;
    /** The description element's id (the tile points its accessible description at it, shown or not). */
    descriptionId?: string;
    /** Extra room at the top (a tab shape's tab): the content sits inside the body. */
    topPx?: number;
    /** The name's own class (a hook for its component: Entry's title, a folder's collapsed-name). */
    nameClass?: string;
    textOpacity?: string;
    /** The icon box's content (an icon, the preview, or a short note). */
    icon: Snippet;
  }

  let { name, size, description, descriptionId, topPx = 0, nameClass = 'title', textOpacity, icon }: Props = $props();
  const wordEm = $derived(longestWordEm(name));
  const segEm = $derived(widestSegmentEm(name));
  /** The name as words and their camel-case parts: a line may break between the parts (<wbr>). */
  const parts = $derived(String(name ?? '').split(/(\s+)/).map((w) => (/^\s+$/.test(w) ? [w] : camelParts(w))));
</script>

<div class="tc-box" style:--tc-top={`${Math.max(0, topPx)}px`} style:--name-word-em={wordEm} style:--name-seg-em={segEm}>
  <div class="tc {size}">
    <div class="tc-name {nameClass}" style:opacity={textOpacity}>
      <!-- Only a Small name wraps; Chrome breaks at <wbr> even under nowrap, so one-line names get none. -->
      {#if size === 'small'}{#each parts as word, i (i)}{#each word as part, j (j)}{#if j > 0}<wbr />{/if}{part}{/each}{/each}{:else}{name}{/if}
    </div>
    <div class="tc-icon">
      {@render icon()}
    </div>
    {#if description}
      <div class="tc-desc-slot">
        <div class="tc-desc subtitle" id={descriptionId} style:opacity={textOpacity}>{description}</div>
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
    /* The padding gives the scale its room: 8cqmin at 100%, down to 3cqmin at 125%, up to 18cqmin at 75%. */
    --pad: max(3px, calc(8cqmin + max(0, 1 - var(--s)) * 40cqmin - max(0, var(--s) - 1) * 20cqmin));
    --gap: max(2px, calc(2.5cqmin * var(--s)));
    /* The box inside the padding (the tab, on a tab shape, comes off the top). */
    --inner-h: calc(100cqh - 2 * var(--pad) - var(--tc-top, 0px));
    --inner-w: calc(100cqw - 2 * var(--pad));
    /* The name: 10% of the box; its 12 px floor rises with the scale (never falls below 12 px). */
    --name-nominal: calc(max(calc(12px * max(1, var(--s))), calc(10cqmin * var(--s))) * var(--tk));
    --name-line: calc(var(--name-nominal) * 1.2);
    --name-fit: calc((100cqw - 6px) / var(--name-word-em, 1));
    /* The description: 8% of the box, an 11 px floor, at most 20 px (times the scale). */
    --desc-font: calc(max(11px, min(calc(8cqmin * var(--s)), calc(20px * var(--s)))) * var(--tk));
    /* ONE description line reserved for every tile of this size (and its gap); none on a Small grid tile. */
    --desc-reserve: calc(var(--desc-font) * 1.2 + var(--gap));
    /* The icon: the rest, capped by the width. */
    --icon: max(12px, min(var(--inner-w), calc(var(--inner-h) - var(--name-line) - var(--gap) - var(--desc-reserve))));
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
  /* Too short for a description line at its floor beside the name and an icon (a Small tile on the grid;
     a 100 px phone tile has room): nothing reserved, the icon takes it. */
  @container tc (max-height: 89.99px) {
    .tc {
      --desc-reserve: 0px;
    }
  }

  .tc-name {
    flex: none;
    width: calc(100cqw - 6px);
    max-width: calc(100cqw - 6px);
    /* NAME_FIT_MIN_PX = 10: a word wider than the tile shrinks to fit, down to 10 px. */
    font-size: max(calc(10px * var(--tk)), min(var(--name-nominal), var(--name-fit)));
    font-weight: 600;
    line-height: 1.2;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Small: the name takes up to two lines, wrapping at spaces and at camel-case boundaries (<wbr>). A word
     that fits once shrunk (to 10 px) is shrunk; one that doesn't is fitted by its widest camel-case part
     instead, so it breaks between its parts at a readable size; a word with no part to break at breaks
     mid-word rather than being lost. */
  .small .tc-name {
    --name-seg-fit: calc((100cqw - 6px) / var(--name-seg-em, 1));
    /* The whole word's fit while it is at least 10 px; below that, its widest part's fit. */
    --name-fit-small: max(var(--name-fit), min(var(--name-seg-fit), calc((10px - var(--name-fit)) * 1000)));
    font-size: max(calc(10px * var(--tk)), min(var(--name-nominal), var(--name-fit-small)));
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
    .small .tc-name :global(wbr) {
      display: none;
    }
  }

  /* The icon's box: its size is fixed by the rule; it gives way only to a two-line name. */
  .tc-icon {
    flex: 0 1 var(--icon);
    width: var(--icon);
    height: var(--icon);
    max-width: 100%;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  /* Small: the full inner width, so a minimised folder's preview can lie as one row of two. */
  .small .tc-icon {
    width: 100%;
  }
  .tc-icon > :global(*) {
    max-width: 100%;
    max-height: 100%;
  }

  /* The description: the reserved line (more when there is room), never taking any from the icon. The
     slot is its own size container, so it shows only the whole lines that fit: two, one, or none. */
  .tc-desc-slot {
    flex: 1 1 0;
    min-height: 0;
    width: 100%;
    container: tcdesc / size;
    font-size: var(--desc-font);
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
