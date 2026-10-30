// Background images that were refused or failed to load. View mode stays
// quiet (console only, once per URL); edit mode reads this store to show the
// user which background images are broken.
import { writable, get } from 'svelte/store';
import type { Background } from '$lib/types';

export const failedBackgroundUrls = writable<string[]>([]);

export function reportBackgroundError(url: string): void {
  if (get(failedBackgroundUrls).includes(url)) return;
  failedBackgroundUrls.update((urls) => [...urls, url]);
  console.error('Background image could not be shown', url);
}

export function clearBackgroundErrors(): void {
  failedBackgroundUrls.set([]);
}

/**
 * A URL that failed earlier has now loaded: drop it, so the
 * edit-mode indicator never shows a stale failure.
 */
export function markBackgroundLoaded(url: string): void {
  if (!get(failedBackgroundUrls).includes(url)) return;
  failedBackgroundUrls.update((urls) => urls.filter((u) => u !== url));
}

/** The image URLs a level's own background references (none for inherit or colour). */
export function backgroundUrlsOf(bg: Background | undefined): string[] {
  if (!bg || bg.inherit) return [];
  if (bg.type === 'image') return typeof bg.value === 'string' && bg.value ? [bg.value] : [];
  if (bg.type === 'slideshow') return Array.isArray(bg.images) ? bg.images.map((u) => String(u)) : [];
  return [];
}

/** The failed URLs that this level still references. */
export function failedFor(bg: Background | undefined, failed: readonly string[]): string[] {
  const mine = backgroundUrlsOf(bg);
  return failed.filter((u) => mine.includes(u));
}
