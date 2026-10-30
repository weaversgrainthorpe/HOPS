import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/utils/api', async () => ({
  ...(await vi.importActual<object>('$lib/utils/api')),
  saveDashboardV3: vi.fn(),
  getConfig: vi.fn(async () => { throw new Error('offline in tests'); })
}));

import { apply, undo, redo, save } from '$lib/stores/editSession';
import * as api from '$lib/utils/api';
import { get } from 'svelte/store';
import { session } from '$lib/stores/editSession';
import { deleteNodes } from '$lib/editor/treeOps';
import type { LayoutDashboard, LayoutNode } from '$lib/types/layout';
import { setLayout, resetEditor, startSession, home, other, tile, p } from '$lib/components/editor/editorTestKit';
import {
  setAnimationEnv, resetDropAnimationForTests, cancelDropAnimations, claimFlourish, type AnimationEnv, type AnimationsMode, type Box
} from './dropAnimation';
import {
  playFolderToggle, playDrill, playPageSlide, playEdit, watchEdits, playSavedTick, playStatusPulse, statusChanged, flipFrom,
  FOLDER_TOGGLE_MS, DRILL_MS, RECEDE_SCALE, PAGE_MS, GLIDE_MS, DELETE_MS, POP_IN_MS, SAVED_MS, PULSE_MS, MAX_ANIMATED
} from './flourishes';

// Visual flourishes on the drop animations' engine. Decoration only: the change is made first,
// the flourish is transform/opacity on what is already drawn. On / Off / Always + reduced motion gate
// them all; the shared cancel stops them all.

class FakeAnim {
  onfinish: (() => void) | null = null;
  oncancel: (() => void) | null = null;
  cancelled = false;
  finish() { this.onfinish?.(); }
  cancel() { this.cancelled = true; this.oncancel?.(); }
}
type Call = { el: HTMLElement; frames: Keyframe[]; opts: KeyframeAnimationOptions; anim: FakeAnim };
let calls: Call[] = [];
let reduced = false;
let frames: FrameRequestCallback[] = [];
const flush = () => {
  const f = frames;
  frames = [];
  f.forEach((cb) => cb(0));
};
/** Boxes by element (what env.measure returns): tests move elements by changing these. */
let boxes = new Map<Element, Box>();

function withAnimations(mode: AnimationsMode | undefined): LayoutDashboard[] {
  const d = home();
  if (mode !== undefined) d.display = { animatedFolderBackgrounds: false, animations: mode };
  return [d, other()];
}

function env(over: Partial<AnimationEnv> = {}) {
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
    measure: (el) => boxes.get(el) ?? { left: 0, top: 0, width: 0, height: 0 },
    ...over
  });
}

/** A drawn node (data-node-id) at `b`, optionally inside `parent`. */
function node(id: string, b: Box, parent: HTMLElement = document.body, attr = 'data-node-id'): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute(attr, id);
  el.textContent = id;
  parent.appendChild(el);
  boxes.set(el, b);
  return el;
}
const B = (left: number, top: number, width = 100, height = 100): Box => ({ left, top, width, height });

function onlyTransformOpacity(kf: Keyframe[]) {
  for (const f of kf) for (const k of Object.keys(f)) expect(['transform', 'opacity', 'offset', 'easing']).toContain(k);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetEditor();
  resetDropAnimationForTests();
  document.body.innerHTML = '';
  calls = [];
  frames = [];
  boxes = new Map();
  reduced = false;
  env();
  setLayout(withAnimations('on'));
});

