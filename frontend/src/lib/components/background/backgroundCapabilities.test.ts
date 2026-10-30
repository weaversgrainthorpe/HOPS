import { describe, it, expect } from 'vitest';
import {
  backgroundCapabilities,
  BACKGROUND_LEVELS,
  BACKGROUND_CASES,
  type BackgroundLevel
} from './backgroundCapabilities';

// One table says what the background dialog shows, per level, runtime context and form
// state. This file is the authority: every expectation below is written out by hand.

const motion = (l: BackgroundLevel, runtime: Parameters<typeof backgroundCapabilities>[1], form = {}) => {
  const c = backgroundCapabilities(l, runtime, form);
  return [c.transitionPicker, c.interval, c.duration, c.kenBurns];
};
const ON = [true, true, true, true];
const OFF = [false, false, false, false];

describe('backgroundCapabilities', () => {
  it('walks every case: dashboard and tab x reduced motion x see-through; folder also x folder animations', () => {
    expect(BACKGROUND_LEVELS).toEqual(['dashboard', 'tab', 'folder']);
    const count = (l: BackgroundLevel) => BACKGROUND_CASES.filter((c) => c.level === l).length;
    expect([count('dashboard'), count('tab'), count('folder')]).toEqual([4, 4, 8]);
    // folderAnimationsOn is folder-only: the other levels' cases don't carry it.
    for (const c of BACKGROUND_CASES) {
      expect('folderAnimationsOn' in c.runtime).toBe(c.level === 'folder');
    }
  });

  it('picture types: every type at dashboard and tab; pictures only at folder', () => {
    const r = { reducedMotion: false };
    expect(backgroundCapabilities('dashboard', r).pictureTypes).toEqual(['none', 'color', 'image', 'slideshow']);
    expect(backgroundCapabilities('tab', r).pictureTypes).toEqual(['none', 'color', 'image', 'slideshow']);
    expect(backgroundCapabilities('folder', { ...r, folderAnimationsOn: true }).pictureTypes).toEqual(['image', 'slideshow']);
  });

  it('overlay darkness and blur: dashboard always; tab only when opaque; never at folder', () => {
    const r = { reducedMotion: false };
    expect(backgroundCapabilities('dashboard', r, { seeThrough: false }).overlay).toBe(true);
    expect(backgroundCapabilities('dashboard', r, { seeThrough: true }).overlay).toBe(true);
    expect(backgroundCapabilities('tab', r, { seeThrough: false }).overlay).toBe(true);
    expect(backgroundCapabilities('tab', r).overlay).toBe(true);
    const seeThroughTab = backgroundCapabilities('tab', r, { seeThrough: true });
    expect(seeThroughTab.overlay).toBe(false);
    expect(seeThroughTab.overlayNote).toBe('seeThroughTab');
    expect(backgroundCapabilities('tab', r, { seeThrough: false }).overlayNote).toBeNull();
    expect(backgroundCapabilities('dashboard', r, { seeThrough: true }).overlayNote).toBeNull();
    // Folders have no overlay of their own at all: nothing to explain.
    const f = backgroundCapabilities('folder', { ...r, folderAnimationsOn: true }, { seeThrough: true });
    expect(f.overlay).toBe(false);
    expect(f.overlayNote).toBeNull();
  });

  it('opacity everywhere', () => {
    for (const c of BACKGROUND_CASES) expect(backgroundCapabilities(c.level, c.runtime, c.form).opacity).toBe(true);
  });

  it('dashboard and tab: slideshow motion controls unless the device asks for reduced motion', () => {
    for (const l of ['dashboard', 'tab'] as const) {
      expect(motion(l, { reducedMotion: false })).toEqual(ON);
      expect(backgroundCapabilities(l, { reducedMotion: false }).motionNotes).toEqual([]);
      expect(motion(l, { reducedMotion: true })).toEqual(OFF);
      expect(backgroundCapabilities(l, { reducedMotion: true }).motionNotes).toEqual(['reducedMotion']);
    }
  });

  it('folder: motion controls only with "Animated folder backgrounds" on and no reduced motion', () => {
    expect(motion('folder', { folderAnimationsOn: true, reducedMotion: false })).toEqual(ON);
    expect(backgroundCapabilities('folder', { folderAnimationsOn: true, reducedMotion: false }).motionNotes).toEqual([]);
    expect(motion('folder', { folderAnimationsOn: false, reducedMotion: false })).toEqual(OFF);
    expect(backgroundCapabilities('folder', { folderAnimationsOn: false, reducedMotion: false }).motionNotes).toEqual(['folderAnimationsOff']);
    expect(backgroundCapabilities('folder', { folderAnimationsOn: true, reducedMotion: true }).motionNotes).toEqual(['reducedMotion']);
    expect(backgroundCapabilities('folder', { folderAnimationsOn: false, reducedMotion: true }).motionNotes).toEqual([
      'folderAnimationsOff',
      'reducedMotion'
    ]);
    // Unknown (not passed) at folder level is off: the folder surface shows it still until known.
    expect(motion('folder', { reducedMotion: false })).toEqual(OFF);
  });

  it('see-through never changes the motion controls', () => {
    expect(motion('tab', { reducedMotion: false }, { seeThrough: true })).toEqual(ON);
    expect(motion('folder', { folderAnimationsOn: true, reducedMotion: false }, { seeThrough: true })).toEqual(ON);
  });

  it('inherit wording per level', () => {
    const r = { reducedMotion: false };
    expect(backgroundCapabilities('dashboard', r).inherit).toMatchObject({ kind: 'switch', ownLabel: 'Show background picture' });
    expect(backgroundCapabilities('tab', r).inherit).toMatchObject({
      kind: 'radios', groupLabel: 'Tab background', inheritLabel: 'Same as the dashboard', ownLabel: 'Its own background'
    });
    expect(backgroundCapabilities('folder', r).inherit).toMatchObject({
      kind: 'picture-or-behind', groupLabel: 'Folder background',
      inheritLabel: "No picture of its own — show what's behind", ownLabel: 'Its own picture'
    });
    expect(backgroundCapabilities('folder', r).typeLabel).toBe('Picture type');
    expect(backgroundCapabilities('tab', r).typeLabel).toBe('Background Type');
  });

  it('is pure: the same input gives an equal answer and the result is frozen', () => {
    const a = backgroundCapabilities('tab', { reducedMotion: false }, { seeThrough: true });
    expect(backgroundCapabilities('tab', { reducedMotion: false }, { seeThrough: true })).toEqual(a);
    expect(Object.isFrozen(a)).toBe(true);
  });
});
