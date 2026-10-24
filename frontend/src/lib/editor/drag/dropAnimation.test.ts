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
  sayAnimationFailure, MERGE_DIALOG_CAP_MS, DROP_MS, GULP_MS, GULP_DELAY_MS, INTO_TOTAL_MS, GATHER_MS, POP_MS,
  POP_DELAY_MS, MERGE_TOTAL_MS, OUT_MS, RELEASE_MS, OUT_GULP_DELAY_MS, OUT_TOTAL_MS, GULP_MAX_EDGE_PX, releaseScale,
  type AnimationEnv, type AnimationsMode
} from './dropAnimation';
import { moveOrCopyTo } from '../editorActions';
import { editorDialog } from '../editorUi';
import { setLayout, resetEditor, startSession, draft, nodeIn, home, other } from '$lib/components/editor/editorTestKit';

// M6 §7.13 + Ruling 5: drop and merge animations. Decoration only: the draft changes at once. Clearly
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
    for (const g of ghosts) expect(peakTravel(g.frames)).toBeGreaterThanOrEqual(20);
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

  // Ruling 3: the folder dialog opens when the merge animation ends (<= 300 ms); at once when off.
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

  it('merge, animations on: the dialog still opens (the animation + a 100 ms margin) if the animation never reports its end', () => {
    const made = mergeDrop(true);
    expect(MERGE_DIALOG_CAP_MS).toBe(MERGE_TOTAL_MS + 100);
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
    calls.forEach((c) => c.anim.finish());
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

// ------------------------------------------------------------------ §8.1: out of a folder

describe('out of a folder (§8.1)', () => {
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
    expect(OUT_TOTAL_MS).toBe(Math.max(OUT_MS, RELEASE_MS, OUT_GULP_DELAY_MS + GULP_MS));
    expect(OUT_TOTAL_MS).toBeGreaterThanOrEqual(450);
    expect(OUT_TOTAL_MS).toBeLessThanOrEqual(650);
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
    it(`${mode}${red ? ' under reduced motion' : ''}: out of a folder by drag or menu plays nothing, and the change is the same`, () => {
      reduced = red;
      start(mode, { x: src, f1: { left: 0, top: 200, width: 800, height: 600 } });
      dragOnto('x', [50, 250], [1500, 1500]);
      dropAt(1500, 1500);
      expect((nodeIn(draft(), 'f1') as FolderNode).content.children).toHaveLength(0);
      expect(moveOrCopyTo(['x'], { tabId: 't1', folderId: 'f1' }, 'copy')).toBe(true);
      flushFrames();
      expect(layerEls()).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });
  }
});
