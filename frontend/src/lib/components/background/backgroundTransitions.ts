// Slideshow transition names. A stored name is never rejected (an odd value must not block an
// import or a migration); an unknown one is used as crossfade here, where it is rendered and
// picked. Without that, the layers get class transition-<unknown>, which has no .visible rule, and
// both stay at opacity 0: an invisible slideshow. HOPS 3.0.0's own Sample stored "fade".

export type TransitionName =
  | 'crossfade' | 'slide' | 'slide-up' | 'slide-down' | 'zoom' | 'zoom-out' | 'fade-black' | 'blur'
  | 'flip' | 'swirl' | 'wipe' | 'curtain' | 'circle' | 'diamond' | 'dissolve' | 'flash' | 'glitch'
  | 'kenburns' | 'none' | 'random';

export const TRANSITION_DEFAULT = 'crossfade';

/** The concrete effects 'random' picks from (every name except 'random' and 'none'). */
export const RANDOM_POOL: readonly TransitionName[] = [
  'crossfade', 'slide', 'slide-up', 'slide-down', 'zoom', 'zoom-out',
  'fade-black', 'blur', 'flip', 'kenburns', 'wipe', 'swirl',
  'dissolve', 'flash', 'glitch', 'curtain', 'circle', 'diamond'
];

const KNOWN = new Set<string>([...RANDOM_POOL, 'none', 'random']);

/** True for a name HOPS can draw; absent counts as known (it means the default). */
export function isKnownTransition(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (typeof v === 'string' && KNOWN.has(v));
}

/** The stored name if HOPS knows it, else crossfade. */
export function slideshowTransition(v: unknown): TransitionName {
  return typeof v === 'string' && KNOWN.has(v) ? (v as TransitionName) : TRANSITION_DEFAULT;
}

/** A random concrete effect for 'random'. */
export function randomTransition(): TransitionName {
  return RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)];
}
