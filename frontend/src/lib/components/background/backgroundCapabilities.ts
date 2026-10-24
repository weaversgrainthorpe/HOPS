/**
 * What the background dialog offers, per level and runtime context (M6 §8.2): one table, so the
 * one BackgroundSection component shows a control only where it has an effect.
 *
 * Why each row is what it is (the renderers are the source of truth):
 * - Folders are pictures only (§7.5): Edit Folder owns the folder's colour, so no Color / None.
 * - Folders have no overlay darkness or blur of their own: the canvas has one overlay (design call 1).
 * - Slideshow motion (interval, transition, duration, Ken Burns) only plays when the layer animates:
 *   BackgroundLayer with animate=false shows the current (first) image still, with no timer. That is
 *   the case under prefers-reduced-motion at every level (Dashboard.svelte), and for folders when the
 *   dashboard's "Animated folder backgrounds" is off (FolderSurface / backgroundAnimation).
 *   Then the controls are replaced by a note, and their stored values are kept as they are.
 */

export type BackgroundLevel = 'dashboard' | 'tab' | 'folder';
export type PictureType = 'none' | 'color' | 'image' | 'slideshow';

export interface BackgroundContext {
  /** The dashboard's effective "Animated folder backgrounds" setting (only folders read it). */
  folderAnimationsOn: boolean;
  /** This device asks for reduced motion (prefers-reduced-motion). */
  reducedMotion: boolean;
}

/** Why the slideshow motion controls are not shown: each one is a visible note. */
export type MotionNote = 'folderAnimationsOff' | 'reducedMotion';

export type InheritWording =
  /** One switch: on = this level's own picture. */
  | { kind: 'switch'; ownLabel: string; inheritHint: string; ownHint: string }
  /** Two radios: the parent's background, or its own. */
  | { kind: 'radios'; groupLabel: string; inheritLabel: string; ownLabel: string; keptHint: string }
  /** Two radios: no picture of its own (what's behind shows), or its own picture (controls only then). */
  | { kind: 'picture-or-behind'; groupLabel: string; inheritLabel: string; ownLabel: string; keptHint: string };

export interface BackgroundCapabilities {
  pictureTypes: readonly PictureType[];
  /** The picture-type group's label. */
  typeLabel: string;
  inherit: InheritWording;
  /** Image fit (cover / contain / fill), for an image or a slideshow. */
  fit: boolean;
  /** This level's show-through opacity. */
  opacity: boolean;
  /** "Lower lets what is behind this … show through." */
  opacityNoun: string;
  /** Overlay darkness and blur. */
  overlay: boolean;
  transitionPicker: boolean;
  interval: boolean;
  duration: boolean;
  /** The Ken Burns transition. */
  kenBurns: boolean;
  /** Shown in place of the motion controls, for a slideshow. */
  motionNotes: readonly MotionNote[];
}

export const BACKGROUND_LEVELS: readonly BackgroundLevel[] = Object.freeze(['dashboard', 'tab', 'folder'] as const);

/** Every runtime context, for tests that walk the whole table. */
export const ALL_BACKGROUND_CONTEXTS: readonly BackgroundContext[] = Object.freeze(
  [true, false].flatMap((folderAnimationsOn) =>
    [false, true].map((reducedMotion) => Object.freeze({ folderAnimationsOn, reducedMotion }))
  )
);

const ALL_TYPES: readonly PictureType[] = Object.freeze(['none', 'color', 'image', 'slideshow'] as const);
const PICTURES_ONLY: readonly PictureType[] = Object.freeze(['image', 'slideshow'] as const);

const INHERIT: Record<BackgroundLevel, InheritWording> = {
  dashboard: {
    kind: 'switch',
    ownLabel: 'Show background picture',
    inheritHint: 'No picture. Your chosen picture is kept, so turning this back on restores it.',
    ownHint: 'Shown behind the whole dashboard.'
  },
  tab: {
    kind: 'radios',
    groupLabel: 'Tab background',
    inheritLabel: 'Same as the dashboard',
    ownLabel: 'Its own background',
    keptHint: "This tab's own picture is kept for when you switch back."
  },
  folder: {
    kind: 'picture-or-behind',
    groupLabel: 'Folder background',
    inheritLabel: "No picture of its own — show what's behind",
    ownLabel: 'Its own picture',
    keptHint: "This folder's own picture is kept for when you switch back."
  }
};

export function backgroundCapabilities(level: BackgroundLevel, context: BackgroundContext): BackgroundCapabilities {
  const isFolder = level === 'folder';
  const notes: MotionNote[] = [];
  if (isFolder && !context.folderAnimationsOn) notes.push('folderAnimationsOff');
  if (context.reducedMotion) notes.push('reducedMotion');
  const motion = notes.length === 0;
  return Object.freeze({
    pictureTypes: isFolder ? PICTURES_ONLY : ALL_TYPES,
    typeLabel: isFolder ? 'Picture type' : 'Background Type',
    inherit: INHERIT[level],
    fit: true,
    opacity: true,
    opacityNoun: level,
    overlay: !isFolder,
    transitionPicker: motion,
    interval: motion,
    duration: motion,
    kenBurns: motion,
    motionNotes: Object.freeze(notes)
  });
}
