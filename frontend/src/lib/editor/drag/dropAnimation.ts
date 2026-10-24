/**
 * Drop and merge animations (M6 §7.13, Ruling 5). Decoration only:
 *
 * - The drop's change is applied to the draft BEFORE anything here runs (commitDrop calls this after
 *   apply succeeded), so an animation can never delay, block or lose an edit, and Undo works at any
 *   moment. Everything drawn here is a detached ghost in its own layer on <body> (or a transform on
 *   the folder's own element); the draft is never read back from it.
 * - Clearly visible, about 500 ms (Ruling 5; the first version's 240–300 ms shrink in place, started
 *   where the drop already was, was hardly seen). Transforms and opacity only, run through the Web
 *   Animations API (composited: no layout thrash and no filters, Tenet 4).
 *   - Into a folder: the dropped tile flies along a curve into the folder (a hop up and in, so it
 *     visibly travels even when dropped right on it), shrinking and fading there; the folder (or its
 *     tile, or a drilled-in inner box) then gulps (scale 1 → 0.94 → 1).
 *   - Merge: the dragged tile and the target tile part a little, then are drawn together onto the new
 *     folder, which pops in (scale 0.6 → 1.05 → 1). The folder dialog opens when it has ended.
 * - The global "Animations" setting (display.animations, Settings → Global settings) is On / Off /
 *   Always. On plays unless the device asks for reduced motion (the setting then says so, visibly);
 *   Always plays even then; Off never. The editor reads it from each dashboard's server-computed
 *   `display` block; until it is known it is off (never a guessed animation).
 * - A browser without element.animate simply gets no animation. An animation that throws is cleaned
 *   up and said once per page (a toast), never silently swallowed; the edit is untouched either way.
 */
import { get } from 'svelte/store';
import { config } from '$lib/stores/config';
import { toast } from '$lib/stores/toast';
import { logError } from '$lib/utils/errors';

/** Into a folder: the tile's flight. */
export const DROP_MS = 440;
/** …then the folder's gulp, starting as the tile arrives (counted from the drop). */
export const GULP_DELAY_MS = 360;
export const GULP_MS = 180;
export const INTO_TOTAL_MS = Math.max(DROP_MS, GULP_DELAY_MS + GULP_MS);
/** Merge: the two tiles drawn together… */
export const GATHER_MS = 320;
/** …then the new folder pops, starting as they meet (counted from the drop). */
export const POP_DELAY_MS = 260;
export const POP_MS = 260;
export const MERGE_TOTAL_MS = Math.max(GATHER_MS, POP_DELAY_MS + POP_MS);
/**
 * Ruling 3: after a merge the folder dialog opens when the animation ends. This is the latest it
 * waits if the browser never reports that end (the animation plus a frame-timing margin).
 */
export const MERGE_DIALOG_CAP_MS = MERGE_TOTAL_MS + 100;
/** The least height of the drop's hop, so a tile dropped right on its folder still visibly travels. */
const MIN_HOP_PX = 56;
/** How far each merged tile first moves away from the other (at least), before they are drawn together. */
const MIN_PART_PX = 44;

/** The "Animations" setting (Ruling 5). */
export type AnimationsMode = 'on' | 'off' | 'always';

export type Box = { left: number; top: number; width: number; height: number };

export interface AnimationEnv {
  reducedMotion(): boolean;
  /** Start a WAAPI animation; null when the browser has no element.animate. */
  animate(el: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null;
  raf(cb: FrameRequestCallback): number;
  /**
   * The rendered element of a node (not one inside a dialog or an inert copy), or of a drilled-in
   * inner box (a sub-folder drawn as a level of its folder, data-nested-folder).
   */
  findNode(id: string): HTMLElement | null;
  measure(el: Element): Box;
}

const domEnv: AnimationEnv = {
  reducedMotion: () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  animate: (el, frames, opts) => (typeof el.animate === 'function' ? el.animate(frames, opts) : null),
  raf: (cb) => requestAnimationFrame(cb),
  findNode: (id) => {
    const live = (attr: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(`[${attr}]`)).find(
        (n) => n.getAttribute(attr) === id && !n.closest('[inert], [role="dialog"]')
      ) ?? null;
    return live('data-node-id') ?? live('data-nested-folder');
  },
  measure: (el) => el.getBoundingClientRect()
};
let env: AnimationEnv = domEnv;
let failureSaid = false;

/** Tests: replace parts of the browser environment (null restores it). */
export function setAnimationEnv(partial: Partial<AnimationEnv> | null): void {
  // A part given as undefined keeps the browser's own.
  const own = Object.fromEntries(Object.entries(partial ?? {}).filter(([, v]) => v !== undefined));
  env = partial ? { ...domEnv, ...own } : domEnv;
}

export function resetDropAnimationForTests(): void {
  env = domEnv;
  failureSaid = false;
  if (typeof document !== 'undefined') document.querySelectorAll('[data-testid="drop-anim"]').forEach((e) => e.remove());
}

/** The global "Animations" setting as the server computed it into the dashboard's display block. */
export function animationsSetting(dashboardId: string): AnimationsMode {
  const v: unknown = get(config)?.dashboards.find((x) => x.id === dashboardId)?.display?.animations;
  return v === 'on' || v === 'always' ? v : 'off'; // unknown: off, never a guessed animation
}

/** Always; or On while the device does not ask for reduced motion. */
export function animationsAllowed(dashboardId: string): boolean {
  const mode = animationsSetting(dashboardId);
  if (mode === 'always') return true;
  if (mode !== 'on') return false;
  try {
    return !env.reducedMotion();
  } catch {
    return false; // can't tell: no motion
  }
}

export type DropAnimation =
  | { kind: 'into'; from: Box; to: Box | (() => Box | null); label: string; folderId: string; onEnd?: () => void }
  | { kind: 'merge'; from: Box; to: Box; label: string; targetLabel: string; folderId: string; onEnd?: () => void };

const ok = (b: Box | null | undefined): b is Box =>
  !!b && [b.left, b.top, b.width, b.height].every(Number.isFinite) && b.width > 0 && b.height > 0;

const n = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3);

