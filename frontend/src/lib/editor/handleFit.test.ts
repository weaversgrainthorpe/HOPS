// an item's edit handle sits INSIDE its top-right
// corner, sized to the item, and never covers the item's centre — so a click or tap in the middle
// always reaches the item (opens a minimised folder, selects a tile), never the Edit dialog. It never
// hangs outside the item (on touch a hung handle covered a neighbour's corner and took
// its taps), with a mouse or on touch alike.
import { describe, it, expect } from 'vitest';
import { cornerHandleFit, HANDLE_MIN_PX, HANDLE_MAX_PX } from './handleFit';

/** The handle's box in the item's own px (origin top-left). */
function box(w: number, h: number) {
  const f = cornerHandleFit(w, h);
  return { ...f, left: w - f.offsetPx - f.sizePx, right: w - f.offsetPx, top: f.offsetPx, bottom: f.offsetPx + f.sizePx };
}
const coversCentre = (w: number, h: number) => {
  const b = box(w, h);
  return b.left <= w / 2 && w / 2 <= b.right && b.top <= h / 2 && h / 2 <= b.bottom;
};
const sizes = (from: number) => {
  const out: [number, number][] = [];
  for (let w = from; w <= 600; w += 1) for (const h of [w, Math.round(w * 0.6), Math.round(w * 1.5)]) out.push([w, h]);
  return out;
};

describe('cornerHandleFit: inside the corner, never over the centre', () => {
  it('is always inside the item: never past its top or right edge (no overhang onto a neighbour), at every size', () => {
    for (const [w, h] of sizes(12)) {
      const b = box(w, h);
      expect(b.offsetPx, `${w}×${h}: offset`).toBeGreaterThanOrEqual(0);
      expect(b.left, `${w}×${h}: left edge inside`).toBeGreaterThanOrEqual(0);
      expect(b.bottom, `${w}×${h}: bottom edge inside`).toBeLessThanOrEqual(h);
      expect(b.right).toBeLessThanOrEqual(w);
    }
  });

  it('never covers the centre (every item 26 px and up, square or not)', () => {
    for (const [w, h] of sizes(26)) expect(coversCentre(w, h), `${w}×${h}`).toBe(false);
  });

  it('keeps 4 px round the centre clear where the item has room (64 px and up)', () => {
    for (const [w, h] of sizes(64)) {
      const b = box(w, h);
      const clearX = b.left >= w / 2 + 4 || b.right <= w / 2 - 4;
      const clearY = b.top >= h / 2 + 4 || b.bottom <= h / 2 - 4;
      expect(clearX || clearY, `${w}×${h}`).toBe(true);
    }
  });

  it('a Small item (51–56 px at 1280–1416) still gets a 24 px handle inside its corner, its centre free', () => {
    for (const w of [51, 52, 53, 54, 55, 56]) {
      const b = box(w, w);
      expect(b.sizePx, `${w}`).toBe(HANDLE_MIN_PX);
      expect(b.offsetPx, `${w}`).toBeGreaterThanOrEqual(0);
      expect(coversCentre(w, w), `${w}`).toBe(false);
    }
  });

  it('at least 24×24 (a tap target) on every item 50 px and up, never more than 28', () => {
    for (let w = 50; w <= 600; w += 7) {
      const f = cornerHandleFit(w, w);
      expect(f.sizePx).toBeGreaterThanOrEqual(HANDLE_MIN_PX);
      expect(f.sizePx).toBeLessThanOrEqual(HANDLE_MAX_PX);
    }
    expect(HANDLE_MIN_PX).toBe(24);
  });

  it('a tiny item (under 50 px) gets a smaller handle rather than one over its centre or outside it', () => {
    const f = cornerHandleFit(40, 40);
    expect(f.sizePx).toBeLessThan(HANDLE_MIN_PX);
    expect(f.offsetPx).toBe(0);
    expect(coversCentre(40, 40)).toBe(false);
  });

  it('is sized to the item: a bigger item gets a bigger handle, up to the cap', () => {
    expect(cornerHandleFit(80, 80).sizePx).toBeLessThan(cornerHandleFit(300, 300).sizePx);
    expect(cornerHandleFit(300, 300).sizePx).toBe(HANDLE_MAX_PX);
  });

  it('an unmeasured item (0 or NaN) gets the plain default, inside', () => {
    expect(cornerHandleFit(0, 0)).toEqual({ sizePx: HANDLE_MAX_PX, offsetPx: 4 });
    expect(cornerHandleFit(NaN, 50)).toEqual({ sizePx: HANDLE_MAX_PX, offsetPx: 4 });
  });
});
