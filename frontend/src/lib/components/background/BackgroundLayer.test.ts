import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import BackgroundLayer from './BackgroundLayer.svelte';
import type { Background } from '$lib/types';

// jsdom never loads images, so a fake Image lets each test decide when a
// preload succeeds or fails, and records the order things happened in.
const events: string[] = [];
class FakeImage {
  static all: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';
  constructor() {
    FakeImage.all.push(this);
  }
  set src(v: string) {
    this._src = v;
    events.push(`preload:${v}`);
  }
  get src() {
    return this._src;
  }
  load() {
    this.onload?.();
  }
  fail() {
    this.onerror?.();
  }
}

/** The latest preload of `url`. */
function img(url: string): FakeImage {
  const found = [...FakeImage.all].reverse().find((i) => i.src === url);
  if (!found) throw new Error(`no preload of ${url}; preloads: ${FakeImage.all.map((i) => i.src).join(', ')}`);
  return found;
}

async function settle() {
  await tick();
  await tick();
}

function root(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('.background-root');
  if (!el) throw new Error('no .background-root rendered');
  return el;
}

function bgImages(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('.background-layer')].map((l) => l.style.backgroundImage);
}

function visibleImage(container: HTMLElement): string {
  return container.querySelector<HTMLElement>('.background-layer.visible')?.style.backgroundImage ?? '';
}

const slideshow = (images: string[], extra: Partial<Background> = {}): Background => ({
  type: 'slideshow',
  images,
  interval: 10,
  transition: 'crossfade',
  transitionDuration: 1,
  ...extra
});

