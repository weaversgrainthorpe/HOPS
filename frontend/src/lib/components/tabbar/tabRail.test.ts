import { describe, it, expect } from 'vitest';
import { railState, pageStep, revealScrollLeft, wheelDelta } from './tabRail';

// Scroll maths for the one-row tab rail. Pure functions; the DOM is read by the component.
describe('tabRail', () => {
  describe('railState', () => {
    it('reports no overflow and both ends when everything fits', () => {
      expect(railState({ scrollLeft: 0, clientWidth: 500, scrollWidth: 500 })).toEqual({
        overflow: false,
        atStart: true,
        atEnd: true
      });
    });

    it('reports overflow, at start, not at end', () => {
      expect(railState({ scrollLeft: 0, clientWidth: 500, scrollWidth: 3000 })).toEqual({
        overflow: true,
        atStart: true,
        atEnd: false
      });
    });

    it('reports at end when scrolled to the far edge', () => {
      expect(railState({ scrollLeft: 2500, clientWidth: 500, scrollWidth: 3000 }).atEnd).toBe(true);
    });
  });

  describe('pageStep', () => {
    it('is 80% of the view width', () => {
      expect(pageStep(500)).toBe(400);
    });

    it('is never less than 1', () => {
      expect(pageStep(0)).toBe(1);
    });
  });

  describe('revealScrollLeft', () => {
    it('returns null for a tab already fully visible with its margin', () => {
      expect(revealScrollLeft({ left: 100, width: 100 }, { scrollLeft: 0, clientWidth: 500, scrollWidth: 3000 })).toBeNull();
    });

    it('scrolls right just enough to show a tab past the right edge, plus margin', () => {
      expect(revealScrollLeft({ left: 2000, width: 100 }, { scrollLeft: 0, clientWidth: 500, scrollWidth: 3000 })).toBe(1624);
    });

    it('scrolls left to a tab left of the view, leaving the margin', () => {
      expect(revealScrollLeft({ left: 100, width: 100 }, { scrollLeft: 800, clientWidth: 500, scrollWidth: 3000 })).toBe(76);
    });

    it('a tab wider than the view aligns its left edge (minus the margin) and counts as visible once it is', () => {
      const m = { scrollLeft: 0, clientWidth: 300, scrollWidth: 3000 };
      expect(revealScrollLeft({ left: 1000, width: 500 }, m)).toBe(976); // scrolled so its start shows
      expect(revealScrollLeft({ left: 1000, width: 500 }, { ...m, scrollLeft: 976 })).toBeNull();
      expect(revealScrollLeft({ left: 1000, width: 500 }, { ...m, scrollLeft: 1100 })).toBe(976); // its start is off the left
      expect(revealScrollLeft({ left: 1000, width: 500 }, { ...m, scrollLeft: 1200 })).toBe(976);
      expect(revealScrollLeft({ left: 2900, width: 500 }, m)).toBe(2700); // clamped to the maximum scroll
    });

    it('never goes below 0 or above the maximum scroll', () => {
      expect(revealScrollLeft({ left: 0, width: 10 }, { scrollLeft: 300, clientWidth: 500, scrollWidth: 3000 })).toBe(0);
      expect(revealScrollLeft({ left: 2990, width: 10 }, { scrollLeft: 0, clientWidth: 500, scrollWidth: 3000 })).toBe(2500);
    });
  });

  describe('wheelDelta', () => {
    it('returns 0 at the end it is pushing against', () => {
      expect(wheelDelta(0, 100, { scrollLeft: 2500, clientWidth: 500, scrollWidth: 3000 })).toBe(0);
      expect(wheelDelta(0, -100, { scrollLeft: 0, clientWidth: 500, scrollWidth: 3000 })).toBe(0);
    });

    it('maps a vertical wheel onto the strip when there is room', () => {
      expect(wheelDelta(0, 100, { scrollLeft: 0, clientWidth: 500, scrollWidth: 3000 })).toBe(100);
    });

    it('leaves a mostly-horizontal gesture to the browser', () => {
      expect(wheelDelta(80, 10, { scrollLeft: 0, clientWidth: 500, scrollWidth: 3000 })).toBe(0);
    });

    it('returns 0 when the strip does not overflow', () => {
      expect(wheelDelta(0, 100, { scrollLeft: 0, clientWidth: 500, scrollWidth: 500 })).toBe(0);
    });
  });
});