afterEach(() => {
  resetDropAnimationForTests();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('FLIP', () => {
  it('draws the new box at the old one (centre origin), and is null when nothing moved', () => {
    expect(flipFrom(B(0, 0), B(100, 50))).toBe('translate(-100.000px, -50.000px) scale(1.000, 1.000)');
    expect(flipFrom(B(0, 0, 50, 50), B(0, 0, 100, 200))).toBe('translate(-25.000px, -75.000px) scale(0.500, 0.250)');
    expect(flipFrom(B(10, 10), B(10.4, 10.4))).toBeNull();
  });
});

describe('1. folder open / minimise', () => {
  it('measures before the change and grows the folder from its tile into its open box (~300 ms)', () => {
    const tileEl = node('f', B(0, 0, 100, 100));
    playFolderToggle('d1', 'f', 'open');
    expect(calls).toHaveLength(0); // nothing until the change is drawn
    tileEl.remove();
    const openEl = node('f', B(0, 0, 400, 300));
    flush();
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.el).toBe(openEl);
    expect(c.opts.duration).toBe(FOLDER_TOGGLE_MS);
    expect(c.frames[0].transform).toBe(flipFrom(B(0, 0, 100, 100), B(0, 0, 400, 300)));
    expect(c.frames[c.frames.length - 1].transform).toBe('none');
    onlyTransformOpacity(c.frames);
    expect(openEl.getAttribute('data-flourish')).toBe('folder-open');
    c.anim.finish();
    expect(openEl.hasAttribute('data-flourish')).toBe(false);
  });

  it('minimise shrinks it back into its tile', () => {
    const openEl = node('f', B(0, 0, 400, 300));
    playFolderToggle('d1', 'f', 'minimise');
    openEl.remove();
    const tileEl = node('f', B(0, 0, 100, 100));
    flush();
    expect(calls[0].el).toBe(tileEl);
    expect(calls[0].frames[0].transform).toBe('translate(150.000px, 100.000px) scale(4.000, 3.000)');
    expect(tileEl.getAttribute('data-flourish')).toBe('folder-minimise');
  });

  it('Off plays nothing; On under reduced motion plays nothing; Always plays even then', () => {
    for (const [mode, red, plays] of [['off', false, false], ['on', true, false], ['always', true, true]] as const) {
      calls = [];
      frames = [];
      document.body.innerHTML = '';
      reduced = red;
      setLayout(withAnimations(mode));
      const a = node('f', B(0, 0));
      playFolderToggle('d1', 'f', 'open');
      a.remove();
      node('f', B(0, 0, 300, 300));
      flush();
      expect(calls.length > 0, `${mode} reduced=${red}`).toBe(plays);
    }
  });
});

describe('guards', () => {
  it('a failing measurement before an open, minimise or drill never stops the change (said, not thrown)', () => {
    env({ findNode: () => { throw new Error('boom'); } });
    expect(() => playFolderToggle('d1', 'f', 'open')).not.toThrow();
    expect(() => playDrill('d1', 'sub', 'top', 'in')).not.toThrow();
    expect(() => playDrill('d1', 'sub', 'top', 'up')).not.toThrow();
    flush();
    expect(calls).toHaveLength(0);
  });

  it('the fallback timer is cleared when a flourish ends', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const before = vi.getTimerCount();
    playStatusPulse('d1', el);
    expect(vi.getTimerCount()).toBe(before + 1);
    calls[0].anim.finish();
    expect(vi.getTimerCount()).toBe(before);
  });
});

describe('2. drill in / up', () => {
  it('in: the inner box zooms forward from its tile and the outer folder recedes slightly, then settles', () => {
    const outer = node('top', B(0, 0, 600, 400));
    const subTile = node('sub', B(20, 60, 100, 100), outer);
    playDrill('d1', 'sub', 'top', 'in');
    subTile.remove();
    const inset = node('sub', B(10, 50, 580, 340), outer, 'data-nested-folder');
    flush();
    const zoom = calls.find((c) => c.el === inset)!;
    const recede = calls.find((c) => c.el === outer)!;
    expect(zoom.opts.duration).toBe(DRILL_MS);
    expect(zoom.frames[0].transform).toBe(flipFrom(B(20, 60, 100, 100), B(10, 50, 580, 340)));
    expect(inset.getAttribute('data-flourish')).toBe('drill-in');
    expect(recede.frames.map((f) => f.transform)).toEqual(['scale(1)', `scale(${RECEDE_SCALE})`, 'scale(1)']);
    expect(outer.getAttribute('data-flourish')).toBe('recede');
    [...zoom.frames, ...recede.frames].forEach(() => onlyTransformOpacity(zoom.frames));
    onlyTransformOpacity(recede.frames);
  });

  it('up: the tile shrinks back from the box and the outer folder comes forward; a tile on another page: only the folder', () => {
    const outer = node('top', B(0, 0, 600, 400));
    const inset = node('sub', B(10, 50, 580, 340), outer, 'data-nested-folder');
    playDrill('d1', 'sub', 'top', 'up');
    inset.remove();
    const subTile = node('sub', B(20, 60, 100, 100), outer);
    flush();
    const back = calls.find((c) => c.el === subTile)!;
    expect(back.frames[0].transform).toBe(flipFrom(B(10, 50, 580, 340), B(20, 60, 100, 100)));
    expect(subTile.getAttribute('data-flourish')).toBe('drill-up');
    expect(calls.find((c) => c.el === outer)!.frames.map((f) => f.transform)).toEqual([`scale(${RECEDE_SCALE})`, 'scale(1)']);

    calls = [];
    const inset2 = node('sub2', B(10, 50, 580, 340), outer, 'data-nested-folder');
    playDrill('d1', 'sub2', 'top', 'up');
    inset2.remove(); // its tile is on another page: not drawn
    flush();
    expect(calls.map((c) => c.el)).toEqual([outer]);
  });

  it('Off: nothing', () => {
    setLayout(withAnimations('off'));
    const outer = node('top', B(0, 0, 600, 400));
    node('sub', B(20, 60), outer);
    playDrill('d1', 'sub', 'top', 'in');
    flush();
    expect(calls).toHaveLength(0);
    expect(frames).toHaveLength(0);
  });
});

