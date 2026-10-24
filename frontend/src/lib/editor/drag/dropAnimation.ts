/**
 * Drop and merge animations (M6 §7.13). Decoration only:
 *
 * - The drop's change is applied to the draft BEFORE anything here runs (commitDrop calls this after
 *   apply succeeded), so an animation can never delay, block or lose an edit, and Undo works at any
 *   moment. Everything drawn here is a detached ghost in its own layer on <body> (or a transform on
 *   the new folder's element); the draft is never read back from it.
 * - At most 300 ms; transforms and opacity only, run through the Web Animations API (composited:
 *   no layout thrash and no filters, Tenet 4).
 * - Never under `prefers-reduced-motion`, nor when the global "Animations" setting
 *   (display.animations, Settings → Global settings) is off. The editor reads that setting from each
 *   dashboard's server-computed `display` block; until it is known it is off (never a guessed
 *   animation).
 * - Into a folder: a ghost of the dropped item shrinks into the folder (or the item's new place).
 *   Merge: the dragged tile and the target tile are drawn together, then the new folder pops out.
 * - A browser without element.animate simply gets no animation. An animation that throws is cleaned
 *   up and said once per page (a toast), never silently swallowed; the edit is untouched either way.
 */
import { get } from 'svelte/store';
import { config } from '$lib/stores/config';
import { toast } from '$lib/stores/toast';
import { logError } from '$lib/utils/errors';

/** Into a folder: the ghost shrinking into it. */
export const DROP_MS = 240;
/** Merge: the two tiles drawn together… */
export const GATHER_MS = 150;
/** …then the new folder pops (starts when the gather ends; GATHER_MS + POP_MS ≤ 300). */
export const POP_MS = 150;
/**
 * Ruling 3: after a merge the folder dialog opens when the animation ends. This is the latest it
 * waits if the browser never reports that end (the animation's 300 ms plus a frame-timing margin).
 */
export const MERGE_DIALOG_CAP_MS = GATHER_MS + POP_MS + 50;

export type Box = { left: number; top: number; width: number; height: number };

export interface AnimationEnv {
  reducedMotion(): boolean;
  /** Start a WAAPI animation; null when the browser has no element.animate. */
  animate(el: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null;
  raf(cb: FrameRequestCallback): number;
  /** The rendered element of a node (not one inside a dialog or an inert copy). */
  findNode(id: string): HTMLElement | null;
  measure(el: Element): Box;
}

const domEnv: AnimationEnv = {
  reducedMotion: () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  animate: (el, frames, opts) => (typeof el.animate === 'function' ? el.animate(frames, opts) : null),
  raf: (cb) => requestAnimationFrame(cb),
  findNode: (id) =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-node-id]')).find(
      (n) => n.getAttribute('data-node-id') === id && !n.closest('[inert], [role="dialog"]')
    ) ?? null,
  measure: (el) => el.getBoundingClientRect()
};
let env: AnimationEnv = domEnv;
let failureSaid = false;

/** Tests: replace parts of the browser environment (null restores it). */
export function setAnimationEnv(partial: Partial<AnimationEnv> | null): void {
  env = partial ? { ...domEnv, ...partial } : domEnv;
}

export function resetDropAnimationForTests(): void {
  env = domEnv;
  failureSaid = false;
  if (typeof document !== 'undefined') document.querySelectorAll('[data-testid="drop-anim"]').forEach((e) => e.remove());
}

/** The global "Animations" setting as the server computed it into the dashboard's display block. */
export function animationsSetting(dashboardId: string): boolean {
  const d = get(config)?.dashboards.find((x) => x.id === dashboardId);
  return d?.display?.animations === true;
}

/** The setting is on and the device does not ask for reduced motion. */
export function animationsAllowed(dashboardId: string): boolean {
  if (!animationsSetting(dashboardId)) return false;
  try {
    return !env.reducedMotion();
  } catch {
    return false; // can't tell: no motion
  }
}

export type DropAnimation =
  | { kind: 'into'; from: Box; to: Box | (() => Box | null); label: string; onEnd?: () => void }
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
    const anim = env.animate(el, frames, { easing: 'ease-in', ...opts });
    if (!anim) return false;
    pending++;
    const end = () => {
      if (--pending <= 0) cleanup();
    };
    anim.onfinish = end;
    anim.oncancel = end;
    return true;
  };

  try {
    if (a.kind === 'into') {
      const g = ghost(a.from, a.label, 'into');
      made.push(g);
      const start = (to: Box | null): void => {
        if (done) return;
        if (!ok(to)) return cleanup();
        const { dx, dy } = towards(a.from, to);
        const s = Math.max(0.1, Math.min(0.4, 0.4 * Math.min(to.width / a.from.width, to.height / a.from.height)));
        const frames: Keyframe[] = [
          { transform: 'translate(0px, 0px) scale(1)', opacity: 0.9 },
          { transform: `translate(${n(dx)}px, ${n(dy)}px) scale(${n(s)})`, opacity: 0 }
        ];
        if (!run(g, frames, { duration: DROP_MS })) cleanup();
      };
      if (typeof a.to === 'function') {
        const resolve = a.to;
        env.raf(() => {
          try {
            start(resolve());
          } catch (e) {
            fail(e);
          }
        });
      } else start(a.to);
      setTimeout(cleanup, DROP_MS + 250);
      return !done;
    }

    // Merge: both tiles drawn together into the target's centre…
    if (!ok(a.to)) return false;
    const dragged = ghost(a.from, a.label, 'merge');
    const target = ghost(a.to, a.targetLabel, 'merge');
    made.push(dragged, target);
    const { dx, dy } = towards(a.from, a.to);
    const gathered = run(dragged, [
      { transform: 'translate(0px, 0px) scale(1)', opacity: 0.9 },
      { transform: `translate(${n(dx)}px, ${n(dy)}px) scale(0.500)`, opacity: 0 }
    ], { duration: GATHER_MS }) && run(target, [
      { transform: 'scale(1)', opacity: 0.9 },
      { transform: 'scale(0.500)', opacity: 0 }
    ], { duration: GATHER_MS });
    if (!gathered) {
      cleanup();
      return false;
    }
    // …then the new folder (already in the draft and drawn) pops out, once it is on screen.
    pending++; // the pop's own slot, so the layer is not torn down before it has a chance to start
    env.raf(() => {
      try {
        const el = done ? null : env.findNode(a.folderId);
        if (el) {
          el.setAttribute('data-drop-pop', '');
          cleanups.push(() => el.removeAttribute('data-drop-pop'));
          run(el, [
            { transform: 'scale(0.5)', opacity: 0 },
            { transform: 'scale(1.06)', opacity: 1, offset: 0.7 },
            { transform: 'scale(1)', opacity: 1 }
          ], {
            duration: POP_MS,
            // Starts as the gather ends, counted from the drop (not from this frame): <= 300 ms in all.
            delay: Math.max(0, GATHER_MS - Math.max(0, (typeof performance !== 'undefined' ? performance.now() : 0) - t0)),
            fill: 'backwards',
            easing: 'ease-out'
          });
        }
      } catch (e) {
        fail(e);
        return;
      }
      if (--pending <= 0) cleanup();
    });
    setTimeout(cleanup, GATHER_MS + POP_MS + 250);
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}
