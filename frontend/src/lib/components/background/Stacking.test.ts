// Milestone 4 Task 4: layered backgrounds — dashboard, tab, folder, overlay, failures.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';

vi.mock('$app/stores', async () => {
  const { writable } = await import('svelte/store');
  const page = writable({ url: new URL('http://localhost/'), params: {}, route: { id: '/' }, status: 200, error: null, data: {}, form: undefined });
  return { page, navigating: writable(null), updated: writable(false) };
});

import Dashboard from '../Dashboard.svelte';
import TabCanvas from '../layout/TabCanvas.svelte';
import { config } from '$lib/stores/config';
import { editMode } from '$lib/stores/editMode';
import { isAuthenticated } from '$lib/stores/auth';
import { resetFolderViewsForTests, setFolderDrill } from '$lib/stores/folderView';
import { failedBackgroundUrls, clearBackgroundErrors } from '$lib/stores/backgroundErrors';
import { begin, resetEditSessionForTests } from '$lib/stores/editSession';
import type { Background } from '$lib/types';
import type { LayoutDashboard, LayoutTab } from '$lib/types/layout';

// ---- fakes ----------------------------------------------------------------

class FakeRO {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.cb = cb; }
  observe(el: Element) {
    this.cb([{ target: el, contentRect: { width: 1440 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

/** jsdom never loads images: each test decides when a preload succeeds or fails. */
class FakeImage {
  static all: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';
  constructor() { FakeImage.all.push(this); }
  set src(v: string) { this._src = v; }
  get src() { return this._src; }
}
function img(url: string): FakeImage {
  const found = [...FakeImage.all].reverse().find((i) => i.src === url);
  if (!found) throw new Error(`no preload of ${url}; preloads: ${FakeImage.all.map((i) => i.src).join(', ')}`);
  return found;
}
async function settle() { for (let i = 0; i < 4; i++) await tick(); }

let reduced = false;
function stubMatchMedia() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('reduce') ? reduced : false,
    media: q,
    addEventListener() {},
    removeEventListener() {}
  }));
}

// ---- fixtures ---------------------------------------------------------------

const tile = (id: string, name: string, x = 0, y = 0): any => ({
  kind: 'tile', id, name, url: 'http://x.test', icon: '', openMode: 'newtab', size: 'medium', order: 0, placement: { x, y, w: 2, h: 2 }
});
const folder = (id: string, name: string, children: any[], extra: any = {}): any => ({
  kind: 'folder', id, name, display: 'expanded', size: 'medium', contentSize: 'medium', placement: { x: 0, y: 2, w: 8, h: 6 },
  content: { children: children.map(({ placement: _p, ...c }) => c) }, ...extra // M5: folder contents have no placements
});
const image = (value: string, extra: Partial<Background> = {}): Background => ({ type: 'image', value, ...extra });
const slideshow = (images: string[], extra: Partial<Background> = {}): Background => ({
  type: 'slideshow', images, interval: 10, transition: 'crossfade', transitionDuration: 1, ...extra
});

function dash(over: Partial<LayoutDashboard> = {}, tabs?: LayoutTab[]): LayoutDashboard {
  return {
    id: 'd1', name: 'Home', path: '/home', revision: 1,
    display: { animatedFolderBackgrounds: true },
    tabs: tabs ?? [
      { id: 't1', name: 'Main', root: { columns: 24, children: [tile('m1', 'MainTile')] } },
      { id: 't2', name: 'Second', root: { columns: 24, children: [tile('s1', 'SecondTile')] } }
    ],
    ...over
  } as LayoutDashboard;
}

function layer(container: Element, level: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`.background-root[data-bg-level="${level}"]`);
}
function panel(container: Element): HTMLElement {
  const el = container.querySelector<HTMLElement>('.canvas-panel');
  if (!el) throw new Error('no canvas panel');
  return el;
}