describe('3. page change', () => {
  it('next slides in from the right (moving left), previous from the left; ~250 ms; a jump slides once', () => {
    const page = node('f', B(0, 0, 400, 300), document.body, 'data-folder-page-content');
    playPageSlide('d1', 'f', 1);
    flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].el).toBe(page);
    expect(calls[0].opts.duration).toBe(PAGE_MS);
    expect(calls[0].frames[0]).toMatchObject({ transform: 'translateX(200.000px)', opacity: 0 });
    expect(calls[0].frames[1]).toMatchObject({ transform: 'translateX(0px)', opacity: 1 });
    onlyTransformOpacity(calls[0].frames);
    expect(page.getAttribute('data-flourish')).toBe('page');
    playPageSlide('d1', 'f', -1);
    flush();
    expect(calls[1].frames[0].transform).toBe('translateX(-200.000px)');
  });

  it('reduced motion under On: nothing', () => {
    reduced = true;
    node('f', B(0, 0, 400, 300), document.body, 'data-folder-page-content');
    playPageSlide('d1', 'f', 1);
    flush();
    expect(calls).toHaveLength(0);
  });
});

/** The draft with tile `id` moved to `pl` on tab t1. */
const moveTo = (id: string, pl: ReturnType<typeof p>) => (d: LayoutDashboard): LayoutDashboard => {
  const c = structuredClone(d);
  const n = c.tabs[0].root.children.find((x) => x.id === id)!;
  (n as { placement: unknown }).placement = pl;
  return c;
};
const addTile = (t: LayoutNode) => (d: LayoutDashboard): LayoutDashboard => {
  const c = structuredClone(d);
  c.tabs[0].root.children.push(t);
  return c;
};

