import { describe, it, expect } from 'vitest';
import {
  backgroundCapabilities,
  BACKGROUND_LEVELS,
  ALL_BACKGROUND_CONTEXTS,
  type BackgroundContext
} from './backgroundCapabilities';

// M6 §8.2: one table says what the background dialog shows, per level and runtime context.
const ctx = (folderAnimationsOn: boolean, reducedMotion: boolean): BackgroundContext => ({ folderAnimationsOn, reducedMotion });

describe('backgroundCapabilities (M6 §8.2)', () => {
  it('covers every level x context (4 contexts per level)', () => {
    expect(BACKGROUND_LEVELS).toEqual(['dashboard', 'tab', 'folder']);
    expect(ALL_BACKGROUND_CONTEXTS).toHaveLength(4);
  });

  it('picture types: every type at dashboard and tab; pictures only at folder', () => {
    for (const c of ALL_BACKGROUND_CONTEXTS) {
      expect(backgroundCapabilities('dashboard', c).pictureTypes).toEqual(['none', 'color', 'image', 'slideshow']);
      expect(backgroundCapabilities('tab', c).pictureTypes).toEqual(['none', 'color', 'image', 'slideshow']);
      expect(backgroundCapabilities('folder', c).pictureTypes).toEqual(['image', 'slideshow']);
    }
  });

  it('overlay darkness and blur only at dashboard and tab; opacity everywhere', () => {
    for (const c of ALL_BACKGROUND_CONTEXTS) {
      expect(backgroundCapabilities('dashboard', c).overlay).toBe(true);
      expect(backgroundCapabilities('tab', c).overlay).toBe(true);
      expect(backgroundCapabilities('folder', c).overlay).toBe(false);
      for (const l of BACKGROUND_LEVELS) expect(backgroundCapabilities(l, c).opacity).toBe(true);
    }
  });

  it('dashboard and tab: slideshow motion controls unless the device asks for reduced motion', () => {
    for (const l of ['dashboard', 'tab'] as const) {
      for (const on of [true, false]) {
        const moving = backgroundCapabilities(l, ctx(on, false));
        expect([moving.transitionPicker, moving.interval, moving.duration, moving.kenBurns]).toEqual([true, true, true, true]);
        expect(moving.motionNotes).toEqual([]);
        const still = backgroundCapabilities(l, ctx(on, true));
        expect([still.transitionPicker, still.interval, still.duration, still.kenBurns]).toEqual([false, false, false, false]);
        expect(still.motionNotes).toEqual(['reducedMotion']);
      }
    }
  });

  it('folder: motion controls only with "Animated folder backgrounds" on and no reduced motion', () => {
    const on = backgroundCapabilities('folder', ctx(true, false));
    expect([on.transitionPicker, on.interval, on.duration, on.kenBurns]).toEqual([true, true, true, true]);
    expect(on.motionNotes).toEqual([]);
    const off = backgroundCapabilities('folder', ctx(false, false));
    expect([off.transitionPicker, off.interval, off.duration, off.kenBurns]).toEqual([false, false, false, false]);
    expect(off.motionNotes).toEqual(['folderAnimationsOff']);
    expect(backgroundCapabilities('folder', ctx(true, true)).motionNotes).toEqual(['reducedMotion']);
    expect(backgroundCapabilities('folder', ctx(false, true)).motionNotes).toEqual(['folderAnimationsOff', 'reducedMotion']);
  });

  it('inherit wording per level', () => {
    const c = ctx(true, false);
    expect(backgroundCapabilities('dashboard', c).inherit).toMatchObject({ kind: 'switch', ownLabel: 'Show background picture' });
    expect(backgroundCapabilities('tab', c).inherit).toMatchObject({
      kind: 'radios', groupLabel: 'Tab background', inheritLabel: 'Same as the dashboard', ownLabel: 'Its own background'
    });
    expect(backgroundCapabilities('folder', c).inherit).toMatchObject({
      kind: 'picture-or-behind', groupLabel: 'Folder background',
      inheritLabel: "No picture of its own — show what's behind", ownLabel: 'Its own picture'
    });
    expect(backgroundCapabilities('folder', c).typeLabel).toBe('Picture type');
    expect(backgroundCapabilities('tab', c).typeLabel).toBe('Background Type');
  });

  it('is pure: the same input gives an equal answer and the result is frozen', () => {
    const a = backgroundCapabilities('folder', ctx(false, false));
    expect(backgroundCapabilities('folder', ctx(false, false))).toEqual(a);
    expect(Object.isFrozen(a)).toBe(true);
  });
});