beforeEach(() => {
  reduced = false;
  FakeImage.all = [];
  vi.stubGlobal('ResizeObserver', FakeRO);
  vi.stubGlobal('Image', FakeImage);
  stubMatchMedia();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  resetEditSessionForTests();
  clearBackgroundErrors();
  localStorage.clear();
  resetFolderViewsForTests();
  editMode.set(false);
  isAuthenticated.set(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  resetFolderViewsForTests();
  editMode.set(false);
  isAuthenticated.set(false);
  config.set(null);
  clearBackgroundErrors();
});

// ---- dashboard + tab --------------------------------------------------------

describe('dashboard and tab layers', () => {
  const dashBg = slideshow(['/backgrounds/d1.jpg', '/backgrounds/d2.jpg'], { overlayOpacity: 0.4, overlayBlur: 3 });

  it('the overlay vars come from the dashboard, or from the tab when the tab is fully opaque', async () => {
    const d = dash({ background: dashBg }, [
      { id: 't1', name: 'Plain', root: { columns: 24, children: [] } },
      { id: 't2', name: 'Opaque', background: image('/backgrounds/t.jpg', { overlayOpacity: 0.2, overlayBlur: 6 }), root: { columns: 24, children: [] } },
      { id: 't3', name: 'Half', background: image('/backgrounds/h.jpg', { opacity: 0.5, overlayOpacity: 0.9, overlayBlur: 15 }), root: { columns: 24, children: [] } },
      { id: 't4', name: 'Inherit', background: { inherit: true, type: 'image', value: '/backgrounds/i.jpg', overlayOpacity: 0.95 }, root: { columns: 24, children: [] } },
      { id: 't5', name: 'Bare', background: { inherit: true }, root: { columns: 24, children: [] } }
    ]);
    config.set({ schemaVersion: 3, dashboards: [d] });
    const { container } = render(Dashboard, { dashboard: d });
    await settle();
    const vars = () => [panel(container).style.getPropertyValue('--overlay-opacity'), panel(container).style.getPropertyValue('--overlay-blur')];
    expect(vars()).toEqual(['0.4', '3px']);

    await fireEvent.click(screen.getByRole('tab', { name: 'Switch to Opaque tab' }));
    await settle();
    expect(vars()).toEqual(['0.2', '6px']);
    expect(layer(container, 'tab')).not.toBeNull();

    await fireEvent.click(screen.getByRole('tab', { name: 'Switch to Half tab' }));
    await settle();
    expect(vars()).toEqual(['0.4', '3px']); // see-through tab: the dashboard's overlay
    expect(layer(container, 'tab')?.style.opacity).toBe('0.5');

    await fireEvent.click(screen.getByRole('tab', { name: 'Switch to Inherit tab' }));
    await settle();
    expect(vars()).toEqual(['0.4', '3px']);
    expect(layer(container, 'tab')).toBeNull(); // inherit: no layer of its own

    await fireEvent.click(screen.getByRole('tab', { name: 'Switch to Bare tab' }));
    await settle();
    expect(vars()).toEqual(['0.4', '3px']);
    expect(layer(container, 'tab')).toBeNull();
  });

  it('overlay values are clamped and default when the dashboard has none', async () => {
    const d = dash({}, [
      { id: 't1', name: 'Wild', background: image('/backgrounds/t.jpg', { overlayOpacity: 7, overlayBlur: -4 }), root: { columns: 24, children: [] } },
      { id: 't2', name: 'None', root: { columns: 24, children: [] } }
    ]);
    config.set({ schemaVersion: 3, dashboards: [d] });
    const { container } = render(Dashboard, { dashboard: d });
    await settle();
    expect(panel(container).style.getPropertyValue('--overlay-opacity')).toBe('1');
    expect(panel(container).style.getPropertyValue('--overlay-blur')).toBe('0px');
    await fireEvent.click(screen.getByRole('tab', { name: 'Switch to None tab' }));
    await settle();
    expect(panel(container).style.getPropertyValue('--overlay-opacity')).toBe('0.7');
    expect(panel(container).style.getPropertyValue('--overlay-blur')).toBe('10px');
  });

  it('the dashboard animation is paused under a fully opaque tab, and resumes at its current image', async () => {
    vi.useFakeTimers();
    const d = dash({ background: slideshow(['/backgrounds/d1.jpg', '/backgrounds/d2.jpg', '/backgrounds/d3.jpg']) }, [
      { id: 't1', name: 'Plain', root: { columns: 24, children: [] } },
      { id: 't2', name: 'Opaque', background: slideshow(['/backgrounds/t1.jpg', '/backgrounds/t2.jpg']), root: { columns: 24, children: [] } },
      { id: 't3', name: 'Half', background: image('/backgrounds/h.jpg', { opacity: 0.5 }), root: { columns: 24, children: [] } }
    ]);
    config.set({ schemaVersion: 3, dashboards: [d] });
    const { container } = render(Dashboard, { dashboard: d });
    await settle();
    const dl = () => layer(container, 'dashboard')!;
    const shown = () => dl().querySelector<HTMLElement>('.background-layer.visible')?.style.backgroundImage ?? '';
    expect(dl().dataset.animate).toBe('true');
    expect(dl().dataset.paused).toBe('false');
    img('/backgrounds/d1.jpg').onload?.();
    await settle();
    vi.advanceTimersByTime(10_000);
    await settle();
    img('/backgrounds/d2.jpg').onload?.();
    await settle();
    expect(shown()).toContain('/backgrounds/d2.jpg');

    await fireEvent.click(screen.getByRole('tab', { name: 'Switch to Opaque tab' }));
    await settle();
    expect(dl().dataset.paused).toBe('true');
    expect(layer(container, 'tab')?.dataset.animate).toBe('true');
    const dashLoads = () => FakeImage.all.filter((i) => i.src.startsWith('/backgrounds/d')).length;
    const before = dashLoads();
    vi.advanceTimersByTime(120_000);
    await settle();
    expect(dashLoads()).toBe(before); // paused: nothing more loads

    await fireEvent.click(screen.getByRole('tab', { name: 'Switch to Half tab' }));
    await settle();
    expect(dl().dataset.paused).toBe('false');
    expect(shown()).toContain('/backgrounds/d2.jpg'); // resumed where it was, not restarted at d1
    expect(dashLoads()).toBe(before);
    vi.advanceTimersByTime(10_000);
    await settle();
    expect(img('/backgrounds/d3.jpg')).toBeTruthy(); // continues with the next slide
    vi.useRealTimers();
  });

  it('a dashboard under a fully opaque first tab loads nothing at all', async () => {
    const d = dash({ background: slideshow(['/backgrounds/d1.jpg', '/backgrounds/d2.jpg']) }, [
      { id: 't1', name: 'Opaque', background: image('/backgrounds/t.jpg'), root: { columns: 24, children: [] } },
      { id: 't2', name: 'Plain', root: { columns: 24, children: [] } }
    ]);
    config.set({ schemaVersion: 3, dashboards: [d] });
    const { container } = render(Dashboard, { dashboard: d });
    await settle();
    expect(layer(container, 'dashboard')?.dataset.paused).toBe('true');
    expect(FakeImage.all.some((i) => i.src.startsWith('/backgrounds/d'))).toBe(false);
    await fireEvent.click(screen.getByRole('tab', { name: 'Switch to Plain tab' }));
    await settle();
    expect(img('/backgrounds/d1.jpg')).toBeTruthy(); // loads once uncovered
  });

  it('reduced motion freezes the dashboard and tab slideshows', async () => {
    reduced = true;
    const d = dash({ background: dashBg }, [
      { id: 't1', name: 'Half', background: slideshow(['/backgrounds/t1.jpg', '/backgrounds/t2.jpg'], { opacity: 0.5 }), root: { columns: 24, children: [] } }
    ]);
    config.set({ schemaVersion: 3, dashboards: [d] });
    const { container } = render(Dashboard, { dashboard: d });
    await settle();
    expect(layer(container, 'dashboard')?.dataset.animate).toBe('false');
    expect(layer(container, 'tab')?.dataset.animate).toBe('false');
  });

  it('failed image falls back to colour with indicator in edit mode', async () => {
    const d = dash({ background: image('/backgrounds/broken.jpg') });
    config.set({ schemaVersion: 3, dashboards: [d] });
    isAuthenticated.set(true);
    begin('d1');
    editMode.set(true);
    const { container } = render(Dashboard, { dashboard: d });
    await settle();
    img('/backgrounds/broken.jpg').onerror?.();
    await settle();
    expect(layer(container, 'dashboard')?.querySelector('.background-fallback')).not.toBeNull();
    const badge = container.querySelector('[data-bg-failed="dashboard"]');
    expect(badge?.textContent).toContain("Background image couldn't be loaded");
    // §7.2: the warning sits in the floating editing toolbar, never in a row that moves the page.
    expect(badge?.closest('[role="toolbar"]')).not.toBeNull();
    expect(console.error).toHaveBeenCalledWith('Background image could not be shown', '/backgrounds/broken.jpg');
  });

  it('a failed dashboard image shows no indicator in view mode (fallback colour only)', async () => {
    const d = dash({ background: image('/backgrounds/broken.jpg') });
    config.set({ schemaVersion: 3, dashboards: [d] });
    const { container } = render(Dashboard, { dashboard: d });
    await settle();
    img('/backgrounds/broken.jpg').onerror?.();
    await settle();
    expect(layer(container, 'dashboard')?.querySelector('.background-fallback')).not.toBeNull();
    expect(container.querySelector('[data-bg-failed]')).toBeNull();
    expect(screen.queryByText(/couldn't be loaded/)).toBeNull();
  });
});

// ---- folders ----------------------------------------------------------------

function mkTab(children: any[]): { d: LayoutDashboard; tab: LayoutTab } {
  const tab: LayoutTab = { id: 't1', name: 'Main', root: { columns: 24, children } };
  const d = dash({}, [tab]);
  config.set({ schemaVersion: 3, dashboards: [d] });
  return { d, tab };
}
function node(container: Element, id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
  if (!el) throw new Error(`no node ${id}`);
  return el;
}

describe('folder layers', () => {
  it('a folder at opacity 0.5 has its surface at 0.5 and its tiles at opacity 1', async () => {
    const { d, tab } = mkTab([folder('f1', 'Box', [tile('in1', 'Inside')], { color: '#ff0000', opacity: 0.5 })]);
    const { container } = render(TabCanvas, { dashboard: d, tab });
    await settle();
    const f = node(container, 'f1');
    const surface = f.querySelector<HTMLElement>(':scope > .folder-shape > .folder-surface > .folder-surface-color');
    expect(surface?.style.opacity).toBe('0.5');
    expect(surface?.style.backgroundColor).toBe('rgb(255, 0, 0)');
    // Nothing between the folder and its tile carries an opacity.
    expect(f.style.opacity).toBe('');
    expect(f.getAttribute('style') ?? '').not.toContain('--group-opacity');
    let el: HTMLElement | null = node(container, 'in1');
    while (el && el !== f) {
      expect(el.style.opacity === '' || el.style.opacity === '1').toBe(true);
      el = el.parentElement;
    }
  });

  it('a folder with no background keeps its colour look on the surface (default 0.95)', async () => {
    const { d, tab } = mkTab([folder('f1', 'Box', [tile('in1', 'Inside')])]);
    const { container } = render(TabCanvas, { dashboard: d, tab });
    await settle();
    const surface = node(container, 'f1').querySelector<HTMLElement>('.folder-surface-color');
    expect(surface?.style.opacity).toBe('0.95');
    expect(node(container, 'f1').querySelector('.background-root')).toBeNull();
  });

  it('a folder picture draws in the folder box, at its opacity, over the surface', async () => {
    const { d, tab } = mkTab([folder('f1', 'Box', [tile('in1', 'Inside')], { color: '#00ff00', background: image('/backgrounds/f.jpg', { opacity: 0.6 }) })]);
    const { container } = render(TabCanvas, { dashboard: d, tab });
    await settle();
    const f = node(container, 'f1');
    const root = f.querySelector<HTMLElement>('.folder-surface .background-root.scope-box');
    expect(root).not.toBeNull();
    expect(root?.dataset.bgLevel).toBe('folder');
    expect(root?.style.opacity).toBe('0.6');
    // While loading, the colour stands in; once shown, the picture is the surface.
    expect(f.querySelector('.folder-surface-color')).not.toBeNull();
    img('/backgrounds/f.jpg').onload?.();
    await settle();
    expect(f.querySelector('.folder-surface-color')).toBeNull();
    expect(f.querySelector<HTMLElement>('.background-layer.visible')?.style.backgroundImage).toContain('/backgrounds/f.jpg');
  });

  it('an inherit folder renders no layer (and a bare {inherit:true} does not crash)', async () => {
    const { d, tab } = mkTab([
      folder('f1', 'Kept', [tile('a', 'A')], { background: { inherit: true, type: 'image', value: '/backgrounds/k.jpg' } }),
      { ...folder('f2', 'Bare', [tile('b', 'B')], { background: { inherit: true } }), placement: { x: 8, y: 2, w: 8, h: 6 } }
    ]);
    const { container } = render(TabCanvas, { dashboard: d, tab });
    await settle();
    for (const id of ['f1', 'f2']) {
      expect(node(container, id).querySelector('.background-root')).toBeNull();
      expect(node(container, id).querySelector('.folder-surface-color')).not.toBeNull();
    }
    expect(FakeImage.all.some((i) => i.src === '/backgrounds/k.jpg')).toBe(false);
  });

  it('the collapsed tile shows a still first image behind the preview', async () => {
    const { d, tab } = mkTab([folder('f1', 'Box', [tile('in1', 'Inside')], {
      display: 'collapsed', background: slideshow(['/backgrounds/c1.jpg', '/backgrounds/c2.jpg'])
    })]);
    const { container } = render(TabCanvas, { dashboard: d, tab });
    await settle();
    const face = node(container, 'f1').querySelector<HTMLElement>('.folder-collapsed-tile');
    const root = face?.querySelector<HTMLElement>('.folder-surface .background-root');
    expect(root?.dataset.animate).toBe('false');
    img('/backgrounds/c1.jpg').onload?.();
    await settle();
    expect(face?.querySelector<HTMLElement>('.background-layer.visible')?.style.backgroundImage).toContain('/backgrounds/c1.jpg');
    // The preview is still there, above the picture.
    expect(face?.querySelector('.preview-grid')).not.toBeNull();
    expect(FakeImage.all.some((i) => i.src === '/backgrounds/c2.jpg')).toBe(false);
  });

  it('an expanded folder slideshow animates per the dashboard setting (display block)', async () => {
    const { d, tab } = mkTab([folder('f1', 'Box', [tile('in1', 'Inside')], { background: slideshow(['/backgrounds/s1.jpg', '/backgrounds/s2.jpg']) })]);
    const { container } = render(TabCanvas, { dashboard: d, tab });
    await settle();
    const root = () => node(container, 'f1').querySelector<HTMLElement>('.background-root');
    expect(root()?.dataset.animate).toBe('true');
    config.set({ schemaVersion: 3, dashboards: [{ ...d, display: { animatedFolderBackgrounds: false } }] });
    await settle();
    expect(root()?.dataset.animate).toBe('false');
  });

  it('failed folder image: fallback colour with indicator in edit mode; cleared when it later loads', async () => {
    const bg = image('/backgrounds/missing.jpg');
    const { d, tab } = mkTab([folder('f1', 'Box', [tile('in1', 'Inside')], { color: '#123456', background: bg })]);
    const { container, unmount } = render(TabCanvas, { dashboard: d, tab, editing: true });
    await settle();
    img('/backgrounds/missing.jpg').onerror?.();
    await settle();
    const f = node(container, 'f1');
    expect(f.querySelector<HTMLElement>('.folder-surface-color')?.style.backgroundColor).toBe('rgb(18, 52, 86)');
    expect(f.querySelector('[data-bg-failed="folder"]')?.textContent).toContain("Background image couldn't be loaded");
    expect(get(failedBackgroundUrls)).toEqual(['/backgrounds/missing.jpg']);
    unmount();

    // Ruling 7: a later successful load removes the entry.
    const again = render(TabCanvas, { dashboard: d, tab, editing: true });
    await settle();
    img('/backgrounds/missing.jpg').onload?.();
    await settle();
    expect(get(failedBackgroundUrls)).toEqual([]);
    expect(again.container.querySelector('[data-bg-failed]')).toBeNull();
  });

  it('failed folder image shows no indicator in view mode', async () => {
    const { d, tab } = mkTab([folder('f1', 'Box', [tile('in1', 'Inside')], { background: image('/backgrounds/missing.jpg') })]);
    const { container } = render(TabCanvas, { dashboard: d, tab });
    await settle();
    img('/backgrounds/missing.jpg').onerror?.();
    await settle();
    expect(node(container, 'f1').querySelector('.folder-surface-color')).not.toBeNull();
    expect(container.querySelector('[data-bg-failed]')).toBeNull();
  });

  it('the indicator only lists URLs the level still references', async () => {
    failedBackgroundUrls.set(['/backgrounds/old.jpg']);
    const { d, tab } = mkTab([folder('f1', 'Box', [tile('in1', 'Inside')], { background: image('/backgrounds/new.jpg') })]);
    const { container } = render(TabCanvas, { dashboard: d, tab, editing: true });
    await settle();
    expect(container.querySelector('[data-bg-failed]')).toBeNull();
  });

  it('the failure badge sits off the content: in the bar of an open folder (titled or not), or on a tab outside a minimised one', async () => {
    const broken = image('/backgrounds/missing.jpg');
    const { d, tab } = mkTab([
      folder('ft', 'Titled', [tile('a', 'A')], { background: broken }),
      { ...folder('fu', 'Untitled', [tile('b', 'B')], { background: broken, showTitle: false }), placement: { x: 8, y: 2, w: 8, h: 6 } },
      { ...folder('fc', 'Collapsed', [tile('c', 'C')], { background: broken, display: 'collapsed' }), placement: { x: 16, y: 2, w: 4, h: 4 } }
    ]);
    const { container } = render(TabCanvas, { dashboard: d, tab, editing: true });
    await settle();
    for (const i of FakeImage.all.filter((x) => x.src === '/backgrounds/missing.jpg')) i.onerror?.();
    await settle();

    const titled = node(container, 'ft').querySelector('[data-bg-failed="folder"]')!;
    expect(titled.closest('.folder-header')).not.toBeNull();
    expect(titled.closest('.folder-body')).toBeNull();

    // M5 §3a.7: every open folder has its bar, an untitled one too.
    const untitled = node(container, 'fu').querySelector('[data-bg-failed="folder"]')!;
    expect(untitled.closest('.folder-header')).not.toBeNull();
    expect(untitled.closest('.folder-body')).toBeNull();

    const collapsed = node(container, 'fc').querySelector('[data-bg-failed="folder"]')!;
    expect(collapsed.classList.contains('placement-corner')).toBe(true);
    expect(collapsed.closest('.folder-collapsed-tile')).toBeNull();
    expect(collapsed.parentElement).toBe(node(container, 'fc'));
  });

  it('an open folder (opened in place) draws its own background in its box, at its opacity', async () => {
    const f = folder('f1', 'Box', [tile('in1', 'Inside')], { display: 'expanded', background: image('/backgrounds/o.jpg', { opacity: 0.7 }) });
    const { d, tab } = mkTab([f]);
    const { container } = render(TabCanvas, { dashboard: d, tab });
    await settle();
    const box = node(container, 'f1');
    const root = box.querySelector<HTMLElement>(':scope > .folder-shape > .folder-surface .background-root.scope-box');
    expect(root).not.toBeNull();
    expect(root?.style.opacity).toBe('0.7');
    expect(document.querySelector('.overlay-backdrop')).toBeNull();
  });
});

// ---- lazy loading through the shared controller (Ruling 10.5) ----------------

type IOCb = (entries: Partial<IntersectionObserverEntry>[]) => void;
class FakeIO {
  static live: FakeIO[] = [];
  cb: IOCb;
  observed = new Set<Element>();
  constructor(cb: IOCb) { this.cb = cb; FakeIO.live.push(this); }
  observe(el: Element) { this.observed.add(el); }
  unobserve(el: Element) { this.observed.delete(el); }
  disconnect() { this.observed.clear(); FakeIO.live = FakeIO.live.filter((i) => i !== this); }
}
function emitVisible(el: Element, area: number) {
  const io = FakeIO.live.find((i) => i.observed.has(el));
  if (!io) throw new Error('element not observed');
  io.cb([{ target: el, isIntersecting: area > 0, intersectionRect: { width: area, height: 1 } as DOMRectReadOnly }]);
}

describe('folder lazy loading', () => {
  beforeEach(() => {
    FakeIO.live = [];
    vi.stubGlobal('IntersectionObserver', FakeIO);
  });

  it('collapsed and single-image folders load only once visible, and never take an animation slot', async () => {
    const anims = [0, 1, 2, 3].map((i) => ({
      ...folder(`a${i}`, `Anim${i}`, [tile(`at${i}`, `AT${i}`)], { background: slideshow([`/backgrounds/a${i}-1.jpg`, `/backgrounds/a${i}-2.jpg`]) }),
      placement: { x: i * 6, y: 0, w: 6, h: 6 }
    }));
    const { d, tab } = mkTab([
      ...anims,
      { ...folder('fc', 'Collapsed', [tile('c', 'C')], { display: 'collapsed', background: slideshow(['/backgrounds/c1.jpg', '/backgrounds/c2.jpg']) }), placement: { x: 0, y: 6, w: 4, h: 4 } },
      { ...folder('fi', 'Single', [tile('s', 'S')], { background: image('/backgrounds/single.jpg') }), placement: { x: 2, y: 3, w: 4, h: 3 } }
    ]);
    const { container } = render(TabCanvas, { dashboard: d, tab });
    await settle();
    // Nothing loads before the observer's first report.
    expect(FakeImage.all.length).toBe(0);
    const surface = (id: string) => node(container, id).querySelector('.folder-surface')!;

    // The stills are the largest on screen; the 4 slideshows still all animate.
    emitVisible(surface('fc'), 100_000);
    emitVisible(surface('fi'), 100_000);
    for (let i = 0; i < 4; i++) emitVisible(surface(`a${i}`), 10);
    await settle();
    expect(img('/backgrounds/c1.jpg')).toBeTruthy();
    expect(img('/backgrounds/single.jpg')).toBeTruthy();
    for (let i = 0; i < 4; i++) {
      expect(node(container, `a${i}`).querySelector<HTMLElement>('.background-root')?.dataset.animate).toBe('true');
    }
    expect(node(container, 'fc').querySelector<HTMLElement>('.background-root')?.dataset.animate).toBe('false');
    expect(node(container, 'fi').querySelector<HTMLElement>('.background-root')?.dataset.animate).toBe('false');
  });

  it('nested inset boxes (M5 §7) share the cap: of 5 animated slideshows drilled one inside another, 4 animate', async () => {
    const show = (id: string) => slideshow([`/backgrounds/${id}-1.jpg`, `/backgrounds/${id}-2.jpg`]);
    const sub = (id: string, children: any[]) => ({ ...folder(id, id.toUpperCase(), children, { background: show(id) }), placement: undefined });
    const chain = sub('n1', [sub('n2', [sub('n3', [sub('n4', [tile('z', 'Z')])])])]);
    const { d, tab } = mkTab([{ ...folder('top', 'Top', [chain], { background: show('top') }), placement: { x: 0, y: 0, w: 24, h: 20 } }]);
    setFolderDrill(d.id, 'top', ['n1', 'n2', 'n3', 'n4']);
    const { container } = render(TabCanvas, { dashboard: d, tab });
    await settle();
    const surfaces = Array.from(container.querySelectorAll<HTMLElement>('.folder-surface'));
    expect(surfaces).toHaveLength(5); // the top box and four inset boxes, each with its own background
    surfaces.forEach((el, i) => emitVisible(el, 1000 - i)); // every one registered with the one controller
    await settle();
    const animating = surfaces.filter((el) => el.querySelector<HTMLElement>('.background-root')?.dataset.animate === 'true');
    expect(animating).toHaveLength(4);
  });
  it('an off-screen single-image folder never loads', async () => {
    const { d, tab } = mkTab([folder('fi', 'Single', [tile('s', 'S')], { background: image('/backgrounds/far.jpg') })]);
    const { container } = render(TabCanvas, { dashboard: d, tab });
    await settle();
    emitVisible(node(container, 'fi').querySelector('.folder-surface')!, 0);
    await settle();
    expect(FakeImage.all.some((i) => i.src === '/backgrounds/far.jpg')).toBe(false);
    expect(node(container, 'fi').querySelector('.folder-surface-color')).not.toBeNull();
  });
});