describe('4, 5, 7. edits: delete, glide, pop-in (and undo / redo)', () => {
  let stop: () => void;
  beforeEach(() => {
    startSession();
    stop = watchEdits();
  });
  afterEach(() => stop());

  it('5. a box changed by an edit glides from its old box (~220 ms); unchanged boxes do not move; the draft changes at once', () => {
    const a = node('a', B(0, 0));
    const b = node('b', B(120, 0));
    expect(apply('Move', moveTo('b', p(6, 0)))).toBe(true);
    expect(calls).toHaveLength(0);
    boxes.set(b, B(360, 0)); // drawn at its new spot
    flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].el).toBe(b);
    expect(calls[0].opts.duration).toBe(GLIDE_MS);
    expect(calls[0].frames[0].transform).toBe('translate(-240.000px, 0.000px) scale(1.000, 1.000)');
    expect(b.getAttribute('data-flourish')).toBe('glide');
    expect(a.hasAttribute('data-flourish')).toBe(false);
  });

  it('undo and redo glide too', () => {
    const b = node('b', B(120, 0));
    apply('Move', moveTo('b', p(6, 0)));
    boxes.set(b, B(360, 0));
    flush();
    calls = [];
    undo();
    boxes.set(b, B(120, 0));
    flush();
    expect(calls[0].frames[0].transform).toBe('translate(240.000px, 0.000px) scale(1.000, 1.000)');
    calls = [];
    redo();
    boxes.set(b, B(360, 0));
    flush();
    expect(calls[0].frames[0].transform).toBe('translate(-240.000px, 0.000px) scale(1.000, 1.000)');
  });

  it('4. a deleted item shrinks and fades as a detached copy (no node ids); its undo pops it back in', () => {
    const a = node('a', B(0, 0));
    apply('Delete', (d) => deleteNodes(d, ['a']));
    const ghost = document.querySelector<HTMLElement>('[data-testid="flourish-ghost"]')!;
    expect(ghost).toBeTruthy();
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.querySelector('[data-node-id]')).toBeNull();
    expect(ghost.style.left).toBe('0px');
    a.remove(); // Svelte removes it
    flush();
    const del = calls.find((c) => c.el === ghost)!;
    expect(del.opts.duration).toBe(DELETE_MS);
    expect(del.frames[del.frames.length - 1]).toMatchObject({ opacity: 0 });
    onlyTransformOpacity(del.frames);
    del.anim.finish();
    expect(document.querySelector('[data-testid="flourish-ghost"]')).toBeNull();

    calls = [];
    undo();
    const back = node('a', B(0, 0));
    flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].el).toBe(back);
    expect(calls[0].opts.duration).toBe(POP_IN_MS);
    expect(calls[0].frames.map((f) => f.transform)).toEqual(['scale(0.6)', 'scale(1.05)', 'scale(1)']);
    expect(back.getAttribute('data-flourish')).toBe('pop-in');
  });

  it('7. a new item pops in at its spot', () => {
    apply('Add tile', addTile(tile('n1', p(20, 0))));
    const n1 = node('n1', B(500, 0));
    flush();
    expect(calls.map((c) => c.el)).toEqual([n1]);
    expect(n1.getAttribute('data-flourish')).toBe('pop-in');
  });

  it('the dropped / claimed item keeps its own animation: the glide and pop-in skip it', () => {
    const a = node('a', B(0, 0));
    const b = node('b', B(120, 0));
    claimFlourish(['b']);
    apply('Move', (d) => moveTo('a', p(10, 0))(moveTo('b', p(6, 0))(d)));
    boxes.set(a, B(240, 0));
    boxes.set(b, B(360, 0));
    flush();
    expect(calls.map((c) => c.el)).toEqual([a]);
  });

  it('an item inside a moving folder moves with it (never two transforms at once)', () => {
    const f = node('f1', B(0, 200, 400, 300));
    const x = node('x', B(10, 250), f);
    apply('Move', moveTo('f1', p(0, 4, 8, 6)));
    boxes.set(f, B(0, 300, 400, 300));
    boxes.set(x, B(10, 350));
    flush();
    expect(calls.map((c) => c.el)).toEqual([f]);
  });

  it(`Tenet 4: at most ${MAX_ANIMATED} items animate for one edit; the rest snap`, () => {
    const many = Array.from({ length: 60 }, (_, i) => tile(`m${i}`, p(0, 10 + i * 2)));
    const els = many.map((t, i) => node(t.id, B(0, 100 + i * 10, 50, 10)));
    apply('Add many', (d) => { const c = structuredClone(d); c.tabs[0].root.children.push(...many); return c; });
    flush();
    calls = [];
    apply('Shift all', (d) => {
      const c = structuredClone(d);
      for (const n of c.tabs[0].root.children) if (n.id.startsWith('m')) (n.placement as { x: number }).x = 4;
      return c;
    });
    els.forEach((el, i) => boxes.set(el, B(200, 100 + i * 10, 50, 10)));
    flush();
    expect(calls).toHaveLength(MAX_ANIMATED);
  });

  it('Off and On under reduced motion: nothing is measured, copied or animated', () => {
    for (const [mode, red] of [['off', false], ['on', true]] as const) {
      reduced = red;
      setLayout(withAnimations(mode));
      const a = node('a', B(0, 0));
      apply('Delete', (d) => deleteNodes(d, ['a']));
      flush();
      expect(document.querySelector('[data-testid="flourish-ghost"]')).toBeNull();
      expect(calls).toHaveLength(0);
      a.remove();
      undo();
    }
  });

  it('the shared cancel (drag start, navigation) and a setting change stop it at once, leaving nothing behind', () => {
    const b = node('b', B(120, 0));
    const a = node('a', B(0, 0));
    apply('Delete a, move b', (d) => moveTo('b', p(6, 0))(deleteNodes(d, ['a'])));
    a.remove();
    boxes.set(b, B(360, 0));
    flush();
    expect(calls.length).toBe(2);
    cancelDropAnimations();
    expect(calls.every((c) => c.anim.cancelled)).toBe(true);
    expect(b.hasAttribute('data-flourish')).toBe(false);
    expect(document.querySelector('[data-testid="flourish-ghost"]')).toBeNull();

    calls = [];
    undo();
    boxes.set(b, B(120, 0));
    node('a', B(0, 0));
    flush();
    expect(calls.length).toBeGreaterThan(0);
    setLayout(withAnimations('off'));
    expect(calls.every((c) => c.anim.cancelled)).toBe(true);
  });

  it('an edit interrupted before its frame (a drag starts at once) never starts later, and leaves no copy', () => {
    const a = node('a', B(0, 0));
    const b = node('b', B(120, 0));
    apply('Delete a, move b', (d) => moveTo('b', p(6, 0))(deleteNodes(d, ['a'])));
    expect(document.querySelector('[data-testid="flourish-ghost"]')).toBeTruthy();
    cancelDropAnimations();
    expect(document.querySelector('[data-testid="flourish-ghost"]')).toBeNull();
    a.remove();
    boxes.set(b, B(360, 0));
    flush();
    expect(calls).toHaveLength(0);
  });

  it('a folder toggle interrupted before its frame never starts', () => {
    const t = node('f', B(0, 0));
    playFolderToggle('d1', 'f', 'open');
    cancelDropAnimations();
    t.remove();
    node('f', B(0, 0, 400, 300));
    flush();
    expect(calls).toHaveLength(0);
  });

  it('a save that brings back the same layout (the server\'s copy) never snaps a running glide', async () => {
    const b = node('b', B(120, 0));
    apply('Move', moveTo('b', p(6, 0)));
    boxes.set(b, B(360, 0));
    flush();
    const glide = calls[0];
    expect(glide.el).toBe(b);
    // The server's normalised copy: the same layout, one field filled in (so a new object, not the draft).
    const stored = { ...structuredClone(get(session)!.draft), revision: 6 };
    (stored.tabs[0].root.children[0] as unknown as Record<string, unknown>).textOpacity = 1;
    vi.mocked(api.saveDashboardV3).mockResolvedValue({ revision: 6, layout: { layoutVersion: 2, dashboards: [stored, other()] } } as never);
    expect(await save()).toBe('saved');
    expect(get(session)!.draft).not.toBe(stored); // the draft was replaced by a copy of the stored layout
    flush();
    expect(glide.anim.cancelled, 'the glide keeps running').toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('a new edit stops the last one first, so it measures resting boxes', () => {
    const b = node('b', B(120, 0));
    apply('Move', moveTo('b', p(6, 0)));
    boxes.set(b, B(360, 0));
    flush();
    const first = calls[0];
    apply('Move', moveTo('b', p(10, 0)));
    expect(first.anim.cancelled).toBe(true);
  });

  it('playEdit never throws on a failing browser call (the edit is already made)', () => {
    env({ drawnNodes: () => { throw new Error('boom'); } });
    expect(() => apply('Move', moveTo('b', p(6, 0)))).not.toThrow();
    expect(() => playEdit('d1', home(), home())).toThrow(); // direct call surfaces it; the watcher catches it
  });
});

