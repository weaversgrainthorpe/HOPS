import type { Background } from '$lib/types';

/**
 * One line, in words, for a dialog's background status (tab and folder dialogs).
 * `none` is what the level shows without a picture of its own, e.g. "Using the
 * dashboard background". The inherit form says its picture is kept.
 */
export function backgroundSummary(bg: Background | undefined, none: string): string {
  if (!bg || !bg.type) return none;
  const what =
    bg.type === 'color' ? `Colour ${bg.value ?? ''}`.trim()
    : bg.type === 'image' ? 'Image'
    : `Slideshow (${Array.isArray(bg.images) ? bg.images.length : 0} images)`;
  if (bg.inherit) return `${none} (own ${what.toLowerCase()} kept, switched off)`;
  const op = typeof bg.opacity === 'number' && Number.isFinite(bg.opacity) ? Math.min(1, Math.max(0, bg.opacity)) : 1;
  return op < 1 ? `${what}, ${Math.round(op * 100)}% opacity` : what;
}
