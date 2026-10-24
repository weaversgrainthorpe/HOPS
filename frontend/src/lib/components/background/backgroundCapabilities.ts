/**
 * What the background dialog offers, per level, runtime context and form state (M6 §8.2): one
 * table, so the one BackgroundSection component shows a control only where it has an effect.
 *
 * Why each row is what it is (the renderers are the source of truth):
 * - Folders are pictures only (§7.5): Edit Folder owns the folder's colour, so no Color / None.
 * - Folders have no overlay darkness or blur of their own: the canvas has one overlay (design call 1).
 * - Slideshow motion (interval, transition, duration, Ken Burns) only plays when the layer animates:
 *   BackgroundLayer with animate=false shows the current (first) image still, with no timer. That is
 *   the case under prefers-reduced-motion at every level (Dashboard.svelte), and for folders when the
 *   dashboard's "Animated folder backgrounds" is off (FolderSurface / backgroundAnimation).
 *   Then the controls are replaced by a note, and their stored values are kept as they are.
 * - The canvas overlay comes from the topmost FULLY OPAQUE layer (Dashboard.svelte): a see-through
 *   tab (opacity below 1) uses the dashboard's darkness and blur, so its own are replaced by a note.
 */

export type BackgroundLevel = 'dashboard' | 'tab' | 'folder';
export type PictureType = 'none' | 'color' | 'image' | 'slideshow';

/** Runtime conditions, from the host dialog. */
export interface BackgroundContext {
  /** This device asks for reduced motion (prefers-reduced-motion). Every level. */
  reducedMotion: boolean;
  /**
   * FOLDER LEVEL ONLY: the dashboard's effective "Animated folder backgrounds" setting. The other
   * levels ignore it, and their hosts don't pass it. At folder level, missing means off — a folder
   * slideshow shows its first image still until the setting is known (as the folder surface does).
   */
  folderAnimationsOn?: boolean;
}

/** The form's own state the table reads (it changes as the user edits). */
export interface BackgroundFormState {
  /** This level's opacity is below 1: what is behind shows through. */
  seeThrough?: boolean;
}

/** Why the overlay controls are not shown, where that needs saying. */
export type OverlayNote = 'seeThroughTab';

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
  /** Shown in place of the overlay controls (null: none, e.g. folders, which never have them). */
  overlayNote: OverlayNote | null;
  transitionPicker: boolean;
  interval: boolean;
  duration: boolean;
  /** The Ken Burns transition. */
  kenBurns: boolean;
  /** Shown in place of the motion controls, for a slideshow. */
  motionNotes: readonly MotionNote[];
}

export const BACKGROUND_LEVELS: readonly BackgroundLevel[] = Object.freeze(['dashboard', 'tab', 'folder'] as const);

/** One cell of the table, for tests that walk all of it. */
export interface BackgroundCase {
  level: BackgroundLevel;
  runtime: BackgroundContext;
  form: BackgroundFormState;
}

/**
 * Every case: each level x reduced motion x see-through, and for folders also x "Animated folder
 * backgrounds" (the other levels' runtime never carries it).
 */
export const BACKGROUND_CASES: readonly BackgroundCase[] = Object.freeze(
  BACKGROUND_LEVELS.flatMap((level) =>
    (level === 'folder' ? [true, false] : [undefined]).flatMap((folderAnimationsOn) =>
      [false, true].flatMap((reducedMotion) =>
        [false, true].map((seeThrough) =>
          Object.freeze({
            level,
            runtime: Object.freeze(folderAnimationsOn === undefined ? { reducedMotion } : { reducedMotion, folderAnimationsOn }),
            form: Object.freeze({ seeThrough })
          })
        )
      )
    )
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

export function backgroundCapabilities(
  level: BackgroundLevel,
  context: BackgroundContext,
  form: BackgroundFormState = {}
): BackgroundCapabilities {
  const isFolder = level === 'folder';
  const notes: MotionNote[] = [];
  if (isFolder && context.folderAnimationsOn !== true) notes.push('folderAnimationsOff');
  if (context.reducedMotion) notes.push('reducedMotion');
  const seeThroughTab = level === 'tab' && form.seeThrough === true;
  const motion = notes.length === 0;
  return Object.freeze({
    pictureTypes: isFolder ? PICTURES_ONLY : ALL_TYPES,
    typeLabel: isFolder ? 'Picture type' : 'Background Type',
    inherit: INHERIT[level],
    fit: true,
    opacity: true,
    opacityNoun: level,
    overlay: !isFolder && !seeThroughTab,
    overlayNote: seeThroughTab ? 'seeThroughTab' : null,
    transitionPicker: motion,
    interval: motion,
    duration: motion,
    kenBurns: motion,
    motionNotes: Object.freeze(notes)
  });
}