/** A ghost tile drawn at `box` in the animation layer (inline styles: it lives outside any component). */
function ghost(box: Box, label: string, kind: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-testid', 'drop-anim');
  el.setAttribute('data-kind', kind);
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = [
    'position:fixed', `left:${box.left}px`, `top:${box.top}px`, `width:${box.width}px`, `height:${box.height}px`,
    // Below dialogs (ruling 3: no animation is ever drawn over one), above the page, navbar and toolbar.
    'box-sizing:border-box', 'pointer-events:none', 'z-index:calc(var(--z-modal, 1000) - 10)',
    'display:flex', 'align-items:center', 'justify-content:center', 'padding:0.25rem',
    'border-radius:0.75rem', 'border:2px solid var(--accent)',
    'background:color-mix(in srgb, var(--bg-secondary) 85%, transparent)', 'color:var(--text-primary)',
    'box-shadow:0 8px 24px rgba(0,0,0,0.3)', 'opacity:0.9', 'transform-origin:50% 50%', 'will-change:transform,opacity'
  ].join(';');
  const span = document.createElement('span');
  span.textContent = label;
  span.style.cssText = 'font-weight:600;font-size:0.875rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%';
  el.appendChild(span);
  document.body.appendChild(el);
  return el;
}

const centre = (b: Box) => ({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // ease-in-out cubic
const tf = (x: number, y: number, s: number) => `translate(${n(x)}px, ${n(y)}px) scale(${n(s)})`;
const STEPS = 10;

/**
 * The drop's flight from (0, 0) to (dx, dy): a quadratic curve through a hop above the higher end,
 * eased, shrinking to `s` and fading out over the last part.
 */
function flightFrames(dx: number, dy: number, s: number, hop: number): Keyframe[] {
  // The control point, so the curve's top (at its middle) is `hop` px above the higher end.
  const cx = dx / 2, cy = (4 * (Math.min(0, dy) - hop) - dy) / 2;
  const out: Keyframe[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = ease(i / STEPS);
    const x = 2 * (1 - t) * t * cx + t * t * dx;
    const y = 2 * (1 - t) * t * cy + t * t * dy;
    const scale = 1 + (s - 1) * t * t;
    const opacity = t < 0.6 ? 0.95 : 0.95 * (1 - (t - 0.6) / 0.4);
    out.push({ transform: tf(x, y, scale), opacity: Number(n(Math.max(0, opacity))), offset: i / STEPS });
  }
  return out;
}

/**
 * A merged tile's path from (0, 0): first `part` px away along (ux, uy), then onto (dx, dy), where
 * the two meet, shrinking to 0.6 and fading as they arrive.
 */
function gatherFrames(dx: number, dy: number, ux: number, uy: number, part: number): Keyframe[] {
  return [
    { transform: tf(0, 0, 1), opacity: 0.95, offset: 0 },
    { transform: tf(ux * part, uy * part, 1.02), opacity: 0.95, offset: 0.3, easing: 'ease-in' },
    { transform: tf(dx * 0.85, dy * 0.85, 0.75), opacity: 0.9, offset: 0.8 },
    { transform: tf(dx, dy, 0.6), opacity: 0, offset: 1 }
  ];
}

/** The translation from one box's centre to another's. */
const towards = (a: Box, b: Box) => ({
  dx: b.left + b.width / 2 - (a.left + a.width / 2),
  dy: b.top + b.height / 2 - (a.top + a.height / 2)
});

/**
 * Say an animation failure once per page (a toast, and the log); the edit it decorated is untouched.
 * Also used by the drag controller when building an animation's arguments throws.
 */
export function sayAnimationFailure(e: unknown): void {
  logError('Drop animation', e);
  if (!failureSaid) {
    failureSaid = true;
    toast.info("Animations couldn't play here, so they are skipped. Your change was made as usual.");
  }
}

/**
 * Play the drop's animation, if allowed. Returns whether it started; when it did, `onEnd` runs once
 * when it has ended (finished, cancelled, failed, or at the fallback timeout). Never throws: the
 * draft change it decorates has already been made.
 */
export function playDropAnimation(dashboardId: string, a: DropAnimation): boolean {
  if (typeof document === 'undefined' || !animationsAllowed(dashboardId) || !ok(a.from)) return false;
  const made: HTMLElement[] = [];
  const cleanups: (() => void)[] = [];
  let done = false;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const cleanup = () => {
    if (done) return;
    done = true;
    made.forEach((e) => e.remove());
    cleanups.forEach((f) => {
      try {
        f();
      } catch {
        /* the element is already gone */
      }
    });
    try {
      a.onEnd?.();
    } catch (e) {
      sayAnimationFailure(e);
    }
  };
  const fail = (e: unknown) => {
    cleanup();
    sayAnimationFailure(e);
  };
  /** Start one animation; false when the browser can't animate (no element.animate). */
  let pending = 0;
  const run = (el: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions): boolean => {
    const anim = env.animate(el, frames, { easing: 'ease-in-out', ...opts });
    if (!anim) return false;
    pending++;
    const end = () => {
      if (--pending <= 0) cleanup();
    };
    anim.onfinish = end;
    anim.oncancel = end;
    return true;
  };

  /** The folder's own element starts its part (gulp / pop), marked by `attr` while it runs. */
  const onFolder = (attr: string, frames: Keyframe[], duration: number, delayFromDrop: number, fill: FillMode) => {
    const el = done ? null : env.findNode(a.folderId);
    if (!el) return;
    el.setAttribute(attr, '');
    cleanups.push(() => el.removeAttribute(attr));
    const elapsed = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : 0) - t0);
    run(el, frames, { duration, delay: Math.max(0, delayFromDrop - elapsed), fill, easing: 'ease-in-out' });
  };

  try {
    if (a.kind === 'into') {
      const g = ghost(a.from, a.label, 'into');
      made.push(g);
      const resolve = a.to;
      pending++; // held until the frame below has started what it starts
      env.raf(() => {
        try {
          if (done) return;
          const to = typeof resolve === 'function' ? resolve() : resolve;
          if (!ok(to)) {
            pending--;
            return cleanup();
          }
          const { dx, dy } = towards(a.from, to);
          const s = Math.max(0.12, Math.min(0.35, 0.4 * Math.min(to.width / a.from.width, to.height / a.from.height)));
          const hop = Math.max(MIN_HOP_PX, 0.5 * a.from.height);
          if (!run(g, flightFrames(dx, dy, s, hop), { duration: DROP_MS, easing: 'linear', fill: 'forwards' })) {
            pending--;
            return cleanup();
          }
          onFolder('data-drop-gulp', [
            { transform: 'scale(1)' }, { transform: 'scale(0.94)', offset: 0.45 }, { transform: 'scale(1)' }
          ], GULP_MS, GULP_DELAY_MS, 'none');
        } catch (e) {
          fail(e);
          return;
        }
        if (--pending <= 0) cleanup();
      });
      setTimeout(cleanup, INTO_TOTAL_MS + 300);
      return !done;
    }

    // Merge: both tiles drawn together onto the new folder (measured once it is drawn), then it pops.
    if (!ok(a.to)) return false;
    const target = a.to;
    const dragged = ghost(a.from, a.label, 'merge');
    const targetGhost = ghost(target, a.targetLabel, 'merge');
    made.push(dragged, targetGhost);
    pending++;
    env.raf(() => {
      try {
        if (done) return;
        const el = env.findNode(a.folderId);
        const fb = el ? env.measure(el) : null;
        const meet = centre(ok(fb) ? fb : target);
        const pa = centre(a.from), pb = centre(target);
        let ux = pa.x - pb.x, uy = pa.y - pb.y;
        const len = Math.hypot(ux, uy);
        if (len < 1) {
          ux = -1;
          uy = 0; // on top of each other: part sideways
        } else {
          ux /= len;
          uy /= len;
        }
        const part = Math.max(MIN_PART_PX, 0.45 * Math.min(a.from.width, target.width));
        const opts: KeyframeAnimationOptions = { duration: GATHER_MS, easing: 'ease-in-out', fill: 'forwards' };
        const gathered =
          run(dragged, gatherFrames(meet.x - pa.x, meet.y - pa.y, ux, uy, part), opts) &&
          run(targetGhost, gatherFrames(meet.x - pb.x, meet.y - pb.y, -ux, -uy, part), opts);
        if (!gathered) {
          pending--;
          return cleanup();
        }
        onFolder('data-drop-pop', [
          { transform: 'scale(0.6)', opacity: 0 },
          { transform: 'scale(1.05)', opacity: 1, offset: 0.6 },
          { transform: 'scale(1)', opacity: 1 }
        ], POP_MS, POP_DELAY_MS, 'backwards');
      } catch (e) {
        fail(e);
        return;
      }
      if (--pending <= 0) cleanup();
    });
    setTimeout(cleanup, MERGE_TOTAL_MS + 300);
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}
