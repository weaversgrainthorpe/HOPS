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

  it('an unknown transition name (3.0.0 Sample\'s "fade") renders as crossfade, never invisible', async () => {
    const { container } = render(BackgroundLayer, {
      background: slideshow(['/backgrounds/a.jpg', '/backgrounds/b.jpg'], { transition: 'fade' as Background['transition'] }),
      scope: 'box',
      animate: true
    });
    await settle();
    for (const l of container.querySelectorAll('.background-layer')) {
      expect(l.classList.contains('transition-crossfade')).toBe(true);
      expect(l.classList.contains('transition-fade')).toBe(false);
    }
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

  it('clamps slideshow timing: a 0.1 s or negative interval ticks every 5 s, never faster', async () => {
    for (const interval of [0.1, -5]) {
      FakeImage.all = [];
      const r = render(BackgroundLayer, {
        background: slideshow(['/backgrounds/a.jpg', '/backgrounds/b.jpg'], { interval }),
        scope: 'viewport',
        animate: true
      });
      await settle();
      img('/backgrounds/a.jpg').load();
      await settle();
      vi.advanceTimersByTime(4_999);
      await settle();
      expect(FakeImage.all.some((i) => i.src === '/backgrounds/b.jpg'), `interval ${interval}: no swap before 5 s`).toBe(false);
      vi.advanceTimersByTime(1);
      await settle();
      expect(img('/backgrounds/b.jpg'), `interval ${interval}: swap at 5 s`).toBeTruthy();
      r.unmount();
    }
  });

  it('clamps slideshow timing: a huge transitionDuration reaches the styles and the curtain timeout as 5 s', async () => {
    const r = render(BackgroundLayer, {
      background: slideshow(['/backgrounds/a.jpg', '/backgrounds/b.jpg'], { transition: 'curtain', transitionDuration: 1e9 }),
      scope: 'viewport',
      animate: true
    });
    await settle();
    for (const l of r.container.querySelectorAll<HTMLElement>('.background-layer')) {
      expect(l.style.getPropertyValue('--transition-duration')).toBe('5s');
    }
    img('/backgrounds/a.jpg').load();
    await settle();
    vi.advanceTimersByTime(10_000);
    await settle();
    img('/backgrounds/b.jpg').load();
    await settle();
    const curtain = r.container.querySelector<HTMLElement>('.curtain-overlay');
    expect(curtain).not.toBeNull();
    expect(curtain!.style.getPropertyValue('--transition-duration')).toBe('5s');
    vi.advanceTimersByTime(5_000);
    await settle();
    expect(r.container.querySelector('.curtain-overlay')).toBeNull();
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

  it('animate off then on resumes at the current image (no restart, no re-preload)', async () => {
    const r = render(BackgroundLayer, {
      background: slideshow(['/backgrounds/a.jpg', '/backgrounds/b.jpg', '/backgrounds/c.jpg']),
      scope: 'box',
      animate: true
    });
    await settle();
    img('/backgrounds/a.jpg').load();
    await settle();
    vi.advanceTimersByTime(10_000);
    await settle();
    img('/backgrounds/b.jpg').load();
    await settle();
    await r.rerender({ animate: false });
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    const before = FakeImage.all.length;
    await r.rerender({ animate: true });
    await settle();
    expect(visibleImage(r.container)).toBe('url("/backgrounds/b.jpg")');
    expect(FakeImage.all.length).toBe(before);
    vi.advanceTimersByTime(10_000);
    await settle();
    expect(img('/backgrounds/c.jpg')).toBeTruthy();
  });

  it('paused from the start loads nothing; unpausing loads the first image', async () => {
    const r = render(BackgroundLayer, {
      background: slideshow(['/backgrounds/a.jpg', '/backgrounds/b.jpg']),
      scope: 'viewport',
      animate: true,
      paused: true
    });
    await settle();
    vi.advanceTimersByTime(60_000);
    expect(FakeImage.all.length).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await r.rerender({ paused: false });
    await settle();
    expect(img('/backgrounds/a.jpg')).toBeTruthy();
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

  it('unmount cancels an in-flight preload download', async () => {
    const r = render(BackgroundLayer, {
      background: slideshow(['/backgrounds/a.jpg', '/backgrounds/b.jpg']),
      scope: 'viewport',
      animate: true
    });
    await settle();
    img('/backgrounds/a.jpg').load();
    await settle();
    vi.advanceTimersByTime(10_000);
    await settle();
    const inFlight = img('/backgrounds/b.jpg');
    r.unmount();
    expect(inFlight.src).toBe('');
    expect(inFlight.onload).toBeNull();
    expect(inFlight.onerror).toBeNull();
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
    'example.com/a.jpg',
    '//evil.example/a.jpg',
    '/api/config',
    '/icons/x.png',
    '/backgrounds/../api/config'
  ])('rejects %j (onError + fallback)', async (bad) => {
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

  it.each([
    ['/backgrounds/photo (1).jpg', 'url("/backgrounds/photo (1).jpg")'],
    ["https://cdn.example/it's.jpg", 'url("https://cdn.example/it\'s.jpg")'],
    ['https://x.example/img(2).jpg', 'url("https://x.example/img(2).jpg")'],
    ['/presets/a\\b.jpg', 'url("/presets/a\\\\b.jpg")']
  ])('accepts %j and renders it escaped', async (good, css) => {
    const onError = vi.fn();
    const { container } = render(BackgroundLayer, {
      background: { type: 'image', value: good },
      scope: 'box',
      onError
    });
    await settle();
    img(good).load();
    await settle();
    expect(onError).not.toHaveBeenCalled();
    expect(visibleImage(container)).toBe(css);
  });

  it('a quote-breakout string renders inertly inside one url()', async () => {
    const evil = '/backgrounds/a.jpg") ; background: red; ("';
    const { container } = render(BackgroundLayer, {
      background: { type: 'image', value: evil },
      scope: 'box'
    });
    await settle();
    img(evil).load();
    await settle();
    const layer = container.querySelector<HTMLElement>('.background-layer.visible')!;
    expect(layer.style.backgroundColor).toBe('');
    expect(layer.style.background).not.toContain('red;');
    expect(layer.style.backgroundImage.startsWith('url("/backgrounds/a.jpg\\")')).toBe(true);
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
