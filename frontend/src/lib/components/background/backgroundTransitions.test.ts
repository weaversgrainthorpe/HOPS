import { describe, it, expect } from 'vitest';
import { isKnownTransition, slideshowTransition, randomTransition, RANDOM_POOL } from './backgroundTransitions';

describe('slideshow transitions', () => {
  it('keeps a known name', () => {
    expect(slideshowTransition('kenburns')).toBe('kenburns');
    expect(slideshowTransition('none')).toBe('none');
    expect(slideshowTransition('random')).toBe('random');
  });

  it('uses crossfade for an unknown, absent or non-string name', () => {
    for (const v of ['fade', 'FADE', '', undefined, null, 3, {}]) expect(slideshowTransition(v)).toBe('crossfade');
  });

  it('calls only unknown stored names unknown', () => {
    expect(isKnownTransition('fade')).toBe(false);
    expect(isKnownTransition(7)).toBe(false);
    expect(isKnownTransition('curtain')).toBe(true);
    expect(isKnownTransition(undefined)).toBe(true);
    expect(isKnownTransition('')).toBe(true);
  });

  it('random never picks random or none', () => {
    for (let i = 0; i < 200; i++) expect(RANDOM_POOL).toContain(randomTransition());
    expect(RANDOM_POOL).not.toContain('random');
    expect(RANDOM_POOL).not.toContain('none');
  });
});
