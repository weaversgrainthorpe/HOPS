import { describe, it, expect } from 'vitest';
import { camelParts, longestWordEm, widestSegmentEm } from './nameFit';

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
