import { describe, it, expect } from 'vitest';
import { CONTENT_SCALE, contentScaleOf, contentScaleProblem, longestWordEm } from './contentScale';

describe('contentScaleOf: the dashboard\'s tile content size as drawn', () => {
  it('draws a valid value as itself', () => {
    for (const v of [75, 80, 100, 110, 125]) expect(contentScaleOf(v)).toBe(v);
  });
  it('a missing field is 100', () => {
    expect(contentScaleOf(undefined)).toBe(100);
  });
  it('draws anything the server would refuse at 100 (never a conversion of stored data)', () => {
    for (const v of [null, 70, 130, 102, 97.5, '110', NaN, Infinity, true, {}]) expect(contentScaleOf(v)).toBe(100);
  });
  it('says what is wrong with a value the server would refuse', () => {
    expect(contentScaleProblem(undefined)).toBeNull();
    expect(contentScaleProblem(110)).toBeNull();
    expect(contentScaleProblem(130)).toMatch(/75 to 125/);
    expect(contentScaleProblem('x')).toMatch(/75 to 125/);
  });
  it('the slider range', () => {
    expect(CONTENT_SCALE).toEqual({ min: 75, max: 125, step: 5, normal: 100 });
  });
});

describe('longestWordEm: how wide the longest word of a name is, in em', () => {
  it('measures the longest word (an estimate without a canvas)', () => {
    const one = longestWordEm('HomeAssistant');
    expect(one).toBeGreaterThan(5);
    expect(longestWordEm('Home Assistant')).toBeLessThan(one);
    expect(longestWordEm('Home Assistant')).toBeCloseTo(longestWordEm('Assistant'), 5);
  });
  it('an empty name is a sensible 1em', () => {
    expect(longestWordEm('')).toBe(1);
    expect(longestWordEm('   ')).toBe(1);
  });
});