describe('6. saved tick', () => {
  it('plays on the tick (~900 ms, transform/opacity) and not when animations are off', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    expect(playSavedTick('d1', el)).toBe(true);
    expect(calls[0].opts.duration).toBe(SAVED_MS);
    expect(el.getAttribute('data-flourish')).toBe('saved');
    onlyTransformOpacity(calls[0].frames);
    expect(calls[0].frames[0].opacity).toBe(0);
    expect(calls[0].frames[calls[0].frames.length - 1].opacity).toBe(0);
    setLayout(withAnimations('off'));
    expect(el.hasAttribute('data-flourish')).toBe(false); // the setting change stopped it
    expect(playSavedTick('d1', el)).toBe(false);
    expect(playSavedTick(undefined, el)).toBe(false);
  });
});

describe('9. status change pulse', () => {
  it('a change is from one real result to another: never the first result, "checking" or "off"', () => {
    expect(statusChanged(undefined, 'up')).toBe(false);
    expect(statusChanged('loading', 'up')).toBe(false);
    expect(statusChanged('up', 'up')).toBe(false);
    expect(statusChanged('up', 'down')).toBe(true);
    expect(statusChanged('down', 'up')).toBe(true);
    expect(statusChanged('up', 'error')).toBe(true);
    expect(statusChanged('disabled', 'up')).toBe(false);
    expect(statusChanged('up', 'disabled')).toBe(false);
    // "unknown" is no result: a failed first fetch (or a first-ever probe) then a real one is not a change.
    expect(statusChanged('unknown', 'up')).toBe(false);
    expect(statusChanged('up', 'unknown')).toBe(false);
    expect(statusChanged('unknown', 'down')).toBe(false);
  });

  it('pulses twice (two peaks), then settles; nothing under Off or reduced motion; Always plays', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    expect(playStatusPulse('d1', el)).toBe(true);
    const tf = calls[0].frames.map((f) => f.transform);
    expect(tf.filter((t) => t !== 'scale(1)')).toHaveLength(2);
    expect(tf[tf.length - 1]).toBe('scale(1)');
    expect(calls[0].opts.duration).toBe(PULSE_MS);
    onlyTransformOpacity(calls[0].frames);
    reduced = true;
    expect(playStatusPulse('d1', el)).toBe(false);
    setLayout(withAnimations('always'));
    expect(playStatusPulse('d1', el)).toBe(true);
    setLayout(withAnimations('off'));
    expect(playStatusPulse('d1', el)).toBe(false);
  });
});
