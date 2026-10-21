import type { BackgroundImage } from '$lib/constants/backgrounds';

/**
 * Each URL once, keeping its first entry (walkthrough §1). The catalogue lists some files
 * under several names and categories, and selection is by URL, so duplicates would all
 * show as selected.
 */
export function dedupeByUrl(images: readonly BackgroundImage[]): BackgroundImage[] {
  const seen = new Set<string>();
  const out: BackgroundImage[] = [];
  for (const img of images) {
    if (seen.has(img.url)) continue;
    seen.add(img.url);
    out.push(img);
  }
  return out;
}

/**
 * The cards for one gallery view. "all": each URL once, as its first entry. A category:
 * each URL once if any of its entries has that category, shown as the first such entry.
 */
export function galleryImages(images: readonly BackgroundImage[], category: string): BackgroundImage[] {
  if (category === 'all') return dedupeByUrl(images);
  return dedupeByUrl(images.filter((img) => img.category === category));
}
