import { describe, it, expect } from 'vitest';
import { fitLinks } from './navFit';

describe('fitLinks (Ruling 12: the links that fit, then More)', () => {
  it('all fit: all shown, no More', () => {
    expect(fitLinks([80, 90, 100], 8, 70, 80 + 8 + 90 + 8 + 100)).toBe(3);
  });
  it('not all fit: as many as fit beside the More button, in order', () => {
    // 80 + 8 + 90 + 8 + More 70 = 256 fits; adding 100 + 8 does not.
    expect(fitLinks([80, 90, 100], 8, 70, 260)).toBe(2);
  });
  it('room only for More: none shown', () => {
    expect(fitLinks([80, 90], 8, 70, 100)).toBe(0);
  });
  it('no room at all: none', () => {
    expect(fitLinks([80], 8, 70, 0)).toBe(0);
  });
  it('a link is never cut: the first link too wide waits in the menu even if a later one would fit', () => {
    expect(fitLinks([300, 20], 8, 70, 200)).toBe(0);
  });
  it('no links: zero', () => {
    expect(fitLinks([], 8, 70, 500)).toBe(0);
  });
  it('an unmeasured width never counts as fitting', () => {
    expect(fitLinks([80, NaN, 50], 8, 70, 1000)).toBe(1);
    expect(fitLinks([0], 8, 70, 1000)).toBe(0);
  });
});
