import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

type IOCb = (entries: Partial<IntersectionObserverEntry>[]) => void;
let ioInstances: FakeIO[] = [];
class FakeIO {
  cb: IOCb;
  observed = new Set<Element>();
  disconnected = false;
  constructor(cb: IOCb) {
    this.cb = cb;
    ioInstances.push(this);
  }
  observe(el: Element) { this.observed.add(el); }
  unobserve(el: Element) { this.observed.delete(el); }
  disconnect() { this.disconnected = true; this.observed.clear(); }
}
function emit(el: Element, area: number) {
  const io = ioInstances[ioInstances.length - 1];
  io.cb([{ target: el, isIntersecting: area > 0, intersectionRect: { width: area, height: 1 } as DOMRectReadOnly }]);
}

let mql: { matches: boolean; listeners: Set<() => void> };
function setReduced(v: boolean) {
  mql.matches = v;
  mql.listeners.forEach((l) => l());
}

async function load() {
  vi.resetModules();
  return await import('./backgroundAnimation');
}

beforeEach(() => {
  ioInstances = [];
  mql = { matches: false, listeners: new Set() };
  vi.stubGlobal('IntersectionObserver', FakeIO);
  vi.stubGlobal('matchMedia', () => ({
    get matches() { return mql.matches; },
    addEventListener: (_: string, l: () => void) => mql.listeners.add(l),
    removeEventListener: (_: string, l: () => void) => mql.listeners.delete(l),
  }));
});
afterEach(() => vi.unstubAllGlobals());

function mk(n: number) {
  return Array.from({ length: n }, () => document.createElement('div'));
}

describe('backgroundAnimation', () => {
  it('10 visible -> exactly 4 animate, largest area first', async () => {
    const m = await load();
    const els = mk(10);
    const regs = els.map((el) => m.registerFolderBackground(el, { dashboardId: 'd', animatedSetting: () => true }));
    els.forEach((el, i) => emit(el, (i + 1) * 100));
    const on = regs.map((r, i) => (get(r.animate) ? i : -1)).filter((i) => i >= 0);
    expect(on).toEqual([6, 7, 8, 9]);
    expect(m.MAX_ANIMATED_FOLDERS).toBe(4);
    expect(ioInstances.length).toBe(1);
  });

  it('ties break by registration order', async () => {
    const m = await load();
    const els = mk(6);
    const regs = els.map((el) => m.registerFolderBackground(el, { dashboardId: 'd', animatedSetting: () => true }));
    els.forEach((el) => emit(el, 50));
    expect(regs.map((r) => get(r.animate))).toEqual([true, true, true, true, false, false]);
  });

  it('a folder leaving view hands its slot to the next', async () => {
    const m = await load();
    const els = mk(5);
    const regs = els.map((el) => m.registerFolderBackground(el, { dashboardId: 'd', animatedSetting: () => true }));
    els.forEach((el, i) => emit(el, 500 - i * 10));
    expect(get(regs[4].animate)).toBe(false);
    emit(els[0], 0);
    expect(get(regs[0].animate)).toBe(false);
    expect(get(regs[4].animate)).toBe(true);
  });

  it('reduced motion disables all, live', async () => {
    const m = await load();
    const [el] = mk(1);
    const r = m.registerFolderBackground(el, { dashboardId: 'd', animatedSetting: () => true });
    emit(el, 100);
    expect(get(r.animate)).toBe(true);
    setReduced(true);
    expect(get(m.reducedMotion)).toBe(true);
    expect(get(r.animate)).toBe(false);
    setReduced(false);
    expect(get(r.animate)).toBe(true);
  });

  it('dashboard setting off disables all (after refresh)', async () => {
    const m = await load();
    let on = true;
    const [el] = mk(1);
    const r = m.registerFolderBackground(el, { dashboardId: 'd', animatedSetting: () => on });
    emit(el, 100);
    expect(get(r.animate)).toBe(true);
    on = false;
    m.refreshBackgroundAnimation();
    expect(get(r.animate)).toBe(false);
  });

  it('setting off from the start never animates', async () => {
    const m = await load();
    const [el] = mk(1);
    const r = m.registerFolderBackground(el, { dashboardId: 'd', animatedSetting: () => false });
    emit(el, 100);
    expect(get(r.animate)).toBe(false);
    expect(get(r.loaded)).toBe(true);
  });

  it('loaded is false until first visible, then sticky', async () => {
    const m = await load();
    const [el] = mk(1);
    const r = m.registerFolderBackground(el, { dashboardId: 'd', animatedSetting: () => true });
    expect(get(r.loaded)).toBe(false);
    emit(el, 0);
    expect(get(r.loaded)).toBe(false);
    emit(el, 10);
    expect(get(r.loaded)).toBe(true);
    emit(el, 0);
    expect(get(r.loaded)).toBe(true);
  });

  it('unregister frees the slot and disconnects when empty', async () => {
    const m = await load();
    const els = mk(5);
    const regs = els.map((el) => m.registerFolderBackground(el, { dashboardId: 'd', animatedSetting: () => true }));
    els.forEach((el, i) => emit(el, 500 - i * 10));
    expect(get(regs[4].animate)).toBe(false);
    regs[0].unregister();
    expect(get(regs[4].animate)).toBe(true);
    regs.slice(1).forEach((r) => r.unregister());
    expect(ioInstances[0].disconnected).toBe(true);
  });

  it('without IntersectionObserver: warns once, treats all visible/loaded, still caps', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = await load();
    const regs = mk(6).map((el) => m.registerFolderBackground(el, { dashboardId: 'd', animatedSetting: () => true }));
    expect(regs.every((r) => get(r.loaded))).toBe(true);
    expect(regs.filter((r) => get(r.animate)).length).toBe(4);
    expect(warn).toHaveBeenCalledTimes(1);
    setReduced(true);
    expect(regs.filter((r) => get(r.animate)).length).toBe(0);
    warn.mockRestore();
  });
});