describe('BackgroundLayer', () => {
  beforeEach(() => {
    FakeImage.all = [];
    events.length = 0;
    vi.stubGlobal('Image', FakeImage);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('viewport scope is fixed full-viewport; box scope fills its parent', async () => {
    const bg: Background = { type: 'color', value: '#123456' };
    const v = render(BackgroundLayer, { background: bg, scope: 'viewport' });
    expect(root(v.container).classList.contains('scope-viewport')).toBe(true);
    expect(root(v.container).classList.contains('scope-box')).toBe(false);
    v.unmount();
    const b = render(BackgroundLayer, { background: bg, scope: 'box' });
    expect(root(b.container).classList.contains('scope-box')).toBe(true);
    expect(root(b.container).classList.contains('scope-viewport')).toBe(false);
  });

  it('is decorative (aria-hidden)', () => {
    const { container } = render(BackgroundLayer, { background: { type: 'color', value: '#000' }, scope: 'box' });
    expect(root(container).getAttribute('aria-hidden')).toBe('true');
  });

  it('renders nothing for a bare inherit background or none', () => {
    const a = render(BackgroundLayer, { background: { inherit: true }, scope: 'box' });
    expect(a.container.querySelector('.background-root')).toBeNull();
    a.unmount();
    const b = render(BackgroundLayer, { background: undefined, scope: 'box' });
    expect(b.container.querySelector('.background-root')).toBeNull();
  });

  it('animate=false shows the first image still: no interval, no transition', async () => {
    const { container } = render(BackgroundLayer, {
      background: slideshow(['/backgrounds/a.jpg', '/backgrounds/b.jpg'], { transition: 'kenburns' }),
      scope: 'box',
      animate: false
    });
    await settle();
    img('/backgrounds/a.jpg').load();
    await settle();
    expect(visibleImage(container)).toBe('url("/backgrounds/a.jpg")');
    expect(vi.getTimerCount()).toBe(0);
    const layers = container.querySelectorAll('.background-layer');
    for (const l of layers) {
      expect(l.classList.contains('transition-none')).toBe(true);
      expect(l.className).not.toMatch(/kenburns/);
    }
    vi.advanceTimersByTime(60_000);
    await settle();
    expect(FakeImage.all.map((i) => i.src)).toEqual(['/backgrounds/a.jpg']);
  });

  it('animate=true advances through the slides with one interval', async () => {
    const { container } = render(BackgroundLayer, {
      background: slideshow(['/backgrounds/a.jpg', '/backgrounds/b.jpg']),
      scope: 'viewport',
      animate: true
    });
    await settle();
    img('/backgrounds/a.jpg').load();
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(10_000);
    await settle();
    img('/backgrounds/b.jpg').load();
    await settle();
    expect(visibleImage(container)).toBe('url("/backgrounds/b.jpg")');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('toggling animate off clears every timer at once', async () => {
    const onError = vi.fn();
    const r = render(BackgroundLayer, {
      background: slideshow(['/backgrounds/a.jpg', '/backgrounds/b.jpg'], { transition: 'curtain' }),
      scope: 'box',
      animate: true,
      onError
    });
    await settle();
    img('/backgrounds/a.jpg').load();
    await settle();
    vi.advanceTimersByTime(10_000);
    await settle();
    img('/backgrounds/b.jpg').load();
    await settle();
    // interval + curtain timeout both pending
    expect(vi.getTimerCount()).toBe(2);
    await r.rerender({ animate: false });
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    const before = FakeImage.all.length;
    vi.advanceTimersByTime(120_000);
    await settle();
    // no slide callback ran after the toggle (an initial re-preload of the first image is allowed)
    expect(FakeImage.all.slice(before).length).toBe(0);
    expect(r.container.querySelector('.curtain-overlay')).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('unmount clears the curtain timeout (and the interval)', async () => {
    const r = render(BackgroundLayer, {
      background: slideshow(['/backgrounds/a.jpg', '/backgrounds/b.jpg'], { transition: 'curtain' }),
      scope: 'viewport',
      animate: true
    });
    await settle();
    img('/backgrounds/a.jpg').load();
    await settle();
    vi.advanceTimersByTime(10_000);
    await settle();
    img('/backgrounds/b.jpg').load();
    await settle();
    expect(r.container.querySelector('.curtain-overlay')).not.toBeNull();
    expect(vi.getTimerCount()).toBe(2);
    r.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preloads the next image before swapping to it', async () => {
    const { container } = render(BackgroundLayer, {
      background: slideshow(['/backgrounds/a.jpg', '/backgrounds/b.jpg']),
      scope: 'viewport',
      animate: true
    });
    await settle();
    img('/backgrounds/a.jpg').load();
    await settle();
    vi.advanceTimersByTime(10_000);
    await settle();
    // Preload started, but nothing swapped yet: the hidden layer holds no b.jpg.
    expect(events).toContain('preload:/backgrounds/b.jpg');
    expect(bgImages(container).some((s) => s.includes('b.jpg'))).toBe(false);
    expect(visibleImage(container)).toBe('url("/backgrounds/a.jpg")');
    img('/backgrounds/b.jpg').load();
    await settle();
    expect(visibleImage(container)).toBe('url("/backgrounds/b.jpg")');
  });

  it('a failed preload reports the url and skips that slide without a blank', async () => {
    const onError = vi.fn();
    const { container } = render(BackgroundLayer, {
      background: slideshow(['/backgrounds/a.jpg', '/backgrounds/b.jpg', '/backgrounds/c.jpg']),
      scope: 'viewport',
      animate: true,
      onError
    });
    await settle();
    img('/backgrounds/a.jpg').load();
    await settle();
    vi.advanceTimersByTime(10_000);
    await settle();
    img('/backgrounds/b.jpg').fail();
    await settle();
    expect(onError).toHaveBeenCalledWith('/backgrounds/b.jpg');
    expect(visibleImage(container)).toBe('url("/backgrounds/a.jpg")');
    img('/backgrounds/c.jpg').load();
    await settle();
    expect(visibleImage(container)).toBe('url("/backgrounds/c.jpg")');
  });

  it('an invalid url calls onError and shows the fallback colour', async () => {
    const onError = vi.fn();
    const { container } = render(BackgroundLayer, {
      background: { type: 'image', value: 'javascript:alert(1)' },
      scope: 'box',
      onError,
      fallbackColor: 'rgb(1, 2, 3)'
    });
    await settle();
    expect(onError).toHaveBeenCalledWith('javascript:alert(1)');
    expect(FakeImage.all.length).toBe(0);
    const fb = container.querySelector<HTMLElement>('.background-fallback');
    expect(fb?.style.backgroundColor).toBe('rgb(1, 2, 3)');
    expect(container.innerHTML).not.toContain('javascript');
  });

  it.each([
    'data:image/png;base64,AAAA',
    'ftp://example.com/a.jpg',
    '/backgrounds/a.jpg") ; background: red; ("',
    "/backgrounds/it's.jpg",
    '/backgrounds/a(1).jpg',
    '/backgrounds/a\\b.jpg',
    '/backgrounds/a\nb.jpg',
    'example.com/a.jpg'
  ])('rejects %j', async (bad) => {
    const onError = vi.fn();
    const { container } = render(BackgroundLayer, {
      background: { type: 'image', value: bad },
      scope: 'box',
      onError,
      fallbackColor: '#000'
    });
    await settle();
    expect(onError).toHaveBeenCalledWith(bad);
    expect(FakeImage.all.length).toBe(0);
    expect(container.querySelector('.background-fallback')).not.toBeNull();
  });

  it('accepts http(s) and same-origin asset paths', async () => {
    const onError = vi.fn();
    const { container } = render(BackgroundLayer, {
      background: slideshow(['https://example.com/x y.jpg', '/presets/data-center.jpg'], { interval: 5 }),
      scope: 'box',
      animate: true,
      onError
    });
    await settle();
    img('https://example.com/x y.jpg').load();
    await settle();
    expect(visibleImage(container)).toBe('url("https://example.com/x y.jpg")');
    vi.advanceTimersByTime(5_000);
    await settle();
    img('/presets/data-center.jpg').load();
    await settle();
    expect(visibleImage(container)).toBe('url("/presets/data-center.jpg")');
    expect(onError).not.toHaveBeenCalled();
  });

  it('a single image that fails to load reports it and shows the fallback colour', async () => {
    const onError = vi.fn();
    const { container } = render(BackgroundLayer, {
      background: { type: 'image', value: '/backgrounds/gone.jpg' },
      scope: 'box',
      onError,
      fallbackColor: 'rgb(9, 9, 9)'
    });
    await settle();
    img('/backgrounds/gone.jpg').fail();
    await settle();
    expect(onError).toHaveBeenCalledWith('/backgrounds/gone.jpg');
    expect(container.querySelector<HTMLElement>('.background-fallback')?.style.backgroundColor).toBe('rgb(9, 9, 9)');
  });

  it('every slide failing shows the fallback colour and stops the interval', async () => {
    const onError = vi.fn();
    const { container } = render(BackgroundLayer, {
      background: slideshow(['/backgrounds/a.jpg', '/backgrounds/b.jpg']),
      scope: 'box',
      animate: true,
      onError,
      fallbackColor: 'rgb(4, 4, 4)'
    });
    await settle();
    img('/backgrounds/a.jpg').fail();
    await settle();
    img('/backgrounds/b.jpg').fail();
    await settle();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(container.querySelector<HTMLElement>('.background-fallback')?.style.backgroundColor).toBe('rgb(4, 4, 4)');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('opacity applies to the layer root only', async () => {
    const { container } = render(BackgroundLayer, {
      background: slideshow(['/backgrounds/a.jpg', '/backgrounds/b.jpg']),
      scope: 'box',
      opacity: 0.4
    });
    await settle();
    img('/backgrounds/a.jpg').load();
    await settle();
    expect(root(container).style.opacity).toBe('0.4');
    for (const l of container.querySelectorAll<HTMLElement>('.background-layer')) {
      expect(l.style.opacity).toBe('');
    }
  });

  it('keeps the fit behaviour', async () => {
    const { container } = render(BackgroundLayer, {
      background: { type: 'image', value: '/backgrounds/a.jpg', fit: 'fill' },
      scope: 'viewport'
    });
    await settle();
    img('/backgrounds/a.jpg').load();
    await settle();
    expect(container.querySelector<HTMLElement>('.background-layer.visible')?.style.backgroundSize).toBe('100% 100%');
  });
});
