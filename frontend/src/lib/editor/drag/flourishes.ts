/**
 * Visual flourishes (M6 §9). They are decoration only, like the drop animations in dropAnimation.ts,
 * and run on the same engine:
 *
 * - The same gating. The global "Animations" setting (display.animations) is On / Off / Always. On
 *   plays nothing when the device asks for reduced motion, Always plays even then, and Off never plays.
 * - The same environment (tests swap it with setAnimationEnv).
 * - The same cancel registry: cancelDropAnimations() stops every flourish too. It runs on drag start,
 *   on navigation and when the editor's canvas goes away. A flourish also stops when the setting
 *   changes so that it is no longer allowed.
 * - Transforms and opacity only, run through the Web Animations API. Each one is applied to an element
 *   that is already drawn in its final state, or to a detached copy for a delete. The change it
 *   decorates is made first and is never delayed. Nothing is read back from an animation.
 * - Cheap (Pi Zero, Tenet 4). Boxes are measured once before a change is drawn and once after it,
 *   never per frame. At most MAX_ANIMATED items move at once; the rest simply snap.
 *
 * The flourishes:
 * 1. A folder opens (grows from its tile into its box) or minimises (shrinks back into its tile).
 * 2. Drill in: the inner box zooms forward from its tile and the outer box recedes slightly.
 *    Drill up reverses it.
 * 3. A folder's page slides in the direction of the change: next comes in from the right, previous
 *    from the left.
 * 4. A deleted item shrinks and fades. Undoing a delete pops the item back in.
 * 5. Every box changed by an edit (push, reflow, delete, size change, undo or redo) glides from its
 *    old box to its new one (FLIP). An item with its own animation (claimFlourish) is skipped.
 * 6. A tick on the Save control, after a successful save only.
 * 7. A new item (added, pasted or duplicated) pops in at its spot.
 * 9. A tile's status dot pulses twice when its status changes. It never pulses on first load, and
 *    it pulses in view mode too.
 *
 * Each animated element carries data-flourish="<kind>" while its animation runs. A delete's copy
 * carries data-testid="flourish-ghost" (it is aria-hidden and inert, and has no node ids).
 */
import { config } from '$lib/stores/config';
import {
  animationEnv, animationsAllowed, claimFlourish, sayAnimationFailure, trackAnimation,
  type Box, type Ended
} from './dropAnimation';

export type FlourishKind =
  | 'folder-open' | 'folder-minimise' | 'drill-in' | 'drill-up' | 'recede' | 'page' | 'delete' | 'glide' | 'pop-in'
  | 'saved' | 'status-pulse';

/** 1. Folder open / minimise. */
export const FOLDER_TOGGLE_MS = 300;
/** 2. Drill in / up, and how far the outer box recedes. */
export const DRILL_MS = 300;
export const RECEDE_SCALE = 0.97;
/** 3. A page change, and how far the new page starts from its spot (a share of its width, capped). */
export const PAGE_MS = 250;
export const PAGE_SHIFT = 0.5;
export const PAGE_SHIFT_MAX_PX = 280;

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const valid = (b: Box | null | undefined): b is Box =>
  !!b && [b.left, b.top, b.width, b.height].every(Number.isFinite) && b.width > 0 && b.height > 0;
const r3 = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3);

type Part = { el: HTMLElement; frames: Keyframe[]; opts: KeyframeAnimationOptions; kind: FlourishKind };

/**
 * Start `parts` as one flourish. It ends when all of them have finished, at a fallback timeout, when
 * the setting stops allowing it, or when cancelDropAnimations() runs. Every animation is cancelled
 * at the end, so no element is left part-way, and every ghost is removed. Returns its stop, or null
 * when nothing started. It never throws: a failure is said once and the change is untouched.
 */
function run(dashboardId: string, parts: Part[], ghosts: HTMLElement[] = []): (() => void) | null {
  const env = animationEnv();
  const anims: Animation[] = [];
  const marked: { el: HTMLElement; kind: FlourishKind }[] = [];
  let done = false;
  let pending = 0;
  let untrack: () => void = () => {};
  let unsub: () => void = () => {};
  const stop = (why: Ended = 'finished') => {
    if (done) return;
    done = true;
    untrack();
    unsub();
    for (const a of anims) {
      try {
        a.onfinish = null;
        a.oncancel = null;
        a.cancel();
      } catch {
        /* already gone with its element */
      }
    }
    for (const m of marked) if (m.el.getAttribute('data-flourish') === m.kind) m.el.removeAttribute('data-flourish');
    for (const g of ghosts) {
      g.dataset.ended = why;
      g.remove();
    }
  };
  if (parts.length === 0) {
    stop();
    return null;
  }
  untrack = trackAnimation(stop);
  unsub = config.subscribe(() => {
    if (!done && !animationsAllowed(dashboardId)) stop('setting');
  });
  let longest = 0;
  try {
    for (const p of parts) {
      if (done) break;
      const a = env.animate(p.el, p.frames, { easing: EASE_OUT, ...p.opts });
      if (!a) continue; // no element.animate in this browser: nothing plays
      anims.push(a);
      pending++;
      longest = Math.max(longest, Number(p.opts.duration ?? 0) + Number(p.opts.delay ?? 0));
      if (!ghosts.includes(p.el)) {
        p.el.setAttribute('data-flourish', p.kind);
        marked.push({ el: p.el, kind: p.kind });
      }
      const end = () => {
        if (--pending <= 0) stop();
      };
      a.onfinish = end;
      a.oncancel = end;
    }
  } catch (e) {
    stop('failed');
    sayAnimationFailure(e);
    return null;
  }
  if (anims.length === 0) {
    stop();
    return null;
  }
  setTimeout(() => stop('fallback'), longest + 300);
  return () => stop('interrupted');
}

