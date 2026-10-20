import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get, writable } from 'svelte/store';

type IOCb = (entries: Partial<IntersectionObserverEntry>[]) => void;
let ioInstances: FakeIO[] = [];
class FakeIO {
  cb: IOCb;
  observed = new Set<Element>();
  disconnected = false;
  options: IntersectionObserverInit | undefined;
  constructor(cb: IOCb, options?: IntersectionObserverInit) {
    this.cb = cb;
    this.options = options;
    ioInstances.push(this);
  }
  observe(el: Element) { this.observed.add(el); }
  unobserve(el: Element) { this.observed.delete(el); }
  disconnect() { this.disconnected = true; this.observed.clear(); }
}
function emit(el: Element, area: number) {
  const io = [...ioInstances].reverse().find((i) => !i.disconnected && i.observed.has(el));
  if (!io) throw new Error('no live observer observing element');
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

function countedStore(initial: boolean) {
  const w = writable(initial);
  let subs = 0;
  return {
    set: w.set,
    count: () => subs,
    subscribe(run: (v: boolean) => void) {
      subs++;
      const u = w.subscribe(run);
      return () => { subs--; u(); };
    },
  };
}

describe('backgroundAnimation', () => {
  it('observer re-measures visible area as a folder scrolls in (thresholds, not just 0)', async () => {
    const m = await load();
    const [el] = mk(1);
    m.registerFolderBackground(el, { animatedSetting: writable(true) });
    const th = ioInstances[0].options?.threshold;
    expect(Array.isArray(th)).toBe(true);
    const list = th as number[];
    expect(list).toContain(0);
    expect(list).toContain(1);
    expect(list.filter((t) => t > 0 && t < 1).length).toBeGreaterThanOrEqual(3);
  });

  it('a folder first seen with a sliver of area takes a slot once its area grows', async () => {
    const m = await load();
    const els = mk(5);
    const regs = els.map((el) => m.registerFolderBackground(el, { animatedSetting: writable(true) }));
    // The big folder enters first with a 1px sliver; four small folders are fully visible.
    emit(els[0], 1);
    for (const el of els.slice(1)) emit(el, 100);
    expect(get(regs[0].animate)).toBe(false);
    // Scrolling on: the observer reports the big folder's real area at the next threshold.
    emit(els[0], 10000);
    expect(get(regs[0].animate)).toBe(true);
    expect(regs.filter((r) => get(r.animate)).length).toBe(m.MAX_ANIMATED_FOLDERS);
  });

  it('unregister releases the setting subscription', async () => {
    const m = await load();
    const setting = countedStore(true);
    const [el] = mk(1);
    const r = m.registerFolderBackground(el, { animatedSetting: setting });
    expect(setting.count()).toBe(1);
    r.unregister();
    expect(setting.count()).toBe(0);
  });

  it('matchMedia listener removed after last unregister; re-register works', async () => {
    const m = await load();
    const [a, b] = mk(2);
    const r1 = m.registerFolderBackground(a, { animatedSetting: writable(true) });
    emit(a, 10);
    expect(mql.listeners.size).toBe(1);
    r1.unregister();
    expect(mql.listeners.size).toBe(0);
    const r2 = m.registerFolderBackground(b, { animatedSetting: writable(true) });
    expect(mql.listeners.size).toBe(1);
    emit(b, 10);
    expect(get(r2.animate)).toBe(true);
    expect(ioInstances.length).toBe(2);
  });

  it('10 visible -> exactly 4 animate, largest area first', async () => {
    const m = await load();
    const els = mk(10);
    const regs = els.map((el) => m.registerFolderBackground(el, { animatedSetting: writable(true) }));
    els.forEach((el, i) => emit(el, (i + 1) * 100));
    const on = regs.map((r, i) => (get(r.animate) ? i : -1)).filter((i) => i >= 0);
    expect(on).toEqual([6, 7, 8, 9]);
    expect(m.MAX_ANIMATED_FOLDERS).toBe(4);
    expect(ioInstances.length).toBe(1);
  });

  it('ties break by registration order', async () => {
    const m = await load();
    const els = mk(6);
    const regs = els.map((el) => m.registerFolderBackground(el, { animatedSetting: writable(true) }));
    els.forEach((el) => emit(el, 50));
    expect(regs.map((r) => get(r.animate))).toEqual([true, true, true, true, false, false]);
  });

  it('a folder leaving view hands its slot to the next', async () => {
    const m = await load();
    const els = mk(5);
    const regs = els.map((el) => m.registerFolderBackground(el, { animatedSetting: writable(true) }));
    els.forEach((el, i) => emit(el, 500 - i * 10));
    expect(get(regs[4].animate)).toBe(false);
    emit(els[0], 0);
    expect(get(regs[0].animate)).toBe(false);
    expect(get(regs[4].animate)).toBe(true);
  });

  it('reduced motion disables all, live', async () => {
    const m = await load();
    const [el] = mk(1);
    const r = m.registerFolderBackground(el, { animatedSetting: writable(true) });
    emit(el, 100);
    expect(get(r.animate)).toBe(true);
    setReduced(true);
    expect(get(m.reducedMotion)).toBe(true);
    expect(get(r.animate)).toBe(false);
    setReduced(false);
    expect(get(r.animate)).toBe(true);
  });

  it('dashboard setting off disables all (reactive, no manual call)', async () => {
    const m = await load();
    const on = writable(true);
    const [el] = mk(1);
    const r = m.registerFolderBackground(el, { animatedSetting: on });
    emit(el, 100);
    expect(get(r.animate)).toBe(true);
    on.set(false);
    expect(get(r.animate)).toBe(false);
  });

  it('setting off from the start never animates', async () => {
    const m = await load();
    const [el] = mk(1);
    const r = m.registerFolderBackground(el, { animatedSetting: writable(false) });
    emit(el, 100);
    expect(get(r.animate)).toBe(false);
    expect(get(r.loaded)).toBe(true);
  });

  it('loaded is false until first visible, then sticky', async () => {
    const m = await load();
    const [el] = mk(1);
    const r = m.registerFolderBackground(el, { animatedSetting: writable(true) });
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
    const regs = els.map((el) => m.registerFolderBackground(el, { animatedSetting: writable(true) }));
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
    const regs = mk(6).map((el) => m.registerFolderBackground(el, { animatedSetting: writable(true) }));
    expect(regs.every((r) => get(r.loaded))).toBe(true);
    expect(regs.filter((r) => get(r.animate)).length).toBe(4);
    expect(warn).toHaveBeenCalledTimes(1);
    setReduced(true);
    expect(regs.filter((r) => get(r.animate)).length).toBe(0);
    warn.mockRestore();
  });

  it('still registrations (countsTowardCap:false) lazy-load but never animate nor take a cap slot', async () => {
    const m = await load();
    const stills = mk(3);
    const anims = mk(4);
    const sr = stills.map((el) => m.registerFolderBackground(el, { countsTowardCap: false }));
    const ar = anims.map((el) => m.registerFolderBackground(el, { animatedSetting: writable(true) }));
    // Not loaded before the first observer report.
    for (const r of sr) expect(get(r.loaded)).toBe(false);
    // Stills are the largest on screen; the 4 animated ones still all animate.
    stills.forEach((el) => emit(el, 1000));
    anims.forEach((el) => emit(el, 10));
    for (const r of sr) {
      expect(get(r.loaded)).toBe(true);
      expect(get(r.animate)).toBe(false);
    }
    for (const r of ar) expect(get(r.animate)).toBe(true);
    [...sr, ...ar].forEach((r) => r.unregister());
  });
});

