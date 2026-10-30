// Slideshow timing bounds. Stored values are never rejected (an odd value must not
// block an import or prod's v2→v3 migration); they are clamped here, where they are used — the
// renderer's timers and styles, and the picker, which shows the clamped value.
//
// v2 defaults: interval 30 s, transition 1.5 s; the v2 picker offered 0.5–5 s transitions.

export const INTERVAL_MIN = 5;
export const INTERVAL_MAX = 3600;
export const INTERVAL_DEFAULT = 30;
export const DURATION_MIN = 0.5;
export const DURATION_MAX = 5;
export const DURATION_DEFAULT = 1.5;

/**
 * A finite number clamped to [min, max]; anything else, or 0 (the "unset" value Go's omitempty
 * and v2 used), gives the default.
 */
function bounded(v: unknown, min: number, max: number, dflt: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) return dflt;
  return Math.min(max, Math.max(min, v));
}

/** Seconds between slides, clamped to [INTERVAL_MIN, INTERVAL_MAX]. */
export function slideshowInterval(v: unknown): number {
  return bounded(v, INTERVAL_MIN, INTERVAL_MAX, INTERVAL_DEFAULT);
}

/** Seconds a transition takes, clamped to [DURATION_MIN, DURATION_MAX]. */
export function slideshowTransitionDuration(v: unknown): number {
  return bounded(v, DURATION_MIN, DURATION_MAX, DURATION_DEFAULT);
}
