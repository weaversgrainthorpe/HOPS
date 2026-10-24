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
  DROP_MS, GATHER_MS, POP_MS, type AnimationEnv
} from './dropAnimation';
import { setLayout, resetEditor, startSession, draft, nodeIn, home, other } from '$lib/components/editor/editorTestKit';

// M6 §7.13: drop and merge animations. Decoration only: the draft changes at once, the animation is
// drawn from the old and new boxes, ≤ 300 ms, transforms and opacity only; never under reduced motion
// or with the global "Animations" setting off.

const GRID = containerMetrics({ columns: 24, children: [] }, 1200);

/** home() with the server-computed display block carrying the global Animations value. */
function withAnimations(on: boolean | undefined): LayoutDashboard[] {
  const d = home();
  if (on !== undefined) d.display = { animatedFolderBackgrounds: false, animations: on };
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
  it('reads the global Animations value from the dashboard display block', () => {
    setLayout(withAnimations(true));
    expect(animationsSetting('d1')).toBe(true);
    setLayout(withAnimations(false));
    expect(animationsSetting('d1')).toBe(false);
  });

  it('unknown (no display block yet, or no such dashboard) is off: never a guessed animation', () => {
    setLayout(withAnimations(undefined));
    expect(animationsSetting('d1')).toBe(false);
    expect(animationsSetting('nope')).toBe(false);
  });

  it('reduced motion turns them off even when the setting is on', () => {
    setLayout(withAnimations(true));
    expect(animationsAllowed('d1')).toBe(true);
    reduced = true;
    expect(animationsAllowed('d1')).toBe(false);
  });
});

describe('playDropAnimation', () => {
  const from = { left: 10, top: 20, width: 100, height: 100 };
  const to = { left: 500, top: 100, width: 100, height: 100 };

  it('into a folder: a ghost shrinks into the folder box within 300 ms, transforms and opacity only', () => {
    setLayout(withAnimations(true));
    expect(playDropAnimation('d1', { kind: 'into', from, to, label: 'A' })).toBe(true);
    expect(layerEls()).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(Number(c.opts.duration)).toBeLessThanOrEqual(300);
    expect(DROP_MS).toBeLessThanOrEqual(300);
    onlyTransformOpacity(c.frames);
    const last = c.frames[c.frames.length - 1];
    expect(String(last.transform)).toMatch(/scale\(0\.\d+\)/); // it shrinks
    expect(Number(last.opacity)).toBe(0);
    c.anim.finish();
    expect(layerEls()).toHaveLength(0); // removed when it finishes
  });

  it('merge: both tiles drawn together, then the new folder pops; the whole thing within 300 ms', () => {
    setLayout(withAnimations(true));
    const folderEl = document.createElement('div');
    document.body.appendChild(folderEl);
    animEnv({ findNode: (id) => (id === 'nf' ? folderEl : null) });
    expect(playDropAnimation('d1', { kind: 'merge', from, to, label: 'A', targetLabel: 'B', folderId: 'nf' })).toBe(true);
    expect(layerEls()).toHaveLength(2); // the dragged tile and the target tile
    flushFrames(); // the new folder is drawn: it pops
    expect(calls).toHaveLength(3);
    expect(GATHER_MS + POP_MS).toBeLessThanOrEqual(300);
    for (const c of calls) {
      onlyTransformOpacity(c.frames);
      expect(Number(c.opts.duration) + Number(c.opts.delay ?? 0)).toBeLessThanOrEqual(300);
    }
    const pop = calls.find((c) => c.el === folderEl)!;
    expect(pop).toBeTruthy();
    expect(Number(pop.opts.delay)).toBe(GATHER_MS);
    expect(folderEl.hasAttribute('data-drop-pop')).toBe(true);
    calls.forEach((c) => c.anim.finish());
    expect(layerEls()).toHaveLength(0);
    expect(folderEl.hasAttribute('data-drop-pop')).toBe(false);
    folderEl.remove();
  });

  it('setting off: nothing at all', () => {
    setLayout(withAnimations(false));
    expect(playDropAnimation('d1', { kind: 'into', from, to, label: 'A' })).toBe(false);
    expect(playDropAnimation('d1', { kind: 'merge', from, to, label: 'A', targetLabel: 'B', folderId: 'nf' })).toBe(false);
    flushFrames();
    expect(layerEls()).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('reduced motion: nothing at all', () => {
    setLayout(withAnimations(true));
    reduced = true;
    expect(playDropAnimation('d1', { kind: 'into', from, to, label: 'A' })).toBe(false);
    flushFrames();
    expect(layerEls()).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('the ghost is removed even if the animation never reports its end', () => {
    setLayout(withAnimations(true));
    playDropAnimation('d1', { kind: 'into', from, to, label: 'A' });
    expect(layerEls()).toHaveLength(1);
    vi.advanceTimersByTime(DROP_MS + 500);
    expect(layerEls()).toHaveLength(0);
  });

  it('a failing animation never throws, leaves no ghost behind and is said once (not silent)', () => {
    setLayout(withAnimations(true));
    animEnv({ animate: () => { throw new Error('boom'); } });
    expect(() => playDropAnimation('d1', { kind: 'into', from, to, label: 'A' })).not.toThrow();
    expect(layerEls()).toHaveLength(0);
    expect(get(toast).filter((t) => /animation/i.test(t.message))).toHaveLength(1);
    playDropAnimation('d1', { kind: 'into', from, to, label: 'A' });
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
  function start(on: boolean) {
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
      expect(calls.length).toBe(on ? 1 : 0);
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
