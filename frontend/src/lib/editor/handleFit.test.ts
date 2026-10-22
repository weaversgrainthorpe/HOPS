// M5 walkthrough 1 (C): an item's edit handle sits in its top-right corner, sized to the item, and
// never covers the item's centre — so a click in the middle always reaches the item (opens a
// minimised folder, selects a tile), never the Edit dialog. It is always at least 24×24 to tap; an
// item too small to hold one clear of its centre has it hung just outside its corner.
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

describe('cornerHandleFit: the corner edit handle never covers the item\'s centre', () => {
  it('never covers the centre, at every item size (Small 24 px up to Large 600 px, square or not)', () => {
    for (let w = 24; w <= 600; w += 1) {
      for (const h of [w, Math.round(w * 0.6), Math.round(w * 1.5)]) {
        expect(coversCentre(w, h), `${w}×${h}`).toBe(false);
        // A margin round the centre stays clear too (a click a hair off-centre).
        const b = box(w, h);
        const clearX = b.left >= w / 2 + 4 || b.right <= w / 2 - 4;
        const clearY = b.top >= h / 2 + 4 || b.bottom <= h / 2 - 4;
        expect(clearX || clearY, `${w}×${h} keeps 4 px round the centre`).toBe(true);
      }
    }
  });

  it('is always at least 24×24 (a tap target) and never more than 28', () => {
    for (let w = 24; w <= 600; w += 7) {
      const f = cornerHandleFit(w, w);
      expect(f.sizePx).toBeGreaterThanOrEqual(HANDLE_MIN_PX);
      expect(f.sizePx).toBeLessThanOrEqual(HANDLE_MAX_PX);
      expect(HANDLE_MIN_PX).toBe(24);
    }
  });

  it('is sized to the item: a bigger item gets a bigger handle, up to the cap', () => {
    expect(cornerHandleFit(80, 80).sizePx).toBeLessThan(cornerHandleFit(300, 300).sizePx);
    expect(cornerHandleFit(300, 300).sizePx).toBe(HANDLE_MAX_PX);
  });

  it('inside the corner when it fits clear of the centre (Medium and up, and a roomy Small)', () => {
    for (const w of [77, 101, 154, 202, 309]) {
      const f = cornerHandleFit(w, w);
      expect(f.outside, `${w}`).toBe(false);
      expect(f.offsetPx).toBeGreaterThanOrEqual(0);
    }
  });

  it('a Small item too small to hold it clear of its centre: hung just outside the corner, still touching it', () => {
    for (const w of [24, 40, 50, 56]) {
      const f = cornerHandleFit(w, w);
      expect(f.outside, `${w}`).toBe(true);
      expect(f.offsetPx).toBeLessThan(0);
      // Still overlaps the item's corner, so the pointer can move from the item onto it.
      expect(-f.offsetPx).toBeLessThan(f.sizePx);
    }
    // At most 8 px past the item where that is enough (a folder page's padding is 8 px).
    expect(cornerHandleFit(56, 56).offsetPx).toBe(-8);
  });

  it('an unmeasured item (0 or NaN) gets the plain default, inside', () => {
    expect(cornerHandleFit(0, 0)).toEqual({ sizePx: HANDLE_MAX_PX, offsetPx: 4, outside: false });
    expect(cornerHandleFit(NaN, 50)).toEqual({ sizePx: HANDLE_MAX_PX, offsetPx: 4, outside: false });
  });
});
