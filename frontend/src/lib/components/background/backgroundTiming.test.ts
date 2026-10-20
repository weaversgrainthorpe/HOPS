import { describe, it, expect } from 'vitest';
import {
  slideshowInterval,
  slideshowTransitionDuration,
  INTERVAL_MIN,
  INTERVAL_MAX,
  INTERVAL_DEFAULT,
  DURATION_MIN,
  DURATION_MAX,
  DURATION_DEFAULT
} from './backgroundTiming';

// Ruling 14: slideshow timing is clamped where it is used, never rejected.
describe('backgroundTiming', () => {
  it('has sane bounds around the v2 defaults', () => {
    expect([INTERVAL_MIN, INTERVAL_DEFAULT, INTERVAL_MAX]).toEqual([5, 30, 3600]);
    expect([DURATION_MIN, DURATION_DEFAULT, DURATION_MAX]).toEqual([0.5, 1.5, 5]);
  });

  it('interval: in range kept; out of range clamped; unset or non-numbers -> default', () => {
    expect(slideshowInterval(60)).toBe(60);
    expect(slideshowInterval(120)).toBe(120);
    expect(slideshowInterval(0.1)).toBe(5);
    expect(slideshowInterval(-5)).toBe(5);
    expect(slideshowInterval(1e9)).toBe(3600);
    expect(slideshowInterval(Infinity)).toBe(30);
    expect(slideshowInterval(NaN)).toBe(30);
    expect(slideshowInterval(undefined)).toBe(30);
    expect(slideshowInterval(null)).toBe(30);
    expect(slideshowInterval(0)).toBe(30);
    expect(slideshowInterval('30')).toBe(30);
    expect(slideshowInterval('7')).toBe(30);
    expect(slideshowInterval(true)).toBe(30);
  });

  it('transitionDuration: in range kept; out of range clamped; unset or non-numbers -> default', () => {
    expect(slideshowTransitionDuration(1.5)).toBe(1.5);
    expect(slideshowTransitionDuration(3)).toBe(3);
    expect(slideshowTransitionDuration(0.1)).toBe(0.5);
    expect(slideshowTransitionDuration(-1)).toBe(0.5);
    expect(slideshowTransitionDuration(1e9)).toBe(5);
    expect(slideshowTransitionDuration(NaN)).toBe(1.5);
    expect(slideshowTransitionDuration(undefined)).toBe(1.5);
    expect(slideshowTransitionDuration(0)).toBe(1.5);
    expect(slideshowTransitionDuration({})).toBe(1.5);
  });
});
