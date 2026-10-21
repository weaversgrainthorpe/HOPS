import { describe, it, expect } from 'vitest';
import { dedupeByUrl, galleryImages } from './galleryImages';
import { BACKGROUND_PRESETS, type BackgroundImage } from '$lib/constants/backgrounds';

const img = (id: string, url: string, category: string, name = id): BackgroundImage => ({
  id, name, category, url, source: 'preset'
});

describe('dedupeByUrl', () => {
  it('keeps the first entry of each URL, in order', () => {
    const out = dedupeByUrl([img('a', '/x.jpg', 'c1'), img('b', '/y.jpg', 'c1'), img('c', '/x.jpg', 'c2')]);
    expect(out.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('galleryImages', () => {
  const list = [img('a', '/x.jpg', 'c1', 'First'), img('b', '/y.jpg', 'c1'), img('c', '/x.jpg', 'c2', 'Second'), img('d', '/x.jpg', 'c2')];
  it('"all" lists each URL once, using its first entry', () => {
    expect(galleryImages(list, 'all').map((i) => [i.id, i.name, i.category])).toEqual([['a', 'First', 'c1'], ['b', 'b', 'c1']]);
  });
  it('a category view lists a URL once if any of its entries has that category', () => {
    expect(galleryImages(list, 'c2').map((i) => i.url)).toEqual(['/x.jpg']);
    expect(galleryImages(list, 'c1').map((i) => i.url)).toEqual(['/x.jpg', '/y.jpg']);
    expect(galleryImages(list, 'none')).toEqual([]);
  });
  it('the bundled catalogue shows every picture exactly once in "all"', () => {
    const urls = galleryImages(BACKGROUND_PRESETS, 'all').map((i) => i.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.length).toBe(new Set(BACKGROUND_PRESETS.map((p) => p.url)).size);
  });
});
