/**
 * How many of the navbar's dashboard links fit (walkthrough 1, Ruling 12): the links are shown in
 * order while they fit; the rest go into a "More" menu, whose button then needs room too.
 *
 * @param linkWidths each link's width in px, in display order
 * @param gapPx the space between two neighbours (links and the More button alike)
 * @param moreWidthPx the More button's width
 * @param availablePx the room for the links and the More button together
 * @returns the number of links to show (0 … linkWidths.length); fewer than all means "show More"
 */
export function fitLinks(linkWidths: number[], gapPx: number, moreWidthPx: number, availablePx: number): number {
  const n = linkWidths.length;
  if (n === 0) return 0;
  const gap = Number.isFinite(gapPx) && gapPx > 0 ? gapPx : 0;
  const room = Number.isFinite(availablePx) ? availablePx : 0;
  // Unmeasured (0 / NaN) widths never count as fitting: the link goes in the menu, never cut off.
  const w = linkWidths.map((x) => (Number.isFinite(x) && x > 0 ? x : Infinity));
  let total = 0;
  for (let i = 0; i < n; i++) total += w[i] + (i > 0 ? gap : 0);
  // Half a pixel of slack: sub-pixel widths that sum to the room exactly still fit.
  if (total <= room + 0.5) return n;
  let used = moreWidthPx;
  let shown = 0;
  for (let i = 0; i < n; i++) {
    const next = used + gap + w[i];
    if (next > room + 0.5) break;
    used = next;
    shown++;
  }
  return shown;
}