/** An element's box now (transforms included), or null when it can't be measured. */
function boxOf(el: Element | null | undefined): Box | null {
  if (!el) return null;
  try {
    const b = animationEnv().measure(el);
    return valid(b) ? { left: b.left, top: b.top, width: b.width, height: b.height } : null;
  } catch {
    return null;
  }
}

/** A drawn node's (or drilled-in box's) element and box, or null. */
function measured(id: string): { el: HTMLElement; box: Box } | null {
  const el = animationEnv().findNode(id);
  const box = boxOf(el);
  return el && box ? { el, box } : null;
}

const clampScale = (s: number) => Math.min(20, Math.max(0.05, s));

/**
 * FLIP: the transform that draws a box now at `to` at `from` instead (the default transform origin
 * is the centre). Null when the two are the same box, so there is nothing to see.
 */
export function flipFrom(from: Box, to: Box): string | null {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const sx = clampScale(from.width / to.width);
  const sy = clampScale(from.height / to.height);
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(from.width - to.width) < 1 && Math.abs(from.height - to.height) < 1) return null;
  return `translate(${r3(dx)}px, ${r3(dy)}px) scale(${r3(sx)}, ${r3(sy)})`;
}

const flipPart = (el: HTMLElement, from: Box, to: Box, kind: FlourishKind, duration: number): Part | null => {
  const t = flipFrom(from, to);
  return t ? { el, kind, frames: [{ transform: t }, { transform: 'none' }], opts: { duration, easing: EASE_OUT } } : null;
};

function allowed(dashboardId: string | undefined): dashboardId is string {
  return typeof document !== 'undefined' && !!dashboardId && animationsAllowed(dashboardId);
}

/** Run on the next frame, after the change has been drawn. Never throws. */
function nextFrame(fn: () => void): void {
  try {
    animationEnv().raf(() => {
      try {
        fn();
      } catch (e) {
        sayAnimationFailure(e);
      }
    });
  } catch (e) {
    sayAnimationFailure(e);
  }
}

// ---- 1. Folder open / minimise ------------------------------------------------------------------

/**
 * Call BEFORE a folder is opened or minimised (in view or edit mode). Its box is measured now. Once
 * the change is drawn, the folder grows from that box into its open box, or shrinks back into its
 * tile. In edit mode the edit glide skips the folder and moves only its neighbours.
 */
export function playFolderToggle(dashboardId: string, folderId: string, to: 'open' | 'minimise'): void {
  if (!allowed(dashboardId)) return;
  const before = measured(folderId);
  if (!before) return;
  claimFlourish([folderId]);
  nextFrame(() => {
    const after = measured(folderId);
    if (!after) return;
    const part = flipPart(after.el, before.box, after.box, to === 'open' ? 'folder-open' : 'folder-minimise', FOLDER_TOGGLE_MS);
    if (part) run(dashboardId, [part]);
  });
}

// ---- 2. Drill in / up ---------------------------------------------------------------------------

/**
 * Call BEFORE drilling into sub-folder `subId` (its tile is on the page of open folder `outerId`),
 * or BEFORE going up out of it (its inset box returns to its tile). Into it: the inset box zooms
 * forward from the tile while the outer folder recedes slightly and settles. Up: the tile shrinks
 * back from the box, and the outer folder comes forward again. If the tile isn't drawn (it is on
 * another page), only the outer folder moves.
 */
export function playDrill(dashboardId: string, subId: string, outerId: string, dir: 'in' | 'up'): void {
  if (!allowed(dashboardId)) return;
  const before = measured(subId);
  claimFlourish([subId, outerId]);
  nextFrame(() => {
    const parts: Part[] = [];
    const after = before ? measured(subId) : null;
    const outer = measured(outerId);
    if (before && after) {
      const part = flipPart(after.el, before.box, after.box, dir === 'in' ? 'drill-in' : 'drill-up', DRILL_MS);
      if (part) {
        if (dir === 'up') part.frames = [{ transform: part.frames[0].transform, opacity: 0.6 }, { transform: 'none', opacity: 1 }];
        parts.push(part);
      }
    }
    if (outer && outer.el !== after?.el) {
      parts.push({
        el: outer.el, kind: 'recede', opts: { duration: DRILL_MS, easing: 'ease-in-out' },
        frames: dir === 'in'
          ? [{ transform: 'scale(1)' }, { transform: `scale(${RECEDE_SCALE})`, offset: 0.45 }, { transform: 'scale(1)' }]
          : [{ transform: `scale(${RECEDE_SCALE})` }, { transform: 'scale(1)' }]
      });
    }
    run(dashboardId, parts);
  });
}

// ---- 3. Page change -----------------------------------------------------------------------------

/**
 * Call when folder `folderId`'s page has changed: `dir` 1 is a later page (it comes in from the
 * right, moving left) and -1 an earlier one. A jump of several pages slides once.
 */
export function playPageSlide(dashboardId: string, folderId: string, dir: 1 | -1): void {
  if (!allowed(dashboardId)) return;
  nextFrame(() => {
    const el = animationEnv().findPage(folderId);
    const box = boxOf(el);
    if (!el || !box) return;
    const shift = Math.min(PAGE_SHIFT_MAX_PX, box.width * PAGE_SHIFT) * dir;
    run(dashboardId, [{
      el, kind: 'page', opts: { duration: PAGE_MS, easing: EASE_OUT },
      frames: [{ transform: `translateX(${r3(shift)}px)`, opacity: 0 }, { transform: 'translateX(0px)', opacity: 1 }]
    }]);
  });
}
