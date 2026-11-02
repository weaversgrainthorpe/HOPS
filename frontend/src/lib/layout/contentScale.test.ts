import { describe, it, expect } from 'vitest';
import { CONTENT_SCALE, camelParts, contentScaleOf, contentScaleProblem, longestWordEm, widestSegmentEm } from './contentScale';

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

describe('camel-case names break at their case boundary, not mid-word', () => {
  it('splits a word where a capital follows a lower-case letter', () => {
    expect(camelParts('HomeAssistant')).toEqual(['Home', 'Assistant']);
    expect(camelParts('nodeRedServer')).toEqual(['node', 'Red', 'Server']);
    expect(camelParts('WARP')).toEqual(['WARP']);
    expect(camelParts('HALo')).toEqual(['HALo']);
    expect(camelParts('HAV5')).toEqual(['HAV5']);
    expect(camelParts('')).toEqual(['']);
  });
  it('the widest camel segment is narrower than the whole word', () => {
    expect(widestSegmentEm('HomeAssistant')).toBeLessThan(longestWordEm('HomeAssistant'));
    expect(widestSegmentEm('HomeAssistant')).toBeCloseTo(longestWordEm('Assistant'), 5);
    expect(widestSegmentEm('WARP')).toBeCloseTo(longestWordEm('WARP'), 5);
  });
  it('the widest word is the widest by width, not by letter count (estimate: equal widths per letter)', () => {
    expect(longestWordEm('ab abcdef')).toBeCloseTo(longestWordEm('abcdef'), 5);
  });
});
