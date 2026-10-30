import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/utils/api', async () => ({
  ...(await vi.importActual<object>('$lib/utils/api')),
  saveDashboardV3: vi.fn(),
  getConfig: vi.fn(async () => { throw new Error('offline in tests'); })
}));

import { containerMetrics } from '$lib/layout/geometry';
import { toast } from '$lib/stores/toast';
import { undo } from '$lib/stores/editSession';
import type { FolderNode, LayoutDashboard } from '$lib/types/layout';
import type { HitResult } from './hitTest';
import { drag, dragSource, setDragEnv, resetDragForTests, setActiveTab, MERGE_DWELL_MS } from './dragController';
import {
  animationsSetting, animationsAllowed, playDropAnimation, setAnimationEnv, resetDropAnimationForTests,
  sayAnimationFailure, safetyNet, MERGE_DIALOG_CAP_MS, DROP_MS, GULP_MS, GULP_DELAY_MS, INTO_TOTAL_MS, GATHER_MS, POP_MS,
  POP_DELAY_MS, MERGE_TOTAL_MS, OUT_MS, RELEASE_MS, OUT_GULP_DELAY_MS, OUT_TOTAL_MS, GULP_MAX_EDGE_PX, releaseScale, cancelDropAnimations, OUT_MAX_ITEMS,
  playOutOfFolders, MIN_LAND_PX, type OutStart,
  type AnimationEnv, type AnimationsMode
} from './dropAnimation';
import { moveOrCopyTo } from '../editorActions';
import { toggleNode } from '$lib/stores/nodeSelection';
import { editorDialog } from '../editorUi';
import { setLayout, resetEditor, startSession, draft, nodeIn, home, other } from '$lib/components/editor/editorTestKit';

// Drop and merge animations. Decoration only: the draft changes at once. Clearly
// visible (~500 ms): a drop flies along a curve into the folder, which gulps; a merge draws both tiles
// together, then the new folder pops. Transforms and opacity only. The setting is On / Off / Always:
// On never plays under reduced motion, Always does, Off never does.

const GRID = containerMetrics({ columns: 24, children: [] }, 1200);

/** home() with the server-computed display block carrying the global Animations value. */
function withAnimations(on: boolean | AnimationsMode | undefined): LayoutDashboard[] {
  const d = home();
  const mode: AnimationsMode | undefined = on === true ? 'on' : on === false ? 'off' : on;
  if (mode !== undefined) d.display = { animatedFolderBackgrounds: false, animations: mode };
  return [d, other()];
}

type Call = { el: HTMLElement; frames: Keyframe[]; opts: KeyframeAnimationOptions; anim: FakeAnim };
class FakeAnim {
  onfinish: (() => void) | null = null;
  oncancel: (() => void) | null = null;
  finish() { this.onfinish?.(); }
  cancel() { this.oncancel?.(); }
}
let calls: Call[] = [];
let reduced = false;
let frames: FrameRequestCallback[] = [];
const flushFrames = () => {
  const f = frames;
  frames = [];
  f.forEach((cb) => cb(0));
};

function animEnv(over: Partial<AnimationEnv> = {}) {
  setAnimationEnv({
    reducedMotion: () => reduced,
    animate: (el, kf, opts) => {
      const anim = new FakeAnim();
      calls.push({ el, frames: kf, opts, anim });
      return anim as unknown as Animation;
    },
    raf: (cb) => {
      frames.push(cb);
      return frames.length;
    },
    findNode: () => null,
    measure: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    ...over
  });
}

const layerEls = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="drop-anim"]'));

/** Every keyframe animates transform and opacity only (Tenet 4: no layout, no filters). */
function onlyTransformOpacity(kf: Keyframe[]) {
  for (const f of kf) {
    for (const k of Object.keys(f)) expect(['transform', 'opacity', 'offset', 'easing']).toContain(k);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  resetEditor();
  resetDragForTests();
  resetDropAnimationForTests();
  calls = [];
  reduced = false;
  frames = [];
  animEnv();
});

afterEach(() => {
  resetDropAnimationForTests();
  vi.useRealTimers();
});

describe('the setting is read', () => {
  it('reads the global Animations value (on / off / always) from the dashboard display block', () => {
    for (const m of ['on', 'off', 'always'] as const) {
      setLayout(withAnimations(m));
      expect(animationsSetting('d1')).toBe(m);
    }
  });

  it('unknown (no display block yet, no such dashboard, or a value it does not know) is off: never a guessed animation', () => {
    setLayout(withAnimations(undefined));
    expect(animationsSetting('d1')).toBe('off');
    expect(animationsSetting('nope')).toBe('off');
    const d = home();
    d.display = { animatedFolderBackgrounds: false, animations: true as unknown as AnimationsMode }; // the old bool
    setLayout([d, other()]);
    expect(animationsSetting('d1')).toBe('off');
  });

  it('On plays unless the device asks for reduced motion; Always plays even then; Off never', () => {
    setLayout(withAnimations('on'));
    expect(animationsAllowed('d1')).toBe(true);
    reduced = true;
    expect(animationsAllowed('d1')).toBe(false);
    setLayout(withAnimations('always'));
    expect(animationsAllowed('d1')).toBe(true);
    reduced = false;
    expect(animationsAllowed('d1')).toBe(true);
    setLayout(withAnimations('off'));
    expect(animationsAllowed('d1')).toBe(false);
  });

  it('Always plays even when the device cannot say whether it wants reduced motion', () => {
    animEnv({ reducedMotion: () => { throw new Error('no matchMedia'); } });
    setLayout(withAnimations('always'));
    expect(animationsAllowed('d1')).toBe(true);
    setLayout(withAnimations('on'));
    expect(animationsAllowed('d1')).toBe(false);
  });
});

