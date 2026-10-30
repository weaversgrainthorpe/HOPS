/**
 * Where an item's corner edit handle goes: INSIDE the item's
 * top-right corner, sized to the item, and NEVER over its centre, so a click or tap in the middle
 * always reaches the item (opens a minimised folder, selects a tile) and never opens the Edit dialog
 * by accident. It never hangs outside the item: there it covered a neighbour's corner, and on touch
 * (where the handle is always shown) a tap on the neighbour opened the wrong item's dialog. The same
 * rule holds with a mouse.
 *
 * - The handle is a square of HANDLE_MIN_PX … HANDLE_MAX_PX (a 24 px tap target), about a fifth of
 *   the item's shorter side, inset from the corner by 2–4 px.
 * - Where it can, it keeps CENTRE_CLEAR_PX clear round the centre on one axis (left of / right of, or
 *   above / below it). A Small item (51–56 px) has no room for that margin: the inset shrinks (down to
 *   the corner itself) until the centre is just free — a 24 px handle still fits.
 * - Only an item under about 50 px, too small for even that, gets a smaller handle (down to
 *   HANDLE_TINY_PX), in the very corner, so its centre stays free.
 */
export const HANDLE_MIN_PX = 24;
export const HANDLE_MAX_PX = 28;
/** The smallest handle, on an item too small for a 24 px one beside its centre. */
export const HANDLE_TINY_PX = 12;
/** The space kept round the item's centre where there is room. */
export const CENTRE_CLEAR_PX = 4;

export interface HandleFit {
  /** The handle's side, px. */
  sizePx: number;
  /** Its distance in from the item's top and right edges, px (never negative: always inside). */
  offsetPx: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Whether a handle of side `s`, `o` px in from the top-right of a w×h item, keeps `m` px clear of the
 * centre on one axis (m = 0: the centre point itself is not under it).
 */
function clear(w: number, h: number, s: number, o: number, m: number): boolean {
  const left = w - o - s;
  const bottom = o + s;
  return m > 0 ? left >= w / 2 + m || bottom <= h / 2 - m : left > w / 2 || bottom < h / 2;
}

export function cornerHandleFit(widthPx: number, heightPx: number): HandleFit {
  const w = widthPx, h = heightPx;
  if (!(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0)) {
    return { sizePx: HANDLE_MAX_PX, offsetPx: 4 };
  }
  const short = Math.min(w, h);
  const inset = clamp(Math.round(short * 0.04), 2, 4);
  const want = clamp(Math.round(short * 0.22), HANDLE_MIN_PX, HANDLE_MAX_PX);
  // Roomy: the wanted size (or down to 24) at the usual inset, with the margin round the centre.
  for (let s = want; s >= HANDLE_MIN_PX; s--) {
    if (clear(w, h, s, inset, CENTRE_CLEAR_PX)) return { sizePx: s, offsetPx: inset };
  }
  // Small: a 24 px handle, the inset shrinking towards the corner until the centre is free.
  for (let o = inset; o >= 0; o--) {
    if (clear(w, h, HANDLE_MIN_PX, o, 0)) return { sizePx: HANDLE_MIN_PX, offsetPx: o };
  }
  // Tiny: a smaller handle in the very corner, short of the centre (left of it > w/2, or above h/2).
  const s = Math.max(HANDLE_TINY_PX, Math.ceil(Math.max(w, h) / 2) - 1);
  return { sizePx: Math.min(s, HANDLE_MIN_PX - 1, Math.floor(short)), offsetPx: 0 };
}
