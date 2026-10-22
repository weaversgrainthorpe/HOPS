/**
 * Where an item's corner edit handle goes (M5 walkthrough 1 C): in the item's top-right corner,
 * sized to the item, and NEVER over its centre, so a click in the middle always reaches the item
 * (opens a minimised folder, selects a tile) and never opens the Edit dialog by accident.
 *
 * - The handle is a square of HANDLE_MIN_PX … HANDLE_MAX_PX (at least a 24 px tap target), about a
 *   fifth of the item's shorter side, inset from the corner by 2–4 px.
 * - It must stay CENTRE_CLEAR_PX clear of the centre on at least one axis (left of / right of, or
 *   above / below it). If even the smallest handle inside the corner can't, the item is too small to
 *   hold one: the handle hangs just outside the corner (a negative offset, at least 8 px out), still
 *   overlapping the corner so the pointer can move from the item onto it.
 */
export const HANDLE_MIN_PX = 24;
export const HANDLE_MAX_PX = 28;
/** The space kept round the item's centre. */
export const CENTRE_CLEAR_PX = 4;
/** How far past the corner a hung handle goes (a folder page's padding is 8 px: it is not clipped). */
const HANG_PX = 8;

export interface HandleFit {
  /** The handle's side, px. */
  sizePx: number;
  /** Its distance in from the item's top and right edges, px (negative: past them). */
  offsetPx: number;
  /** True when it hangs outside the corner (the item is too small to hold it clear of its centre). */
  outside: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Whether a handle of side `s`, `o` px in from the top-right of a w×h item, is clear of its centre. */
function clear(w: number, h: number, s: number, o: number): boolean {
  const m = CENTRE_CLEAR_PX;
  const left = w - o - s;
  const bottom = o + s;
  return left >= w / 2 + m || bottom <= h / 2 - m;
}

export function cornerHandleFit(widthPx: number, heightPx: number): HandleFit {
  const w = widthPx, h = heightPx;
  if (!(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0)) {
    return { sizePx: HANDLE_MAX_PX, offsetPx: 4, outside: false };
  }
  const short = Math.min(w, h);
  const inset = clamp(Math.round(short * 0.04), 2, 4);
  const want = clamp(Math.round(short * 0.22), HANDLE_MIN_PX, HANDLE_MAX_PX);
  for (let s = want; s >= HANDLE_MIN_PX; s--) {
    if (clear(w, h, s, inset)) return { sizePx: s, offsetPx: inset, outside: false };
  }
  // Too small: hang it outside the corner, as far out as clearing the centre needs (at least 8 px).
  const s = HANDLE_MIN_PX;
  const m = CENTRE_CLEAR_PX;
  const need = Math.max(Math.floor(w / 2 - m - s), Math.floor(h / 2 - m - s));
  return { sizePx: s, offsetPx: Math.min(-HANG_PX, need), outside: true };
}