/** The translate(x, y) of a keyframe's transform. */
function xy(f: Keyframe): { x: number; y: number } {
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(String(f.transform));
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
}
function scaleOf(f: Keyframe): number {
  const m = /scale\((-?[\d.]+)\)/.exec(String(f.transform));
  return m ? Number(m[1]) : 1;
}
/** The largest distance of any keyframe from the straight line between the first and last. */
function bulge(kf: Keyframe[]): number {
  const a = xy(kf[0]), b = xy(kf[kf.length - 1]);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return Math.max(...kf.map((f) => {
    const p = xy(f);
    if (len < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
    return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
  }));
}
const peakTravel = (kf: Keyframe[]) => Math.max(...kf.map((f) => Math.hypot(xy(f).x, xy(f).y)));

describe('playDropAnimation', () => {
  const from = { left: 10, top: 20, width: 100, height: 100 };
  const to = { left: 500, top: 100, width: 100, height: 100 };

  it('the timings: about 500 ms in all, clearly longer than the old 300 ms', () => {
    expect(DROP_MS).toBeGreaterThanOrEqual(400);
    expect(INTO_TOTAL_MS).toBe(Math.max(DROP_MS, GULP_DELAY_MS + GULP_MS));
    expect(INTO_TOTAL_MS).toBeGreaterThanOrEqual(450);
    expect(INTO_TOTAL_MS).toBeLessThanOrEqual(600);
    expect(MERGE_TOTAL_MS).toBe(Math.max(GATHER_MS, POP_DELAY_MS + POP_MS));
    expect(MERGE_TOTAL_MS).toBeGreaterThanOrEqual(450);
    expect(MERGE_TOTAL_MS).toBeLessThanOrEqual(600);
    expect(GULP_DELAY_MS).toBeLessThan(DROP_MS); // the gulp starts as the tile arrives
    expect(POP_DELAY_MS).toBeLessThanOrEqual(GATHER_MS); // the pop starts as the tiles meet
  });

  it('into a folder: the ghost flies along a curve into the folder, shrinking and fading there', () => {
    setLayout(withAnimations(true));
    expect(playDropAnimation('d1', { kind: 'into', from, to, label: 'A', folderId: 'c1' })).toBe(true);
    expect(layerEls()).toHaveLength(1);
    flushFrames();
    const c = calls.find((x) => x.el.dataset.testid === 'drop-anim')!;
    expect(Number(c.opts.duration)).toBe(DROP_MS);
    onlyTransformOpacity(c.frames);
    expect(c.frames.length).toBeGreaterThanOrEqual(5);
    // It ends on the folder's centre…
    const end = xy(c.frames[c.frames.length - 1]);
    expect(end.x).toBeCloseTo(490, 0);
    expect(end.y).toBeCloseTo(80, 0);
    // …along a curve (not a straight line), …
    expect(bulge(c.frames)).toBeGreaterThanOrEqual(40);
    // …shrunk into it and faded out there, visible for most of the way.
    expect(scaleOf(c.frames[c.frames.length - 1])).toBeLessThanOrEqual(0.4);
    expect(Number(c.frames[c.frames.length - 1].opacity)).toBe(0);
    expect(Number(c.frames[Math.floor(c.frames.length / 2)].opacity)).toBeGreaterThan(0.8);
    expect(c.opts.fill).toBe('forwards'); // never snaps back before it is removed
  });

  it('into a folder dropped right on it (no distance to go): it still visibly hops in (>= 40 px)', () => {
    setLayout(withAnimations(true));
    playDropAnimation('d1', { kind: 'into', from, to: from, label: 'A', folderId: 'c1' });
    flushFrames();
    const c = calls.find((x) => x.el.dataset.testid === 'drop-anim')!;
    expect(peakTravel(c.frames)).toBeGreaterThanOrEqual(40);
  });

  it('into a folder: the folder then gulps (scale 1 → 0.94 → 1) as the tile arrives', () => {
    setLayout(withAnimations(true));
    const folderEl = document.createElement('div');
    document.body.appendChild(folderEl);
    animEnv({ findNode: (id) => (id === 'c1' ? folderEl : null) });
    const onEnd = vi.fn();
    playDropAnimation('d1', { kind: 'into', from, to, label: 'A', folderId: 'c1', onEnd });
    flushFrames();
    const g = calls.find((x) => x.el === folderEl)!;
    expect(g).toBeTruthy();
    onlyTransformOpacity(g.frames);
    expect(g.frames.map(scaleOf)).toEqual([1, 0.94, 1]);
    expect(Number(g.opts.duration)).toBe(GULP_MS);
    expect(Number(g.opts.delay)).toBe(GULP_DELAY_MS);
    expect(folderEl.hasAttribute('data-drop-gulp')).toBe(true);
    calls.forEach((x) => x.anim.finish());
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(layerEls()).toHaveLength(0);
    expect(folderEl.hasAttribute('data-drop-gulp')).toBe(false);
    folderEl.remove();
  });

  it("into a drilled-in folder's inner box: the box itself gulps (found by data-nested-folder)", () => {
    setLayout(withAnimations(true));
    const box = document.createElement('div');
    box.setAttribute('data-nested-folder', 'nb');
    document.body.appendChild(box);
    animEnv({ findNode: undefined });
    playDropAnimation('d1', { kind: 'into', from, to, label: 'A', folderId: 'nb' });
    flushFrames();
    expect(calls.some((x) => x.el === box)).toBe(true);
    box.remove();
  });

  it('into a folder whose element is not drawn: the flight still plays (no gulp, nothing silent to report)', () => {
    setLayout(withAnimations(true));
    const onEnd = vi.fn();
    expect(playDropAnimation('d1', { kind: 'into', from, to, label: 'A', folderId: 'gone', onEnd })).toBe(true);
    flushFrames();
    expect(calls).toHaveLength(1);
    calls[0].anim.finish();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('merge: both tiles are drawn together onto the new folder, which then pops (0.6 → 1.05 → 1)', () => {
    setLayout(withAnimations(true));
    const folderEl = document.createElement('div');
    document.body.appendChild(folderEl);
    const folderBox = { left: 200, top: 300, width: 100, height: 100 };
    animEnv({ findNode: (id) => (id === 'nf' ? folderEl : null), measure: () => folderBox });
    expect(playDropAnimation('d1', { kind: 'merge', from, to, label: 'A', targetLabel: 'B', folderId: 'nf' })).toBe(true);
    expect(layerEls()).toHaveLength(2); // the dragged tile and the target tile
    flushFrames(); // the new folder is drawn: measured, then the gather and the pop start
    expect(calls).toHaveLength(3);
    const [dragged, target] = layerEls().map((el) => calls.find((c) => c.el === el)!);
    for (const c of [dragged, target]) {
      onlyTransformOpacity(c.frames);
      expect(Number(c.opts.duration)).toBe(GATHER_MS);
      expect(c.opts.fill).toBe('forwards');
      expect(Number(c.frames[c.frames.length - 1].opacity)).toBe(0);
      expect(scaleOf(c.frames[c.frames.length - 1])).toBeCloseTo(0.6, 2);
    }
    // They meet on the new folder's centre (250, 350): from (60, 70) and (550, 150).
    expect(xy(dragged.frames[dragged.frames.length - 1])).toEqual({ x: 190, y: 280 });
    expect(xy(target.frames[target.frames.length - 1])).toEqual({ x: -300, y: 200 });
    const pop = calls.find((c) => c.el === folderEl)!;
    onlyTransformOpacity(pop.frames);
    expect(pop.frames.map(scaleOf)).toEqual([0.6, 1.05, 1]);
    expect(Number(pop.opts.duration)).toBe(POP_MS);
    expect(Number(pop.opts.delay)).toBe(POP_DELAY_MS);
    expect(pop.opts.fill).toBe('backwards'); // hidden until the tiles meet
    expect(folderEl.hasAttribute('data-drop-pop')).toBe(true);
    calls.forEach((c) => c.anim.finish());
    expect(layerEls()).toHaveLength(0);
    expect(folderEl.hasAttribute('data-drop-pop')).toBe(false);
    folderEl.remove();
  });

  it('merge dropped right on the target (the two ghosts on top of each other): they still visibly move (>= 40 px)', () => {
    setLayout(withAnimations(true));
    const folderEl = document.createElement('div');
    document.body.appendChild(folderEl);
    animEnv({ findNode: (id) => (id === 'nf' ? folderEl : null), measure: () => from });
    playDropAnimation('d1', { kind: 'merge', from, to: from, label: 'A', targetLabel: 'B', folderId: 'nf' });
    flushFrames();
    const ghosts = layerEls().map((el) => calls.find((c) => c.el === el)!);
    for (const g of ghosts) {
      // Each ghost alone moves comfortably past 40 px (>= 56), and HOLDS there (>= 10% of the time,
      // still opaque) so a ~60 fps sampler can't miss the peak (a real-browser run measured 39.92 px).
      const far = g.frames.filter((f) => Math.hypot(xy(f).x, xy(f).y) >= 56 && Number(f.opacity) > 0.8);
      expect(far.length, 'at least two keyframes out at >= 56 px').toBeGreaterThanOrEqual(2);
      const offs = far.map((f) => Number(f.offset));
      expect(Math.max(...offs) - Math.min(...offs)).toBeGreaterThanOrEqual(0.1);
    }
    // Apart from each other by >= 40 px at the widest.
    const apart = Math.max(...ghosts[0].frames.map((f, i) => Math.hypot(xy(f).x - xy(ghosts[1].frames[i]).x, xy(f).y - xy(ghosts[1].frames[i]).y)));
    expect(apart).toBeGreaterThanOrEqual(40);
    folderEl.remove();
  });

  it('merge: when the new folder is not drawn, the tiles gather on the target instead', () => {
    setLayout(withAnimations(true));
    playDropAnimation('d1', { kind: 'merge', from, to, label: 'A', targetLabel: 'B', folderId: 'nf' });
    flushFrames();
    const [dragged] = layerEls().map((el) => calls.find((c) => c.el === el)!);
    expect(xy(dragged.frames[dragged.frames.length - 1])).toEqual({ x: 490, y: 80 });
  });

  it('merge: onEnd runs once, when the gather and the pop have both ended', () => {
    setLayout(withAnimations(true));
    const folderEl = document.createElement('div');
    document.body.appendChild(folderEl);
    animEnv({ findNode: (id) => (id === 'nf' ? folderEl : null) });
    const onEnd = vi.fn();
    expect(playDropAnimation('d1', { kind: 'merge', from, to, label: 'A', targetLabel: 'B', folderId: 'nf', onEnd })).toBe(true);
    flushFrames();
    calls[0].anim.finish();
    calls[1].anim.finish();
    expect(onEnd).not.toHaveBeenCalled(); // the pop is still running
    calls[2].anim.finish();
    expect(onEnd).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(onEnd).toHaveBeenCalledTimes(1);
    folderEl.remove();
  });

  it('merge: onEnd still runs (at the fallback) when the animation never reports its end', () => {
    setLayout(withAnimations(true));
    const onEnd = vi.fn();
    playDropAnimation('d1', { kind: 'merge', from, to, label: 'A', targetLabel: 'B', folderId: 'nf', onEnd });
    flushFrames();
    vi.advanceTimersByTime(MERGE_TOTAL_MS + 500);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('the animation layer sits below dialogs (never drawn over one)', () => {
    setLayout(withAnimations(true));
    playDropAnimation('d1', { kind: 'into', from, to, label: 'A', folderId: 'c1' });
    const z = layerEls()[0].style.zIndex;
    expect(z).toContain('--z-modal');
    expect(z).not.toContain('--z-toast');
  });

  it('a failure while preparing an animation is said once with the same toast (not only logged)', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    sayAnimationFailure(new Error('bad args'));
    sayAnimationFailure(new Error('again'));
    expect(get(toast).filter((t) => /animation/i.test(t.message))).toHaveLength(1);
    warn.mockRestore();
  });

  for (const how of ['setting off', 'On under reduced motion'] as const) {
    it(`${how}: nothing at all`, () => {
      setLayout(withAnimations(how === 'setting off' ? 'off' : 'on'));
      reduced = how !== 'setting off';
      expect(playDropAnimation('d1', { kind: 'into', from, to, label: 'A', folderId: 'c1' })).toBe(false);
      expect(playDropAnimation('d1', { kind: 'merge', from, to, label: 'A', targetLabel: 'B', folderId: 'nf' })).toBe(false);
      flushFrames();
      expect(layerEls()).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });
  }

  it('Always under reduced motion: it plays', () => {
    setLayout(withAnimations('always'));
    reduced = true;
    expect(playDropAnimation('d1', { kind: 'into', from, to, label: 'A', folderId: 'c1' })).toBe(true);
    flushFrames();
    expect(calls.length).toBeGreaterThan(0);
  });

  it('the ghost is removed even if the animation never reports its end', () => {
    setLayout(withAnimations(true));
    playDropAnimation('d1', { kind: 'into', from, to, label: 'A', folderId: 'c1' });
    flushFrames();
    expect(layerEls()).toHaveLength(1);
    vi.advanceTimersByTime(INTO_TOTAL_MS + 500);
    expect(layerEls()).toHaveLength(0);
  });

  it('a failing animation never throws, leaves no ghost behind and is said once (not silent)', () => {
    setLayout(withAnimations(true));
    animEnv({ animate: () => { throw new Error('boom'); } });
    expect(() => { playDropAnimation('d1', { kind: 'into', from, to, label: 'A', folderId: 'c1' }); flushFrames(); }).not.toThrow();
    expect(layerEls()).toHaveLength(0);
    expect(get(toast).filter((t) => /animation/i.test(t.message))).toHaveLength(1);
    playDropAnimation('d1', { kind: 'into', from, to, label: 'A', folderId: 'c1' });
    flushFrames();
    expect(get(toast).filter((t) => /animation/i.test(t.message))).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ through the drag engine

const BOXES = [
  { id: 'a', box: { left: 0, top: 0, width: 100, height: 100 } },
  { id: 'b', box: { left: 100, top: 0, width: 100, height: 100 } },
  { id: 'c1', box: { left: 500, top: 100, width: 100, height: 100 } }
];
let dragFrames: FrameRequestCallback[] = [];
function dragEnv() {
  setDragEnv({
    hitTest: (x, y): HitResult => {
      const out: HitResult = { container: { ref: { tabId: 't1' }, metrics: GRID, layout: 'grid', left: 0, top: 0 }, dx: x, dy: y };
      const n = BOXES.find((b) => x >= b.box.left && x < b.box.left + b.box.width && y >= b.box.top && y < b.box.top + b.box.height);
      if (n) {
        out.nodeId = n.id;
        out.node = { id: n.id, ...n.box };
      }
      return out;
    },
    raf: (cb) => {
      dragFrames.push(cb);
      return dragFrames.length;
    },
    cancelRaf: () => {
      dragFrames = [];
    },
    measure: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    viewport: () => ({ width: 2000, height: 2000 }),
    scrollBy: () => {}
  });
}
const pe = (type: string, x: number, y: number) =>
  new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, pointerId: 1, isPrimary: true });
function dragOnto(id: string, from: [number, number], to: [number, number]) {
  const el = document.createElement('div');
  el.setAttribute('data-node-id', id);
  document.body.appendChild(el);
  dragSource(el, { id, enabled: true });
  el.dispatchEvent(pe('pointerdown', ...from));
  document.body.dispatchEvent(pe('pointermove', from[0] + 6, from[1]));
  document.body.dispatchEvent(pe('pointermove', ...to));
  const f = dragFrames;
  dragFrames = [];
  f.forEach((cb) => cb(0));
}
const dropAt = (x: number, y: number) => document.body.dispatchEvent(pe('pointerup', x, y));

describe('a drop never waits for its animation', () => {
  function start(on: boolean | AnimationsMode) {
    setLayout(withAnimations(on));
    startSession();
    setActiveTab('t1');
    dragEnv();
  }

  for (const on of [true, false]) {
    it(`into a folder (animations ${on ? 'on' : 'off'}): the draft changes at the drop, before any frame`, () => {
      start(on);
      dragOnto('a', [50, 50], [550, 150]);
      expect(get(drag)!.target?.kind).toBe('into-folder');
      dropAt(550, 150);
      // Synchronously, no frames flushed and no timers run: the change is already in the draft.
      expect((nodeIn(draft(), 'c1') as FolderNode).content.children.map((n) => n.id)).toEqual(['y', 'a']);
      expect(layerEls()).toHaveLength(on ? 1 : 0);
      expect(calls.length).toBe(0); // nothing has even started yet: the animation follows the change
    });
  }

  it('merge: the new folder is in the draft at the drop; the animation plays over it', () => {
    start(true);
    dragOnto('a', [50, 50], [150, 50]);
    vi.advanceTimersByTime(MERGE_DWELL_MS);
    const f = dragFrames;
    dragFrames = [];
    f.forEach((cb) => cb(0));
    expect(get(drag)!.target?.kind).toBe('merge');
    dropAt(150, 50);
    const merged = draft().tabs[0].root.children.find((n) => n.kind === 'folder' && n.id !== 'f1' && n.id !== 'c1') as FolderNode;
    expect(merged.content.children.map((n) => n.id)).toEqual(['b', 'a']);
    expect(layerEls()).toHaveLength(2);
  });

  // The folder dialog opens when the merge animation ends (<= 300 ms); at once when off.
  function mergeDrop(on: boolean) {
    start(on);
    dragOnto('a', [50, 50], [150, 50]);
    vi.advanceTimersByTime(MERGE_DWELL_MS);
    const f = dragFrames;
    dragFrames = [];
    f.forEach((cb) => cb(0));
    expect(get(drag)!.target?.kind).toBe('merge');
    dropAt(150, 50);
    return draft().tabs[0].root.children.find((n) => n.kind === 'folder' && n.id !== 'f1' && n.id !== 'c1') as FolderNode;
  }

  it('merge, animations on: the folder dialog waits for the animation, then opens', () => {
    const made = mergeDrop(true);
    expect(get(editorDialog)).toBeNull();
    flushFrames();
    calls.forEach((c) => c.anim.finish());
    expect(get(editorDialog)).toEqual({ kind: 'folder', id: made.id });
  });

  it('merge, animations on: the dialog still opens (the animation + a 100 ms margin, from its start) if the animation never reports its end', () => {
    const made = mergeDrop(true);
    expect(MERGE_DIALOG_CAP_MS).toBe(MERGE_TOTAL_MS + 100);
    vi.advanceTimersByTime(2000);
    expect(get(editorDialog), 'counted from when the animation starts (its first frame), not from the drop').toBeNull();
    flushFrames();
    vi.advanceTimersByTime(MERGE_DIALOG_CAP_MS - 1);
    expect(get(editorDialog)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(get(editorDialog)).toEqual({ kind: 'folder', id: made.id });
  });

  it('merge, animations off: the folder dialog opens at once', () => {
    const made = mergeDrop(false);
    expect(get(editorDialog)).toEqual({ kind: 'folder', id: made.id });
  });

  it('merge, Always under reduced motion: the dialog waits for the animation', () => {
    reduced = true;
    start('always');
    dragOnto('a', [50, 50], [150, 50]);
    vi.advanceTimersByTime(MERGE_DWELL_MS);
    const f = dragFrames;
    dragFrames = [];
    f.forEach((cb) => cb(0));
    dropAt(150, 50);
    expect(get(editorDialog)).toBeNull();
    flushFrames();
    calls.forEach((c) => c.anim.finish());
    expect(get(editorDialog)?.kind).toBe('folder');
  });

  it('merge, reduced motion: the folder dialog opens at once', () => {
    reduced = true;
    const made = mergeDrop(true);
    expect(get(editorDialog)).toEqual({ kind: 'folder', id: made.id });
  });

  it('merge then Undo before the animation ends: no dialog for the folder that is gone', () => {
    mergeDrop(true);
    undo();
    flushFrames();
    calls.forEach((c) => c.anim.finish());
    vi.advanceTimersByTime(1000);
    expect(get(editorDialog)).toBeNull();
  });

  it('Undo mid-animation restores the draft; the animation finishing later changes nothing', () => {
    start(true);
    dragOnto('a', [50, 50], [550, 150]);
    const before = draft();
    dropAt(550, 150);
    expect(draft()).not.toBe(before);
    undo();
    expect((nodeIn(draft(), 'c1') as FolderNode).content.children.map((n) => n.id)).toEqual(['y']);
    expect(nodeIn(draft(), 'a')).toBeTruthy();
    const afterUndo = draft();
    flushFrames(); // its animations start on the next frame…
    expect(calls.length).toBeGreaterThan(0);
    calls.forEach((c) => c.anim.finish()); // …and finish later
    vi.advanceTimersByTime(1000);
    expect(draft()).toBe(afterUndo);
    expect(layerEls()).toHaveLength(0);
  });

  it('an animation that throws still keeps the edit', () => {
    start(true);
    animEnv({ animate: () => { throw new Error('boom'); } });
    dragOnto('a', [50, 50], [550, 150]);
    dropAt(550, 150);
    expect((nodeIn(draft(), 'c1') as FolderNode).content.children.map((n) => n.id)).toEqual(['y', 'a']);
    expect(get(toast).some((t) => t.message === 'Moved "A" to C1')).toBe(true);
  });
});

describe('gulpScale (a big folder never wobbles)', () => {
  it('squeezes a tile-sized target by the full 6%', async () => {
    const { gulpScale } = await import('./dropAnimation');
    expect(gulpScale(120, 120)).toBeCloseTo(0.94, 5);
  });
  it('moves a big open folder\'s edges by at most GULP_MAX_EDGE_PX', async () => {
    const { gulpScale, GULP_MAX_EDGE_PX } = await import('./dropAnimation');
    const w = 1200, h = 600;
    const edgeMove = ((1 - gulpScale(w, h)) * Math.max(w, h)) / 2;
    expect(edgeMove).toBeLessThanOrEqual(GULP_MAX_EDGE_PX + 1e-9);
  });
});

// -----------------------------------------------------------------: out of a folder

describe('out of a folder', () => {
  const src = { left: 100, top: 300, width: 100, height: 100 }; // where the item was, in its folder
  const spot = { left: 700, top: 50, width: 120, height: 120 }; // where it is drawn now
  /** Elements for findNode, each with its own measured box. */
  function world(boxes: Record<string, { left: number; top: number; width: number; height: number }>) {
    const els: Record<string, HTMLElement> = {};
    for (const id of Object.keys(boxes)) {
      els[id] = document.createElement('div');
      els[id].dataset.id = id;
      document.body.appendChild(els[id]);
    }
    animEnv({
      findNode: (id) => els[id] ?? null,
      measure: (el) => boxes[(el as HTMLElement).dataset.id ?? ''] ?? { left: 0, top: 0, width: 0, height: 0 }
    });
    return els;
  }
  afterEach(() => document.querySelectorAll('[data-id]').forEach((e) => e.remove()));

  it('the timings: about 500 ms, the destination gulp starting as it arrives', () => {
    expect(OUT_MS).toBeGreaterThanOrEqual(400);
    expect(RELEASE_MS).toBeLessThan(OUT_MS);
    expect(OUT_GULP_DELAY_MS).toBeLessThan(OUT_MS);
    expect(OUT_TOTAL_MS).toBeGreaterThanOrEqual(450);
    expect(OUT_TOTAL_MS).toBeLessThanOrEqual(650);
  });

  it('it is over when its animations finish (well before the fallback), and says how it ended', () => {
    setLayout(withAnimations('on'));
    const els = world({ x: spot, f1: { left: 0, top: 250, width: 600, height: 300 }, c1: { left: 500, top: 100, width: 100, height: 100 } });
    const onEnd = vi.fn();
    playDropAnimation('d1', { kind: 'out', from: src, label: 'X', sourceId: 'f1', landedId: 'x', intoId: 'c1', onEnd });
    flushFrames();
    const g = layerEls()[0];
    // The fallback is only a backstop: every part (flight, reveal, puff, gulp) ends inside OUT_TOTAL_MS.
    for (const c of calls) expect(Number(c.opts.delay ?? 0) + Number(c.opts.duration)).toBeLessThanOrEqual(OUT_TOTAL_MS);
    calls.forEach((c) => c.anim.finish());
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(g.isConnected).toBe(false);
    expect(g.dataset.ended).toBe('finished');
    void els;
  });

  it('the fallback removes it if the browser never reports the end, and says so', () => {
    setLayout(withAnimations('on'));
    world({ x: spot, f1: { left: 0, top: 250, width: 600, height: 300 } });
    playDropAnimation('d1', { kind: 'out', from: src, label: 'X', sourceId: 'f1', landedId: 'x' });
    flushFrames();
    const g = layerEls()[0];
    vi.advanceTimersByTime(OUT_TOTAL_MS + 300);
    expect(g.isConnected).toBe(false);
    expect(g.dataset.ended).toBe('safety-net');
  });

  it('the item rises out of the source, then hops on a curve to its new spot, landing at its new size', () => {
    setLayout(withAnimations('on'));
    world({ x: spot, f1: { left: 0, top: 250, width: 600, height: 300 } });
    expect(playDropAnimation('d1', { kind: 'out', from: src, label: 'X', sourceId: 'f1', landedId: 'x' })).toBe(true);
    const g = layerEls();
    expect(g).toHaveLength(1);
    expect(g[0].dataset.kind).toBe('out');
    flushFrames();
    const c = calls.find((x) => x.el.dataset.testid === 'drop-anim')!;
    onlyTransformOpacity(c.frames);
    expect(Number(c.opts.duration)).toBe(OUT_MS);
    expect(c.opts.fill).toBe('forwards');
    // It starts inside the source, smaller…
    expect(xy(c.frames[0])).toEqual({ x: 0, y: 0 });
    expect(scaleOf(c.frames[0])).toBeLessThan(1);
    // …rises out of it (up, while still over the source)…
    const rise = c.frames.find((f) => Number(f.offset) > 0 && Number(f.offset) <= 0.25)!;
    expect(xy(rise).y).toBeLessThanOrEqual(-20);
    expect(Math.abs(xy(rise).x)).toBeLessThan(1);
    expect(Number(rise.opacity)).toBeGreaterThan(0.8);
    // …and lands on the new spot's centre, along a curve.
    const end = c.frames[c.frames.length - 1];
    expect(xy(end).x).toBeCloseTo(610, 0);
    expect(xy(end).y).toBeCloseTo(-240, 0);
    expect(scaleOf(end)).toBeCloseTo(1.2, 2);
    expect(bulge(c.frames.filter((f) => Number(f.offset) >= Number(rise.offset)))).toBeGreaterThanOrEqual(40);
  });

  it('the source does a small release puff (capped like the gulp), marked while it runs', () => {
    setLayout(withAnimations('on'));
    const els = world({ x: spot, f1: { left: 0, top: 0, width: 1200, height: 400 }, small: { left: 0, top: 0, width: 100, height: 100 } });
    const onEnd = vi.fn();
    playDropAnimation('d1', { kind: 'out', from: src, label: 'X', sourceId: 'f1', landedId: 'x', onEnd });
    flushFrames();
    const puff = calls.find((x) => x.el === els.f1)!;
    expect(puff).toBeTruthy();
    onlyTransformOpacity(puff.frames);
    const peak = Math.max(...puff.frames.map(scaleOf));
    expect(peak).toBeGreaterThan(1);
    expect(((peak - 1) * 1200) / 2).toBeLessThanOrEqual(GULP_MAX_EDGE_PX + 1e-9);
    expect(Number(puff.opts.duration)).toBe(RELEASE_MS);
    expect(els.f1.hasAttribute('data-drop-release')).toBe(true);
    calls.forEach((x) => x.anim.finish());
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(els.f1.hasAttribute('data-drop-release')).toBe(false);
    expect(layerEls()).toHaveLength(0);
    expect(releaseScale(100, 100)).toBeCloseTo(1.06, 5); // a small source puffs by the full 6%
  });

  it('the item at its new spot is hidden under the ghost and revealed as it lands (opacity only)', () => {
    setLayout(withAnimations('on'));
    const els = world({ x: spot, f1: { left: 0, top: 250, width: 600, height: 300 } });
    playDropAnimation('d1', { kind: 'out', from: src, label: 'X', sourceId: 'f1', landedId: 'x' });
    flushFrames();
    const reveal = calls.find((x) => x.el === els.x)!;
    expect(reveal).toBeTruthy();
    onlyTransformOpacity(reveal.frames);
    expect(Number(reveal.frames[0].opacity)).toBe(0);
    expect(Number(reveal.frames[reveal.frames.length - 1].opacity)).toBe(1);
  });

  it("the reveal ends at the element's own (computed) opacity, not 1", () => {
    setLayout(withAnimations('on'));
    const els = world({ x: spot, f1: { left: 0, top: 250, width: 600, height: 300 } });
    animEnv({
      findNode: (id) => els[id] ?? null,
      measure: (el) => ({ x: spot, f1: { left: 0, top: 250, width: 600, height: 300 } } as Record<string, { left: number; top: number; width: number; height: number }>)[(el as HTMLElement).dataset.id ?? ''],
      opacity: (el) => ((el as HTMLElement).dataset.id === 'x' ? 0.55 : 1)
    });
    playDropAnimation('d1', { kind: 'out', from: src, label: 'X', sourceId: 'f1', landedId: 'x' });
    flushFrames();
    const reveal = calls.find((x) => x.el === els.x)!;
    expect(Number(reveal.frames[reveal.frames.length - 1].opacity)).toBe(0.55);
    expect(Number(reveal.opts.duration)).toBe(OUT_MS);
    expect(reveal.opts.fill ?? 'none').toBe('none'); // never left hidden after it
  });

  it('into a different folder where the item is not drawn: it hops into that folder, which gulps', () => {
    setLayout(withAnimations('on'));
    const els = world({ c1: { left: 500, top: 100, width: 100, height: 100 }, f1: { left: 0, top: 250, width: 600, height: 300 } });
    playDropAnimation('d1', { kind: 'out', from: src, label: 'X', sourceId: 'f1', landedId: 'x', intoId: 'c1' });
    flushFrames();
    const c = calls.find((x) => x.el.dataset.testid === 'drop-anim')!;
    const end = c.frames[c.frames.length - 1];
    expect(xy(end).x).toBeCloseTo(400, 0);
    expect(xy(end).y).toBeCloseTo(-200, 0);
    expect(scaleOf(end)).toBeLessThanOrEqual(0.4);
    expect(Number(end.opacity)).toBe(0);
    const gulp = calls.find((x) => x.el === els.c1)!;
    expect(gulp.frames.map(scaleOf)).toEqual([1, 0.94, 1]);
    expect(Number(gulp.opts.delay)).toBe(OUT_GULP_DELAY_MS);
    expect(calls.some((x) => x.el === els.f1)).toBe(true); // and the source puffed
  });

  it('nowhere to land on screen (another tab): it still pops out of the source and fades, then is removed', () => {
    setLayout(withAnimations('on'));
    world({ f1: { left: 0, top: 250, width: 600, height: 300 } });
    const onEnd = vi.fn();
    expect(playDropAnimation('d1', { kind: 'out', from: src, label: 'X', sourceId: 'f1', landedId: 'x', onEnd })).toBe(true);
    flushFrames();
    const c = calls.find((x) => x.el.dataset.testid === 'drop-anim')!;
    expect(peakTravel(c.frames)).toBeGreaterThanOrEqual(40);
    expect(Number(c.frames[c.frames.length - 1].opacity)).toBe(0);
    vi.advanceTimersByTime(OUT_TOTAL_MS + 300);
    expect(layerEls()).toHaveLength(0);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('Off, and On under reduced motion, play nothing; Always under reduced motion plays', () => {
    world({ x: spot, f1: src });
    for (const [mode, red, plays] of [['off', false, false], ['on', true, false], ['always', true, true]] as const) {
      calls = [];
      reduced = red;
      setLayout(withAnimations(mode));
      expect(playDropAnimation('d1', { kind: 'out', from: src, label: 'X', sourceId: 'f1', landedId: 'x' })).toBe(plays);
      flushFrames();
      expect(calls.length > 0).toBe(plays);
      resetDropAnimationForTests();
      world({ x: spot, f1: src });
    }
  });
});

describe('items leaving a folder animate out, and the draft changes at once', () => {
  const src = { left: 0, top: 200, width: 100, height: 100 };
  function start(on: boolean | AnimationsMode, boxes: Record<string, { left: number; top: number; width: number; height: number }> = {}) {
    setLayout(withAnimations(on));
    startSession();
    setActiveTab('t1');
    dragEnv();
    const els: Record<string, HTMLElement> = {};
    for (const id of Object.keys(boxes)) {
      els[id] = document.createElement('div');
      els[id].dataset.id = id;
      document.body.appendChild(els[id]);
    }
    animEnv({
      findNode: (id) => els[id] ?? null,
      measure: (el) => boxes[(el as HTMLElement).dataset.id ?? ''] ?? { left: 0, top: 0, width: 0, height: 0 }
    });
    return els;
  }
  afterEach(() => document.querySelectorAll('[data-id]').forEach((e) => e.remove()));

  it('dragged out of a folder onto the tab: the change is made at the drop, then the item pops out of the folder', () => {
    const els = start('on', { x: src, f1: { left: 0, top: 200, width: 800, height: 600 } });
    dragOnto('x', [50, 250], [1500, 1500]);
    expect(get(drag)!.target?.kind).toBe('place');
    dropAt(1500, 1500);
    expect(nodeIn(draft(), 'x')).toBeTruthy();
    expect((nodeIn(draft(), 'f1') as FolderNode).content.children).toHaveLength(0);
    expect(calls).toHaveLength(0); // nothing started before the change
    const g = layerEls();
    expect(g.map((e) => e.dataset.kind)).toEqual(['out']);
    // It starts where the item was in the folder (measured before the change was drawn).
    expect(g[0].style.left).toBe('0px');
    expect(g[0].style.top).toBe('200px');
    flushFrames();
    expect(calls.some((c) => c.el === els.f1)).toBe(true); // the folder's release puff
  });

  it('dragged from one folder into another: out (not into), and the destination gulps', () => {
    const els = start('on', { x: src, f1: { left: 0, top: 200, width: 800, height: 600 }, c1: { left: 500, top: 100, width: 100, height: 100 } });
    dragOnto('x', [50, 50], [550, 150]);
    expect(get(drag)!.target?.kind).toBe('into-folder');
    dropAt(550, 150);
    expect((nodeIn(draft(), 'c1') as FolderNode).content.children.map((n) => n.id)).toEqual(['y', 'x']);
    expect(layerEls().map((e) => e.dataset.kind)).toEqual(['out']);
    flushFrames();
    expect(calls.some((c) => c.el === els.c1)).toBe(true);
    expect(calls.some((c) => c.el === els.f1)).toBe(true);
  });

  it('a drop from the tab into a folder is still "into", not "out"', () => {
    start('on');
    dragOnto('a', [50, 50], [550, 150]);
    dropAt(550, 150);
    expect(layerEls().map((e) => e.dataset.kind)).toEqual(['into']);
  });

  for (const mode of ['move', 'copy'] as const) {
    it(`menu ${mode === 'move' ? 'Move' : 'Copy'} out of a folder: the change is made at once, then it pops out`, () => {
      start('on', { x: src, f1: { left: 0, top: 200, width: 800, height: 600 } });
      expect(moveOrCopyTo(['x'], { tabId: 't1' }, mode)).toBe(true);
      const kids = (nodeIn(draft(), 'f1') as FolderNode).content.children;
      expect(kids).toHaveLength(mode === 'move' ? 0 : 1);
      expect(calls).toHaveLength(0);
      expect(layerEls().map((e) => e.dataset.kind)).toEqual(['out']);
    });
  }

  it('menu Move between places on the tab is not "out of a folder": nothing plays', () => {
    start('on', { a: src });
    expect(moveOrCopyTo(['a'], { tabId: 't1', folderId: 'f1' }, 'move')).toBe(true);
    expect(layerEls().map((e) => e.dataset.kind)).not.toContain('out');
  });

  for (const [mode, red] of [['off', false], ['on', true]] as const) {
    it(`${mode}${red ? ' under reduced motion' : ''}: a drag out of a folder plays nothing, and the change is the same`, () => {
      reduced = red;
      start(mode, { x: src, f1: { left: 0, top: 200, width: 800, height: 600 } });
      dragOnto('x', [50, 250], [1500, 1500]);
      dropAt(1500, 1500);
      expect((nodeIn(draft(), 'f1') as FolderNode).content.children).toHaveLength(0);
      expect(nodeIn(draft(), 'x')).toBeTruthy();
      flushFrames();
      expect(layerEls()).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });

    for (const how of ['move', 'copy'] as const) {
      it(`${mode}${red ? ' under reduced motion' : ''}: menu ${how} OUT of a folder plays nothing, and the change is the same`, () => {
        reduced = red;
        start(mode, { x: src, f1: { left: 0, top: 200, width: 800, height: 600 } });
        expect(moveOrCopyTo(['x'], { tabId: 't1' }, how)).toBe(true);
        expect((nodeIn(draft(), 'f1') as FolderNode).content.children).toHaveLength(how === 'move' ? 0 : 1);
        expect(draft().tabs[0].root.children.some((n) => n.id === 'x' || (n.kind === 'tile' && n.name === 'X'))).toBe(true);
        flushFrames();
        expect(layerEls()).toHaveLength(0);
        expect(calls).toHaveLength(0);
      });
    }
  }
});

describe('cleanup never leaves a real element animated', () => {
  const src = { left: 100, top: 300, width: 100, height: 100 };
  const spot = { left: 700, top: 50, width: 120, height: 120 };
  type Live = FakeAnim & { cancelled?: boolean };
  function world2() {
    const boxes: Record<string, typeof src> = { x: spot, f1: { left: 0, top: 250, width: 600, height: 300 }, c1: { left: 500, top: 100, width: 100, height: 100 } };
    const els: Record<string, HTMLElement> = {};
    for (const id of Object.keys(boxes)) {
      els[id] = document.createElement('div');
      els[id].dataset.id = id;
      document.body.appendChild(els[id]);
    }
    animEnv({
      findNode: (id) => els[id] ?? null,
      measure: (el) => boxes[(el as HTMLElement).dataset.id ?? ''] ?? { left: 0, top: 0, width: 0, height: 0 },
      animate: (el, kf, opts) => {
        const anim = new FakeAnim() as Live;
        anim.cancel = () => { anim.cancelled = true; anim.oncancel?.(); };
        calls.push({ el, frames: kf, opts, anim });
        return anim as unknown as Animation;
      }
    });
    return els;
  }
  afterEach(() => document.querySelectorAll('[data-id]').forEach((e) => e.remove()));
  const onReal = (els: Record<string, HTMLElement>) => calls.filter((c) => Object.values(els).includes(c.el));

  it('when the fallback ends it, the reveal, puff and gulp on real elements are cancelled (never left at opacity 0)', () => {
    setLayout(withAnimations('on'));
    const els = world2();
    playDropAnimation('d1', { kind: 'out', from: src, label: 'X', sourceId: 'f1', landedId: 'x', intoId: 'c1' });
    flushFrames();
    // The ghost's flight finishes; nothing else reports its end.
    calls.find((c) => c.el.dataset.testid === 'drop-anim')!.anim.finish();
    vi.advanceTimersByTime(OUT_TOTAL_MS + 300);
    const real = onReal(els);
    expect(real.length).toBeGreaterThanOrEqual(2);
    for (const c of real) expect((c.anim as Live).cancelled, `${c.el.dataset.id} cancelled`).toBe(true);
  });

  it('cancelDropAnimations() stops every running drop, merge and out animation at once and restores the real elements', () => {
    setLayout(withAnimations('on'));
    const els = world2();
    const ends = [vi.fn(), vi.fn(), vi.fn()];
    playDropAnimation('d1', { kind: 'out', from: src, label: 'X', sourceId: 'f1', landedId: 'x', intoId: 'c1', onEnd: ends[0] });
    playDropAnimation('d1', { kind: 'into', from: src, to: spot, label: 'A', folderId: 'c1', onEnd: ends[1] });
    playDropAnimation('d1', { kind: 'merge', from: src, to: spot, label: 'A', targetLabel: 'B', folderId: 'c1', onEnd: ends[2] });
    flushFrames();
    expect(layerEls().length).toBe(4);
    cancelDropAnimations();
    expect(layerEls()).toHaveLength(0);
    for (const c of calls) expect((c.anim as Live).cancelled).toBe(true);
    for (const el of Object.values(els)) {
      for (const a of ['data-drop-gulp', 'data-drop-pop', 'data-drop-release']) expect(el.hasAttribute(a)).toBe(false);
    }
    ends.forEach((e) => expect(e).toHaveBeenCalledTimes(1));
  });

  it('a drop whose first frame has not run yet is cancelled too (nothing starts afterwards)', () => {
    setLayout(withAnimations('on'));
    world2();
    playDropAnimation('d1', { kind: 'out', from: src, label: 'X', sourceId: 'f1', landedId: 'x' });
    cancelDropAnimations();
    flushFrames();
    expect(calls).toHaveLength(0);
    expect(layerEls()).toHaveLength(0);
  });

  it('setAnimationEnv cancels running animations', () => {
    setLayout(withAnimations('on'));
    world2();
    playDropAnimation('d1', { kind: 'out', from: src, label: 'X', sourceId: 'f1', landedId: 'x' });
    flushFrames();
    const started = calls.slice();
    setAnimationEnv(null);
    expect(layerEls()).toHaveLength(0);
    for (const c of started) expect((c.anim as Live).cancelled).toBe(true);
  });

  for (const to of ['off', 'reduced'] as const) {
    it(`turning animations ${to === 'off' ? 'Off' : 'unavailable (reduced motion, On)'} mid-animation cancels it`, () => {
      setLayout(withAnimations('on'));
      world2();
      playDropAnimation('d1', { kind: 'out', from: src, label: 'X', sourceId: 'f1', landedId: 'x' });
      flushFrames();
      if (to === 'reduced') reduced = true;
      setLayout(withAnimations(to === 'off' ? 'off' : 'on'));
      expect(layerEls()).toHaveLength(0);
      expect(calls.every((c) => (c.anim as Live).cancelled)).toBe(true);
    });
  }

  it('starting a new drag cancels running animations: the just-landed item is visible again', () => {
    setLayout(withAnimations('on'));
    startSession();
    setActiveTab('t1');
    dragEnv();
    const els = world2();
    playDropAnimation('d1', { kind: 'out', from: src, label: 'X', sourceId: 'f1', landedId: 'x' });
    flushFrames();
    const reveal = calls.find((c) => c.el === els.x)!;
    dragOnto('a', [50, 50], [550, 150]);
    expect(get(drag)).not.toBeNull();
    expect((reveal.anim as Live).cancelled).toBe(true);
    expect(layerEls()).toHaveLength(0);
  });
});

describe('multi-select out of folders', () => {
  function startMany(n: number, mode: AnimationsMode = 'on') {
    const d = home();
    const f1 = d.tabs[0].root.children.find((x) => x.id === 'f1') as FolderNode;
    const x = f1.content.children[0];
    f1.content.children = Array.from({ length: n }, (_, i) => ({ ...x, id: `x${i}`, name: `X${i}` }));
    setLayout([{ ...d, display: { animatedFolderBackgrounds: false, animations: mode } }, other()]);
    startSession();
    setActiveTab('t1');
    dragEnv();
    const els: Record<string, HTMLElement> = {};
    const boxes: Record<string, { left: number; top: number; width: number; height: number }> = {
      f1: { left: 0, top: 200, width: 800, height: 600 }, c1: { left: 500, top: 100, width: 100, height: 100 }, y: { left: 520, top: 120, width: 60, height: 60 }
    };
    for (let i = 0; i < n; i++) boxes[`x${i}`] = { left: 10 + 50 * i, top: 210, width: 40, height: 40 };
    for (const id of Object.keys(boxes)) {
      els[id] = document.createElement('div');
      els[id].dataset.id = id;
      document.body.appendChild(els[id]);
    }
    animEnv({
      findNode: (id) => els[id] ?? null,
      measure: (el) => boxes[(el as HTMLElement).dataset.id ?? ''] ?? { left: 0, top: 0, width: 0, height: 0 }
    });
    return els;
  }
  afterEach(() => document.querySelectorAll('[data-id]').forEach((e) => e.remove()));

  it('menu Move of several items out of folders: each pops out of its own spot and source; the source puffs once', () => {
    const els = startMany(3);
    expect(moveOrCopyTo(['x0', 'x1', 'y'], { tabId: 't1' }, 'move')).toBe(true);
    const g = layerEls();
    expect(g.map((e) => e.dataset.kind)).toEqual(['out', 'out', 'out']);
    expect(g.map((e) => e.style.left)).toEqual(['10px', '60px', '520px']);
    flushFrames();
    expect(calls.filter((c) => c.el === els.f1)).toHaveLength(1);
    expect(calls.filter((c) => c.el === els.c1)).toHaveLength(1);
  });

  it('a multi-select drag out of folders animates every moved item, each from its own source', () => {
    startMany(3);
    toggleNode('x0', true);
    toggleNode('x2', true);
    toggleNode('y', true);
    dragOnto('x0', [50, 50], [1500, 1500]);
    expect(get(drag)!.ids.sort()).toEqual(['x0', 'x2', 'y']);
    dropAt(1500, 1500);
    const g = layerEls();
    expect(g).toHaveLength(3);
    expect(g.map((e) => e.style.left).sort()).toEqual(['10px', '110px', '520px']);
  });

  it('at most 12 animate; the rest simply appear', () => {
    startMany(15);
    expect(moveOrCopyTo(Array.from({ length: 15 }, (_, i) => `x${i}`), { tabId: 't1' }, 'move')).toBe(true);
    expect(OUT_MAX_ITEMS).toBe(12);
    expect(layerEls()).toHaveLength(12);
    expect((nodeIn(draft(), 'f1') as FolderNode).content.children).toHaveLength(0);
  });
});

describe('out of a folder to another tab: the source is not drawn', () => {
  // The bug: a drag that dwelt on a tab button switched the tab, so at the drop neither the item nor
  // its folder was drawn and the hop started at the release point — already the destination — so only
  // the landing showed. Now it starts from the source tab's BUTTON, which puffs; with no button drawn
  // it drops in from >= MIN_LAND_PX away. It never travels 0 px.
  const tabBtn = { left: 40, top: 10, width: 120, height: 40 }; // the Grid tab button, in the tab bar
  const spot = { left: 700, top: 300, width: 120, height: 120 }; // where the item landed, on the shown tab
  type B = { left: number; top: number; width: number; height: number };
  /** Nodes not drawn yet: the moved item, until the change is drawn (cleared before each frame flush). */
  const notYet = new Set<string>();
  beforeEach(() => notYet.clear());
  /** Drawn nodes (findNode) and drawn tab buttons that are not the shown tab (findTabButton), each measured. */
  function world(nodes: Record<string, B>, tabs: Record<string, B> = {}) {
    const els: Record<string, HTMLElement> = {};
    const boxes: Record<string, B> = {};
    for (const [id, b] of Object.entries(nodes)) {
      els[id] = document.createElement('div');
      els[id].dataset.id = id;
      boxes[id] = b;
      document.body.appendChild(els[id]);
    }
    for (const [id, b] of Object.entries(tabs)) {
      els[`tab:${id}`] = document.createElement('div');
      els[`tab:${id}`].dataset.id = `tab:${id}`;
      boxes[`tab:${id}`] = b;
      document.body.appendChild(els[`tab:${id}`]);
    }
    animEnv({
      findNode: (id) => (notYet.has(id) ? null : els[id] ?? null),
      findTabButton: (id) => els[`tab:${id}`] ?? null,
      measure: (el) => boxes[(el as HTMLElement).dataset.id ?? ''] ?? { left: 0, top: 0, width: 0, height: 0 }
    });
    return els;
  }
  afterEach(() => document.querySelectorAll('[data-id], [data-tab-button]').forEach((e) => e.remove()));
  const ghostCall = () => calls.find((c) => c.el.dataset.testid === 'drop-anim')!;
  const opts = (fallback?: B) => ({ landed: (id: string) => id, label: () => 'X', fallbackFrom: fallback ? () => fallback : undefined });
  const notDrawn: OutStart = { id: 'x', sourceId: 'f1', tabId: 't1', from: null };

  it('starts from the source tab button and hops to the landed spot, landing at its size (>= 40 px)', () => {
    setLayout(withAnimations('on'));
    world({ x: spot }, { t1: tabBtn });
    playOutOfFolders('d1', [notDrawn], opts({ left: 690, top: 290, width: 120, height: 120 }));
    const g = layerEls();
    expect(g.map((e) => e.dataset.kind)).toEqual(['out']);
    // Drawn at the tab button, not at the release point (the ghost box is ignored).
    expect([g[0].style.left, g[0].style.top, g[0].style.width, g[0].style.height]).toEqual(['40px', '10px', '120px', '40px']);
    flushFrames();
    const c = ghostCall();
    onlyTransformOpacity(c.frames);
    expect(Number(c.opts.duration)).toBe(OUT_MS);
    const end = c.frames[c.frames.length - 1];
    expect(xy(end).x).toBeCloseTo(660, 0); // centre 100,30 → 760,360
    expect(xy(end).y).toBeCloseTo(330, 0);
    expect(peakTravel(c.frames)).toBeGreaterThanOrEqual(40);
  });

  it('the tab button puffs (capped like the gulp: edges move <= 6 px), marked while it runs; the folder does not', () => {
    setLayout(withAnimations('on'));
    const wide = { left: 0, top: 0, width: 400, height: 40 };
    const els = world({ x: spot, f1: { left: 0, top: 0, width: 600, height: 300 } }, { t1: wide });
    // The folder IS found here only to prove the tab is used when the item and folder weren't measured.
    playOutOfFolders('d1', [notDrawn], opts());
    flushFrames();
    const puff = calls.find((c) => c.el === els['tab:t1'])!;
    expect(puff).toBeTruthy();
    onlyTransformOpacity(puff.frames);
    const peak = Math.max(...puff.frames.map(scaleOf));
    expect(peak).toBeGreaterThan(1);
    expect(((peak - 1) * 400) / 2).toBeLessThanOrEqual(GULP_MAX_EDGE_PX + 1e-9);
    expect(Number(puff.opts.duration)).toBe(RELEASE_MS);
    expect(els['tab:t1'].hasAttribute('data-drop-release')).toBe(true);
    expect(calls.some((c) => c.el === els.f1)).toBe(false);
    calls.forEach((c) => c.anim.finish());
    expect(els['tab:t1'].hasAttribute('data-drop-release')).toBe(false);
    expect(layerEls()).toHaveLength(0);
  });

  it('several items from the same tab: each starts at its button, which puffs once', () => {
    setLayout(withAnimations('on'));
    const els = world({ x: spot, y: { left: 900, top: 300, width: 120, height: 120 } }, { t1: tabBtn });
    playOutOfFolders('d1', [notDrawn, { id: 'y', sourceId: 'f2', tabId: 't1', from: null }], opts());
    expect(layerEls().map((e) => e.style.left)).toEqual(['40px', '40px']);
    flushFrames();
    expect(calls.filter((c) => c.el === els['tab:t1'])).toHaveLength(1);
  });

  it("a source that IS drawn still starts where it is (the tab button isn't used)", () => {
    setLayout(withAnimations('on'));
    const els = world({ x: spot, f1: { left: 0, top: 200, width: 600, height: 300 } }, { t1: tabBtn });
    playOutOfFolders('d1', [{ ...notDrawn, from: { left: 100, top: 250, width: 100, height: 100 } }], opts());
    expect(layerEls()[0].style.left).toBe('100px');
    flushFrames();
    expect(calls.some((c) => c.el === els.f1)).toBe(true);
    expect(calls.some((c) => c.el === els['tab:t1'])).toBe(false);
  });

  it('the shown tab\'s button (aria-selected) and a button inside a dialog are never a start (browser lookup)', () => {
    setLayout(withAnimations('on'));
    animEnv({ findTabButton: undefined }); // the real DOM lookup
    const mk = (id: string, selected: boolean) => {
      const b = document.createElement('div');
      b.setAttribute('data-tab-button', id);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(selected));
      document.body.appendChild(b);
      return b;
    };
    mk('t1', true);
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.appendChild(mk('t3', false));
    document.body.appendChild(dlg);
    const t2 = mk('t2', false);
    playOutOfFolders('d1', [notDrawn, { ...notDrawn, id: 'y', tabId: 't3' }], opts());
    expect(layerEls()[0]?.style.left ?? '').not.toBe('40px');
    dlg.remove();
    resetDropAnimationForTests();
    expect(t2.isConnected).toBe(true);
  });

  it('no tab button drawn (a phone layout): it drops in onto its spot from the ghost, settling (>= MIN_LAND_PX)', () => {
    setLayout(withAnimations('on'));
    const els = world({ x: spot });
    const ghostAt = { left: 400, top: 100, width: 120, height: 120 }; // far from the spot
    playOutOfFolders('d1', [notDrawn], opts(ghostAt));
    flushFrames();
    const g = layerEls()[0];
    // Drawn on the spot, starting at the ghost (its offset), overshooting a little, then at rest.
    expect([g.style.left, g.style.top]).toEqual(['700px', '300px']);
    const c = ghostCall();
    onlyTransformOpacity(c.frames);
    expect(xy(c.frames[0])).toEqual({ x: -300, y: -200 });
    expect(peakTravel(c.frames)).toBeGreaterThanOrEqual(MIN_LAND_PX);
    const end = c.frames[c.frames.length - 1];
    expect(xy(end)).toEqual({ x: 0, y: 0 });
    expect(Number(end.opacity)).toBe(0);
    // The settle: just past the spot (along its path) before coming to rest.
    const past = c.frames.find((f) => xy(f).x > 0 && xy(f).y > 0);
    expect(past).toBeTruthy();
    expect(Math.hypot(xy(past!).x, xy(past!).y)).toBeLessThanOrEqual(8);
    // The item is revealed under it as it lands; nothing puffs (no source is drawn).
    const reveal = calls.find((x) => x.el === els.x)!;
    expect(Number(reveal.frames[0].opacity)).toBe(0);
    expect(calls.filter((x) => x.el !== g && x.el !== els.x)).toHaveLength(0);
    calls.forEach((x) => x.anim.finish());
    expect(layerEls()).toHaveLength(0);
  });

  for (const [how, fb] of [['the ghost was right on the spot', { left: 705, top: 298, width: 120, height: 120 }], ['no ghost is known', undefined]] as const) {
    it(`no tab button and ${how}: it drops in from MIN_LAND_PX above (never 0 px)`, () => {
      setLayout(withAnimations('on'));
      world({ x: spot });
      playOutOfFolders('d1', [notDrawn], opts(fb));
      flushFrames();
      const g = layerEls()[0];
      expect(g.style.visibility).toBe('');
      expect([g.style.left, g.style.top]).toEqual(['700px', '300px']);
      const c = ghostCall();
      expect(xy(c.frames[0])).toEqual({ x: 0, y: -MIN_LAND_PX });
      expect(peakTravel(c.frames)).toBeGreaterThanOrEqual(40);
      expect(Number(c.opts.duration)).toBe(OUT_MS);
    });
  }

  it('no tab button and the item is not drawn either: the ghost is removed at once (nothing left behind)', () => {
    setLayout(withAnimations('on'));
    world({});
    const onEndCount = layerEls().length;
    playOutOfFolders('d1', [notDrawn], opts());
    flushFrames();
    expect(layerEls()).toHaveLength(onEndCount);
  });

  for (const [mode, red] of [['off', false], ['on', true]] as const) {
    it(`${mode}${red ? ' under reduced motion' : ''}: nothing plays from the tab button`, () => {
      reduced = red;
      setLayout(withAnimations(mode));
      world({ x: spot }, { t1: tabBtn });
      playOutOfFolders('d1', [notDrawn], opts());
      flushFrames();
      expect(layerEls()).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });
  }

  describe('through a drag and menu Move/Copy', () => {
    function start(on: AnimationsMode, nodes: Record<string, B>, tabs: Record<string, B>) {
      setLayout(withAnimations(on));
      startSession();
      setActiveTab('t1');
      dragEnv();
      return world(nodes, tabs);
    }

    it('a drag whose source is no longer drawn starts from the source tab\'s button, not the drop point', () => {
      const els = start('on', { x: spot }, { t1: tabBtn });
      dragOnto('x', [50, 250], [1500, 1500]);
      // At the drop neither the item nor its folder is drawn (the drag switched tab in the real app).
      notYet.add('x');
      dropAt(1500, 1500);
      notYet.clear(); // the change is drawn: the item is on its new spot
      expect(nodeIn(draft(), 'x')).toBeTruthy();
      const g = layerEls();
      expect(g.map((e) => e.dataset.kind)).toEqual(['out']);
      expect([g[0].style.left, g[0].style.top]).toEqual(['40px', '10px']);
      flushFrames();
      expect(calls.some((c) => c.el === els['tab:t1'])).toBe(true);
    });

    it('a drag with no tab button drawn drops in onto its spot from the ghost', () => {
      start('on', { x: spot }, {});
      dragOnto('x', [50, 250], [1500, 1500]);
      notYet.add('x');
      dropAt(1500, 1500);
      notYet.clear();
      flushFrames();
      const g = layerEls();
      expect(g).toHaveLength(1);
      expect([g[0].style.left, g[0].style.top]).toEqual(['700px', '300px']);
      expect(peakTravel(ghostCall().frames)).toBeGreaterThanOrEqual(MIN_LAND_PX);
    });

    for (const mode of ['move', 'copy'] as const) {
      it(`menu ${mode === 'move' ? 'Move' : 'Copy'} whose source is not drawn starts from the source tab's button`, () => {
        const els = start('on', { x: spot }, { t1: tabBtn });
        notYet.add('x'); // e.g. the selection was kept while another tab is shown
        expect(moveOrCopyTo(['x'], { tabId: 't2' }, mode)).toBe(true);
        notYet.clear();
        expect(layerEls().map((e) => e.style.left)).toEqual(['40px']);
        flushFrames();
        expect(calls.some((c) => c.el === els['tab:t1'])).toBe(true);
      });
    }
  });
});

// A busy device (slow frames) must still see every animation to its end: the safety net for an end
// the browser never reports is counted from the start, and never cuts short one that is still playing.
describe('the safety net', () => {
  /** An animation as the browser reports it: running, `t` ms into its `end` ms. */
  const playing = (at: { t: number; end: number; state?: AnimationPlayState }) =>
    ({
      get playState() { return at.state ?? 'running'; },
      get currentTime() { return at.t; },
      effect: { getComputedTiming: () => ({ endTime: at.end }) }
    }) as unknown as Animation;

  it('fires at its time when nothing reports being in play (the end was never reported)', () => {
    const fire = vi.fn();
    safetyNet([new FakeAnim() as unknown as Animation], 500, 300, fire);
    vi.advanceTimersByTime(499);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('a slow device: still playing and moving on at its time, it waits for what remains instead of cutting it short', () => {
    const fire = vi.fn();
    const at: { t: number; end: number; state?: AnimationPlayState } = { t: 150, end: 440 }; // its first frame came late: only 150 ms in when the net is due
    safetyNet([playing(at)], 740, 300, fire);
    vi.advanceTimersByTime(740);
    expect(fire, 'not cut short while it plays').not.toHaveBeenCalled();
    at.t = 420; // further on: still playing
    vi.advanceTimersByTime(290 + 300);
    expect(fire).not.toHaveBeenCalled();
    at.state = 'finished'; // the end, never reported
    vi.advanceTimersByTime(20 + 300);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('no frames (it is not moving on): it waits, since nothing of it is drawn either, and ends once it is no longer playing', () => {
    const fire = vi.fn();
    const at: { t: number; end: number; state?: AnimationPlayState } = { t: 100, end: 440 };
    safetyNet([playing(at)], 740, 300, fire);
    vi.advanceTimersByTime(740 + 3 * (340 + 300)); // still at 100 ms
    expect(fire).not.toHaveBeenCalled();
    at.state = 'paused'; // stopped short of its end: no longer playing
    vi.advanceTimersByTime(340 + 300);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('its clear stops it', () => {
    const fire = vi.fn();
    const clear = safetyNet([new FakeAnim() as unknown as Animation], 500, 300, fire);
    clear();
    vi.advanceTimersByTime(5000);
    expect(fire).not.toHaveBeenCalled();
  });
});
