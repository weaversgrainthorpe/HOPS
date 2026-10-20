// Shared animation controller for folder backgrounds (Milestone 4, Task 3).
//
// One IntersectionObserver serves every registered folder background. At most
// MAX_ANIMATED_FOLDERS of the visible ones animate, chosen by largest visible
// area (ties -> registration order). Allocation is recomputed only on observer
// callbacks, registration changes, setting changes (each registration
// subscribes to its `animatedSetting` readable) and prefers-reduced-motion
// changes -- never per frame. The cap is global for the viewport: it spans all
// registered folder backgrounds, not per dashboard.
//
// Dashboard / tab layers are not registered here; they consume `reducedMotion`
// directly and are not counted in the cap.

import { readable, writable, type Readable, type Writable } from 'svelte/store';

export const MAX_ANIMATED_FOLDERS = 4;

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/** prefers-reduced-motion, live. SSR-safe: false when there is no window. */
export const reducedMotion: Readable<boolean> = readable(false, (set) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const mql = window.matchMedia(REDUCED_QUERY);
  const update = () => set(mql.matches);
  update();
  mql.addEventListener('change', update);
  return () => mql.removeEventListener('change', update);
});

interface Reg {
  seq: number;
  /** false: a still folder (collapsed tile, single image) — lazy-load only, never animates or takes a slot. */
  counts: boolean;
  setting: boolean;
  unsubSetting: (() => void) | null;
  visible: boolean;
  area: number;
  animate: Writable<boolean>;
  loaded: Writable<boolean>;
}

const regs = new Map<Element, Reg>();
let seq = 0;
let observer: IntersectionObserver | null = null;
let reduced = false;
let unsubReduced: (() => void) | null = null;
let warnedNoIO = false;

function recompute() {
  const candidates: Reg[] = [];
  if (!reduced) {
    for (const r of regs.values()) {
      if (r.counts && r.visible && r.setting) candidates.push(r);
    }
  }
  candidates.sort((a, b) => b.area - a.area || a.seq - b.seq);
  const winners = new Set(candidates.slice(0, MAX_ANIMATED_FOLDERS));
  for (const r of regs.values()) r.animate.set(winners.has(r));
}

function onEntries(entries: IntersectionObserverEntry[]) {
  for (const e of entries) {
    const r = regs.get(e.target);
    if (!r) continue;
    const rect = e.intersectionRect;
    r.area = e.isIntersecting && rect ? rect.width * rect.height : 0;
    r.visible = e.isIntersecting && r.area > 0;
    if (r.visible) r.loaded.set(true);
  }
  recompute();
}

function start() {
  if (!unsubReduced) {
    unsubReduced = reducedMotion.subscribe((v) => {
      const changed = v !== reduced;
      reduced = v;
      if (changed) recompute();
    });
  }
  if (!observer && typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(onEntries);
  }
}

function stop() {
  observer?.disconnect();
  observer = null;
  unsubReduced?.();
  unsubReduced = null;
  reduced = false;
}

/**
 * Register a folder background element. `loaded` turns true once the element
 * has been on screen (lazy loading); `animate` is this folder's slot.
 * `countsTowardCap: false` registers a still folder (collapsed tile, single
 * image): it only gets `loaded`, never animates and never takes one of the
 * MAX_ANIMATED_FOLDERS slots; `animatedSetting` is then not needed.
 */
export function registerFolderBackground(
  el: Element,
  opts: { animatedSetting?: Readable<boolean>; countsTowardCap?: boolean },
): { animate: Readable<boolean>; loaded: Readable<boolean>; unregister(): void } {
  const counts = opts.countsTowardCap !== false && !!opts.animatedSetting;
  const reg: Reg = {
    seq: seq++,
    counts,
    setting: false,
    unsubSetting: null,
    visible: false,
    area: 0,
    animate: writable(false),
    loaded: writable(false),
  };
  // A re-registration of the same element replaces the old one.
  regs.get(el)?.animate.set(false);
  regs.set(el, reg);
  start();
  if (counts && opts.animatedSetting) {
    reg.unsubSetting = opts.animatedSetting.subscribe((v) => {
      const changed = v !== reg.setting;
      reg.setting = v;
      if (changed) recompute();
    });
  }

  if (observer) {
    observer.observe(el);
  } else {
    // No IntersectionObserver: never silently stay blank. Treat as visible and
    // loaded (equal area), still subject to the cap and reduced motion.
    if (!warnedNoIO) {
      warnedNoIO = true;
      console.warn('[backgroundAnimation] IntersectionObserver unavailable; treating all folder backgrounds as visible');
    }
    reg.visible = true;
    reg.area = 1;
    reg.loaded.set(true);
    recompute();
  }

  let done = false;
  return {
    animate: { subscribe: reg.animate.subscribe },
    loaded: { subscribe: reg.loaded.subscribe },
    unregister() {
      if (done) return;
      done = true;
      reg.unsubSetting?.();
      reg.unsubSetting = null;
      if (regs.get(el) === reg) {
        regs.delete(el);
        observer?.unobserve(el);
      }
      reg.animate.set(false);
      if (regs.size === 0) stop();
      else recompute();
    },
  };
}
