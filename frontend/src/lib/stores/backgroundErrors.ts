// Background images that were refused or failed to load. View mode stays
// quiet (console only, once per URL); edit mode reads this store to show the
// user which background images are broken.
import { writable, get } from 'svelte/store';

export const failedBackgroundUrls = writable<string[]>([]);

export function reportBackgroundError(url: string): void {
  if (get(failedBackgroundUrls).includes(url)) return;
  failedBackgroundUrls.update((urls) => [...urls, url]);
  console.error('Background image could not be shown', url);
}

export function clearBackgroundErrors(): void {
  failedBackgroundUrls.set([]);
}
