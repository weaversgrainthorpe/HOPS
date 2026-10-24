import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/utils/api', async () => ({
  ...(await vi.importActual<object>('$lib/utils/api')),
  saveDashboardV3: vi.fn(),
  getConfig: vi.fn(async () => { throw new Error('offline in tests'); })
}));

import type { LayoutDashboard } from '$lib/types/layout';
import { setLayout, resetEditor, home, other } from '$lib/components/editor/editorTestKit';
import {
  setAnimationEnv, resetDropAnimationForTests, type AnimationEnv, type AnimationsMode, type Box
} from './dropAnimation';
import {
  playFolderToggle, playDrill, playPageSlide, flipFrom,
  FOLDER_TOGGLE_MS, DRILL_MS, RECEDE_SCALE, PAGE_MS
} from './flourishes';

// M6 §9: visual flourishes on the drop animations' engine. Decoration only: the change is made first,
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
